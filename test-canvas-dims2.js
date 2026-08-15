// test-canvas-dims2.js - detailed canvas alignment diagnostic
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=900,700']
  });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));

  const dims = await page.evaluate(() => {
    function rect(id) {
      const el = document.getElementById(id);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
    }
    function clsRect(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
    }
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      dpr: window.devicePixelRatio,
      body: rect('body') || clsRect('body'),
      root: rect('game-root'),
      canvas: rect('game-canvas'),
      fx: rect('fx-canvas'),
      hud: rect('hud'),
      titleScreen: rect('screen-title'),
      titleContent: clsRect('.title-content'),
      titleText: clsRect('.title-text'),
      titleEmoji: clsRect('.title-emoji'),
      nameInput: rect('player-name'),
      ageButtons: clsRect('.age-buttons'),
      startBtn: rect('btn-start'),
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      docScrollH: document.documentElement.scrollHeight,
      docClientH: document.documentElement.clientHeight,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      overflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight + 2
    };
  });
  console.log(JSON.stringify(dims, null, 2));

  await page.screenshot({ path: 'test-canvas-align2.png' });
  console.log('Screenshot: test-canvas-align2.png');

  await browser.close();
})();
