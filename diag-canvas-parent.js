// Walk the canvas's actual computed style + parent chain
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1280,800']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));

  const m = await page.evaluate(() => {
    const c = document.getElementById('game-canvas');
    const cs = getComputedStyle(c);
    // Walk parents
    const parents = [];
    let el = c.parentElement;
    while (el && el !== document.documentElement) {
      const s = getComputedStyle(el);
      parents.push({ tag: el.tagName, id: el.id, cls: el.className, w: s.width, h: s.height, pos: s.position, display: s.display });
      el = el.parentElement;
    }
    return {
      canvas: {
        rect: c.getBoundingClientRect().toJSON ? c.getBoundingClientRect().toJSON() : { w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height },
        clientW: c.clientWidth, clientH: c.clientHeight, offsetW: c.offsetWidth, offsetH: c.offsetHeight,
        scrollW: c.scrollWidth, scrollH: c.scrollHeight,
        attrW: c.width, attrH: c.height,
        styleW: c.style.width, styleH: c.style.height,
        display: cs.display, position: cs.position, top: cs.top, left: cs.left,
        boxSizing: cs.boxSizing,
        parentDisplay: getComputedStyle(c.parentElement).display
      },
      parents
    };
  });
  console.log(JSON.stringify(m, null, 2));
  await browser.close();
})();
