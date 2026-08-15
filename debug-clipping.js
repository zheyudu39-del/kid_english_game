// Check if startBtn is actually clipped or just reporting outside
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 667, height: 375 });
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  const m = await page.evaluate(() => {
    const tc = document.querySelector('.title-content');
    const sb = document.getElementById('btn-start');
    // Check if startBtn is inside titleContent visually
    const tcRect = tc.getBoundingClientRect();
    const sbRect = sb.getBoundingClientRect();
    const tcBottom = tcRect.bottom;
    const sbBottom = sbRect.bottom;
    // The visual overflow: is startBtn's actual top within tc's box?
    const visuallyClipped = sbRect.top < tcRect.top || sbRect.bottom > tcRect.bottom;
    // Is the doc actually scrollable?
    const docScrollH = document.documentElement.scrollHeight;
    const docClientH = document.documentElement.clientHeight;
    return {
      tcBottom, sbBottom, visuallyClipped,
      tcScrollTop: tc.scrollTop, tcScrollHeight: tc.scrollHeight, tcClientHeight: tc.clientHeight,
      docScrollH, docClientH, docOverflow: docScrollH > docClientH
    };
  });
  console.log(JSON.stringify(m, null, 2));
  // Check if startBtn is actually visible in screenshot
  await page.screenshot({ path: 'debug-landscape.png' });
  await browser.close();
})();
