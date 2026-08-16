// test-shop-ui.js - Browser check for the shop entry buttons and the token
// session flow. Requires the server on PORT (default 3210).
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT) || 3210;
const BASE = 'http://127.0.0.1:' + PORT;
const NICK = 'SP' + Date.now().toString().slice(-9);
const PASS = 'testpass123';

let failures = 0;
function check(name, ok, detail) {
  detail = detail || '';
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
}

(async () => {
  // Create an account and grab a session token directly via the API.
  const reg = await fetch(BASE + '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nickname: NICK, password: PASS, age: 7 })
  }).then(r => r.json());
  check('fixture account created', reg.success === true && typeof reg.token === 'string');

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle2' });

  // 1. Title-screen shop button opens the shop.
  await page.click('#btn-shop');
  await page.waitForFunction(() => !document.getElementById('screen-shop').classList.contains('hidden'), { timeout: 5000 });
  // The catalog is fetched async in ShopModule.open() — wait for the cards.
  await page.waitForFunction(() => document.querySelectorAll('#shop-grid .shop-card').length === 5, { timeout: 10000 });
  check('title #btn-shop opens shop screen', true);
  check('weapon tab renders 5 cards', true);

  // 2. Items tab renders 5 cards.
  await page.click('#tab-items');
  await page.waitForFunction(() => document.querySelectorAll('#shop-grid .shop-card').length === 5, { timeout: 5000 });
  check('items tab renders 5 cards', true);

  // 3. Close button hides the shop.
  await page.click('#btn-shop-close');
  await page.waitForFunction(() => document.getElementById('screen-shop').classList.contains('hidden'), { timeout: 5000 });
  check('close button hides shop screen', true);

  // 4. Token session: plant token + nickname, reload, expect silent restore.
  await page.evaluate((nick, token) => {
    localStorage.setItem('wordhunter:logged-in', nick);
    localStorage.setItem('wordhunter:token', token);
  }, NICK, reg.token);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => {
    const el = document.getElementById('user-status');
    return el && !el.classList.contains('hidden') && el.textContent.includes('已登录');
  }, { timeout: 10000 });
  const badge = await page.$eval('#user-status', el => el.textContent);
  check('session restored from token after reload', badge.includes(NICK), badge.trim());

  // 5. Logged-in shop shows the server-side coin balance (50 start).
  await page.click('#btn-shop');
  await page.waitForFunction(() => !document.getElementById('screen-shop').classList.contains('hidden'), { timeout: 5000 });
  await page.waitForFunction(() => document.getElementById('shop-coins').textContent.includes('50'), { timeout: 5000 });
  check('shop shows server coin balance (🪙 50)', true);

  const realErrors = consoleErrors.filter(t => !/Failed to load resource.*401/.test(t));
  check('no unexpected console errors', realErrors.length === 0, realErrors.join(' | '));

  await browser.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('Test harness error:', err);
  process.exit(1);
});
