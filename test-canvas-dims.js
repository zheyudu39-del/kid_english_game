// test-canvas-dims.js - measure canvas + viewport dimensions
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

  const dims = await page.evaluate(() => {
    const canvas = document.getElementById('game-canvas');
    const root = document.getElementById('game-root');
    const body = document.body;
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      body: body.getBoundingClientRect(),
      root: root.getBoundingClientRect(),
      canvas: canvas.getBoundingClientRect(),
      canvasStyleW: canvas.style.width,
      canvasStyleH: canvas.style.height,
      canvasAttrW: canvas.width,
      canvasAttrH: canvas.height,
      // What about fx-canvas
      fx: document.getElementById('fx-canvas').getBoundingClientRect(),
      hud: document.getElementById('hud').getBoundingClientRect()
    };
  });
  console.log(JSON.stringify(dims, null, 2));

  // Take a screenshot
  await page.screenshot({ path: 'test-canvas-align.png' });
  console.log('Screenshot saved: test-canvas-align.png');

  await browser.close();
})();
