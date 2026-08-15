// Capture title screen in game-style at 1280x800 (desktop) and 414x896 (mobile)
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const VIEWS = [
  { name: 'desktop-1280x800', w: 1280, h: 800 },
  { name: 'laptop-800x600',   w: 800,  h: 600 },
  { name: 'mobile-414x896',   w: 414,  h: 896 },
  { name: 'mobile-landscape', w: 667,  h: 375 }
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--font-render-hinting=none']
  });
  for (const v of VIEWS) {
    const page = await browser.newPage();
    await page.setViewport({ width: v.w, height: v.h, deviceScaleFactor: 2 });
    await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle0' });
    // Give fonts + animations a beat to settle
    await new Promise(r => setTimeout(r, 800));
    // Type a name + select an age so the screenshot reflects a realistic state
    try {
      await page.type('#player-name', 'Alex', { delay: 30 });
      await page.click('.age-btn[data-age="6"]');
    } catch (e) { /* element not present, skip */ }
    await new Promise(r => setTimeout(r, 300));
    await page.screenshot({ path: `screenshot-title-${v.name}.png`, fullPage: false });
    console.log(`📸 screenshot-title-${v.name}.png  (${v.w}x${v.h})`);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
