const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/vocabulary.json', 'utf-8'));
// Simulate the per-age filter that /api/vocabulary?age=X applies
for (const age of [3, 5, 7, 9, 12, 15, 18, 'adult']) {
  let cap;
  if (age === 'adult') cap = data.ageGroups.adult.maxDifficulty;
  else cap = data.ageGroups[age].maxDifficulty;
  const filtered = data.words.filter(w => w.difficulty <= cap);
  const buckets = {};
  for (let d = 1; d <= 8; d++) buckets[d] = filtered.filter(w => w.difficulty === d).length;
  console.log('age=' + age + ' (cap=' + cap + ') total=' + filtered.length + ' buckets=' + JSON.stringify(buckets));
}
