// .tmp_bossdebug.js - why doesn't the translation modal open?
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
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
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
    window.dispatchEvent(new CustomEvent('wordhunter:start-level', { detail: { level: 10 } }));
  });
  await sleep(2500);
  await page.click('#btn-go');
  await sleep(1200);
  const env = await page.evaluate(() => ({
    hasModal: !!document.getElementById('translation-modal'),
    hasEssays: !!window.Essays,
    hasEssayShow: !!(window.Essay && typeof window.Essay.show === 'function'),
    state: window._game.state
  }));
  console.log('ENV:', JSON.stringify(env));
  const fireRes = await page.evaluate(() => {
    const g = window._game;
    const m = g.monsters.find(x => x.alive && !x.captured);
    if (!m) return { err: 'no monster' };
    g.player.invulnerable = 600000;
    g.player.x = m.x - 140; g.player.y = m.y;
    const dx = m.x - g.player.x, dy = m.y - g.player.y, mag = Math.hypot(dx, dy) || 1;
    g.player.facing = { x: dx / mag, y: dy / mag };
    const bulletsBefore = g.bullets.length;
    g._fireBullet();
    return { fired: g.bullets.length > bulletsBefore, dist: mag, bossX: m.x, bossY: m.y, px: g.player.x };
  });
  console.log('FIRE:', JSON.stringify(fireRes));
  for (let i = 0; i < 30; i++) {
    await sleep(150);
    const s = await page.evaluate(() => ({
      modalOpen: !document.getElementById('translation-modal').classList.contains('hidden'),
      qOpen: !document.getElementById('question-modal').classList.contains('hidden'),
      engaged: window._game.activeMonster !== null,
      bullets: window._game.bullets.length,
      bossAlive: window._game.monsters.filter(m => m.alive).length
    }));
    if (s.modalOpen || s.qOpen || i % 5 === 0) console.log('t+' + ((i + 1) * 150) + 'ms:', JSON.stringify(s));
    if (s.modalOpen || s.qOpen) break;
  }
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
