// Diagnose: simulate entering the game and see if canvas is misaligned
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE.ERROR:', m.text()); });

  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));

  // Fill name + click age, then start
  await page.type('#player-name', 'Test');
  await page.click('.age-btn[data-age="7"]');
  await page.click('#btn-start');
  await new Promise(r => setTimeout(r, 1500));

  // Click the level card if present, else click "begin" on intro
  const before = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const r = c.getBoundingClientRect();
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      canvasRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      canvasStyleW: c.style.width, canvasStyleH: c.style.height,
      canvasAttrW: c.width, canvasAttrH: c.height,
      bodyW: document.body.clientWidth, bodyH: document.body.clientHeight,
      root: document.getElementById('game-root').getBoundingClientRect()
    };
  });
  console.log('TITLE/LEVEL-INTRO state:', JSON.stringify(before, null, 2));

  // Try to start level (clicking "开始" or similar)
  try {
    const begin = await page.$('#btn-begin, .btn-begin, [data-action="begin"]');
    if (begin) await begin.click();
  } catch (e) {}
  await new Promise(r => setTimeout(r, 800));

  // Try keyboard space to start
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 1000));

  const playing = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const r = c.getBoundingClientRect();
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      canvasRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      canvasStyleW: c.style.width, canvasStyleH: c.style.height,
      canvasAttrW: c.width, canvasAttrH: c.height,
      hudDisplay: getComputedStyle(document.getElementById('hud')).display,
      hudVisible: !document.getElementById('hud').classList.contains('hidden'),
      titleHidden: document.getElementById('screen-title').classList.contains('hidden'),
      levelIntroHidden: document.getElementById('screen-level-intro').classList.contains('hidden')
    };
  });
  console.log('PLAYING state:', JSON.stringify(playing, null, 2));

  await page.screenshot({ path: 'diagnose-canvas-playing.png' });
  console.log('Screenshot: diagnose-canvas-playing.png');

  await browser.close();
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
