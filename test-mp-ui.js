// test-mp-ui.js - Two-browser E2E for the versus multiplayer flow.
// Registers two accounts via the API, drives both pages through the lobby
// (create + join by code), starts a match, captures monsters by firing and
// answering questions, and verifies both clients see the match end.
'use strict';

const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT) || 3210;
const BASE = 'http://127.0.0.1:' + PORT;
const PASS = 'testpass123';

let failures = 0;
function check(name, ok, detail) {
  detail = detail || '';
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
}

async function makeAccount(tag) {
  const nickname = 'MP' + tag + Date.now().toString().slice(-8);
  // Back off on the auth rate limit (10/min/IP) instead of failing the run.
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(BASE + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, password: PASS, age: 7 })
    });
    if (res.status === 201) return { nickname, token: (await res.json()).token };
    if (res.status === 409) {
      const login = await fetch(BASE + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, password: PASS })
      });
      if (login.status === 200) return { nickname, token: (await login.json()).token };
    }
    if (res.status === 429 && attempt < 12) {
      await new Promise(r => setTimeout(r, 6000));
      continue;
    }
    throw new Error('register failed: ' + res.status);
  }
}

async function newPlayerBrowser(account) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
    protocolTimeout: 60000
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => console.error('  [pageerror ' + account.nickname + ']', e.message.substring(0, 200)));
  page.on('crash', () => console.error('  [page-crash]', account.nickname));
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  // Seed the session (login state + token) like a real login would.
  await page.evaluate((nick, token) => {
    localStorage.setItem('wordhunter:logged-in', nick);
    localStorage.setItem('wordhunter:token', token);
  }, account.nickname, account.token);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const el = document.getElementById('user-status');
    return el && !el.classList.contains('hidden');
  }, { timeout: 10000, polling: 'mutation' });
  return { browser, page };
}

