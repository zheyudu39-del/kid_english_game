// Debug landscape media query
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 667, height: 375 });
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 400));
  const m = await page.evaluate(() => {
    const tc = document.querySelector('.title-content');
    const te = document.querySelector('.title-emoji');
    const tt = document.querySelector('.title-text');
    const ts = document.querySelector('.title-stats');
    const sb = document.getElementById('btn-start');
    const bb = document.querySelector('.big-btn');
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      titleContent: { h: tc.getBoundingClientRect().height, scrollH: tc.scrollHeight, clientH: tc.clientHeight },
      titleEmoji: { fontSize: getComputedStyle(te).fontSize, display: getComputedStyle(te).display },
      titleText: { fontSize: getComputedStyle(tt).fontSize, display: getComputedStyle(tt).display },
      titleSub: tt.nextElementSibling ? { display: getComputedStyle(tt.nextElementSibling).display } : null,
      tagline: document.querySelector('.tagline') ? getComputedStyle(document.querySelector('.tagline')).display : null,
      stats: { padding: getComputedStyle(ts).padding, h: ts.getBoundingClientRect().height },
      contentGap: getComputedStyle(tc).gap,
      contentPad: getComputedStyle(tc).padding,
      startBtn: sb.getBoundingClientRect(),
      mediaQ540: window.matchMedia('(max-height: 540px)').matches,
      mediaQ380w: window.matchMedia('(max-width: 380px)').matches,
      bb: { fontSize: getComputedStyle(bb).fontSize, padding: getComputedStyle(bb).padding }
    };
  });
  console.log(JSON.stringify(m, null, 2));
  await page.screenshot({ path: 'debug-landscape.png' });
  await browser.close();
})();
