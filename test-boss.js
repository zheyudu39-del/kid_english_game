// test-boss.js - E2E for the boss duel: single hyper-aggressive boss,
// translation challenge (中文作文→英文), wrong hurts, perfect wins.
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

    // ---- 1. Grading unit checks ----
    const grading = await page.evaluate(() => {
      const essay = window.Essays.makeEssay(1);
      const perfect = essay.sentences.map(s => s.en).join(' ');
      const good = window.Essays.grade(essay, perfect);
      const bad = window.Essays.grade(essay, 'hello world');
      return {
        len: essay.zh.length,
        perfectCorrect: good.correct,
        badCorrect: bad.correct,
        details: good.details.length
      };
    });
    check('essay is ~50 Chinese chars', grading.len >= 30 && grading.len <= 90, 'len=' + grading.len);
    check('perfect translation passes', grading.perfectCorrect === true, JSON.stringify(grading));
    check('garbage translation fails', grading.badCorrect === false);

    // ---- 2. Boss level boots as a 1v1 duel ----
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
    let intro = null;
    for (let i = 0; i < 40 && !intro; i++) {
      await sleep(250);
      intro = await page.evaluate(() => {
        const el = document.getElementById('screen-level-intro');
        if (el.classList.contains('hidden')) return null;
        return {
          num: document.getElementById('level-intro-num').textContent,
          goal: document.getElementById('level-intro-goal').textContent
        };
      });
    }
    check('boss intro mentions translation', !!intro && intro.num.includes('BOSS') && intro.goal.includes('翻译'), JSON.stringify(intro));

    await page.click('#btn-go');
    await sleep(1500);
    const duel = await page.evaluate(() => {
      const g = window._game;
      return {
        playing: g.state === 'playing',
        count: g.monsters.length,
        boss: g.monsters[0] ? !!g.monsters[0].boss : false,
        scale: g.monsters[0] ? g.monsters[0].scale : 0,
        aggressive: g.monsters[0] ? g.monsters[0].ai : '',
        target: document.getElementById('hud-target').textContent,
        ammo: g.ammo,
        timeLimit: g.currentLevel.timeLimit
      };
    });
    check('boss duel: exactly one monster', duel.playing && duel.count === 1, JSON.stringify(duel));
    check('the monster is a big aggressive boss', duel.boss && duel.scale >= 1.8 && duel.aggressive === 'aggressive', JSON.stringify(duel));
    check('target 0/1, generous ammo, >=150s timer', duel.target === '0/1' && duel.ammo >= 30 && duel.timeLimit >= 150, JSON.stringify(duel));

    // ---- 3. Engage the boss → translation modal ----
    const engage = async () => {
      const ok = await page.evaluate(() => {
        const g = window._game;
        const m = g.monsters.find(x => x.alive && !x.captured);
        if (!m) return false;
        g.player.invulnerable = 600000; // shield the test from boss attacks
        g.player.x = m.x - 140; g.player.y = m.y;
        const dx = m.x - g.player.x, dy = m.y - g.player.y, mag = Math.hypot(dx, dy) || 1;
        g.player.facing = { x: dx / mag, y: dy / mag };
        g._fireBullet();
        return true;
      });
      if (!ok) return false;
      for (let i = 0; i < 40; i++) {
        await sleep(150);
        const open = await page.evaluate(() =>
          !document.getElementById('translation-modal').classList.contains('hidden'));
        if (open) return true;
      }
      return false;
    };

    check('shooting the boss opens translation modal', await engage());
    const essayInfo = await page.evaluate(() => {
      const essay = window.Essay._lastEssay;
      return {
        zh: essay.zh,
        len: essay.zh.length,
        sentences: essay.sentences.length,
        inputVisible: !!document.getElementById('translation-input')
      };
    });
    check('essay shown with 4 sentences', essayInfo.sentences === 4 && essayInfo.inputVisible, JSON.stringify(essayInfo).slice(0, 160));

    // ---- 4. Wrong translation hurts the player ----
    const hpBefore = await page.evaluate(() => window._game.hp);
    // The engage helper shields the test from boss fireballs; lift that
    // shield so the wrong-answer counterattack actually costs 1 HP.
    await page.evaluate(() => { window._game.player.invulnerable = 0; });
    await page.type('#translation-input', 'hello world');
    await page.click('#translation-submit');
    await sleep(4800); // wrong feedback window 4.2s
    const afterWrong = await page.evaluate(() => ({
      hp: window._game.hp,
      modalHidden: document.getElementById('translation-modal').classList.contains('hidden')
    }));
    check('wrong translation costs 1 HP', afterWrong.hp === hpBefore - 1, 'hp ' + hpBefore + '->' + afterWrong.hp);
    check('translation modal closes after wrong', afterWrong.modalHidden);

    // ---- 5. Perfect translation defeats the boss ----
    check('re-engage boss after wrong answer', await engage());
    await page.evaluate(() => {
      const essay = window.Essay._lastEssay;
      const perfect = essay.sentences.map(s => s.en).join(' ');
      document.getElementById('translation-input').value = perfect;
    });
    await page.click('#translation-submit');
    // Poll: feedback 2.6s + capture + 600ms win schedule — timing is
    // animation-bound, so wait for the screen instead of a fixed sleep.
    let win = null;
    for (let i = 0; i < 45; i++) {
      await sleep(200);
      win = await page.evaluate(() => ({
        winScreen: !document.getElementById('screen-win').classList.contains('hidden'),
        captured: window._game.captured,
        state: window._game.state
      }));
      if (win.winScreen) break;
    }
    check('perfect translation wins the boss duel', win.winScreen && win.captured === 1, JSON.stringify(win));

    check('no JS runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(failures ? 'FAILURES: ' + failures : 'ALL PASS');
    process.exitCode = failures ? 1 : 0;
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
