// test-title-layout.js - objective layout assertions for the title screen
// (two-column desktop hero+panel, single-column mobile, toolbar packing).
// Runs against the server on PORT (default 3000).
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.PORT) || 3000;
const BASE = 'http://127.0.0.1:' + PORT;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const cases = [
    { name: 'desktop', w: 1280, h: 800 },
    { name: 'laptop', w: 1024, h: 640 },
    { name: 'tablet', w: 768, h: 1024 },
    { name: 'mobile', w: 414, h: 896 }
  ];
  for (const c of cases) {
    const page = await browser.newPage();
    await page.setViewport({ width: c.w, height: c.h });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 600));
    const geo = await page.evaluate(() => {
      const box = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      };
      return {
        hero: box('.title-hero'),
        form: box('.title-form'),
        start: box('#btn-start'),
        toolbar: box('.title-toolbar'),
        name: box('#player-name'),
        viewport: { w: innerWidth, h: innerHeight },
        hScroll: document.documentElement.scrollWidth > innerWidth + 1,
        contentScrollable: (() => {
          const el = document.querySelector('.title-content');
          return el ? el.scrollHeight > el.clientHeight + 4 : null;
        })(),
        toolbarBtns: document.querySelectorAll('.title-toolbar button').length,
        toolbarRows: (() => {
          // Rows = distinct vertical bands (round to 6px so sub-pixel
          // offsets can't fabricate extra rows).
          const btns = Array.from(document.querySelectorAll('.title-toolbar button'))
            .filter(b => getComputedStyle(b).display !== 'none');
          return new Set(btns.map(b => Math.round(b.getBoundingClientRect().top / 6))).size;
        })(),
        labelOverflows: (() => {
          // Every button label must stay inside its button frame (the
          // reported "Chinese text spills out of the buttons" bug).
          const btns = Array.from(document.querySelectorAll('.title-toolbar .mode-buttons .big-btn'));
          return btns.filter(b => {
            const r = b.getBoundingClientRect();
            const span = b.querySelector('span:not(.btn-emoji):not(.wb-badge)');
            if (!span) return false;
            const lr = span.getBoundingClientRect();
            return lr.right > r.right + 1 || lr.left < r.left - 1;
          }).length;
        })()
      };
    });
    if (c.name === 'desktop' || c.name === 'laptop') {
      check(`[${c.name}] two-column: hero left, form right`,
        geo.hero && geo.form && geo.form.left > geo.hero.right - 10,
        `hero.right=${geo.hero && Math.round(geo.hero.right)} form.left=${geo.form && Math.round(geo.form.left)}`);
      check(`[${c.name}] columns vertically centered-ish`,
        geo.hero && geo.form && Math.abs((geo.hero.top + geo.hero.h / 2) - (geo.form.top + geo.form.h / 2)) < 120);
    } else {
      check(`[${c.name}] single column: form below hero`,
        geo.hero && geo.form && geo.form.top >= geo.hero.bottom - 10,
        `hero.bottom=${geo.hero && Math.round(geo.hero.bottom)} form.top=${geo.form && Math.round(geo.form.top)}`);
    }
    check(`[${c.name}] no horizontal overflow`, !geo.hScroll, geo.hScroll ? 'scrollWidth > viewport' : '');
    check(`[${c.name}] start button above toolbar`,
      geo.start && geo.toolbar && geo.start.bottom <= geo.toolbar.top + 1);
    check(`[${c.name}] toolbar holds 9 secondary buttons (3 auth + 6 modes)`,
      geo.toolbarBtns === 9, 'buttons=' + geo.toolbarBtns);
    check(`[${c.name}] toolbar packs into <=3 rows`, geo.toolbarRows <= 3, 'rows=' + geo.toolbarRows);
    check(`[${c.name}] no label overflows its button`, geo.labelOverflows === 0, 'overflows=' + geo.labelOverflows);
    check(`[${c.name}] no JS errors`, errors.length === 0, errors[0] || '');
    await page.close();
  }
  await browser.close();
  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
