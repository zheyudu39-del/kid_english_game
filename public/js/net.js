// net.js - WebSocket client for multiplayer (versus race mode).
// Connects to /ws with the session token from /api/login. The server pings
// us every 30s (browsers auto-pong, keeping proxies awake); no client-side
// heartbeat is needed. Automatic reconnect with backoff, capped at 3 tries
// — room state is NOT resumed after a reconnect (v1 scope).
(function () {
  'use strict';

  const RECONNECT_DELAYS = [1000, 2000, 4000];
  const POS_INTERVAL = 50; // ms between position broadcasts (20Hz)

  const handlers = new Map();   // type -> Set<fn>
  let ws = null;
  let status = 'idle';          // idle | connecting | open | closed
  let attempts = 0;
  let closedByUs = false;
  let statusListeners = new Set();

  // --- position throttle (coalesce to the latest value) ---
  let lastPosSent = 0;
  let posTimer = null;
  let pendingPos = null;

  function wsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = encodeURIComponent(window.API.getToken());
    return proto + '//' + window.location.host + '/ws?token=' + token;
  }

  function setStatus(s) {
    status = s;
    for (const fn of statusListeners) {
      try { fn(s); } catch (e) { /* listener error must not kill the socket */ }
    }
  }

  function dispatch(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    const set = handlers.get(msg.type);
    if (!set) return;
    for (const fn of set) {
      try { fn(msg); } catch (e) { console.error('net handler error (' + msg.type + '):', e); }
    }
  }

  function openSocket() {
    const token = window.API.getToken();
    if (!token) {
      setStatus('closed');
      dispatch({ type: 'error', msg: '请先登录后再联机' });
      return false;
    }
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return true;
    }
    setStatus('connecting');
    closedByUs = false;
    try {
      ws = new WebSocket(wsUrl());
    } catch (e) {
      setStatus('closed');
      return false;
    }
    ws.onopen = () => {
      attempts = 0;
      setStatus('open');
    };
    ws.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); }
      catch (e) { return; }
      dispatch(msg);
    };
    ws.onclose = () => {
      ws = null;
      if (closedByUs || attempts >= RECONNECT_DELAYS.length) {
        setStatus('closed');
        return;
      }
      const delay = RECONNECT_DELAYS[attempts++];
      setStatus('connecting');
      setTimeout(() => {
        if (!closedByUs) openSocket();
      }, delay);
    };
    ws.onerror = () => { /* onclose follows */ };
    return true;
  }

  function flushPos() {
    posTimer = null;
    if (!pendingPos) return;
    const now = Date.now();
    const wait = now - lastPosSent;
    if (wait < POS_INTERVAL) {
      posTimer = setTimeout(flushPos, POS_INTERVAL - wait);
      return;
    }
    lastPosSent = now;
    send('pos', pendingPos);
    pendingPos = null;
  }

  function send(type, data) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(Object.assign({ type }, data || {})));
      return true;
    } catch (e) {
      return false;
    }
  }

  const Net = {
    // Resolve once the socket is open (connects if needed). Rejects when
    // not logged in or after the reconnect budget is exhausted.
    ensureConnected() {
      return new Promise((resolve, reject) => {
        if (status === 'open') { resolve(); return; }
        if (!openSocket()) { reject(new Error('无法建立连接')); return; }
        const onChange = (s) => {
          if (s === 'open') { resolve(); cleanup(); }
          else if (s === 'closed') { reject(new Error('连接已断开')); cleanup(); }
        };
        const cleanup = () => statusListeners.delete(onChange);
        statusListeners.add(onChange);
      });
    },

    // connect() keeps the old name working for callers that just want the
    // socket brought up without awaiting.
    connect() { openSocket(); },

    disconnect() {
      closedByUs = true;
      if (posTimer) { clearTimeout(posTimer); posTimer = null; }
      pendingPos = null;
      if (ws) { try { ws.close(1000, 'bye'); } catch (e) { /* already closed */ } }
      ws = null;
      setStatus('idle');
    },

    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
    },

    off(type, fn) {
      const set = handlers.get(type);
      if (set) set.delete(fn);
    },

    onStatus(fn) {
      statusListeners.add(fn);
      return () => statusListeners.delete(fn);
    },

    status() { return status; },
    send,

    // Throttled position broadcast (world-space x/y + facing unit vector).
    sendPos(x, y, f) {
      pendingPos = { x: Math.round(x), y: Math.round(y), f: { x: +f.x.toFixed(2), y: +f.y.toFixed(2) } };
      if (!posTimer) flushPos();
    },

    createRoom(level) { return send('create', { level }); },
    quickMatch(level) { return send('quick', { level }); },
    joinRoom(code) { return send('join', { code }); },
    leaveRoom() { return send('leave', {}); },
    startGame() { return send('start', {}); },
    reportHit(monsterId) { return send('hit', { monsterId }); },
    reportAnswer(monsterId, choice) { return send('answer', { monsterId, choice }); }
  };

  window.Net = Net;
})();
