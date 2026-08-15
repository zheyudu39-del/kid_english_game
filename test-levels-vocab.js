// Cross-age cross-level vocab test:
//  - For each age group, load vocab via API
//  - For each level 1..30, check that the level has at least 5 eligible
//    words in the loaded vocab (otherwise that level would have nothing
//    to spawn, which was the original "too easy / no progress" bug).
const http = require('http');
function fetch(age) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:3000/api/vocabulary?age=' + age, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

function fetchLevels() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:3000/api/levels', res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

(async () => {
  const levels = await fetchLevels();
  console.log('Loaded ' + levels.length + ' levels');
  // Print level 1 and level 30 to confirm new fields
  console.log('Level 1:', JSON.stringify(levels[0]));
  console.log('Level 30:', JSON.stringify(levels[29]));
  console.log('Level 15:', JSON.stringify(levels[14]));

  const ages = [3, 5, 7, 9, 12, 15, 18, 'adult'];
  let totalFail = 0;
  for (const age of ages) {
    const vocab = await fetch(age);
    let tooFew = 0;
    const low = [];
    for (const lvl of levels) {
      const minD = lvl.minDifficulty;
      const maxD = lvl.maxDifficulty;
      const eligible = vocab.words.filter(w => w.difficulty >= minD && w.difficulty <= maxD);
      if (eligible.length < 5) {
        tooFew++;
        low.push('  L' + lvl.level + ' (d' + minD + '-' + maxD + '): only ' + eligible.length + ' words');
      }
    }
    const ok = tooFew === 0;
    console.log((ok ? '\u2705' : '\u274c') + ' age ' + age + ' (' + vocab.words.length + ' words): ' + (30 - tooFew) + '/30 levels have >=5 eligible words');
    if (!ok) {
      totalFail++;
      low.forEach(l => console.log(l));
    }
  }
  console.log('\n=== ' + (ages.length - totalFail) + '/' + ages.length + ' age groups pass ===');
  process.exit(totalFail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(1); });
