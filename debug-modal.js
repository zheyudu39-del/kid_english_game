// Diagnose: see what word the question modal shows vs what option to click
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=900,700']
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console', m => { if (m.type() === 'log') console.log('CONSOLE:', m.text()); });

  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle0' });
  await page.type('#player-name', 'Hunter');
  await page.evaluate(() => document.querySelector('.age-btn[data-age="7"]').click());
  await page.click('#btn-start');
  await page.waitForSelector('#screen-level-intro:not(.hidden)');
  await page.click('#btn-go');
  await new Promise(r => setTimeout(r, 600));

  // Force collision
  await page.evaluate(() => {
    const g = window._game;
    g.player.x = g.monsters[0].x;
    g.player.y = g.monsters[0].y;
  });
  await new Promise(r => setTimeout(r, 800));

  const m = await page.evaluate(() => {
    const word = document.getElementById('modal-word').textContent;
    const opts = Array.from(document.querySelectorAll('.modal-option')).map(o => o.textContent);
    const activeMonster = window._game.activeMonster;
    return {
      modalWord: word,
      modalOptions: opts,
      activeMonsterChinese: activeMonster ? activeMonster.word.chinese : null,
      activeMonsterEnglish: activeMonster ? activeMonster.word.english : null,
      monstersCount: window._game.monsters.length
    };
  });
  console.log(JSON.stringify(m, null, 2));
  await browser.close();
})();
