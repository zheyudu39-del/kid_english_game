// Verify the title screen actually contains the game-style elements
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));

  const result = await page.evaluate(() => {
    const has = (sel) => !!document.querySelector(sel);
    const text = (sel) => document.querySelector(sel)?.textContent.trim() || null;
    const style = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily.split(',')[0].trim(),
        color: cs.color,
        textShadow: cs.textShadow
      };
    };
    return {
      // === Hero banner ===
      hasBanner:       has('.title-banner'),
      hasSword:        has('.title-banner__decoration'),
      hasGameEmoji:    text('.title-emoji'),
      hasTitleText:    text('.title-text'),
      hasTitleSub:     text('.title-sub'),
      hasTagline:      text('.tagline'),
      // === Stats ribbon ===
      hasStats:        has('.title-stats'),
      statsItems:      [...document.querySelectorAll('.title-stats__item')].map(i => i.textContent.trim()),
      // === Form ===
      hasForm:         has('.title-form'),
      hasNameField:    has('.title-field'),
      hasAgeSelect:    has('.age-select'),
      ageBtns:         [...document.querySelectorAll('.age-btn')].map(b => ({
        age: b.dataset.age,
        emoji: b.querySelector('.age-btn__emoji')?.textContent.trim(),
        num:   b.querySelector('.age-btn__num')?.textContent.trim(),
        label: b.querySelector('.age-btn__label')?.textContent.trim()
      })),
      hasStartBtn:     has('#btn-start'),
      startBtnText:    text('#btn-start'),
      hasShine:        has('.btn-shine'),
      // === Background decorations ===
      bgMonsters:      [...document.querySelectorAll('.title-bg__monster')].map(m => m.textContent.trim()),
      bgCoins:         [...document.querySelectorAll('.title-bg__coin')].map(c => c.textContent.trim()),
      hasClouds:       has('.title-bg__clouds'),
      hasGround:       has('.title-bg__ground'),
      // === Computed style samples ===
      titleTextStyle:  style('.title-text'),
      startBtnStyle:   style('#btn-start'),
      statsStyle:      style('.title-stats')
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
