// Verify world now fills viewport on multiple screen sizes
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const VIEWS = [
  { name: 'laptop-1280x800',  w: 1280, h: 800  },
  { name: 'desktop-1920x1080', w: 1920, h: 1080 },
  { name: 'small-800x600',    w: 800,  h: 600  }
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu']
  });
  for (const v of VIEWS) {
    const page = await browser.newPage();
    await page.setViewport({ width: v.w, height: v.h });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));

    await page.type('#player-name', 'Tester');
    await page.click('.age-btn[data-age="7"]');
    await page.click('#btn-start');
    await new Promise(r => setTimeout(r, 1500));

    // Sample a pixel at each corner of the visible canvas to detect black bars
    const result = await page.evaluate((vw, vh) => {
      const c = document.getElementById('game-canvas');
      const ctx = c.getContext('2d');
      const samples = {};
      const points = {
        topLeft:     [10, 10],
        topRight:    [vw - 10, 10],
        bottomLeft:  [10, vh - 10],
        bottomRight: [vw - 10, vh - 10],
        center:      [vw / 2, vh / 2],
        // A few "playing field" spots
        groundLeft:  [100, vh * 0.85],
        groundRight: [vw - 100, vh * 0.85]
      };
      for (const [name, [x, y]] of Object.entries(points)) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        samples[name] = `rgb(${d[0]},${d[1]},${d[2]})`;
      }
      return { vw, vh, samples };
    }, v.w, v.h);

    const isBlack = (rgb) => /rgb\((\d+),(\d+),(\d+)\)/.test(rgb) && (() => {
      const m = rgb.match(/(\d+),(\d+),(\d+)/);
      return +m[1] < 15 && +m[2] < 15 && +m[3] < 15;
    })();
    const cornersBlack = isBlack(result.samples.topRight) && isBlack(result.samples.bottomRight);
    console.log(`[${v.w}x${v.h}] errs=${errs.length} cornersBlackRight=${cornersBlack}`);
    console.log('  samples:', JSON.stringify(result.samples));
    if (errs.length) console.log('  errs:', errs);
    await page.screenshot({ path: `world-test-${v.name}.png` });
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
