/**
 * Layout + multi-age verification.
 * Checks: no horizontal overflow, options count per age, all ages render.
 * Usage: node test-layout.js
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu']
  });

  for (const age of [3, 5, 7, 9]) {
    const page = await browser.newPage();
    await page.setViewport({ width: 480, height: 850 });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    await page.goto('http://localhost:3000/#home', { waitUntil: 'networkidle0' });
    await page.type('#nickname-input', '布局测试');
    await page.click('#btn-start');
    await page.waitForSelector('.keg-card[data-age]');
    await page.click(`.keg-card[data-age="${age}"]`);
    await page.waitForSelector('.keg-card[data-game]');

    // For each game, check first round renders and options fit in viewport
    const games = ['word-recognition', 'listening', 'spelling', 'sentences'];
    for (const g of games) {
      await page.click(`.keg-card[data-game="${g}"]`);
      await page.waitForSelector('.keg-option', { timeout: 8000 });
      await new Promise(r => setTimeout(r, 300));

      const layout = await page.evaluate(() => {
        const doc = document.documentElement;
        const overflowX = doc.scrollWidth > doc.clientWidth + 2;
        const options = document.querySelectorAll('.keg-option');
        const optCount = options.length;
        const optBoxes = [...options].map(o => o.getBoundingClientRect());
        const visible = optBoxes.filter(r => r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0).length;
        const qBox = document.querySelector('.keg-game__question')?.getBoundingClientRect();
        return { overflowX, optCount, visible, qVisible: qBox ? (qBox.width > 0) : false };
      });

      // Expected option counts: age3 word/listen → 3, else 4; spelling → 4; sentences → 3
      let expected = 4;
      if (g === 'sentences') expected = 3;
      else if (age === 3) expected = 3;
      // listening for age 3 is 4 (optionCount = 4 in listening code) — check actual
      if (g === 'listening' && age === 3) expected = 4;

      check(`age${age} [${g}] 无横向溢出`, !layout.overflowX);
      check(`age${age} [${g}] 选项数正确(${expected})`, layout.optCount === expected, `实际 ${layout.optCount}`);
      check(`age${age} [${g}] 选项全部在视口内`, layout.visible === layout.optCount, `${layout.visible}/${layout.optCount}`);
      check(`age${age} [${g}] 题目区可见`, layout.qVisible);
      check(`age${age} [${g}] 无JS错误`, errs.length === 0, errs[0] || '');

      await page.evaluate(() => location.hash = 'menu');
      await page.waitForSelector('.keg-card[data-game]');
    }
    await page.close();
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== 结果: ${results.length - failed.length}/${results.length} 通过 ===`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
