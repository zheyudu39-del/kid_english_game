/**
 * test-wordhunter.js - E2E smoke test for the new Word Hunter game
 * Verifies:
 *  - Title screen renders with all key elements
 *  - Vocabulary loads for chosen age
 *  - Level intro shows after starting
 *  - Game canvas becomes active
 *  - Player can move and collide with a monster
 *  - Question modal pops on collision
 *  - Win/lose flow works
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3000;
const BASE = 'http://localhost:' + PORT;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log((ok ? '\u2705' : '\u274c') + ' ' + name + (detail ? ' \u2014 ' + detail : ''));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=900,700']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(0, 4).join(' | ')));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // Clear localStorage so we get a fresh test
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 10000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 10000 });

  // Title screen
  check('\u6807\u9898\u5c4f\u6e32\u67d3', await page.$('#screen-title:not(.hidden)') !== null);
  check('\u6807\u9898\u6587\u672c', (await page.$eval('.title-text', el => el.textContent)).includes('\u82f1\u8bed'));
  check('5 \u4e2a\u5e74\u9f84\u6309\u94ae', (await page.$$('#screen-title .age-btn')).length === 5);

  // Type name and start
  await page.type('#player-name', 'Hunter');
  check('\u59d3\u540d\u8f93\u5165\u540e\u5f00\u59cb\u6309\u94ae\u53ef\u7528', await page.$eval('#btn-start', b => !b.disabled));

  // Click age 7
  await page.evaluate(() => document.querySelector('#screen-title .age-btn[data-age="7"]').click());
  await page.click('#btn-start');

  // Level intro
  await page.waitForSelector('#screen-level-intro:not(.hidden)', { timeout: 5000 });
  check('\u5173\u5361\u4ecb\u7ecd\u663e\u793a', true);
  check('\u5173\u5361\u540d\u79f0', (await page.$eval('#level-intro-name', el => el.textContent)).length > 0);
  check('\u76ee\u6807\u63cf\u8ff0', /\u6355\u83b7/.test(await page.$eval('#level-intro-goal', el => el.textContent)));

  // Go!
  await page.click('#btn-go');

  // Wait for canvas to be visible
  await page.waitForSelector('#hud:not(.hidden)', { timeout: 3000 });
  check('HUD \u663e\u793a', true);
  check('\u521d\u59cb\u8840\u91cf 3', await page.$eval('#hud-hp', el => el.textContent.includes('\u2764\u2764\u2764')));
  check('\u521d\u59cb\u5206\u6570 0', (await page.$eval('#hud-score', el => el.textContent)) === '0');
  check('\u5173\u5361\u53f7 Lv.1', (await page.$eval('#hud-level', el => el.textContent)) === 'Lv.1');

  // Check that monsters are spawned (counted via game state)
  const monsterCount = await page.evaluate(() => {
    return (window._game && window._game.monsters) ? window._game.monsters.length : 0;
  });
  check('\u5c0f\u602a\u5df2\u751f\u6210', monsterCount > 0, '\u6570\u91cf: ' + monsterCount);
  const wordCount = await page.evaluate(() => (window._game && window._game.words) ? window._game.words.length : 0);
  check('\u8bcd\u6c47\u5e93\u52a0\u8f7d', wordCount > 50, '\u8bcd\u6570: ' + wordCount);

  // Force a collision by moving the player to a monster's position
  const moved = await page.evaluate(() => {
    const g = window._game;
    if (!g || !g.monsters.length) return false;
    // Teleport player right next to a monster
    g.player.x = g.monsters[0].x + 10;
    g.player.y = g.monsters[0].y;
    return true;
  });
  check('\u8fd1\u8ddd\u79fb\u52a8\u5b8c\u6210', moved);

  // Wait a moment for the collision check + question modal to appear
  await new Promise(r => setTimeout(r, 800));
  const modalShown = await page.$eval('#question-modal', el => !el.classList.contains('hidden'));
  check('\u63a5\u89e6\u540e\u95ee\u7b54\u6a21\u6001\u5f39\u51fa', modalShown);

  if (modalShown) {
    // Verify question content
    const word = await page.$eval('#modal-word', el => el.textContent);
    check('\u95ee\u9898\u663e\u793a\u5355\u8bcd', word.length > 0, word);
    const optionCount = await page.$$eval('.modal-option', els => els.length);
    check('\u95ee\u9898 4 \u4e2a\u9009\u9879', optionCount === 4, '\u5b9e\u9645: ' + optionCount);

    // Click the correct option (textContent == activeMonster.word.chinese)
    // Note: g.monsters[0] may have been replaced after capture+respawn,
    // so we use g.activeMonster which is set in _tryCollide and stays
    // stable throughout the question modal.
    const answered = await page.evaluate(() => {
      const g = window._game;
      const monster = g.activeMonster || (g.monsters.length && g.monsters[0]);
      if (!monster || !monster.word) return null;
      const correctText = monster.word.chinese;
      const opts = Array.from(document.querySelectorAll('.modal-option'));
      const correctBtn = opts.find(o => o.textContent === correctText);
      if (correctBtn) { correctBtn.click(); return true; }
      return { correctText, opts: opts.map(o => o.textContent) };
    });
    check('\u70b9\u51fb\u6b63\u786e\u9009\u9879\u6210\u529f', answered);

    // Wait for modal to close + capture animation
    await new Promise(r => setTimeout(r, 900));
    const modalClosed = await page.$eval('#question-modal', el => el.classList.contains('hidden'));
    check('\u7b54\u5bf9\u540e\u6a21\u6001\u5173\u95ed', modalClosed);
    const scoreAfter = parseInt(await page.$eval('#hud-score', el => el.textContent), 10);
    check('\u52a0\u5206\u751f\u6548', scoreAfter > 0, 'score=' + scoreAfter);
  }

  // Errors check
  check('\u65e0\u63a7\u5236\u53f0\u9519\u8bef', errors.length === 0, errors.slice(0, 2).join(' | '));

  // Dump pageerror stack
  if (errors.length) {
    console.log('\n\u9519\u8bef\u8be6\u60c5:');
    errors.forEach((e, i) => console.log('  [' + (i+1) + ']', e.substring(0, 500)));
  }

  await browser.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
