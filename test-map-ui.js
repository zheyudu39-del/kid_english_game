// test-map-ui.js - E2E for the growth-tree level map: entry button, node
// rendering, boss nodes, scroll-to-later-levels, locked/current clicks.
'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:3000';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail) {
  detail = detail || '';
  console.log((ok ? '✅' : '❌') + ' ' + name + (detail ? ' — ' + detail : ''));
  if (!ok) failures++;
}

(async () => {
  // ---- server-side boss rules ----
  const meta = await fetch(BASE + '/api/levels').then(r => r.json());
  const bosses = meta.levels.filter(l => l.isBoss);
  check('API: 72 boss levels total', bosses.length === 72, String(bosses.length));
  check('API: bosses at every 10th + world finals',
    [10, 20, 110, 111, 121, 222, 565, 666].every(n => bosses.some(b => b.level === n)) &&
    ![9, 11, 120, 556, 566].some(n => bosses.some(b => b.level === n)));
  const lv10 = await fetch(BASE + '/api/levels/10').then(r => r.json());
  const lv9 = await fetch(BASE + '/api/levels/9').then(r => r.json());
  check('API: boss 10 named 森林守卫1 with 3x own base HP', lv10.isBoss && lv10.monsterName === '森林守卫1' && lv10.monsterHP === (10 * 2 + 10) * 3 && lv9.monsterHP === 9 * 2 + 10);

  // ---- browser ----
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'],
    protocolTimeout: 60000
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(BASE + '/', { waitUntil: 'networkidle2' });

    check('title has 🌳 map button', await page.$('#btn-map') !== null);
    await page.click('#btn-map');
    await sleep(600);
    check('map screen opens', await page.$eval('#screen-map', el => getComputedStyle(el).display !== 'none'));

    const counts = await page.evaluate(() => ({
      nodes: document.querySelectorAll('.map-node').length,
      worlds: document.querySelectorAll('.map-world').length,
      boss: document.querySelectorAll('.map-node--boss').length,
      done: document.querySelectorAll('.map-node--done').length
    }));
    check('all 666 level nodes rendered', counts.nodes === 666, JSON.stringify(counts));
    check('6 world signposts', counts.worlds === 6);
    check('72 boss nodes rendered', counts.boss === 72);
    check('boss nodes carry crown', (await page.$eval('.map-node--boss .map-node__crown', el => el.textContent)) === '👑');
    check('tree has summit star and roots',
      (await page.$('.map-top')) !== null && (await page.$('.map-roots')) !== null);
    check('branch rows render leafy SVG twigs',
      (await page.$eval('.map-row', el => getComputedStyle(el, '::before').backgroundImage)).includes('data:image/svg'));
    check('tree canopy texture painted',
      (await page.$eval('#map-tree', el => getComputedStyle(el).backgroundImage)).includes('radial-gradient'));

    // Fresh player: level 1 is the pulsing "now" node and visible in the
    // initial viewport (auto-scrolled to it).
    const nowVisible = await page.evaluate(() => {
      const n = document.querySelector('.map-node--now');
      if (!n) return { lvl: null };
      const r = n.getBoundingClientRect();
      const s = document.getElementById('map-scroll').getBoundingClientRect();
      return { lvl: n.dataset.level, visible: r.top >= s.top && r.bottom <= s.bottom };
    });
    check('current level node = 1 and visible on open', nowVisible.lvl === '1' && nowVisible.visible, JSON.stringify(nowVisible));

    // The window shows only a slice of the tree (scrollable)…
    const slice = await page.evaluate(() => {
      const s = document.getElementById('map-scroll');
      const vis = [...document.querySelectorAll('.map-node')].filter(n => {
        const r = n.getBoundingClientRect();
        const sr = s.getBoundingClientRect();
        return r.bottom > sr.top && r.top < sr.bottom;
      }).map(n => +n.dataset.level);
      return { scrollable: s.scrollHeight > s.clientHeight + 100, visibleCount: vis.length, max: Math.max(...vis) };
    });
    check('map window shows a few dozen levels, not all 666', slice.scrollable && slice.visibleCount >= 18 && slice.visibleCount < 120, JSON.stringify(slice));

    // …and scrolling UP reveals LATER levels.
    await page.evaluate(() => { document.getElementById('map-scroll').scrollTop -= 6000; });
    await sleep(300);
    const laterVisible = await page.evaluate(() => {
      const s = document.getElementById('map-scroll');
      const sr = s.getBoundingClientRect();
      return [...document.querySelectorAll('.map-node')].filter(n => {
        const r = n.getBoundingClientRect();
        return r.bottom > sr.top && r.top < sr.bottom && +n.dataset.level > 150;
      }).length;
    });
    check('scrolling up reveals later levels (>150)', laterVisible > 5, String(laterVisible));

    // Locked node: shake + toast, map stays open.
    await page.evaluate(() => {
      const s = document.getElementById('map-scroll');
      s.scrollTop = s.scrollHeight; // bottom of tree = level 1 area
    });
    await sleep(300);
    await page.click('.map-node[data-level="666"]');
    await sleep(300);
    let toastText = '';
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      toastText = await page.$eval('#toast', el => el.classList.contains('hidden') ? '' : el.innerText);
      if (toastText) break;
    }
    check('locked node shows guidance toast', /先通过/.test(toastText), toastText);
    check('map stays open after locked click', await page.$eval('#screen-map', el => getComputedStyle(el).display !== 'none'));

    await page.screenshot({ path: 'test-map-tree.png' });

    // Unlocked node starts the level.
    await page.click('.map-node[data-level="1"]');
    await sleep(2500);
    const introVisible = await page.$eval('#screen-level-intro', el => getComputedStyle(el).display !== 'none');
    const introText = await page.$eval('#level-intro-num', el => el.textContent);
    check('clicking level 1 starts it (intro shown)', introVisible && introText.includes('第 1 关'), introText);
    check('map closed after starting', await page.$eval('#screen-map', el => getComputedStyle(el).display === 'none'));

    console.log(failures ? 'FAILURES: ' + failures : 'ALL PASS');
    process.exitCode = failures ? 1 : 0;
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
