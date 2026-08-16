// test-realtime.js - Protocol-level tests for the multiplayer WebSocket
// server (realtime.js). Registers throwaway accounts via the HTTP API,
// then drives two/three WS clients through the full versus flow.
//
//   PORT=3210 node server.js
//   PORT=3210 node test-realtime.js
'use strict';

const WebSocket = require('ws');
const PORT = Number(process.env.PORT) || 3210;
const BASE = 'http://127.0.0.1:' + PORT;
const WS_URL = 'ws://127.0.0.1:' + PORT + '/ws';

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? '✅' : '❌') + ' ' + name + (extra !== undefined && !ok ? ' — ' + JSON.stringify(extra) : ''));
  if (!ok) failures++;
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function makeAccount(tag) {
  const nickname = 'WS' + tag + Date.now().toString().slice(-8);
  // The server's auth endpoints are rate-limited (10/min/IP — brute-force
  // defense). A full test run registers several accounts, so back off and
  // retry when we trip the limit instead of failing the run.
  for (let attempt = 1; ; attempt++) {
    const reg = await api('POST', '/api/register', { nickname, password: 'secret123', age: 7 });
    if (reg.status === 201) return { nickname, token: reg.json.token };
    if (reg.status === 409) {
      // The registration actually landed but we missed the 201 — log in.
      const login = await api('POST', '/api/login', { nickname, password: 'secret123' });
      if (login.status === 200) return { nickname, token: login.json.token };
    }
    if (reg.status === 429 && attempt < 12) {
      await new Promise(r => setTimeout(r, 6000));
      continue;
    }
    throw new Error('register failed: ' + reg.status);
  }
}

// A minimal scripted WS client: collects messages, offers waitFor(type).
function connect(token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL + '?token=' + encodeURIComponent(token));
    const client = {
      ws,
      inbox: [],
      waiters: [],
      closed: false,
      send(type, data) { ws.send(JSON.stringify(Object.assign({ type }, data || {}))); },
      waitFor(type, timeout = 5000) {
        const i = client.inbox.findIndex(m => m.type === type);
        if (i >= 0) return Promise.resolve(client.inbox.splice(i, 1)[0]);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout waiting for ' + type)), timeout);
          client.waiters.push({ type, res: (m) => { clearTimeout(t); res(m); } });
        });
      },
      close() { client.closed = true; try { ws.close(); } catch (e) {} }
    };
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw); } catch (e) { return; }
      const w = client.waiters.findIndex(x => x.type === m.type);
      if (w >= 0) client.waiters.splice(w, 1)[0].res(m);
      else client.inbox.push(m);
    });
    ws.on('open', () => resolve(client));
    ws.on('error', reject);
    ws.on('close', () => { client.closed = true; });
  });
}

