const fs = require('fs');
const data = JSON.parse(fs.readFileSync('data/vocabulary.json', 'utf-8'));
const words = data.words;

console.log('=== 词汇数据完整性审计 ===\n');

// 1. Required fields check
const required = ['id', 'english', 'chinese', 'difficulty', 'ageMin', 'category'];
const missing = { id: 0, english: 0, chinese: 0, difficulty: 0, ageMin: 0, category: 0 };
const nullish = { id: 0, english: 0, chinese: 0, difficulty: 0, ageMin: 0, category: 0 };
const wrongType = { id: 0, english: 0, chinese: 0, difficulty: 0, ageMin: 0, category: 0 };
const samples = {};

for (const w of words) {
  for (const k of required) {
    if (!(k in w)) missing[k]++;
    else if (w[k] === null || w[k] === undefined || w[k] === '') {
      nullish[k]++;
      if (!samples[k]) samples[k] = w;
    } else if (typeof w[k] !== (k === 'id' || k === 'english' || k === 'chinese' || k === 'category' ? 'string' : 'number')) {
      wrongType[k]++;
    }
  }
}
console.log('--- 1. 必填字段检查 ---');
console.log('missing keys:', missing);
console.log('nullish/empty:', nullish);
console.log('wrong type:', wrongType);
console.log('samples of nullish:', samples);

// 2. Duplicate ids
const idMap = new Map();
let dupIds = 0;
const dupIdSamples = [];
for (const w of words) {
  if (idMap.has(w.id)) { dupIds++; if (dupIdSamples.length < 5) dupIdSamples.push(w); }
  else idMap.set(w.id, w);
}
console.log('\n--- 2. 重复 id ---');
console.log('count:', dupIds, 'samples:', dupIdSamples);

// 3. english lower-case consistency
let upper = 0, mixed = 0, lower = 0;
const upperSamples = [];
const mixedSamples = [];
for (const w of words) {
  const e = w.english || '';
  if (e === e.toLowerCase()) lower++;
  else if (e === e.toUpperCase()) { upper++; if (upperSamples.length < 5) upperSamples.push(w); }
  else { mixed++; if (mixedSamples.length < 5) mixedSamples.push(w); }
}
console.log('\n--- 3. english 大小写 ---');
console.log('lowercase:', lower, 'uppercase:', upper, 'mixed:', mixed);
console.log('uppercase samples:', upperSamples);
console.log('mixed samples:', mixedSamples);

// 4. Duplicate english (case-insensitive)
const engLower = new Map();
let dupEng = 0;
const dupEngSamples = [];
for (const w of words) {
  const k = (w.english || '').toLowerCase();
  if (engLower.has(k)) {
    dupEng++;
    if (dupEngSamples.length < 8) dupEngSamples.push({ first: engLower.get(k), dup: w });
  } else engLower.set(k, w);
}
console.log('\n--- 4. 重复 english (case-insensitive) ---');
console.log('count:', dupEng);
console.log('samples:', dupEngSamples);

// 5. Chinese null/empty
let nullCh = 0, emptyCh = 0;
const chSamples = [];
for (const w of words) {
  if (w.chinese === null || w.chinese === undefined) nullCh++;
  else if (w.chinese === '') { emptyCh++; if (chSamples.length < 5) chSamples.push(w); }
}
console.log('\n--- 5. chinese null/empty ---');
console.log('null:', nullCh, 'empty:', emptyCh, 'samples:', chSamples);

// 6. Difficulty range
let outRange = 0;
const diffBuckets = { 1:0,2:0,3:0,4:0,5:0,6:0,7:0,8:0, other:0 };
const otherDiffSamples = [];
for (const w of words) {
  if (diffBuckets[w.difficulty] !== undefined) diffBuckets[w.difficulty]++;
  else { diffBuckets.other++; if (otherDiffSamples.length < 5) otherDiffSamples.push(w); outRange++; }
}
console.log('\n--- 6. difficulty 分布 ---');
console.log('buckets:', diffBuckets);
console.log('out-of-range count:', outRange, 'samples:', otherDiffSamples);

// 7. ageMin range
let ageMinBad = 0;
const ageMinSamples = [];
const ageMinBuckets = {};
for (const w of words) {
  const a = w.ageMin;
  ageMinBuckets[a] = (ageMinBuckets[a] || 0) + 1;
  if (typeof a !== 'number' || a < 3 || a > 18) {
    ageMinBad++;
    if (ageMinSamples.length < 5) ageMinSamples.push(w);
  }
}
console.log('\n--- 7. ageMin 分布 ---');
console.log('buckets:', ageMinBuckets);
console.log('out-of-range count:', ageMinBad, 'samples:', ageMinSamples);

// 8. Categories distribution
const catBuckets = {};
const validCats = new Set((data.categories || []).map(c => c.id));
for (const w of words) catBuckets[w.category] = (catBuckets[w.category] || 0) + 1;
const invalidCat = Object.keys(catBuckets).filter(c => !validCats.has(c));
console.log('\n--- 8. category ---');
console.log('total distinct:', Object.keys(catBuckets).length);
console.log('invalid (not in categories list):', invalidCat);
console.log('first 5 buckets:', Object.entries(catBuckets).slice(0, 5));

// 9. Per-difficulty word count - critical for the band issue!
console.log('\n--- 9. 按 difficulty 的词数 ---');
console.log(diffBuckets);
console.log('TOTAL:', words.length);

// 10. Show distribution of english length
const engLenBuckets = {};
for (const w of words) {
  const l = (w.english || '').length;
  engLenBuckets[l] = (engLenBuckets[l] || 0) + 1;
}
console.log('\n--- 10. english 长度分布 ---');
console.log(engLenBuckets);
