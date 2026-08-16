// test-auth-api.js - API-level regression test for the auth/session/shop flow.
// Run with the server already listening (defaults to http://127.0.0.1:3210):
//   PORT=3210 node server.js
//   node test-auth-api.js
// Each run registers a uniquely-named test player so coin/unlock assertions
// are deterministic regardless of previous runs.
'use strict';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3210';
const NICK = '测试tx' + String(Date.now() % 100000); // unique per run, <= 12 chars
const PASS = 'secret123';

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('  PASS', name);
  else { failures++; console.error('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

async function call(method, path, { token, headers = {}, body } = {}) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, headers);
  if (token) h['X-Player-Token'] = token;
  const res = await fetch(BASE + path, {
    method, headers: h,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status, json };
}

(async () => {
  const enc = encodeURIComponent(NICK);

  console.log('1. health');
  const health = await call('GET', '/api/health');
  check('health 200', health.status === 200 && health.json.status === 'ok');

  console.log('2. register');
  const reg = await call('POST', '/api/register', { body: { nickname: NICK, password: PASS, age: 7 } });
  check('register 201', reg.status === 201, reg);
  const token = reg.json && reg.json.token;
  check('token issued', typeof token === 'string' && token.length > 20, reg.json);
  const regAgain = await call('POST', '/api/register', { body: { nickname: NICK, password: 'other123', age: 7 } });
  check('duplicate register 409', regAgain.status === 409, regAgain);

  console.log('3. profile read auth gates');
  const withToken = await call('GET', '/api/players/' + enc, { token });
  check('profile with token 200', withToken.status === 200 && withToken.json.nickname === NICK, withToken);
  check('starting coins 50', withToken.json.coins === 50, withToken.json);
  const noToken = await call('GET', '/api/players/' + enc);
  check('profile without token 401', noToken.status === 401, noToken);
  // Headers must be latin1, so the old spoofing scheme is simulated with the
  // percent-encoded form (which the old server also accepted).
  const spoofedHeader = await call('GET', '/api/players/' + enc, { headers: { 'X-Player': enc } });
  check('profile with forged X-Player (old scheme) 401', spoofedHeader.status === 401, spoofedHeader);
  const tampered = await call('GET', '/api/players/' + enc, { token: token.slice(0, -4) + 'beef' });
  check('profile with tampered token 401', tampered.status === 401, tampered);

  console.log('4. login');
  const badPw = await call('POST', '/api/login', { body: { nickname: NICK, password: 'wrong-password' } });
  check('wrong password 401', badPw.status === 401, badPw);
  const noUser = await call('POST', '/api/login', { body: { nickname: '不存在的玩家', password: 'whatever1' } });
  check('nonexistent user 401 (not 500)', noUser.status === 401, noUser);
  const login = await call('POST', '/api/login', { body: { nickname: NICK, password: PASS } });
  check('login 200 + token', login.status === 200 && typeof login.json.token === 'string', login);
  const loginToken = login.json.token;
  const crossUse = await call('GET', '/api/players/' + enc, { token: loginToken });
  check('login token works for own profile', crossUse.status === 200, crossUse);

  console.log('5. progress');
  const progNoTok = await call('POST', `/api/players/${enc}/progress`, { body: { level: 1, won: true } });
  check('progress without token 401', progNoTok.status === 401, progNoTok);
  const prog = await call('POST', `/api/players/${enc}/progress`, { token: loginToken, body: { level: 1, won: true } });
  check('level 1 win recorded', prog.status === 200 && prog.json.success === true, prog);
  // Level 1: baseHP = 1*2+10 = 12, reward coins = floor(12/3) = 4 → 50 + 4
  check('server-computed reward (+4 coins)', prog.json.player.coins === 54, prog.json.player);
  const progReplay = await call('POST', `/api/players/${enc}/progress`, { token: loginToken, body: { level: 1, won: true } });
  check('replay grants no extra coins', progReplay.json.player.coins === 54, progReplay.json.player);
  const skip = await call('POST', `/api/players/${enc}/progress`, { token: loginToken, body: { level: 666, won: true } });
  check('level-skip rejected 400', skip.status === 400, skip);

  console.log('6. shop');
  const shop = await call('GET', '/api/shop');
  check('shop catalog public', shop.status === 200 && shop.json.weapons.length === 5 && shop.json.items.length === 5, shop.json && {
    w: shop.json.weapons.length,
    i: shop.json.items.length
  });
  const buy = await call('POST', `/api/players/${enc}/buy`, { token: loginToken, body: { itemId: 'health-potion' } });
  check('buy potion (54-50=4 coins left)', buy.status === 200 && buy.json.player.coins === 4, buy.json.player);
  const buyPoor = await call('POST', `/api/players/${enc}/buy`, { token: loginToken, body: { itemId: 'ammo-crate' } });
  check('insufficient coins 400', buyPoor.status === 400, buyPoor);
  const equip = await call('POST', `/api/players/${enc}/equip`, { token: loginToken, body: { weaponId: 'wooden' } });
  check('equip owned weapon ok', equip.status === 200 && equip.json.player.equippedWeapon === 'wooden', equip.json.player);
  const useIt = await call('POST', `/api/players/${enc}/use-item`, { token: loginToken, body: { itemId: 'health-potion' } });
  check('use-item decrements count', useIt.status === 200 && useIt.json.player.inventory.items['health-potion'] === 0, useIt.json.player.inventory);

  console.log('7. levels');
  const lvl = await call('GET', '/api/levels/1');
  check('level 1 config', lvl.status === 200 && lvl.json.level === 1 && lvl.json.monsterHP === 12, lvl.json);
  const lvlBad = await call('GET', '/api/levels/1abc');
  check('garbage level id 400', lvlBad.status === 400, lvlBad);
  const lvlAll = await call('GET', '/api/levels');
  check('levels list has 666', lvlAll.status === 200 && lvlAll.json.totalLevels === 666 && lvlAll.json.levels.length === 666);

  console.log('8. scrypt storage format');
  const fs = require('fs');
  const players = JSON.parse(fs.readFileSync('data/players.json', 'utf-8'));
  const stored = players.players[NICK] && players.players[NICK].passwordHash;
  check('stored hash is scrypt:<salt>:<hash>', typeof stored === 'string' && stored.startsWith('scrypt:') && stored.split(':').length === 3, stored);

  console.log('9. leaderboard (levels cleared)');
  const NICK2 = '排榜' + String(Date.now() % 100000);
  const reg2 = await call('POST', '/api/register', { body: { nickname: NICK2, password: PASS, age: 7 } });
  const tok2 = reg2.json.token;
  await call('POST', `/api/players/${encodeURIComponent(NICK2)}/progress`, { token: tok2, body: { level: 1, won: true } });
  await call('POST', `/api/players/${encodeURIComponent(NICK2)}/progress`, { token: tok2, body: { level: 2, won: true } });
  const lb = await call('GET', '/api/leaderboard/levels?limit=10');
  check('leaderboard 200 with entries', lb.status === 200 && Array.isArray(lb.json.entries) && lb.json.entries.length >= 2, lb.json.entries && lb.json.entries.length);
  const e1 = lb.json.entries.find(x => x.nickname === NICK);
  const e2 = lb.json.entries.find(x => x.nickname === NICK2);
  check('main player listed with 1 cleared', e1 && e1.cleared === 1, e1);
  check('second player listed with 2 cleared', e2 && e2.cleared === 2, e2);
  check('2-cleared ranks above 1-cleared', e1 && e2 && e2.rank < e1.rank, { e1rank: e1 && e1.rank, e2rank: e2 && e2.rank });
  const lbMe = await call('GET', '/api/leaderboard/levels?nickname=' + encodeURIComponent(NICK2));
  check('me returns own rank', lbMe.status === 200 && lbMe.json.me && lbMe.json.me.nickname === NICK2 && lbMe.json.me.rank >= 1, lbMe.json.me);
  const lbBad = await call('GET', '/api/leaderboard/levels?limit=999999');
  check('limit clamped (no 500)', lbBad.status === 200, lbBad.status);

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});
