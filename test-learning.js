// test-learning.js - E2E for the learning features: 4 question types,
// wrong-word book (persistence + spaced repetition), review levels, and
// the parent report (API + UI).
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

    // ============ 1. Question types ============
    const qt = await page.evaluate(async () => {
      const g = window._game;
      g.playerName = 'qtkid';
      if (window.WrongBook) WrongBook.clear();
      const word = { id: 'qt1', english: 'apple', chinese: '苹果', difficulty: 2 };
      const waitOptions = () => new Promise(res => {
        const t = setInterval(() => {
          if (document.querySelectorAll('#modal-options .modal-option').length >= 4) { clearInterval(t); res(); }
        }, 50);
      });
      const runType = async (type) => {
        const p = window.Question.show(word, g.words, { type });
        await waitOptions();
        const prompt = document.getElementById('modal-prompt').textContent;
        const display = document.getElementById('modal-word').textContent;
        const subShown = !document.getElementById('modal-sub').classList.contains('hidden');
        const replayShown = !document.getElementById('modal-replay').classList.contains('hidden');
        let correctText;
        if (type === 'en2cn') correctText = '苹果';
        else if (type === 'spell') {
          const toks = display.trim().split(/\s+/);
          const bi = toks.indexOf('_');
          correctText = 'apple'.charAt(bi);
        } else correctText = 'apple';
        const btns = Array.from(document.querySelectorAll('#modal-options .modal-option'));
        const btn = btns.find(b => b.textContent === correctText);
        if (!btn) return { type, ok: false, why: 'no correct option', display };
        btn.click();
        const result = await p;
        return { type, ok: result.correct === true, rtype: result.type, prompt, display, subShown, replayShown };
      };
      const out = [];
      out.push(await runType('en2cn'));
      out.push(await runType('cn2en'));
      out.push(await runType('listen'));
      out.push(await runType('spell'));
      // Wrong answer on cn2en must resolve correct=false.
      const p2 = window.Question.show(word, g.words, { type: 'cn2en' });
      await waitOptions();
      const btns2 = Array.from(document.querySelectorAll('#modal-options .modal-option'));
      const wrongBtn = btns2.find(b => b.textContent !== 'apple') || btns2[0];
      wrongBtn.click();
      const r2 = await p2;
      out.push({ type: 'cn2en-wrong', ok: r2.correct === false });
      return out;
    });
    for (const t of qt) {
      check('question type ' + t.type + ' works', t.ok,
        t.ok ? ('"' + t.prompt + '" / ' + JSON.stringify(t.display)) : (t.why || 'unexpected result'));
    }
    check('listen type shows replay button', qt[2] && qt[2].replayShown === true, JSON.stringify(qt[2] || {}));
    check('spell type shows Chinese sub-line', qt[3] && qt[3].subShown === true, JSON.stringify(qt[3] || {}));

    // Type gating: level 1 always classic; high level unlocks more; review rotates.
    const gating = await page.evaluate(() => {
      const g = window._game;
      const w = { english: 'cat', chinese: '猫' };
      const at = (lvl, age, review) => {
        g.currentLevelNum = lvl; g.ageGroup = age;
        g.currentLevel = review ? { isReview: true } : { isReview: false };
        return g._pickQuestionType(w);
      };
      const bag = new Set();
      for (let i = 0; i < 60; i++) bag.add(at(300, 12, false));
      return {
        lvl1: at(1, 12, false),
        lvl5: at(5, 7, false),
        highBag: [...bag].sort().join(','),
        reviewBag: (() => { const s = new Set(); for (let i = 0; i < 80; i++) s.add(at(1, 7, true)); return [...s].sort().join(','); })()
      };
    });
    check('level 1-9 stays on en2cn (onboarding)', gating.lvl1 === 'en2cn' && gating.lvl5 === 'en2cn', JSON.stringify(gating));
    check('high level/age unlocks cn2en+listen+spell', gating.highBag.includes('cn2en') && gating.highBag.includes('listen') && gating.highBag.includes('spell'), gating.highBag);
    check('review level rotates all types', gating.reviewBag.includes('spell') && gating.reviewBag.includes('cn2en'), gating.reviewBag);

    // ============ 2. Wrong-word book ============
    const wb1 = await page.evaluate(() => {
      window._game.playerName = 'wbkid';
      WrongBook.clear();
      const w = { english: 'Apple', chinese: '苹果', difficulty: 2 };
      WrongBook.recordWrong(w);
      WrongBook.recordWrong(w);   // second miss: wrongCount 2
      const s1 = WrongBook.stats();
      const list1 = WrongBook.allWords();
      return { s1, wc: list1.length ? list1[0].wrong : 0 };
    });
    check('wrong word recorded (due, wrongCount=2)', wb1.s1.total === 1 && wb1.s1.due === 1 && wb1.wc === 2, JSON.stringify(wb1));

    const wb2 = await page.evaluate(async () => {
      const w = { english: 'apple', chinese: '苹果', difficulty: 2 };
      WrongBook.recordRight(w);  // box 1 (20 min later — not due)
      const s2 = WrongBook.stats();
      WrongBook.recordRight(w);  // box 2
      WrongBook.recordRight(w);  // box 3 -> mastered, removed
      const s3 = WrongBook.stats();
      return { s2, s3 };
    });
    check('spaced repetition: 1 right defers review', wb2.s2.due === 0 && wb2.s2.total === 1, JSON.stringify(wb2.s2));
    check('3 rights graduates the word', wb2.s3.total === 0 && wb2.s3.mastered === 1, JSON.stringify(wb2.s3));

    // Persistence across reload (same player name).
    await page.reload({ waitUntil: 'networkidle2' });
    const wb3 = await page.evaluate(() => {
      window._game.playerName = 'wbkid';
      return WrongBook.stats();
    });
    check('wrong book persists across reload', wb3.total === 0 && wb3.mastered === 1, JSON.stringify(wb3));

    // ============ 3. Review level ============
    // Seed three real vocabulary words as wrong. The page was reloaded for
    // the persistence check above, so the vocabulary must be (re)loaded
    // first — an empty word pool would seed nothing and review wouldn't
    // start.
    const seeded = await page.evaluate(async () => {
      const g = window._game;
      g.playerName = 'wbkid';
      g.currentLevel = { isReview: false };
      WrongBook.clear();
      if (!g.words || g.words.length === 0) {
        try {
          g.vocabulary = await window.API.getVocabulary();
          g.words = (g.vocabulary && g.vocabulary.words) || [];
        } catch (e) { g.words = []; }
      }
      const seed = g.words.filter(w => w && w.english && w.chinese && /^[a-z]{3,8}$/.test(w.english)).slice(0, 3);
      seed.forEach(w => WrongBook.recordWrong(w));
      window.__seed = seed.map(w => w.english);
      return seed.length;
    });
    check('seeded 3 wrong words from vocabulary', seeded === 3, 'seeded=' + seeded);
    const started = await page.evaluate(() => window._game.startReviewLevel());
    check('review level starts when words are due', started === true);
    await sleep(400);
    const intro = await page.evaluate(() => ({
      num: document.getElementById('level-intro-num').textContent,
      goal: document.getElementById('level-intro-goal').textContent
    }));
    check('review intro shows 错词复习', intro.num === '错词复习', JSON.stringify(intro));
    await page.click('#btn-go');
    await sleep(600);
    const arena = await page.evaluate(() => {
      const g = window._game;
      return {
        count: g.monsters.length,
        words: g.monsters.map(m => m.word.english).sort().join(','),
        seed: window.__seed.slice().sort().join(','),
        hud: document.getElementById('hud-level').textContent
      };
    });
    check('review spawns exactly the seeded words', arena.count === 3 && arena.words === arena.seed, JSON.stringify(arena));
    check('HUD shows 复习 label', arena.hud === '复习', arena.hud);

    // Capture all three via direct fire + correct answers (type-agnostic).
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => {
        const g = window._game;
        const m = g.monsters.find(x => x.alive && !x.captured);
        if (!m) return 'no-monster';
        g.player.x = m.x - 100; g.player.y = m.y;
        const dx = m.x - g.player.x, dy = m.y - g.player.y, mag = Math.hypot(dx, dy) || 1;
        g.player.facing = { x: dx / mag, y: dy / mag };
        g._fireBullet();
        return 'fired';
      });
      await sleep(500);
      const answered = await page.evaluate(async () => {
        const modal = document.getElementById('question-modal');
        for (let t = 0; t < 40 && modal.classList.contains('hidden'); t++) await new Promise(r => setTimeout(r, 50));
        if (modal.classList.contains('hidden')) return 'modal-never-opened';
        const g = window._game;
        const m = g.activeMonster;
        const word = m && m.word;
        const type = document.getElementById('modal-prompt').textContent;
        let correctText = null;
        if (type.includes('中文')) correctText = word.chinese;
        else if (type.includes('补全')) {
          const toks = document.getElementById('modal-word').textContent.trim().split(/\s+/);
          const bi = toks.indexOf('_');
          correctText = word.english.charAt(bi);
        } else correctText = word.english;
        const btns = Array.from(document.querySelectorAll('#modal-options .modal-option'));
        const btn = btns.find(b => b.textContent === correctText) || btns[0];
        btn.click();
        return 'answered:' + type;
      });
      await sleep(1600); // feedback + settle
      if (i === 0) check('review question modal opens + answerable', /^answered/.test(String(answered)), String(answered));
    }
    await sleep(1200);
    const reviewEnd = await page.evaluate(() => ({
      winVisible: !document.getElementById('screen-win').classList.contains('hidden'),
      title: document.querySelector('#screen-win h2').textContent,
      replayLabel: document.getElementById('btn-replay').textContent,
      nextHidden: document.getElementById('btn-next-level').classList.contains('hidden'),
      wb: WrongBook.stats()
    }));
    check('review win screen shows 复习完成', reviewEnd.winVisible && reviewEnd.title === '复习完成!', JSON.stringify(reviewEnd));
    check('review relabels replay / hides next', reviewEnd.replayLabel === '再复习一轮' && reviewEnd.nextHidden, JSON.stringify(reviewEnd));
    check('all review words answered correctly (deferred)', reviewEnd.wb.total === 3 && reviewEnd.wb.due === 0, JSON.stringify(reviewEnd.wb));

    // ============ 4. Parent report ============
    const nick = 'rp' + (Date.now() % 100000);
    const post = async (correct, rounds, playSec) => {
      const res = await fetch(BASE + '/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nick, score: 100, ageGroup: 7, gameMode: 'word-hunter', category: 'mixed', roundsPlayed: rounds, correctCount: correct, playSec })
      });
      return res.status;
    };
    check('submit score rows for report', (await post(8, 10, 120)) === 201 && (await post(9, 10, 60)) === 201);
    const report = await (await fetch(BASE + '/api/report/' + nick)).json();
    check('report totals aggregate', report.totals.sessions === 2 && report.totals.rounds === 20 &&
      report.totals.correct === 17 && report.totals.accuracy === 85 && report.totals.playSec === 180,
      JSON.stringify(report.totals));

    // Report UI
    await page.evaluate((n) => {
      document.getElementById('player-name').value = n;
      window._game.playerName = n;
      window._game.showScreen('screen-title');
      window._game.state = 'title';
    }, nick);
    await page.click('#btn-report');
    await sleep(900);
    const rpUI = await page.evaluate(() => ({
      visible: !document.getElementById('screen-report').classList.contains('hidden'),
      cards: document.getElementById('rp-cards').textContent,
      who: document.getElementById('rp-who').textContent,
      hasTrend: !!document.querySelector('#rp-trend svg'),
      sessions: document.querySelectorAll('#rp-sessions .rp-session').length
    }));
    check('report screen opens with stats', rpUI.visible && rpUI.cards.includes('85%') && rpUI.who.includes(nick), JSON.stringify(rpUI).slice(0, 200));
    check('report renders trend SVG + session rows', rpUI.hasTrend && rpUI.sessions >= 2, JSON.stringify(rpUI.sessions));
    await page.click('#btn-rp-close');
    // Negative playSec is clamped server-side (0), not stored as-is.
    check('report clamps garbage playSec', (await post(1, 5, -50)) === 201);

    // ============ 5. Title entries + badge ============
    const entries = await page.evaluate(() => {
      document.getElementById('player-name').value = 'badgekid';
      window._game.playerName = 'badgekid';
      WrongBook.clear();
      ['a', 'b', 'c', 'd', 'e'].forEach((e, i) => WrongBook.recordWrong({ english: 'w' + e, chinese: '词' + i, difficulty: 1 }));
      const badge = document.getElementById('wb-badge');
      return {
        wbBtn: !!document.getElementById('btn-wrongbook'),
        rpBtn: !!document.getElementById('btn-report'),
        badgeText: badge.textContent,
        badgeVisible: !badge.classList.contains('hidden')
      };
    });
    check('title buttons exist', entries.wbBtn && entries.rpBtn);
    check('due badge shows count', entries.badgeVisible && entries.badgeText === '5', JSON.stringify(entries));
    await page.click('#btn-wrongbook');
    await sleep(300);
    const wbUI = await page.evaluate(() => ({
      visible: !document.getElementById('screen-wrongbook').classList.contains('hidden'),
      rows: document.querySelectorAll('#wb-list .wb-row').length,
      reviewLabel: document.getElementById('btn-review-start').textContent
    }));
    check('wrongbook screen lists words', wbUI.visible && wbUI.rows === 5, JSON.stringify(wbUI));
    check('review button shows due count', wbUI.reviewLabel.includes('5'), wbUI.reviewLabel);
    await page.click('#btn-wb-close');

    check('no JS runtime errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    console.log(failures ? 'FAILURES: ' + failures : 'ALL PASS');
    process.exitCode = failures ? 1 : 0;
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
