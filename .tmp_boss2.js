// .tmp_boss2.js - open boss level 10 directly (event path used by the map),
// verify the intro shows the BOSS header, then start the battle.
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

  await page.evaluate(() => {
    localStorage.setItem('wordhunter:save:bossviewer', JSON.stringify({
      name: 'bossviewer', age: 7, maxUnlocked: 10, bestScore: 0, lastPlayed: Date.now()
    }));
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.type('#player-name', 'bossviewer');
  await sleep(500);

  // Go straight through the same event the map dispatches (bypasses the
  // map's unlock toast gate) after syncing the in-memory save state.
  await page.evaluate(() => {
    const g = window._game;
    g.playerName = 'bossviewer';
    g.maxUnlocked = 10;
    window.dispatchEvent(new CustomEvent('wordhunter:start-level', { detail: { level: 10 } }));
  });

  // Poll for the level intro to appear (startLevel awaits two API calls).
  let intro = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    intro = await page.evaluate(() => {
      const el = document.getElementById('screen-level-intro');
      if (el.classList.contains('hidden')) return null;
      return {
        num: document.getElementById('level-intro-num').textContent,
        name: document.getElementById('level-intro-name').textContent,
        goal: document.getElementById('level-intro-goal').textContent
      };
    });
    if (intro) break;
  }
  console.log('BOSS INTRO:', JSON.stringify(intro));
  if (intro && intro.num.includes('10')) {
    await page.click('#btn-go');
    await sleep(3000);
    const battle = await page.evaluate(() => {
      const g = window._game;
      const boss = g.monsters.find(m => m.boss);
      return {
        playing: g.state === 'playing',
        monsters: g.monsters.length,
        hasBoss: !!boss,
        bossScale: boss ? boss.scale : 0,
        bossName: (g.currentLevel && g.currentLevel.monsterName) || '',
        hud: document.getElementById('hud-level').textContent
      };
    });
    console.log('BATTLE:', JSON.stringify(battle));
  }
  console.log('WINDOW LEFT OPEN for you to play (30 min).');
  await sleep(30 * 60 * 1000);
  await browser.close();
})().catch(e => { console.error('BOSS OPEN ERROR', e); process.exit(1); });
