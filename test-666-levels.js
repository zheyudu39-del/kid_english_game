// test-666-levels.js - Verify the new 666-level frontend exposes the right configs.
// Boots a headless Chromium, loads the page, types a name, picks age, starts
// the game, then for several key levels (1, 111=world1boss, 222=world2boss,
// 333=world3boss, 444=world4boss, 555=world5boss, 666=world6boss) inspects
// `window._game.currentLevel` and confirms it has the right world /
// difficulty / isBoss / target / minDifficulty..maxDifficulty.
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  // Use domcontentloaded (fast) + waitForSelector for the title screen,
  // then explicitly wait for _game.currentLevel to be populated after
  // the start click. networkidle0 was unreliable once the async level
  // loader added a few in-flight requests.
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 10000 });

  // Enter name + click first age button + start
  await page.type('#player-name', 'tester666');
  await page.click('.age-btn[data-age="7"]');
  await page.click('#btn-start');

  // Wait for first level intro to render
  await page.waitForFunction(() => window._game && window._game.currentLevel,
    { timeout: 15000 });

  // Read out the first level's config from window._game
  const lv1 = await page.evaluate(() => {
    const g = window._game;
    return {
      num: g.currentLevelNum,
      world: g.currentLevel.world,
      isBoss: g.currentLevel.isBoss,
      difficulty: g.currentLevel.difficulty,
      minDifficulty: g.currentLevel.minDifficulty,
      maxDifficulty: g.currentLevel.maxDifficulty,
      monsterType: g.currentLevel.monsterType,
      monsterName: g.currentLevel.monsterName,
      target: g.currentLevel.target,
      timeLimit: g.currentLevel.timeLimit,
      monsterHP: g.currentLevel.monsterHP,
      wordsLoaded: g.words.length
    };
  });
  console.log('LEVEL 1:', JSON.stringify(lv1));

  // The new Levels module has been preloaded by main.js
  const cache = await page.evaluate(() => ({
    total: window.Levels.TOTAL_LEVELS,
    cacheReady: !!(window.Levels._cache.meta && window.Levels._cache.meta.levels.length),
    sample111: window.Levels.getLevel(111),
    sample222: window.Levels.getLevel(222),
    sample666: window.Levels.getLevel(666)
  }));
  console.log('Levels.TOTAL_LEVELS:', cache.total);
  console.log('Cache primed:', cache.cacheReady, 'count:', cache.cacheReady ? '(see /api/levels)' : '');

  const expectations = [
    { num: 1,   world: 1, isBoss: false, difficulty: 1 },
    { num: 111, world: 1, isBoss: true,  difficulty: 3 },
    { num: 112, world: 2, isBoss: false, difficulty: 3 },
    { num: 222, world: 2, isBoss: true,  difficulty: 4 },
    { num: 333, world: 3, isBoss: true,  difficulty: 5 },
    { num: 444, world: 4, isBoss: true,  difficulty: 6 },
    { num: 555, world: 5, isBoss: true,  difficulty: 7 },
    { num: 666, world: 6, isBoss: true,  difficulty: 8 }
  ];

  let pass = 0, fail = 0;
  for (const e of expectations) {
    const lv = await page.evaluate(n => window.Levels.getLevel(n), e.num);
    const ok = lv.world === e.world && lv.isBoss === e.isBoss && lv.difficulty === e.difficulty
      && lv.minDifficulty >= 1 && lv.maxDifficulty <= 8 && lv.minDifficulty <= lv.maxDifficulty
      && lv.target > 0 && lv.timeLimit > 0 && lv.monsterHP > 0;
    if (ok) { pass++; console.log('  ✅ L' + e.num + ' world=' + lv.world + ' boss=' + lv.isBoss + ' d=' + lv.difficulty + ' band=[' + lv.minDifficulty + ',' + lv.maxDifficulty + '] target=' + lv.target + ' time=' + lv.timeLimit + 's hp=' + lv.monsterHP + ' type=' + lv.monsterType); }
    else    { fail++; console.log('  ❌ L' + e.num + ' got', JSON.stringify({world:lv.world,isBoss:lv.isBoss,difficulty:lv.difficulty,band:[lv.minDifficulty,lv.maxDifficulty],target:lv.target,timeLimit:lv.timeLimit,monsterHP:lv.monsterHP})); }
  }

  // Async: getLevelAsync for 111 should pull full monsterName from server
  const full111 = await page.evaluate(async () => await window.Levels.getLevelAsync(111));
  const hasName = typeof full111.monsterName === 'string' && full111.monsterName.length > 0;
  if (hasName) { pass++; console.log('  ✅ L111 async monsterName="' + full111.monsterName + '" reward=' + JSON.stringify(full111.reward)); }
  else         { fail++; console.log('  ❌ L111 async missing monsterName'); }

  // Click "go" and verify game actually starts (canvas visible)
  await page.click('#btn-go');
  await new Promise(r => setTimeout(r, 500));
  const canvasVisible = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    return c && c.style.display !== 'none';
  });
  if (canvasVisible) { pass++; console.log('  ✅ canvas visible after startLevel'); }
  else               { fail++; console.log('  ❌ canvas not visible after startLevel'); }

  if (errs.length) { fail++; console.log('  ❌ console errors:', errs); }
  else             { pass++; console.log('  ✅ no console errors'); }

  console.log('\n' + pass + '/' + (pass + fail) + ' passed');
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('test error:', e); process.exit(2); });
