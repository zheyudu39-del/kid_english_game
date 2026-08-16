/**
 * realtime.js - WebSocket multiplayer server (versus race mode).
 *
 * Attach to the Express HTTP server; it shares the port with the REST API
 * via HTTP upgrade on path /ws. Authentication reuses the HMAC session
 * tokens issued by /api/login (deps.verifySessionToken).
 *
 * Authority split (see README):
 *   Server-authoritative: room lifecycle, spawn lists, per-monster
 *   engagement locks, answer correctness (compared against the vocabulary),
 *   per-player capture counts, respawns, winner.
 *   Client-simulated (cosmetic): own movement/bullets/monster AI wander,
 *   remote player positions (relayed at ~20Hz + interpolated).
 *
 * Message protocol (JSON, one object per frame):
 *   C→S: create{level} quick{level} join{code} leave start
 *        pos{x,y,f} hit{monsterId} answer{monsterId, choice}
 *   S→C: room{code,players,level,state} peer_join{name} peer_leave{id}
 *        countdown{n} start{level,cfg,spawns,target,timeLimit}
 *        peer_pos{id,x,y,f} engage{monsterId,by} capture{monsterId,by}
 *        wrong{monsterId,by,correct} spawn{spawns[]} end{winner,standings}
 *        error{msg}
 */
'use strict';

const WebSocket = require('ws');

const WS_PATH = '/ws';
const MAX_PLAYERS = 4;
const MAX_ROOMS = 500;
const MAX_CONNS_PER_IP = 8;
const MSG_RATE_LIMIT = 80;        // messages per second per connection
const ROOM_IDLE_MS = 5 * 60 * 1000;
const QUICK_WAIT_MS = 60 * 1000;  // give up matching after this
const ENGAGE_TIMEOUT_MS = 15 * 1000; // answerer disconnected → release lock
const QUICK_COUNTDOWN_S = 3;
const PLAYER_COLORS = ['#2ed573', '#1e90ff', '#ff9f43', '#ff6b9d'];

// Battle parameters mirror battleParamsFor() in public/js/levels.js —
// keep the two in sync (server owns the authoritative values in net play).
function battleParamsFor(levelNum) {
  const lvl = Math.max(1, Math.min(666, Math.floor(Number(levelNum) || 1)));
  return {
    target: Math.min(18, 5 + Math.floor(lvl / 40)),
    timeLimit: Math.min(180, 60 + Math.floor(lvl / 30) * 5),
    monsterCount: Math.min(32, 6 + Math.floor(lvl / 25))
  };
}

// A word is usable when it can be rendered AND answered (chinese meaning).
function isAnswerable(w) {
  return w && typeof w.english === 'string' && w.english.length > 0 &&
    typeof w.chinese === 'string' && w.chinese.trim().length > 0;
}

