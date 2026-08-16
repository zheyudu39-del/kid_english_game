// mp.js - Multiplayer versus lobby: create / join / quick-match rooms and
// orchestrate the net game flow between the lobby UI and game.js.
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  let booted = false;
  let myId = null;
  let room = null;          // { code, state, level, players: [{id,name,color,host}] }
  let mpLevel = 1;

  function game() { return window._game || null; }

  function maxLevelChoice() {
    const g = game();
    const unlocked = (g && g.maxUnlocked) || 1;
    return Math.max(1, Math.min(window.Levels.TOTAL_LEVELS, unlocked));
  }

  // ---- view switching ----
  function showView(name) {
    ['mp-menu', 'mp-searching', 'mp-room'].forEach(id => {
      const v = el(id);
      if (v) v.classList.toggle('hidden', id !== name);
    });
  }

  async function open() {
    const screen = el('screen-mp');
    if (!screen) return;
    const reg = window.RegisterModule;
    if (!reg || !reg.isLoggedIn()) {
      Utils.toast('联机对战需要先登录账号');
      if (reg && typeof reg.showLoginModal === 'function') reg.showLoginModal();
      return;
    }
    const g = game();
    if (g && typeof g.pauseForModal === 'function') g.pauseForModal();
    mpLevel = maxLevelChoice();
    renderLevel();
    // If we're still in a room (e.g. after a match), reopen straight to it.
    showView(room ? 'mp-room' : 'mp-menu');
    screen.classList.remove('hidden');
    try { await window.Net.ensureConnected(); }
    catch (e) {
      Utils.toast('联机服务连接失败，请稍后再试');
    }
  }

  function close() {
    const screen = el('screen-mp');
    if (screen) screen.classList.add('hidden');
    const g = game();
    if (g && typeof g.isModalPaused === 'function' && typeof g.resumeFromModal === 'function' && g.isModalPaused()) {
      g.resumeFromModal();
    }
    // Closing the lobby also leaves any room we were sitting in.
    if (room) {
      room = null;
      window.Net.leaveRoom();
      Utils.toast('已离开房间');
    }
  }

  // ---- lobby widgets ----
  function renderLevel() {
    const num = el('mp-level-num');
    if (num) num.textContent = '第 ' + mpLevel + ' 关';
    const minus = el('mp-level-minus');
    const plus = el('mp-level-plus');
    if (minus) minus.disabled = mpLevel <= 1;
    if (plus) plus.disabled = mpLevel >= maxLevelChoice();
  }

  function renderRoom() {
    if (!room) { showView('mp-menu'); return; }
    showView('mp-room');
    const codeEl = el('mp-code');
    if (codeEl) codeEl.textContent = room.code;
    const list = el('mp-players');
    if (list) {
      list.textContent = '';
      (room.players || []).forEach(p => {
        const row = document.createElement('div');
        row.className = 'mp-player';
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.setProperty('--pc', p.color || '#2ed573');
        const name = document.createElement('span');
        name.className = 'mp-player__name';
        name.textContent = p.name + (p.id === myId ? '（你）' : '');
        row.append(dot, name);
        if (p.host) {
          const crown = document.createElement('span');
          crown.className = 'host-mark';
          crown.textContent = '👑';
          crown.setAttribute('aria-label', '房主');
          row.appendChild(crown);
        }
        list.appendChild(row);
      });
    }
    const amHost = (room.players || []).some(p => p.host && p.id === myId);
    const startBtn = el('btn-mp-start');
    if (startBtn) startBtn.classList.toggle('hidden', !amHost);
    const hint = el('mp-hint');
    if (hint) {
      hint.textContent = amHost
        ? '人齐后点击开始对战（2-4 人）'
        : '等待房主开始对战…';
    }
  }

  // ---- actions ----
  function createRoom() {
    window.Net.ensureConnected().then(() => {
      window.Net.createRoom(mpLevel);
    }).catch(() => Utils.toast('联机服务连接失败，请稍后再试'));
  }

  function quickMatch() {
    window.Net.ensureConnected().then(() => {
      window.Net.quickMatch(mpLevel);
      showView('mp-searching');
    }).catch(() => Utils.toast('联机服务连接失败，请稍后再试'));
  }

  function cancelQuick() {
    // 'leave' doubles as "cancel quick match" server-side (it drops any
    // queued entry AND leaves a room when in one).
    window.Net.leaveRoom();
    showView('mp-menu');
  }

  function joinByCode() {
    const input = el('mp-join-code');
    const code = (input && input.value || '').trim();
    if (!/^\d{4}$/.test(code)) {
      Utils.toast('请输入 4 位数字房间码');
      return;
    }
    window.Net.ensureConnected().then(() => {
      window.Net.joinRoom(code);
    }).catch(() => Utils.toast('联机服务连接失败，请稍后再试'));
  }

  function leaveRoom() {
    room = null;
    window.Net.leaveRoom();
    showView('mp-menu');
  }

  // ---- result screen actions ----
  function backToLobby() {
    const result = el('screen-mp-result');
    if (result) result.classList.add('hidden');
    const g = game();
    if (g && g.state !== 'playing') {
      // Park the game loop; the lobby overlays the title screen state.
      g.paused = true;
      g.state = 'title';
    }
    const screen = el('screen-mp');
    if (screen) screen.classList.remove('hidden');
    renderRoom();
  }

  function backToTitle() {
    const result = el('screen-mp-result');
    if (result) result.classList.add('hidden');
    if (room) { room = null; window.Net.leaveRoom(); }
    const g = game();
    if (g) {
      g.paused = true;
      g.state = 'title';
      if (g.input && typeof g.input.reset === 'function') g.input.reset();
      if (g.input && typeof g.input.setLocked === 'function') g.input.setLocked(false);
      g.showScreen('screen-title');
      g.showHUD(false);
    }
  }

  // ---- net events ----
  function bindNet() {
    const Net = window.Net;

    Net.on('welcome', (msg) => { myId = msg.id; });

    Net.on('room', (msg) => {
      room = msg;
      renderRoom();
    });

    Net.on('countdown', (msg) => {
      const hint = el('mp-hint');
      if (hint && msg.n > 0) hint.textContent = '匹配成功！' + msg.n + ' 秒后开始对战…';
    });

    Net.on('start', (msg) => {
      const screen = el('screen-mp');
      if (screen) screen.classList.add('hidden');
      const g = game();
      if (g && typeof g.startLevelNet === 'function') {
        g.startLevelNet(msg, myId);
      }
    });

    Net.on('error', (msg) => {
      Utils.toast(msg.msg || '联机错误');
      // Errors from queue timeout etc. land us back on the menu.
      if (!room && !el('mp-searching').classList.contains('hidden')) {
        showView('mp-menu');
      }
    });

    Net.onStatus((s) => {
      if (s === 'closed' && room) {
        Utils.toast('联机连接已断开');
        room = null;
        showView('mp-menu');
      }
    });
  }

  // ---- init ----
  function init() {
    if (booted) return;
    booted = true;
    bindNet();

    const mpBtn = el('btn-multiplayer');
    if (mpBtn && !mpBtn.dataset.wired) {
      mpBtn.addEventListener('click', open);
      mpBtn.dataset.wired = '1';
    }
    const closeBtn = el('btn-mp-close');
    if (closeBtn && !closeBtn.dataset.wired) {
      closeBtn.addEventListener('click', close);
      closeBtn.dataset.wired = '1';
    }
    const minus = el('mp-level-minus');
    if (minus && !minus.dataset.wired) {
      minus.addEventListener('click', () => {
        mpLevel = Math.max(1, mpLevel - 1);
        renderLevel();
      });
      minus.dataset.wired = '1';
    }
    const plus = el('mp-level-plus');
    if (plus && !plus.dataset.wired) {
      plus.addEventListener('click', () => {
        mpLevel = Math.min(maxLevelChoice(), mpLevel + 1);
        renderLevel();
      });
      plus.dataset.wired = '1';
    }
    const createBtn = el('btn-mp-create');
    if (createBtn && !createBtn.dataset.wired) {
      createBtn.addEventListener('click', createRoom);
      createBtn.dataset.wired = '1';
    }
    const quickBtn = el('btn-mp-quick');
    if (quickBtn && !quickBtn.dataset.wired) {
      quickBtn.addEventListener('click', quickMatch);
      quickBtn.dataset.wired = '1';
    }
    const cancelBtn = el('btn-mp-cancel-quick');
    if (cancelBtn && !cancelBtn.dataset.wired) {
      cancelBtn.addEventListener('click', cancelQuick);
      cancelBtn.dataset.wired = '1';
    }
    const joinBtn = el('btn-mp-join');
    if (joinBtn && !joinBtn.dataset.wired) {
      joinBtn.addEventListener('click', joinByCode);
      joinBtn.dataset.wired = '1';
    }
    const leaveBtn = el('btn-mp-leave');
    if (leaveBtn && !leaveBtn.dataset.wired) {
      leaveBtn.addEventListener('click', leaveRoom);
      leaveBtn.dataset.wired = '1';
    }
    const startBtn = el('btn-mp-start');
    if (startBtn && !startBtn.dataset.wired) {
      startBtn.addEventListener('click', () => { window.Net.startGame(); });
      startBtn.dataset.wired = '1';
    }
    const lobbyBtn = el('btn-mp-lobby');
    if (lobbyBtn && !lobbyBtn.dataset.wired) {
      lobbyBtn.addEventListener('click', backToLobby);
      lobbyBtn.dataset.wired = '1';
    }
    const homeBtn = el('btn-mp-home');
    if (homeBtn && !homeBtn.dataset.wired) {
      homeBtn.addEventListener('click', backToTitle);
      homeBtn.dataset.wired = '1';
    }
    const codeInput = el('mp-join-code');
    if (codeInput && !codeInput.dataset.wired) {
      codeInput.addEventListener('input', () => {
        codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
      });
      codeInput.dataset.wired = '1';
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        const screen = el('screen-mp');
        if (screen && !screen.classList.contains('hidden')) {
          e.preventDefault();
          close();
        }
      }
    });
  }

  window.MPModule = {
    init, open, close,
    backToLobby,
    getRoom() { return room; },
    getMyId() { return myId; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
