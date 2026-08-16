// mp.js - Multiplayer versus lobby: create / join / quick-match rooms and
// orchestrate the net game flow between the lobby UI and game.js.
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  let booted = false;
  let myId = null;
  let room = null;          // { code, state, level, players: [{id,name,color,host}] }
  let mpLevel = 1;
  let searchingTimer = null;
  let searchingBackstop = null;

  function stopSearchingTimer() {
    if (searchingTimer) {
      clearInterval(searchingTimer);
      searchingTimer = null;
    }
    // Local backstop: never stay on the searching screen longer than this,
    // even when the server's 20s timeout error never arrives (dead socket,
    // restarted server, ...). 25s > 20s server timeout on purpose.
    if (searchingBackstop) {
      clearTimeout(searchingBackstop);
      searchingBackstop = null;
    }
  }

  function isSearching() {
    const v = el('mp-searching');
    return !!(v && !v.classList.contains('hidden'));
  }

  // Leave the searching state and explain why.
  function bailFromSearching(msg) {
    if (!isSearching()) return;
    stopSearchingTimer();
    window.Net.leaveRoom(); // also drops the server-side queue entry
    showView('mp-menu');
    if (msg) Utils.toast(msg, 3000);
  }

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
    updateConnIndicator();
    try { await window.Net.ensureConnected(); updateConnIndicator(); }
    catch (e) {
      updateConnIndicator();
      Utils.toast('联机连接失败，请刷新页面重试；若仍失败，退出登录后重新登录一次', 3500);
    }
  }

  function close() {
    const screen = el('screen-mp');
    if (screen) screen.classList.add('hidden');
    closeJoinModal();
    const g = game();
    if (g && typeof g.isModalPaused === 'function' && typeof g.resumeFromModal === 'function' && g.isModalPaused()) {
      g.resumeFromModal();
    }
    // Closing the lobby always sends 'leave': it cancels any pending quick
    // match queue entry (otherwise a "ghost" waiter could be paired later)
    // and leaves any room we were sitting in.
    stopSearchingTimer();
    const wasSearching = !el('mp-searching').classList.contains('hidden');
    if (room || wasSearching) window.Net.leaveRoom();
    if (room) {
      room = null;
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
    const count = (room.players || []).length;
    const startBtn = el('btn-mp-start');
    if (startBtn) {
      startBtn.classList.toggle('hidden', !amHost);
      // A lone hunter can still start — it becomes a practice run.
      startBtn.textContent = count === 1 ? '🎯 开始练习（单人）' : '🎯 开始对战';
    }
    const hint = el('mp-hint');
    if (hint) {
      if (!amHost) {
        hint.textContent = count === 1
          ? '等待房主开始练习或对战…'
          : '等待房主开始对战…';
      } else if (count === 1) {
        hint.textContent = '还没有对手 — 可以先单人练习，或把房间码发给朋友';
      } else {
        hint.textContent = '人齐了，点击开始对战（2-4 人）';
      }
    }
  }

  // Live connection indicator in the lobby header: ● 已连接 / 连接中 / ✕ 断开.
  function updateConnIndicator() {
    const elc = el('mp-conn');
    if (!elc) return;
    const s = window.Net.status();
    const dot = elc.querySelector('.mp-conn__dot');
    elc.classList.toggle('ok', s === 'open');
    elc.classList.toggle('bad', s === 'closed');
    const label = elc.childNodes[elc.childNodes.length - 1];
    const text = s === 'open' ? '已连接' : (s === 'closed' ? '未连接' : '连接中…');
    if (label && label.nodeType === 3) label.textContent = text;
  }

  // All lobby actions funnel through this: it waits for the socket and turns
  // connection problems into an actionable message instead of a silent no-op.
  function withConnection(action, doing) {
    updateConnIndicator();
    window.Net.ensureConnected().then(() => {
      updateConnIndicator();
      action();
    }).catch((err) => {
      updateConnIndicator();
      const msg = err && err.message === '请先登录后再联机'
        ? '联机需要先登录账号'
        : '联机连接失败（' + ((err && err.message) || '未知') + '）。请刷新页面重试；若仍失败，退出登录后重新登录一次';
      Utils.toast(msg, 3500);
    });
  }

  // ---- actions ----
  function createRoom() {
    withConnection(() => window.Net.createRoom(mpLevel));
  }

  function quickMatch() {
    withConnection(() => {
      window.Net.quickMatch(mpLevel);
      showView('mp-searching');
      startSearchingTimer();
    });
  }

  // Live "已等待 n 秒" counter so waiting never feels frozen.
  function startSearchingTimer() {
    stopSearchingTimer();
    const startedAt = Date.now();
    const text = el('mp-searching-text');
    searchingTimer = setInterval(() => {
      if (!text) return;
      const s = Math.floor((Date.now() - startedAt) / 1000);
      text.textContent = '正在寻找对手… 已等待 ' + s + ' 秒';
    }, 1000);
    if (text) text.textContent = '正在寻找对手… 已等待 0 秒';
    searchingBackstop = setTimeout(() => {
      bailFromSearching('暂时没有匹配到其他玩家——先创建房间单人练习吧，朋友可随时用房码加入');
    }, 25000);
  }

  function cancelQuick() {
    stopSearchingTimer();
    // 'leave' doubles as "cancel quick match" server-side (it drops any
    // queued entry AND leaves a room when in one).
    window.Net.leaveRoom();
    showView('mp-menu');
  }

  // Escape hatch straight from the waiting screen: stop waiting, make a room.
  function practiceFromQuick() {
    if (!isSearching()) return;
    stopSearchingTimer();
    window.Net.leaveRoom(); // drop the queue entry
    withConnection(() => window.Net.createRoom(mpLevel));
  }

  function joinByCode() {
    // The button ALWAYS opens the dialog. A stale code sitting in the inline
    // box (e.g. synced from a previous join) must never silently re-join an
    // old room — that bypasses the dialog and confuses everyone.
    openJoinModal();
  }

  // ---- join-by-code dialog ----
  function openJoinModal() {
    const m = el('mp-join-modal');
    const input = el('mp-join-modal-input');
    if (!m || !input) return;
    const inline = el('mp-join-code');
    input.value = (inline && inline.value || '').trim();
    m.classList.remove('hidden');
    try { input.focus(); input.select(); } catch (e) { /* non-fatal */ }
  }

  function closeJoinModal() {
    const m = el('mp-join-modal');
    if (m) m.classList.add('hidden');
  }

  function submitJoinModal() {
    const input = el('mp-join-modal-input');
    const code = (input && input.value || '').trim();
    if (!/^\d{4}$/.test(code)) {
      Utils.toast('请输入 4 位数字房间码');
      if (input) { try { input.focus(); input.select(); } catch (e) { /* non-fatal */ } }
      return;
    }
    const inline = el('mp-join-code');
    if (inline) inline.value = code; // keep the inline box in sync
    closeJoinModal();
    withConnection(() => window.Net.joinRoom(code));
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
      stopSearchingTimer();
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
      closeJoinModal();
      const g = game();
      if (g && typeof g.startLevelNet === 'function') {
        g.startLevelNet(msg, myId);
      }
    });

    Net.on('error', (msg) => {
      Utils.toast(msg.msg || '联机错误');
      stopSearchingTimer();
      // Errors from queue timeout etc. land us back on the menu.
      if (!room && !el('mp-searching').classList.contains('hidden')) {
        showView('mp-menu');
      }
    });

    Net.onStatus((s) => {
      updateConnIndicator();
      if (s === 'closed') {
        // Socket died: recover BOTH stuck states (searching / in-room),
        // otherwise the lobby sits on a dead screen forever.
        if (isSearching()) bailFromSearching('联机连接已断开，请重新匹配或创建房间');
        else if (room) {
          Utils.toast('联机连接已断开');
          room = null;
          showView('mp-menu');
        }
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
    const practiceBtn = el('btn-mp-quick-practice');
    if (practiceBtn && !practiceBtn.dataset.wired) {
      practiceBtn.addEventListener('click', practiceFromQuick);
      practiceBtn.dataset.wired = '1';
    }
    const joinBtn = el('btn-mp-join');
    if (joinBtn && !joinBtn.dataset.wired) {
      joinBtn.addEventListener('click', joinByCode);
      joinBtn.dataset.wired = '1';
    }
    const joinClose = el('btn-mp-join-close');
    if (joinClose && !joinClose.dataset.wired) {
      joinClose.addEventListener('click', closeJoinModal);
      joinClose.dataset.wired = '1';
    }
    const joinForm = el('mp-join-form');
    if (joinForm && !joinForm.dataset.wired) {
      joinForm.addEventListener('submit', (e) => { e.preventDefault(); submitJoinModal(); });
      joinForm.dataset.wired = '1';
    }
    const joinModalInput = el('mp-join-modal-input');
    if (joinModalInput && !joinModalInput.dataset.wired) {
      joinModalInput.addEventListener('input', () => {
        joinModalInput.value = joinModalInput.value.replace(/\D/g, '').slice(0, 4);
      });
      joinModalInput.dataset.wired = '1';
    }
    const leaveBtn = el('btn-mp-leave');
    if (leaveBtn && !leaveBtn.dataset.wired) {
      leaveBtn.addEventListener('click', leaveRoom);
      leaveBtn.dataset.wired = '1';
    }
    const startBtn = el('btn-mp-start');
    if (startBtn && !startBtn.dataset.wired) {
      startBtn.addEventListener('click', () => { withConnection(() => window.Net.startGame()); });
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
        const joinModal = el('mp-join-modal');
        if (joinModal && !joinModal.classList.contains('hidden')) {
          e.preventDefault();
          closeJoinModal();
          return;
        }
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