function attachRealtime(httpServer, deps) {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 4 * 1024 });
  const rooms = new Map();        // code -> room
  const quickQueue = [];          // waiting connections for quick match
  const ipConns = new Map();      // ip -> count
  let nextConnId = 1;

  // ---- upgrade handling / auth -------------------------------------------
  httpServer.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch (e) { socket.destroy(); return; }
    if (url.pathname !== WS_PATH) { socket.destroy(); return; }

    const nickname = deps.verifySessionToken(url.searchParams.get('token') || '');
    if (!nickname) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const ip = req.socket.remoteAddress || 'unknown';
    const n = (ipConns.get(ip) || 0) + 1;
    if (n > MAX_CONNS_PER_IP) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    ipConns.set(ip, n);

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, nickname, ip);
    });
  });

  // ---- helpers -------------------------------------------------------------
  function send(ws, type, data) {
    if (ws.readyState !== WebSocket.OPEN) return;
    try { ws.send(JSON.stringify(Object.assign({ type }, data))); }
    catch (e) { /* socket died mid-send; close handler cleans up */ }
  }

  function broadcast(room, type, data, exceptId) {
    for (const p of room.players.values()) {
      if (exceptId !== undefined && p.id === exceptId) continue;
      send(p.ws, type, data);
    }
  }

  function roomSnapshot(room) {
    return {
      code: room.code,
      state: room.state,
      level: room.level,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id, name: p.name, color: p.color, host: p.id === room.hostId
      }))
    };
  }

  function genCode() {
    for (let i = 0; i < 50; i++) {
      const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  // Word pool for a level's difficulty band (d-1 .. d+1 like the client).
  function eligibleWords(cfg) {
    const vocab = deps.loadVocabulary();
    const words = (vocab && Array.isArray(vocab.words)) ? vocab.words : [];
    const minD = Math.max(1, (cfg.difficulty || 1) - 1);
    const maxD = Math.min(8, (cfg.difficulty || 1) + 1);
    const inBand = words.filter(w => isAnswerable(w) &&
      Number.isFinite(Number(w.difficulty)) && w.difficulty >= minD && w.difficulty <= maxD);
    if (inBand.length > 0) return inBand;
    return words.filter(isAnswerable);
  }

  // Build one spawn wave (same shape the client's spawnMonsters produces).
  function genSpawns(room, count, existing) {
    const pool = room.wordPool;
    const spawns = [];
    const minDist = 80;
    const taken = existing || [];
    let attempts = 0;
    const maxAttempts = count * 30;
    while (spawns.length < count && attempts < maxAttempts && pool.length > 0) {
      attempts++;
      const x = 60 + Math.random() * (room.worldW - 120);
      const y = 60 + Math.random() * (room.worldH - 120);
      let tooClose = false;
      for (const t of taken.concat(spawns)) {
        if (Math.hypot(t.x - x, t.y - y) < minDist) { tooClose = true; break; }
      }
      if (tooClose) continue;
      const word = pool[Math.floor(Math.random() * pool.length)];
      const aiPool = ['wander', 'wander', 'patrol', 'aggressive'];
      spawns.push({
        id: room.nextNetId++,
        x: Math.round(x),
        y: Math.round(y),
        ai: aiPool[Math.floor(Math.random() * aiPool.length)],
        word
      });
    }
    return spawns;
  }

  function registerMonsters(room, spawns) {
    for (const s of spawns) {
      room.monsters.set(s.id, { alive: true, engagedBy: null, word: s.word });
    }
  }

  function createRoom(level, hostConn) {
    if (rooms.size >= MAX_ROOMS) {
      send(hostConn.ws, 'error', { msg: '服务器房间已满，请稍后再试' });
      return null;
    }
    const code = genCode();
    if (!code) {
      send(hostConn.ws, 'error', { msg: '创建房间失败，请重试' });
      return null;
    }
    const cfg = deps.buildLevelConfig(level);
    const battle = battleParamsFor(level);
    // World size must match the client's World construction (game.js uses
    // viewport-dependent sizes; the client clamps spawns into its own world,
    // so a generous fixed arena keeps everyone compatible).
    const room = {
      code,
      state: 'lobby',
      level: cfg.level,
      cfg,
      target: battle.target,
      timeLimit: battle.timeLimit,
      monsterCount: battle.monsterCount,
      worldW: 1440,
      worldH: 720,
      hostId: hostConn.id,
      players: new Map(),
      monsters: new Map(),
      counts: new Map(),
      wordPool: eligibleWords(cfg),
      nextNetId: 0,
      lastActivity: Date.now(),
      playTimer: null,
      engageTimer: null,
      quickTimer: null
    };
    rooms.set(code, room);
    return room;
  }

  function joinRoom(room, conn) {
    const idx = room.players.size;
    room.players.set(conn.id, conn);
    room.counts.set(conn.id, 0);
    conn.room = room;
    conn.color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
    room.lastActivity = Date.now();
    broadcast(room, 'room', roomSnapshot(room));
    // Everyone except the joiner already learns membership from the room
    // snapshot; the join event is a "someone arrived" ping for the others.
    broadcast(room, 'peer_join', { id: conn.id, name: conn.name }, conn.id);
  }

  function clearRoomTimers(room) {
    if (room.playTimer) { clearTimeout(room.playTimer); room.playTimer = null; }
    if (room.engageTimer) { clearTimeout(room.engageTimer); room.engageTimer = null; }
    if (room.quickTimer) { clearTimeout(room.quickTimer); room.quickTimer = null; }
  }

  function destroyRoom(room) {
    clearRoomTimers(room);
    rooms.delete(room.code);
  }

  function releaseEngagement(room) {
    if (room.engageTimer) { clearTimeout(room.engageTimer); room.engageTimer = null; }
    for (const m of room.monsters.values()) m.engagedBy = null;
  }

  function startGame(room) {
    if (room.players.size < 2) {
      const host = room.players.get(room.hostId);
      if (host) send(host.ws, 'error', { msg: '至少需要 2 名玩家才能开始对战' });
      return;
    }
    clearRoomTimers(room);
    releaseEngagement(room);
    room.monsters.clear();
    room.state = 'playing';
    room.counts = new Map();
    for (const id of room.players.keys()) room.counts.set(id, 0);
    // Fresh word pool per round so replays don't repeat the exact same set.
    room.wordPool = eligibleWords(room.cfg);
    room.nextNetId = 0;
    const spawns = genSpawns(room, room.monsterCount, []);
    registerMonsters(room, spawns);
    broadcast(room, 'start', {
      level: room.level,
      cfg: room.cfg,
      spawns,
      target: room.target,
      timeLimit: room.timeLimit
    });
    room.playTimer = setTimeout(() => endGame(room, null), (room.timeLimit + 5) * 1000);
    room.lastActivity = Date.now();
  }

  function endGame(room, winnerId) {
    if (room.state !== 'playing') return;
    clearRoomTimers(room);
    releaseEngagement(room);
    room.state = 'ended';
    const standings = Array.from(room.players.values())
      .map(p => ({ id: p.id, name: p.name, color: p.color, captured: room.counts.get(p.id) || 0 }))
      .sort((a, b) => b.captured - a.captured);
    const winner = winnerId != null && room.players.has(winnerId)
      ? { id: winnerId, name: room.players.get(winnerId).name }
      : (standings[0] && standings[0].captured > 0 ? { id: standings[0].id, name: standings[0].name } : null);
    broadcast(room, 'end', { winner, standings });
    room.lastActivity = Date.now();
  }

  function removeFromQuick(conn) {
    const i = quickQueue.indexOf(conn);
    if (i >= 0) {
      quickQueue.splice(i, 1);
      if (conn.quickTimer) { clearTimeout(conn.quickTimer); conn.quickTimer = null; }
    }
  }

  function leaveRoom(conn, silent) {
    const room = conn.room;
    if (!room) return;
    // Release a question this player was in the middle of answering.
    let engagedRelease = false;
    for (const m of room.monsters.values()) {
      if (m.engagedBy === conn.id) { m.engagedBy = null; engagedRelease = true; }
    }
    if (engagedRelease && room.engageTimer) {
      clearTimeout(room.engageTimer);
      room.engageTimer = null;
    }
    room.players.delete(conn.id);
    room.counts.delete(conn.id);
    conn.room = null;
    room.lastActivity = Date.now();
    if (room.players.size === 0) {
      destroyRoom(room);
      return;
    }
    // Host migration.
    if (room.hostId === conn.id) {
      room.hostId = room.players.keys().next().value;
    }
    if (!silent) broadcast(room, 'room', roomSnapshot(room));
    broadcast(room, 'peer_leave', { id: conn.id, name: conn.name });
    // Versus with a single survivor: they still race the target; the room
    // simply continues. (All-left case handled above.)
  }

  // ---- quick match -----------------------------------------------------------
  function tryPairQuick() {
    // Drop entries whose socket died while waiting. Queue items are conn
    // wrappers — the readyState lives on .ws.
    const alive = (c) => c.ws && c.ws.readyState === WebSocket.OPEN;
    while (quickQueue.length && !alive(quickQueue[0])) {
      const c = quickQueue.shift();
      if (c.quickTimer) { clearTimeout(c.quickTimer); c.quickTimer = null; }
    }
    if (quickQueue.length < 2) return;

    const a = quickQueue.shift();
    const b = quickQueue.shift();
    for (const c of [a, b]) {
      if (c.quickTimer) { clearTimeout(c.quickTimer); c.quickTimer = null; }
    }
    if (!alive(a) || !alive(b) || a.room || b.room) {
      // One went stale mid-pair: keep the healthy one queued for the next round.
      for (const c of [a, b]) {
        if (alive(c) && !c.room) quickQueue.push(c);
      }
      return;
    }

    const room = createRoom(a.mpLevel || 1, a);
    if (!room) return;
    joinRoom(room, a);
    joinRoom(room, b);
    // Auto-start countdown so matched players don't need to do anything.
    let n = QUICK_COUNTDOWN_S;
    broadcast(room, 'countdown', { n });
    room.quickTimer = setInterval(() => {
      n--;
      if (n > 0) { broadcast(room, 'countdown', { n }); return; }
      clearInterval(room.quickTimer);
      room.quickTimer = null;
      if (room.players.size >= 2 && room.state === 'lobby') startGame(room);
    }, 1000);
  }

  // ---- connection lifecycle ----------------------------------------------
  wss.on('connection', (ws, req, nickname, ip) => {
    const conn = {
      id: nextConnId++,
      name: nickname,
      ws,
      ip,
      room: null,
      color: PLAYER_COLORS[0],
      mpLevel: 1,
      quickTimer: null,
      msgTimes: []      // rolling timestamps for the rate limit
    };

    // Kick any previous connection of the same account (one session per
    // nickname keeps room identity unambiguous).
    for (const client of wss.clients) {
      if (client !== ws && client.__conn && client.__conn.name === nickname) {
        send(client, 'error', { msg: '账号在其他地方登录' });
        client.close(4000, 'replaced');
      }
    }
    ws.__conn = conn;

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      // Rolling 1s window rate limit.
      const now = Date.now();
      conn.msgTimes.push(now);
      while (conn.msgTimes.length && conn.msgTimes[0] <= now - 1000) conn.msgTimes.shift();
      if (conn.msgTimes.length > MSG_RATE_LIMIT) return;

      let msg;
      try { msg = JSON.parse(raw); }
      catch (e) { return; }
      if (!msg || typeof msg.type !== 'string') return;

      // A single malformed/hostile message must never take down the whole
      // server (it shares the process with the HTTP API).
      try {
        handle_message(conn, msg);
      } catch (err) {
        console.error('realtime message handler error:', err);
        send(ws, 'error', { msg: '服务器处理消息出错' });
      }
    });

    ws.on('close', () => {
      // Same robustness rule as message handling: a crash during cleanup
      // must never take the server down.
      try {
        removeFromQuick(conn);
        leaveRoom(conn, false);
      } catch (err) {
        console.error('realtime close handler error:', err);
      }
      const n = (ipConns.get(ip) || 1) - 1;
      if (n <= 0) ipConns.delete(ip); else ipConns.set(ip, n);
    });

    ws.on('error', () => { /* close handler does cleanup */ });

    send(ws, 'welcome', { id: conn.id, name: conn.name });
  });

  // ---- message dispatch -----------------------------------------------------
  function handle_message(conn, msg) {
    const room = conn.room;
    switch (msg.type) {
      case 'create': {
        if (room) { send(conn.ws, 'error', { msg: '你已在房间中' }); return; }
        const level = Math.max(1, Math.min(deps.TOTAL_LEVELS, Math.floor(Number(msg.level)) || 1));
        conn.mpLevel = level;
        const r = createRoom(level, conn);
        if (r) joinRoom(r, conn);
        return;
      }
      case 'quick': {
        if (room) { send(conn.ws, 'error', { msg: '你已在房间中' }); return; }
        conn.mpLevel = Math.max(1, Math.min(deps.TOTAL_LEVELS, Math.floor(Number(msg.level)) || 1));
        quickQueue.push(conn);
        conn.quickTimer = setTimeout(() => {
          removeFromQuick(conn);
          send(conn.ws, 'error', { msg: '暂时没有找到对手，试试创建房间邀请朋友吧' });
        }, QUICK_WAIT_MS);
        tryPairQuick();
        return;
      }
      case 'join': {
        if (room) { send(conn.ws, 'error', { msg: '你已在房间中' }); return; }
        const code = String(msg.code || '').trim();
        const r = rooms.get(code);
        if (!r) { send(conn.ws, 'error', { msg: '房间不存在' }); return; }
        if (r.players.size >= MAX_PLAYERS) { send(conn.ws, 'error', { msg: '房间已满' }); return; }
        if (r.state !== 'lobby') { send(conn.ws, 'error', { msg: '对战已经开始，等下一局吧' }); return; }
        conn.mpLevel = r.level;
        joinRoom(r, conn);
        return;
      }
      case 'leave': {
        // Also doubles as "cancel quick match": drop any queued entry.
        removeFromQuick(conn);
        if (room) leaveRoom(conn, false);
        return;
      }
      case 'start': {
        if (!room) return;
        if (conn.id !== room.hostId) { send(conn.ws, 'error', { msg: '只有房主可以开始对战' }); return; }
        if (room.state === 'playing') return;
        startGame(room);
        return;
      }
      case 'pos': {
        if (!room || room.state !== 'playing') return;
        const x = Number(msg.x), y = Number(msg.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const f = (msg.f && Number.isFinite(Number(msg.f.x)) && Number.isFinite(Number(msg.f.y)))
          ? { x: msg.f.x, y: msg.f.y } : { x: 0, y: 1 };
        broadcast(room, 'peer_pos', { id: conn.id, x, y, f }, conn.id);
        return;
      }
      case 'hit': {
        if (!room || room.state !== 'playing') return;
        const id = Number(msg.monsterId);
        const m = room.monsters.get(id);
        if (!m || !m.alive || m.engagedBy !== null) return;
        // A player answers at most one question at a time.
        for (const other of room.monsters.values()) {
          if (other.engagedBy === conn.id) return;
        }
        m.engagedBy = conn.id;
        broadcast(room, 'engage', { monsterId: id, by: conn.id });
        if (room.engageTimer) clearTimeout(room.engageTimer);
        room.engageTimer = setTimeout(() => {
          // Auto-release if the answerer never replies (disconnect / stall).
          if (m.engagedBy === conn.id) {
            m.engagedBy = null;
            broadcast(room, 'wrong', { monsterId: id, by: conn.id, correct: m.word.chinese, timeout: true });
          }
          room.engageTimer = null;
        }, ENGAGE_TIMEOUT_MS);
        return;
      }
      case 'answer': {
        if (!room || room.state !== 'playing') return;
        const id = Number(msg.monsterId);
        const m = room.monsters.get(id);
        if (!m || !m.alive || m.engagedBy !== conn.id) return;
        if (room.engageTimer) { clearTimeout(room.engageTimer); room.engageTimer = null; }
        m.engagedBy = null;
        const correct = typeof msg.choice === 'string' && msg.choice === m.word.chinese;
        if (correct) {
          m.alive = false;
          const n = (room.counts.get(conn.id) || 0) + 1;
          room.counts.set(conn.id, n);
          broadcast(room, 'capture', { monsterId: id, by: conn.id, captured: n });
          if (n >= room.target) { endGame(room, conn.id); return; }
          // Respawn pressure when the field runs low. Dead monsters carry
          // no position on the server, so the wave only spaces against
          // itself (genSpawns handles intra-wave spacing).
          const alive = Array.from(room.monsters.values()).filter(x => x.alive).length;
          if (alive < 3) {
            const spawns = genSpawns(room, 2, []);
            registerMonsters(room, spawns);
            broadcast(room, 'spawn', { spawns });
          }
        } else {
          broadcast(room, 'wrong', { monsterId: id, by: conn.id, correct: m.word.chinese });
        }
        return;
      }
      default:
        return;
    }
  }

  // ---- keepalive & GC -------------------------------------------------------
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* terminate on next sweep */ }
    }
  }, 30 * 1000);
  heartbeat.unref();

  const sweeper = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const idle = now - room.lastActivity;
      if (room.players.size === 0 || (room.state !== 'playing' && idle > ROOM_IDLE_MS)) {
        destroyRoom(room);
      }
    }
  }, 60 * 1000);
  sweeper.unref();

  return {
    wss,
    rooms,
    stats() {
      return { rooms: rooms.size, sockets: wss.clients.size, queue: quickQueue.length };
    }
  };
}

module.exports = { attachRealtime };