(async () => {
  console.log('1. auth gates');
  await new Promise((done) => {
    const bad = new WebSocket(WS_URL + '?token=garbage');
    bad.on('unexpected-response', (req, res) => {
      check('bad token rejected with 401', res.statusCode === 401, res.statusCode);
      done();
    });
    bad.on('open', () => { check('bad token rejected with 401', false, 'connection opened'); done(); });
  });

  const A = await makeAccount('a');
  const B = await makeAccount('b');
  const ca = await connect(A.token);
  const cb = await connect(B.token);
  const wa = await ca.waitFor('welcome');
  const wb = await cb.waitFor('welcome');
  check('welcome carries id + name', typeof wa.id === 'number' && wa.name === A.nickname, wa);

  console.log('2. room create / join');
  ca.send('create', { level: 5 });
  const roomA = await ca.waitFor('room');
  check('host gets room snapshot', /^\d{4}$/.test(roomA.code) && roomA.players.length === 1, roomA);
  check('host flagged', roomA.players[0].host === true && roomA.players[0].id === wa.id);
  cb.send('join', { code: roomA.code });
  const peerJoin = await ca.waitFor('peer_join');
  check('host sees peer_join', peerJoin.name === B.nickname, peerJoin);
  const roomB = await cb.waitFor('room');
  check('joiner gets room snapshot', roomB.code === roomA.code && roomB.players.length === 2, roomB);

  console.log('3. join guards');
  cb.send('leave');
  await new Promise(r => setTimeout(r, 200));
  cb.send('join', { code: '0000' });
  const err = await cb.waitFor('error');
  check('unknown room error', /房间不存在/.test(err.msg), err);
  // Rejoin for the rest of the tests.
  cb.send('join', { code: roomA.code });
  await cb.waitFor('room');

  console.log('4. start permission (host only)');
  cb.send('start');
  const notHost = await cb.waitFor('error');
  check('non-host cannot start', /房主/.test(notHost.msg), notHost);

  console.log('5. versus round');
  ca.send('start');
  const startA = await ca.waitFor('start');
  const startB = await cb.waitFor('start');
  check('both got start', startA.level === 5 && startB.level === 5);
  check('spawn list shared', startA.spawns.length === startB.spawns.length &&
    startA.spawns.length >= 6 &&
    JSON.stringify(startA.spawns.map(s => s.id)) === JSON.stringify(startB.spawns.map(s => s.id)));
  check('spawns carry answerable words', startA.spawns.every(s => s.word && s.word.english && s.word.chinese));
  check('target consistent', startA.target === startB.target && startA.target >= 5);

  const monster = startA.spawns[0];

  // engagement lock: both hit the same monster, only the first answers.
  ca.send('hit', { monsterId: monster.id });
  cb.send('hit', { monsterId: monster.id });
  const engA = await ca.waitFor('engage');
  const engB = await cb.waitFor('engage');
  check('engage broadcast to both', engA.monsterId === monster.id && engB.monsterId === monster.id);
  const answeringClient = engA.by === wa.id ? ca : cb;

  // Wrong answer first: monster released, no capture.
  answeringClient.send('answer', { monsterId: monster.id, choice: '绝对不对的答案' });
  const wrongA = await ca.waitFor('wrong');
  check('wrong answer broadcast with correct text', wrongA.monsterId === monster.id && wrongA.correct === monster.word.chinese, wrongA);

  // Re-hit and answer correctly.
  ca.send('hit', { monsterId: monster.id });
  const eng2 = await ca.waitFor('engage');
  const byA = eng2.by === wa.id;
  const answerer = byA ? ca : cb;
  answerer.send('answer', { monsterId: monster.id, choice: monster.word.chinese });
  const capA = await ca.waitFor('capture');
  check('capture broadcast', capA.monsterId === monster.id && capA.captured === 1, capA);

  // Answer a monster you never engaged → ignored (no event).
  const other = startA.spawns[1];
  cb.send('answer', { monsterId: other.id, choice: other.word.chinese });
  ca.send('hit', { monsterId: other.id });
  const eng3 = await ca.waitFor('engage');
  check('stale answer ignored, new engage works', eng3.by === wa.id, eng3);
  ca.send('answer', { monsterId: other.id, choice: '又错了' });
  const wrong2 = await ca.waitFor('wrong');
  check('second wrong ok', wrong2.monsterId === other.id);

  console.log('6. race to target');
  // All spawn entries the client has seen (initial wave + respawns).
  const knownSpawns = () => startA.spawns.concat(
    ca.inbox.filter(m => m.type === 'spawn').flatMap(m => m.spawns));
  const used = new Set([monster.id, other.id]);
  const softWait = (client, type, ms) =>
    client.waitFor(type, ms).then(m => m, () => null);
  let raceDone = false;
  while (!raceDone) {
    const cand = knownSpawns().find(s => !used.has(s.id));
    if (!cand) {
      // Wait for a respawn wave before giving up.
      const wave = await softWait(ca, 'spawn', 3000);
      if (!wave) break;
      continue;
    }
    used.add(cand.id);
    ca.send('hit', { monsterId: cand.id });
    const eng = await softWait(ca, 'engage', 1500);
    if (!eng || eng.by !== wa.id) continue; // someone else / stale
    ca.send('answer', { monsterId: cand.id, choice: cand.word.chinese });
    const cap = await softWait(ca, 'capture', 1500);
    if (!cap) continue;
    raceDone = cap.captured >= startA.target;
  }
  check('raced to target', raceDone, { target: startA.target });
  const endA = await ca.waitFor('end', 10000);
  const endB = await cb.waitFor('end', 10000);
  check('end broadcast with winner', endA.winner && endA.winner.id === wa.id, endA);
  check('both ends agree', endA.winner.id === endB.winner.id);
  check('standings sorted', endA.standings.length === 2 && endA.standings[0].captured >= endA.standings[1].captured, endA.standings);

  console.log('7. quick match');
  const C = await makeAccount('c');
  const D = await makeAccount('d');
  const cc = await connect(C.token);
  const cd = await connect(D.token);
  await cc.waitFor('welcome');
  await cd.waitFor('welcome');
  cc.send('quick', { level: 3 });
  await new Promise(r => setTimeout(r, 300));
  cd.send('quick', { level: 3 });
  const roomC = await cc.waitFor('room', 8000);
  const roomD = await cd.waitFor('room', 8000);
  // cc's snapshot is from its own join (1 player); cd's shows both — the
  // pairing itself is proven by matching codes + the later messages.
  check('quick match paired into one room', roomC.code === roomD.code && roomD.players.length === 2, { roomC, roomD });
  const cd1 = await cc.waitFor('countdown', 8000);
  check('countdown started', cd1.n === 3 || cd1.n === 2, cd1);
  const startC = await cc.waitFor('start', 10000);
  const startD = await cd.waitFor('start', 10000);
  check('auto-start fired', startC.level === 3 && startD.spawns.length > 0);
  cc.close();
  cd.close();

  console.log('8. disconnect during play releases locks');
  // A hits a monster then B drops... reuse main room (it's 'ended'; host can
  // restart). Start a new round and test B disconnect mid-engage.
  ca.send('start');
  const s2 = await ca.waitFor('start');
  await cb.waitFor('start');
  // Drop stale engages from earlier rounds so we read THIS round's event.
  cb.inbox.length = 0;
  const m0 = s2.spawns[0];
  cb.send('hit', { monsterId: m0.id });
  const engB2 = await cb.waitFor('engage');
  check('B engaged', engB2.by === wb.id, engB2);
  cb.close();
  // A hits the same monster — should be locked until the 15s release, then
  // a fresh hit works. We just verify A receives peer_leave promptly.
  const left = await ca.waitFor('peer_leave');
  check('peer_leave on disconnect', left.id === wb.id, left);

  console.log('9. solo practice run (single hunter)');
  const E = await makeAccount('e');
  const ce = await connect(E.token);
  const we = await ce.waitFor('welcome');
  ce.send('create', { level: 4 });
  const roomE = await ce.waitFor('room');
  check('solo room created', roomE.players.length === 1, roomE);
  ce.send('start');
  const startE = await ce.waitFor('start');
  check('solo start allowed (practice)', startE.level === 4 && startE.spawns.length > 0, startE.level);
  // Race to the target alone.
  const usedE = new Set();
  const knownE = () => startE.spawns.concat(
    ce.inbox.filter(m => m.type === 'spawn').flatMap(m => m.spawns));
  const softE = (type, ms) => ce.waitFor(type, ms).then(m => m, () => null);
  let soloDone = false;
  while (!soloDone) {
    const cand = knownE().find(s => !usedE.has(s.id));
    if (!cand) {
      const wave = await softE('spawn', 3000);
      if (!wave) break;
      continue;
    }
    usedE.add(cand.id);
    ce.send('hit', { monsterId: cand.id });
    const eng = await softE('engage', 1500);
    if (!eng || eng.by !== we.id) continue;
    ce.send('answer', { monsterId: cand.id, choice: cand.word.chinese });
    const cap = await softE('capture', 1500);
    if (!cap) continue;
    soloDone = cap.captured >= startE.target;
  }
  check('solo practice raced to target', soloDone, { target: startE.target });
  const endE = await ce.waitFor('end', 10000);
  check('solo practice ends with winner', endE.winner && endE.winner.id === we.id, endE.winner);
  check('solo standings have one entry', endE.standings.length === 1 && endE.standings[0].captured >= startE.target, endE.standings);
  ce.close();

  console.log('10. quick-match ghost cancel');
  // A queued player closing the lobby must not stay pairable.
  const F = await makeAccount('f');
  const G = await makeAccount('g');
  const cf = await connect(F.token);
  const cg = await connect(G.token);
  await cf.waitFor('welcome');
  await cg.waitFor('welcome');
  cf.send('quick', { level: 2 });
  await new Promise(r => setTimeout(r, 200));
  cf.send('leave'); // "closed the lobby" → cancels the queue entry
  cg.send('quick', { level: 2 });
  // cg must NOT be paired with the cancelled cf: it stays searching.
  await new Promise(r => setTimeout(r, 1500));
  const ghostRoom = await Promise.race([
    cg.waitFor('room', 1500).then(() => true, () => false),
    new Promise(r => setTimeout(() => r(false), 1600))
  ]);
  check('cancelled waiter is not paired (no ghost)', ghostRoom === false, ghostRoom);
  cf.close();
  cg.close();

  ca.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});