(async () => {
  const A = await makeAccount('a');
  const B = await makeAccount('b');
  // Two separate browser instances: background tabs get their renderers
  // throttled/suspended by Chrome, which stalls CDP calls (clicks, evaluates)
  // and also freezes each player's game loop.
  const clientA = await newPlayerBrowser(A);
  const clientB = await newPlayerBrowser(B);
  const pageA = clientA.page;
  const pageB = clientB.page;
  const browsers = [clientA.browser, clientB.browser];

  console.log('--- lobby ---');
  await pageA.click('#btn-multiplayer');
  await pageA.waitForSelector('#screen-mp:not(.hidden)', { timeout: 5000 });
  console.log('  A lobby open');
  await pageA.click('#btn-mp-create');
  await pageA.waitForFunction(() => document.getElementById('mp-code').textContent !== '0000' &&
    document.getElementById('mp-code').textContent.length === 4, { timeout: 5000, polling: 'mutation' });
  const code = await pageA.$eval('#mp-code', el => el.textContent.trim());
  check('room created, code shown', /^\d{4}$/.test(code), code);
  console.log('  room code', code);

  await pageB.click('#btn-multiplayer');
  await pageB.waitForSelector('#screen-mp:not(.hidden)', { timeout: 5000 });
  // Join goes through the dialog: click opens it (prefilled from the inline
  // box), Enter submits the form.
  await pageB.type('#mp-join-code', code);
  await pageB.click('#btn-mp-join');
  await pageB.waitForSelector('#mp-join-modal:not(.hidden)', { timeout: 5000 });
  check('join dialog opens from the button', true);
  await pageB.keyboard.press('Enter');
  await pageA.waitForFunction(() => document.querySelectorAll('#mp-players .mp-player').length === 2, { timeout: 5000 });
  check('host sees both players in lobby', true);
  const hostSeesStart = await pageA.$eval('#btn-mp-start', el => !el.classList.contains('hidden'));
  const guestSeesStart = await pageB.$eval('#btn-mp-start', el => el.classList.contains('hidden'));
  check('start button: host only', hostSeesStart && guestSeesStart);

  console.log('--- match start ---');
  await pageA.click('#btn-mp-start');
  await pageA.waitForSelector('#screen-level-intro:not(.hidden)', { timeout: 8000 });
  await pageB.waitForSelector('#screen-level-intro:not(.hidden)', { timeout: 8000 });
  check('both pages show level intro', true);
  await pageA.click('#btn-go');
  await pageB.click('#btn-go');
  await pageA.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  await pageB.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  check('both HUDs visible', true);
  const monstersA = await pageA.evaluate(() => window._game.monsters.length);
  const monstersB = await pageB.evaluate(() => window._game.monsters.length);
  check('shared spawn field', monstersA > 0 && monstersA === monstersB, monstersA + '/' + monstersB);
  const hudMpA = await pageA.evaluate(() => {
    return Array.from(document.querySelectorAll('#hud-mp .hud-mp__item')).map(e => e.textContent);
  });
  check('versus score bar lists both hunters', hudMpA.length === 2 && hudMpA.some(t => t.includes(A.nickname)), hudMpA.join(' | '));

  console.log('--- race (page A captures to target) ---');
  const target = await pageA.evaluate(() => window._game.currentLevel.target);
  // Drive page A through real UI flow: aim at a monster, fire, answer the
  // question modal by clicking the correct option. Repeat until match end.
  const raced = await pageA.evaluate(async (targetCount) => {
    const g = window._game;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let round = 0; round < targetCount + 8; round++) {
      if (document.getElementById('screen-mp-result') &&
          !document.getElementById('screen-mp-result').classList.contains('hidden')) {
        return true;
      }
      const m = g.monsters.find(x => x.alive && !x.captured && x.netId != null && !x.netLocked && !x.hitPending);
      if (!m) { await sleep(400); continue; }
      // Stand next to the monster and fire at it.
      g.player.x = m.x - 120;
      g.player.y = m.y;
      const dx = m.x - g.player.x, dy = m.y - g.player.y;
      const mag = Math.hypot(dx, dy) || 1;
      g.player.facing = { x: dx / mag, y: dy / mag };
      g._fireBullet();
      // Wait for OUR question modal (server engage round-trip).
      let ok = false;
      for (let i = 0; i < 40; i++) {
        const modal = document.getElementById('question-modal');
        if (modal && !modal.classList.contains('hidden')) { ok = true; break; }
        await sleep(100);
      }
      if (!ok) { m.hitPending = false; continue; }
      // Click the correct option.
      const want = m.word.chinese;
      const btn = Array.from(document.querySelectorAll('.modal-option')).find(b => b.textContent === want);
      if (btn) btn.click();
      // Wait for the modal to close and the capture to register.
      for (let i = 0; i < 40; i++) {
        const modal = document.getElementById('question-modal');
        if (modal && modal.classList.contains('hidden')) break;
        await sleep(100);
      }
      await sleep(300);
    }
    return false;
  }, target);
  check('raced to target via real UI', raced, 'target=' + target);

  await pageA.waitForSelector('#screen-mp-result:not(.hidden)', { timeout: 15000 });
  await pageB.waitForSelector('#screen-mp-result:not(.hidden)', { timeout: 15000 });
  check('both pages show versus result', true);
  const titleA = await pageA.$eval('#mp-result-title', el => el.textContent);
  const titleB = await pageB.$eval('#mp-result-title', el => el.textContent);
  check('winner/loser titles correct', titleA.includes('胜利') && titleB.includes('再接再厉'), titleA + ' / ' + titleB);
  const standings = await pageA.$$eval('#mp-standings .mp-standing', els => els.map(e => e.textContent));
  check('standings rendered with both hunters', standings.length === 2, standings.join(' | '));

  console.log('--- progress recorded ---');
  const prof = await fetch(BASE + '/api/players/' + encodeURIComponent(A.nickname), {
    headers: { 'X-Player-Token': A.token }
  }).then(r => r.json());
  check('winner progress recorded (level 1 cleared)', Array.isArray(prof.completedLevels) && prof.completedLevels.includes(1), prof.completedLevels);

  for (const b of browsers) await b.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});
