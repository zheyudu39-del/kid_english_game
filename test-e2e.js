/**
 * E2E test - plays through all 4 games using headless Chrome.
 * Usage: node test-e2e.js
 * Dev-only test harness (not deployed).
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

const hash = page => page.evaluate(() => location.hash);

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=480,850']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto('http://localhost:3000/#home', { waitUntil: 'networkidle0' });

  // --- Home page ---
  check('首页渲染', await page.$('#btn-start') !== null);
  await page.type('#nickname-input', '测试宝贝');
  await page.click('#btn-start');
  await page.waitForSelector('.keg-card[data-age]', { timeout: 5000 });
  check('首页→选年龄', true);

  // --- Age select (choose 5-6) ---
  await page.click('.keg-card[data-age="5"]');
  await page.waitForSelector('.keg-card[data-game]', { timeout: 5000 });
  const gameCount = await page.$$('.keg-card[data-game]').then(l => l.length);
  check('选年龄→菜单', gameCount === 4, `${gameCount} 个游戏模式`);

  // --- Play each game via real UI clicks ---
  const gameIds = ['word-recognition', 'listening', 'spelling', 'sentences'];
  for (const gameId of gameIds) {
    // Go back to menu if not already there
    if (!(await hash(page)).includes('menu')) {
      await page.evaluate(() => location.hash = 'menu');
    }
    await page.waitForSelector('.keg-card[data-game]', { timeout: 5000 });

    // Click the specific game card (it loads vocabulary then starts the game)
    const clicked = await page.evaluate(gid => {
      const card = document.querySelector(`.keg-card[data-game="${gid}"]`);
      if (!card) return false;
      card.click();
      return true;
    }, gameId);
    check(`[${gameId}] 卡片可点击`, clicked);

    // Wait for first round
    await page.waitForSelector('.keg-game__option-grid', { timeout: 10000 }).catch(() => {});
    check(`[${gameId}] 第一题渲染`, await page.$('.keg-game__option-grid') !== null);

    // Play up to 12 rounds (spelling has 12, others 10)
    let reachedResults = false;
    for (let r = 0; r < 12; r++) {
      const clicked = await page.evaluate(() => {
        const btn = document.querySelector('.keg-option:not(.keg-option--disabled)');
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!clicked) break;
      // Wait until either results page appears OR next round's options become
      // enabled again (feedback locks the current round's buttons)
      await page.waitForFunction(
        () => location.hash.includes('results')
          || document.querySelectorAll('.keg-option:not(.keg-option--disabled)').length > 0,
        { timeout: 7000 }
      ).catch(() => {});
      if (await hash(page).then(h => h.includes('results'))) { reachedResults = true; break; }
    }
    check(`[${gameId}] 完成题目到达结果页`, reachedResults);

    if (reachedResults) {
      const scoreText = await page.$eval('#result-score', el => el.textContent).catch(() => '');
      check(`[${gameId}] 结果页显示分数`, /分/.test(scoreText), scoreText);
      await new Promise(r => setTimeout(r, 600)); // let score POST finish
    }
  }

  // --- Ranking page ---
  await page.evaluate(() => location.hash = 'ranking');
  await page.waitForSelector('.keg-ranking__table', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.keg-ranking__row').length > 0, { timeout: 5000 }).catch(() => {});
  const rowCount = await page.$$('.keg-ranking__row').then(l => l.length);
  check('排行榜显示成绩', rowCount > 0, `${rowCount} 条记录`);

  // --- JS errors ---
  check('无 JS 运行时错误', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== 结果: ${results.length - failed.length}/${results.length} 通过 ===`);
  process.exit(failed.length ? 1 : 0);
})().catch(err => {
  console.error('测试崩溃:', err);
  process.exit(1);
});
