/**
 * test-campaign.js - Smoke test the new 666-level campaign UI.
 * Drives the SPA via Puppeteer: home -> age-select -> menu -> world-map -> battle.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3000;
const BASE = 'http://localhost:' + PORT;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '\u2705' : '\u274c'} ${name}${detail ? ' \u2014 ' + detail : ''}`);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=480,900']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // Use a unique nickname so we start clean
  const nick = 'hero_' + Date.now();
  await page.goto(BASE + '/#home', { waitUntil: 'networkidle0' });

  // Home -> type nickname
  check('\u9996\u9875\u6e32\u67d3', await page.$('#btn-start') !== null);
  await page.type('#nickname-input', nick);
  await page.evaluate(() => document.querySelector('#btn-start').click());
  await page.waitForSelector('.keg-card[data-age]', { timeout: 5000 });

  // Choose age 9 (use evaluate because keg-card is a div, not button)
  await page.evaluate(() => document.querySelector('.keg-card[data-age="9"]').click());
  await page.waitForSelector('#btn-campaign', { timeout: 5000 });
  check('\u9009\u5e74\u9f84\u2192\u83dc\u5355', true);

  // Check the campaign CTA exists
  check('\u83dc\u5355\u201c\u5f00\u59cb\u95ef\u5173\u201d\u5361\u7247', await page.$('#btn-campaign') !== null);

  // Go to world map
  await page.evaluate(() => document.querySelector('#btn-campaign').click());
  await page.waitForSelector('.keg-world-tabs', { timeout: 5000 });
  const worldTabs = await page.$$eval('.keg-world-tab', els => els.length);
  check('\u4e16\u754c\u5217\u8868 6 \u4e2a\u4e16\u754c', worldTabs === 6, '\u5b9e\u9645 ' + worldTabs);

  // Verify default world is world 1
  const defaultLevelCount = await page.$$eval('.keg-level', els => els.length);
  check('\u9ed8\u8ba4\u663e\u793a\u7b2c\u4e00\u4e16\u754c 111 \u5173', defaultLevelCount === 111, '\u5b9e\u9645 ' + defaultLevelCount);

  // Verify level 1 is enabled, level 50 is locked (because not progressed)
  const lvl1Disabled = await page.$eval('.keg-level[data-level="1"]', el => el.disabled);
  const lvl50Disabled = await page.$eval('.keg-level[data-level="50"]', el => el.disabled);
  check('\u7b2c1\u5173\u9ed8\u8ba4\u53ef\u70b9\u51fb', lvl1Disabled === false);
  check('\u7b2c50\u5173\u672a\u8fbe\u6210\u9ed8\u8ba4\u9501\u5b9a', lvl50Disabled === true);

  // The new player should also see world 1's boss (level 111) unlocked.
  const lvl111Disabled = await page.$eval('.keg-level[data-level="111"]', el => el.disabled);
  check('\u7b2c1\u4e16\u754cBoss(111)\u9ed8\u8ba4\u53ef\u70b9\u51fb', lvl111Disabled === false);

  // Worlds 2-6 should be locked (no bosses defeated yet)
  const w2TabLocked = await page.$eval('.keg-world-tab[data-world="2"]', el => el.classList.contains('keg-world-tab--locked'));
  check('\u672a\u6253\u8d62\u4efb\u4f55Boss\u65f6 \u4e16\u754c2 tab \u9501\u5b9a', w2TabLocked === true);
  const w6TabLocked = await page.$eval('.keg-world-tab[data-world="6"]', el => el.classList.contains('keg-world-tab--locked'));
  check('\u672a\u6253\u8d62\u4efb\u4f55Boss\u65f6 \u4e16\u754c6 tab \u9501\u5b9a', w6TabLocked === true);

  // API sanity for highest level
  const l666 = await page.evaluate(() => fetch('/api/levels/666').then(r => r.json()));
  check('\u5173\u5361666\u5728\u670d\u52a1\u7aef\u53ef\u8bbf\u95ee', l666 && l666.isBoss === true && l666.difficulty === 8);

  // Click level 1 -> battle
  await page.evaluate(() => document.querySelector('.keg-world-tab[data-world="1"]').click());
  await page.waitForSelector('.keg-level[data-level="1"]:not([disabled])', { timeout: 5000 });
  await page.evaluate(() => document.querySelector('.keg-level[data-level="1"]').click());
  await page.waitForSelector('.keg-monster', { timeout: 5000 });
  check('\u70b9\u51fb\u7b2c1\u5173 \u8fdb\u5165\u6218\u6597\u821e\u53f0', true);

  // ---- NEW: Battle arena with player + monster + VS ----
  check('\u6218\u6597\u573a\u666f\u5b58\u5728', await page.$('.keg-arena__scene') !== null);
  check('\u73a9\u5bb6\u5934\u50cf\u6e32\u67d3', await page.$('#keg-player-card') !== null);
  check('VS\u6807\u8bb0\u6e32\u67d3', await page.$('.keg-arena__vs') !== null);
  check('\u602a\u7269\u5728\u53f3\u4fa7\u6e32\u67d3', await page.$('#keg-arena-monster') !== null);

  // ---- NEW: Verify player has HP bar ----
  const playerHpText = await page.$eval('.keg-player__bar-text', el => el.textContent);
  check('\u73a9\u5bb6HP\u663e\u793a', /\d+ \/ \d+/.test(playerHpText), 'HP: ' + playerHpText);

  // ---- NEW: Verify monster has breathing animation class ----
  const monsterHasBreath = await page.evaluate(() => {
    const a = document.getElementById('keg-monster-avatar');
    if (!a) return false;
    const s = getComputedStyle(a);
    return s.animationName && s.animationName !== 'none';
  });
  check('\u602a\u7269\u52a8\u753b\u6fc0\u6d3b', monsterHasBreath);

  // Verify monster HP bar
  const monsterHP = await page.$eval('.keg-monster__bar-text', el => el.textContent);
  check('\u602a\u7269HP\u663e\u793a', /12 \/ 12/.test(monsterHP), 'HP text: ' + monsterHP);

  // Verify skills bar rendered with 3 skills
  const skillCount = await page.$$eval('.keg-skill', els => els.length);
  check('\u6280\u80fd\u680f 3 \u4e2a\u6280\u80fd', skillCount === 3, '\u5b9e\u9645 ' + skillCount);

  // Verify coins visible
  const coinsText = await page.$eval('.keg-skills__coins', el => el.textContent);
  check('\u91d1\u5e01\u663e\u793a', /50/.test(coinsText), 'coins: ' + coinsText);

  // Verify the game slot has the word-recognition UI (an option grid)
  const optCount = await page.$$eval('.keg-option', els => els.length);
  check('\u6218\u6597\u4e2d\u51fa\u9898 \u9009\u9879\u6e32\u67d3', optCount >= 2, '\u9009\u9879\u6570: ' + optCount);

  // Click the CORRECT option to trigger the player attack sequence
  const optCount2 = await page.$$eval('.keg-option', els => els.length);
  let submitted = false;
  let clickedCorrect = false;
  // Record initial HP for direction-aware assertion below
  const monsterHpBefore = await page.$eval('.keg-monster__bar-text', el => el.textContent);
  const playerHpBefore = await page.$eval('.keg-player__bar-text', el => el.textContent);
  if (optCount2 > 0) {
    // Find the correct option via the engine's currentCorrectId (exposed by game modules)
    clickedCorrect = await page.evaluate(() => {
      const eng = window._currentEngine;
      const correctId = eng && eng.currentCorrectId;
      const opts = document.querySelectorAll('.keg-option');
      let target = null;
      if (correctId != null) {
        target = Array.from(opts).find(o => o.dataset.id === String(correctId));
      }
      if (!target) target = opts[0]; // fallback: just click first
      if (target) {
        target.click();
        return target.dataset.id === String(correctId);
      }
      return false;
    });
    await new Promise(r => setTimeout(r, 2000));
    submitted = true;
  }
  check('\u70b9\u51fb\u9009\u9879\u53ef\u89e6\u53d1\u56de\u590d', submitted);

  // Verify that HP changed IN THE EXPECTED DIRECTION:
  //   - clickedCorrect=true  => monster HP should drop, player HP unchanged
  //   - clickedCorrect=false => player HP should drop (monster counter-attack), monster HP unchanged
  const monsterHpAfter = await page.$eval('.keg-monster__bar-text', el => el.textContent);
  const playerHpAfter = await page.$eval('.keg-player__bar-text', el => el.textContent);
  const monsterChanged = monsterHpAfter !== monsterHpBefore;
  const playerChanged = playerHpAfter !== playerHpBefore;
  const isCorrect = clickedCorrect;
  const expectedDirection = isCorrect ? (monsterChanged && !playerChanged) : (playerChanged && !monsterChanged);
  check(
    '\u6218\u6597\u540e HP \u53d8\u5316\u65b9\u5411\u6b63\u786e',
    expectedDirection,
    'clicked=' + (isCorrect ? 'correct' : 'wrong') + ' | M: ' + monsterHpBefore + '->' + monsterHpAfter + ' / P: ' + playerHpBefore + '->' + playerHpAfter
  );

  // Take a screenshot for visual confirmation
  await page.screenshot({ path: 'test-campaign-battle.png', fullPage: true });
  console.log('\u{1F4F8} Screenshot saved: test-campaign-battle.png');

  if (errors.length) {
    console.log('\nConsole / page errors:');
    errors.forEach(e => console.log('  ' + e));
  } else {
    console.log('\nNo console/page errors.');
  }

  // Summary
  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length || errors.length) process.exitCode = 1;

  await browser.close();
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
