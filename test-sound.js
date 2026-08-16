// test-sound.js - E2E for the WebAudio sound-effect system: module load,
// mute toggle + persistence, real gameplay triggers recorded, no JS errors.
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail) {
  detail = detail || '';
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
    protocolTimeout: 60000
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/', { waitUntil: 'networkidle2' });

    // ---- module + alias upgrade ----
    const mod = await page.evaluate(() => ({
      hasSound: !!window.Sound,
      hasPlay: !!(window.Sound && typeof window.Sound.play === 'function'),
      alias: typeof Utils.playBeep === 'function'
    }));
    check('Sound module loaded', mod.hasSound && mod.hasPlay && mod.alias, JSON.stringify(mod));

    // Every catalog entry must schedule without throwing (headless audio ctx).
    const badSounds = await page.evaluate(() => {
      const names = ['click', 'shoot', 'hit', 'engage', 'correct', 'wrong', 'catch',
        'coin', 'combo', 'win', 'lose', 'boss', 'bossDown', 'countdown', 'tick',
        'join', 'leave', 'matchStart', 'knockout', 'unlock'];
      const bad = [];
      for (const n of names) {
        try { window.Sound.play(n, { combo: 5, final: true }); }
        catch (e) { bad.push(n + ':' + e.message); }
      }
      return bad;
    });
    check('all 20 sound effects play without throwing', badSounds.length === 0, badSounds.join(','));

    // ---- mute toggle + persistence ----
    check('mute button visible', await page.$eval('#btn-sound-toggle', el => getComputedStyle(el).display !== 'none'));
    await page.click('#btn-sound-toggle');
    await sleep(200);
    let state = await page.evaluate(() => ({ muted: window.Sound.isMuted(), label: document.querySelector('#btn-sound-toggle').getAttribute('aria-label') }));
    check('click toggles mute on', state.muted === true && /开启音效/.test(state.label), JSON.stringify(state));
    check('muted play is recorded but silent-safe', await page.evaluate(() => { window.Sound.play('coin'); return window.Sound.recent().slice(-1)[0] === 'coin'; }));
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(300);
    state = await page.evaluate(() => ({ muted: window.Sound.isMuted(), icon: document.querySelector('#btn-sound-toggle').textContent }));
    check('mute persists across reload', state.muted === true && state.icon === '🔇', JSON.stringify(state));
    await page.click('#btn-sound-toggle'); // unmute
    await sleep(200);
    check('click toggles mute off', await page.evaluate(() => window.Sound.isMuted()) === false);
    // Keyboard M toggles too — but must NOT fire while typing in an input.
    await page.keyboard.press('m');
    await sleep(200);
    check('M key toggles mute', await page.evaluate(() => window.Sound.isMuted()) === true);
    await page.keyboard.press('m');
    await sleep(100);

    // ---- real gameplay triggers ----
    await page.type('#player-name', 'sndkid');
    await page.click('#btn-start');
    await sleep(2500);
    const introSound = await page.evaluate(() => window.Sound.recent());
    check('level intro plays a sound (click)', introSound.includes('click'), introSound.join(','));
    await page.click('#btn-go');
    await sleep(1200);
    // Fire a bullet: press Space until a shoot sound is recorded.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.down('Space');
      await sleep(80);
      await page.keyboard.up('Space');
      await sleep(200);
      if (await page.evaluate(() => window.Sound.recent().includes('shoot'))) break;
    }
    const fired = await page.evaluate(() => window.Sound.recent());
    check('shooting plays shoot sound', fired.includes('shoot'), fired.slice(-6).join(','));
    // Engage a monster like test-wordhunter does: teleport next to one and
    // fire — keyboard-walking is too flaky for a reliable hit.
    const moved = await page.evaluate(() => {
      const g = window._game;
      if (!g || !g.monsters.length || !g.player) return false;
      const m = g.monsters[0];
      g.player.x = m.x - 120;
      g.player.y = m.y;
      const dx = m.x - g.player.x, dy = m.y - g.player.y;
      const mag = Math.hypot(dx, dy) || 1;
      g.player.facing = { x: dx / mag, y: dy / mag };
      g._fireBullet();
      return true;
    });
    check('engaged a monster via direct fire', moved);
    await sleep(900);
    const modalOpen = await page.$eval('#question-modal', el => !el.classList.contains('hidden'));
    check('question modal opened (engage sound path)', modalOpen);
    if (modalOpen) {
      await page.evaluate(() => {
        const g = window._game;
        const monster = g.activeMonster || (g.monsters.length && g.monsters[0]);
        const correctText = monster && monster.word && monster.word.chinese;
        const opts = Array.from(document.querySelectorAll('.modal-option'));
        const btn = opts.find(o => o.textContent === correctText) || opts[0];
        if (btn) btn.click();
      });
      await sleep(900);
    }
    const afterAnswer = await page.evaluate(() => window.Sound.recent());
    check('engage sound played on question open', afterAnswer.includes('engage'), afterAnswer.join(','));
    check('answer played correct or wrong', afterAnswer.includes('correct') || afterAnswer.includes('wrong'), afterAnswer.slice(-4).join(','));

    // ---- map sounds ----
    await page.evaluate(() => { window._game.showScreen('screen-title'); window._game.paused = true; window._game.state = 'title'; });
    await sleep(300);
    await page.click('#btn-map');
    await sleep(500);
    await page.click('.map-node[data-level="666"]');
    await sleep(300);
    const mapSounds = await page.evaluate(() => window.Sound.recent());
    check('locked map node plays wrong sound', mapSounds.includes('wrong'), mapSounds.slice(-3).join(','));
    await page.click('.map-node[data-level="1"]');
    await sleep(2500);
    const mapSounds2 = await page.evaluate(() => window.Sound.recent());
    check('unlocked map node plays unlock sound', mapSounds2.includes('unlock'), mapSounds2.slice(-3).join(','));

    // ---- boss growl on boss-level intro (drive via direct call path) ----
    const bossOk = await page.evaluate(() => {
      window.Sound.play('boss');
      return window.Sound.recent().slice(-1)[0] === 'boss';
    });
    check('boss growl playable', bossOk);

    check('no JS runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));

    console.log(failures ? 'FAILURES: ' + failures : 'ALL PASS');
    process.exitCode = failures ? 1 : 0;
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
