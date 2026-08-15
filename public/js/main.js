// main.js - Entry point: wires UI events to game logic
(function () {
  'use strict';

  // Guard against double-execution (e.g. the bundle being injected twice):
  // re-running this file would create a second Game instance, a second
  // game loop, and duplicate every listener below.
  if (window.__wordhunterMainBooted) return;
  window.__wordhunterMainBooted = true;

  // Boot
  const game = new Game();
  window._game = game;  // for debugging

  // ---- Title screen wiring ----
  const nameInput = document.getElementById('player-name');
  const startBtn = document.getElementById('btn-start');
  const ageButtons = document.querySelectorAll('.age-btn');
  const saveInfo = document.getElementById('save-info');

  const TOTAL = (window.Levels && Levels.TOTAL_LEVELS) || 666; // Fallback matches actual TOTAL_LEVELS in levels.js

  // Helper to prevent duplicate event listeners
  function addClickOnce(btn, handler) {
    if (btn && !btn.dataset.wired) {
      btn.addEventListener('click', handler);
      btn.dataset.wired = 'true';
    }
  }

  function updateStartButton() {
    const ok = nameInput.value.trim().length > 0;
    startBtn.disabled = !ok;
    if (ok) {
      // If this player is logged in (AND the typed name matches the logged-in
      // nickname), trust the server's maxLevel as the single source of truth;
      // only fall back to localStorage for guests. This prevents a stale
      // local save from sending the player to a level they've already lost
      // access to.
      const name = nameInput.value.trim();
      const loggedIn = window.RegisterModule && window.RegisterModule.isLoggedInAs &&
                       window.RegisterModule.isLoggedInAs(name);
      let n = null;
      if (loggedIn && game.maxUnlocked && game.maxUnlocked > 1) {
        n = Math.max(1, Math.min(TOTAL, parseInt(game.maxUnlocked, 10) || 1));
      } else {
        try {
          const key = 'wordhunter:save:' + name;
          const raw = localStorage.getItem(key);
          if (raw) {
            const data = JSON.parse(raw);
            n = Math.max(1, Math.min(TOTAL, parseInt(data.maxUnlocked, 10) || 1));
          }
        } catch (e) {
          console.error('Failed to parse save data:', e);
          saveInfo.textContent = '存档读取错误，将开始新游戏';
          return;
        }
      }
      if (n && n > 1) {
        saveInfo.textContent = '上次进度: 第 ' + n + ' / ' + TOTAL + ' 关';
      } else {
        saveInfo.textContent = '新玩家: ' + TOTAL + ' 关等你挑战!';
      }
      // Mirror "继续狩猎" / "开始狩猎" in the start button
      const span = startBtn.querySelector('span:nth-child(2)');
      if (span) {
        span.textContent = n && n > 1 ? '继续狩猎' : '开始狩猎';
      }
    } else {
      saveInfo.textContent = '';
    }
  }
  if (nameInput && !nameInput.dataset.wired) {
    nameInput.addEventListener('input', updateStartButton);
    nameInput.dataset.wired = 'true';
  }

  // Prevent duplicate event listeners if script loads multiple times
  const ageButtonsContainer = document.querySelector('.age-buttons-container');
  if (ageButtonsContainer && !ageButtonsContainer.dataset.wired) {
    ageButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        ageButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        game.ageGroup = parseInt(btn.dataset.age, 10);
      });
    });
    ageButtonsContainer.dataset.wired = 'true';
  }

  let isStarting = false; // Prevent concurrent startLevel calls
  addClickOnce(startBtn, async () => {
    if (isStarting) return; // Prevent concurrent starts
    const name = nameInput.value.trim();
    if (!name) return;
    isStarting = true;
    startBtn.disabled = true; // Disable during loading

    try {
      game.playerName = name;
      Utils.playBeep('click');

      // Resume from the local save — but only for guests, for a logged-in
      // player whose server progress is unknown (e.g. restoreSession was
      // offline), or when the typed name differs from the logged-in
      // nickname. A logged-in player WITH server progress must not be
      // downgraded by a stale local save; the server profile is the single
      // source of truth.
      const loggedIn = window.RegisterModule && window.RegisterModule.isLoggedInAs &&
                       window.RegisterModule.isLoggedInAs(name);
      if (!(loggedIn && game.maxUnlocked > 1)) {
        const save = game.loadSave();
        if (save && save.maxUnlocked) {
          game.maxUnlocked = Math.max(1, Math.min(TOTAL, parseInt(save.maxUnlocked, 10) || 1));
        }
      }

      // Load FULL vocabulary (no age filter) so every level (1..666) can
      // find words in its difficulty band [d-1, d+1]. The server used to
      // filter by age which truncated high-difficulty words and broke
      // levels 5xx/6xx for younger players. Age is now used only for
      // progress tracking and UI display, not for word selection.
      try {
        game.vocabulary = await API.getVocabulary();
        game.words = (game.vocabulary && game.vocabulary.words) || [];
      } catch (e) {
        console.error('Vocabulary load failed:', e);
        game.vocabulary = null;
        game.words = [];
        Utils.toast('词库加载失败，请检查网络');
        return;
      }
      if (game.words.length === 0) {
        Utils.toast('词库加载失败，请刷新重试');
        return;
      }

      // Go to level 1 (or resume). Clamp so a corrupt save can never send
      // us outside [1, TOTAL]. Await so the isStarting mutex stays held
      // until the level intro is actually shown.
      try {
        // Clear any keys pressed while on the title screen so the new
        // level doesn't start with a held direction.
        if (game.input && typeof game.input.reset === 'function') game.input.reset();
        const target = Math.max(1, Math.min(TOTAL, parseInt(game.maxUnlocked, 10) || 1));
        await game.startLevel(target);
      } catch (e) {
        console.error('Failed to start level:', e);
        Utils.toast('关卡启动失败，请重试');
      }
    } finally {
      // Every path (success, vocab failure, startLevel failure, unexpected
      // throw) must re-arm the button and release the mutex.
      isStarting = false;
      startBtn.disabled = false;
      updateStartButton(); // Re-enable based on name input
    }
  });

  // ---- Level intro ----
  addClickOnce(document.getElementById('btn-go'), () => {
    game.beginPlay();
  });

  // ---- Result screen buttons ----
  addClickOnce(document.getElementById('btn-next-level'), () => {
    const next = game.currentLevelNum + 1;
    if (next > TOTAL) {
      Utils.toast('🎉 恭喜通关全部 ' + TOTAL + ' 关！回到第 1 关继续挑战');
      game.startLevel(1); // maxUnlocked is preserved
    } else {
      game.startLevel(next);
    }
  });

  addClickOnce(document.getElementById('btn-replay'), () => {
    game.startLevel(game.currentLevelNum);
  });

  addClickOnce(document.getElementById('btn-retry'), () => {
    game.startLevel(game.currentLevelNum);
  });

  addClickOnce(document.getElementById('btn-home-win'), goHome);
  addClickOnce(document.getElementById('btn-home-lose'), goHome);

  function goHome() {
    // Pause game loop to prevent performance issues and state anomalies
    if (game.state && game.state !== 'title') {
      game.paused = true;
    }
    // Drop any held direction keys / joystick drag so the next level
    // doesn't start with the player already moving. (startLevel() itself
    // clears game.paused, so this pause can never become permanent.)
    if (game.input && typeof game.input.reset === 'function') game.input.reset();
    game.showScreen('screen-title');
    game.showHUD(false);
    // Re-render save info
    updateStartButton();
  }

  // Preload the 666-level list in the background so the first level
  // start is instant. If this fails (offline), startLevel() will still
  // work via the local fallback in Levels.getLevel().
  if (window.Levels && Levels.loadAll) {
    Levels.loadAll().catch(() => {});
  }

  // Show initial save info
  updateStartButton();

  // Re-run updateStartButton after a short delay so that the (async)
  // restoreSession() in register.js — which may pull maxUnlocked from
  // the server — gets reflected in the title-screen progress text.
  // Without this, a logged-in returning player briefly sees "新玩家"
  // until they type a character into the name field.
  setTimeout(updateStartButton, 500);
  setTimeout(updateStartButton, 2000);
  // Also re-render when register.js explicitly tells us the session
  // profile is loaded (after login, after register, or after restore).
  document.addEventListener('wordhunter:session-restored', updateStartButton);
  document.addEventListener('wordhunter:session-cleared', updateStartButton);
})();
