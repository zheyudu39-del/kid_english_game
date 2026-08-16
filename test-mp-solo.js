// test-mp-solo.js - Single-player journey through the multiplayer mode:
// the exact path a lone user takes — open lobby, create a room alone, start
// a practice run, answer questions, reach the target, see the result screen,
// and have the win recorded. Mirrors the reported "cannot use it alone" case.
'use strict';

const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT) || 3000;
const BASE = 'http://127.0.0.1:' + PORT;

let failures = 0;
function check(name, ok, detail) {
  detail = detail || '';
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
}

async function makeAccount(prefix) {
  const nickname = prefix + Date.now().toString().slice(-8);
  for (let attempt = 1; ; attempt++) {
    const reg = await fetch(BASE + '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname, password: 'secret123', age: 7 })
    });
    if (reg.status === 201) return { nickname, token: (await reg.json()).token };
    if (reg.status === 409) {
      const login = await fetch(BASE + '/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, password: 'secret123' })
      });
      if (login.status === 200) return { nickname, token: (await login.json()).token };
    }
    if (reg.status === 429 && attempt < 12) {
      await new Promise(r => setTimeout(r, 6000));
      continue;
    }
    throw new Error('register failed: ' + reg.status);
  }
}

(async () => {
  const account = await makeAccount('SOLO');
  const nickname = account.nickname;
  const token = account.token;

  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
    protocolTimeout: 60000
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.evaluate((n, t) => {
    localStorage.setItem('wordhunter:logged-in', n);
    localStorage.setItem('wordhunter:token', t);
  }, nickname, token);
  await page.reload({ waitUntil: 'networkidle2' });

  // Open the lobby and create a room alone.
  await page.click('#btn-multiplayer');
  await page.waitForSelector('#screen-mp:not(.hidden)', { timeout: 5000 });
  await page.click('#btn-mp-create');
  await page.waitForFunction(() => document.getElementById('mp-code').textContent !== '0000', { timeout: 5000 });
  const btnText = await page.$eval('#btn-mp-start', el => el.textContent);
  check('solo start button offers practice', btnText.includes('练习'), btnText);
  const hint = await page.$eval('#mp-hint', el => el.textContent);
  check('solo hint explains practice', hint.includes('练习') || hint.includes('还没有对手'), hint);

  // Start the practice run alone.
  await page.click('#btn-mp-start');
  await page.waitForSelector('#screen-level-intro:not(.hidden)', { timeout: 8000 });
  check('practice match starts for a lone hunter', true);
  await page.click('#btn-go');
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 5000 });
  const hudList = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#hud-mp .hud-mp__item')).map(e => e.textContent));
  check('versus bar lists the lone hunter', hudList.length === 1 && hudList[0].includes(nickname), hudList.join(' | '));

  // Capture to the target through the real UI (aim, fire, answer).
  const target = await page.evaluate(() => window._game.currentLevel.target);
  const raced = await page.evaluate(async (targetCount) => {
    const g = window._game;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    for (let round = 0; round < targetCount + 8; round++) {
      if (document.getElementById('screen-mp-result') &&
          !document.getElementById('screen-mp-result').classList.contains('hidden')) return true;
      const m = g.monsters.find(x => x.alive && !x.captured && x.netId != null && !x.netLocked && !x.hitPending);
      if (!m) { await sleep(400); continue; }
      g.player.x = m.x - 120;
      g.player.y = m.y;
      const dx = m.x - g.player.x, dy = m.y - g.player.y;
      const mag = Math.hypot(dx, dy) || 1;
      g.player.facing = { x: dx / mag, y: dy / mag };
      g._fireBullet();
      let ok = false;
      for (let i = 0; i < 40; i++) {
        const modal = document.getElementById('question-modal');
        if (modal && !modal.classList.contains('hidden')) { ok = true; break; }
        await sleep(100);
      }
      if (!ok) { m.hitPending = false; continue; }
      const want = m.word.chinese;
      const btn = Array.from(document.querySelectorAll('.modal-option')).find(b => b.textContent === want);
      if (btn) btn.click();
      for (let i = 0; i < 40; i++) {
        const modal = document.getElementById('question-modal');
        if (modal && modal.classList.contains('hidden')) break;
        await sleep(100);
      }
      await sleep(300);
    }
    return false;
  }, target);
  check('solo practice raced to target via real UI', raced, 'target=' + target);

  await page.waitForSelector('#screen-mp-result:not(.hidden)', { timeout: 15000 });
  const title = await page.$eval('#mp-result-title', el => el.textContent);
  check('practice win title shown', title.includes('胜利'), title);
  const standings = await page.$$eval('#mp-standings .mp-standing', els => els.map(e => e.textContent));
  check('standings show the lone hunter', standings.length === 1, standings.join(' | '));

  const prof = await fetch(BASE + '/api/players/' + encodeURIComponent(nickname), {
    headers: { 'X-Player-Token': token }
  }).then(r => r.json());
  check('practice win recorded (level 1 cleared)', Array.isArray(prof.completedLevels) && prof.completedLevels.includes(1), prof.completedLevels);
  check('no JS errors', pageErrors.length === 0, pageErrors[0] || '');

  console.log('--- stuck-searching recovery ---');
  // Back to title, reopen the lobby.
  await page.click('#btn-mp-home');
  await new Promise(r => setTimeout(r, 400));
  await page.click('#btn-multiplayer');
  await page.waitForSelector('#screen-mp:not(.hidden)', { timeout: 5000 });
  await new Promise(r => setTimeout(r, 600));

  // 1. Socket dies while searching → view must recover to the menu.
  await page.click('#btn-mp-quick');
  await page.waitForSelector('#mp-searching:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => window.Net.disconnect());
  await page.waitForFunction(() => !document.getElementById('mp-menu').classList.contains('hidden'), { timeout: 8000 });
  check('dead socket during matching returns to menu', true);

  // 2. Escape hatch: "不等了，创建房间先练习" goes straight to a room.
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => window.Net.connect());
  await page.waitForFunction(() => window.Net.status() === 'open', { timeout: 10000 });
  await page.click('#btn-mp-quick');
  await page.waitForSelector('#mp-searching:not(.hidden)', { timeout: 5000 });
  await page.click('#btn-mp-quick-practice');
  await page.waitForFunction(() => document.getElementById('mp-code').textContent !== '0000', { timeout: 8000 });
  const escCode = await page.$eval('#mp-code', e => e.textContent.trim());
  check('practice escape button creates a room', /^\d{4}$/.test(escCode), escCode);

  await browser.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures ? 1 : 0);
})().catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});
