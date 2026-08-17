// .tmp_bosswin.js - trace state after a perfect boss translation
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle2' });
  await page.evaluate(() => {
    localStorage.setItem('wordhunter:save:bosskid', JSON.stringify({
      name: 'bosskid', age: 7, maxUnlocked: 10, bestScore: 0, lastPlayed: Date.now()
    }));
  });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.type('#player-name', 'bosskid');
  await sleep(400);
  await page.evaluate(() => {
    const g = window._game;
    g.playerName = 'bosskid';
    g.maxUnlocked = 10;
    // trace endLevel + schedule
    const origSchedule = g._scheduleEndLevel.bind(g);
    g._scheduleEndLevel = (won, delay) => { window.__trace.push('schedule(' + won + ',' + delay + ')'); return origSchedule(won, delay); };
    const origEnd = g.endLevel.bind(g);
    g.endLevel = (won) => { window.__trace.push('endLevel(' + won + ') state=' + g.state); return origEnd(won); };
    window.__trace = [];
    window.dispatchEvent(new CustomEvent('wordhunter:start-level', { detail: { level: 10 } }));
  });
  await sleep(2500);
  await page.click('#btn-go');
  await sleep(1200);
  await page.evaluate(() => {
    const g = window._game;
    const m = g.monsters.find(x => x.alive && !x.captured);
    g.player.invulnerable = 600000;
    g.player.x = m.x - 140; g.player.y = m.y;
    const dx = m.x - g.player.x, dy = m.y - g.player.y, mag = Math.hypot(dx, dy) || 1;
    g.player.facing = { x: dx / mag, y: dy / mag };
    g._fireBullet();
  });
  for (let i = 0; i < 30; i++) {
    await sleep(150);
    if (await page.evaluate(() => !document.getElementById('translation-modal').classList.contains('hidden'))) break;
  }
  await page.evaluate(() => {
    const essay = window.Essay._lastEssay;
    document.getElementById('translation-input').value = essay.sentences.map(s => s.en).join(' ');
  });
  await page.click('#translation-submit');
  for (let i = 0; i < 35; i++) {
    await sleep(200);
    const s = await page.evaluate(() => ({
      state: window._game.state,
      captured: window._game.captured,
      win: !document.getElementById('screen-win').classList.contains('hidden'),
      trace: window.__trace.slice()
    }));
    if (i % 3 === 0) console.log('t+' + ((i + 1) * 200) + 'ms:', JSON.stringify(s));
  }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
