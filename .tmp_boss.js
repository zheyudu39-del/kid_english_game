// .tmp_boss.js - open boss level 10 in a VISIBLE browser and start it
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: false,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const page = (await browser.pages())[0];
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle2' });

  // Unlock up to level 10 for a fresh viewer profile.
  await page.evaluate(() => {
    localStorage.setItem('wordhunter:save:bossviewer', JSON.stringify({
      name: 'bossviewer', age: 7, maxUnlocked: 10, bestScore: 0, lastPlayed: Date.now()
    }));
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.type('#player-name', 'bossviewer');
  await sleep(400);

  // Try the map first; fall back to a direct start if the node isn't rendered.
  await page.click('#btn-map');
  await sleep(800);
  let clicked = await page.evaluate(() => {
    const n = document.querySelector('.map-node[data-level="10"]');
    if (n) { n.click(); return true; }
    return false;
  });
  if (!clicked) {
    await page.evaluate(() => window._game.startLevel(10));
  }
  await sleep(1800);
  const intro = await page.evaluate(() => ({
    num: document.getElementById('level-intro-num').textContent,
    name: document.getElementById('level-intro-name').textContent,
    goal: document.getElementById('level-intro-goal').textContent,
    visible: !document.getElementById('screen-level-intro').classList.contains('hidden')
  }));
  console.log('BOSS INTRO:', JSON.stringify(intro));
  if (intro.visible) {
    await page.click('#btn-go');
    await sleep(2500);
    const battle = await page.evaluate(() => {
      const g = window._game;
      const boss = g.monsters.find(m => m.boss);
      return {
        playing: g.state === 'playing',
        monsters: g.monsters.length,
        hasBoss: !!boss,
        bossScale: boss ? boss.scale : 0,
        hud: document.getElementById('hud-level').textContent
      };
    });
    console.log('BATTLE:', JSON.stringify(battle));
  }
  console.log('WINDOW LEFT OPEN for you to play (30 min).');
  await sleep(30 * 60 * 1000);
  await browser.close();
})().catch(e => { console.error('BOSS OPEN ERROR', e); process.exit(1); });
