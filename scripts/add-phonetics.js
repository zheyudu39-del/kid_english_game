/**
 * Dev tool: adds American-English IPA phonetics to vocabulary.json.
 * Safe to re-run (idempotent). Map is keyed by word id.
 * Usage: node scripts/add-phonetics.js
 */
const fs = require('fs');
const path = require('path');

const VOCAB = path.join(__dirname, '..', 'data', 'vocabulary.json');

// id -> IPA (General American pronunciation, consistent with en-US TTS)
const PHONETIC = {
  // --- animals ---
  an01: '/dɔːɡ/', an02: '/kæt/', an03: '/bɜːrd/', an04: '/fɪʃ/', an05: '/pɪɡ/',
  an06: '/dʌk/', an07: '/kaʊ/', an08: '/hɔːrs/', an09: '/ʃiːp/', an10: '/ber/',
  an11: '/ˈmʌŋki/', an12: '/ˈlaɪən/', an13: '/ˈtaɪɡər/', an14: '/ˈelɪfənt/', an15: '/ˈræbɪt/',
  an16: '/dʒəˈræf/', an17: '/ˈpeŋɡwɪn/', an18: '/ˈdɑːlfɪn/', an19: '/ʃɑːrk/', an20: '/ˈiːɡl/',
  // --- food ---
  fd01: '/ˈæpl/', fd02: '/eɡ/', fd03: '/mɪlk/', fd04: '/keɪk/', fd05: '/bred/',
  fd06: '/bəˈnænə/', fd07: '/raɪs/', fd08: '/ˈwɔːtər/', fd09: '/dʒuːs/', fd10: '/ˈkændi/',
  fd11: '/ˈɔːrɪndʒ/', fd12: '/ɡreɪp/', fd13: '/ˈnuːdl/', fd14: '/ˈtʃɪkɪn/', fd15: '/ˌaɪs ˈkriːm/',
  fd16: '/ˈsændwɪtʃ/', fd17: '/ˈpiːtsə/', fd18: '/ˈsæləd/', fd19: '/ˈhæmbɜːrɡər/', fd20: '/ˈkʊki/',
  // --- body ---
  bd01: '/aɪ/', bd02: '/ɪr/', bd03: '/noʊz/', bd04: '/maʊθ/', bd05: '/hænd/',
  bd06: '/hed/', bd07: '/fʊt/', bd08: '/ɑːrm/', bd09: '/leɡ/', bd10: '/her/',
  bd11: '/ˈfɪŋɡər/', bd12: '/tuːθ/', bd13: '/niː/', bd14: '/ˈʃoʊldər/', bd15: '/ˈstʌmək/',
  bd16: '/ˈelboʊ/', bd17: '/tʌŋ/', bd18: '/θʌm/', bd19: '/ˈæŋkl/', bd20: '/tʃɪn/',
  // --- colors ---
  cl01: '/red/', cl02: '/bluː/', cl03: '/ɡriːn/', cl04: '/ˈjeloʊ/',
  cl05: '/blæk/', cl06: '/waɪt/', cl07: '/pɪŋk/', cl08: '/ˈɔːrɪndʒ/',
  cl09: '/ˈpɜːrpl/', cl10: '/braʊn/', cl11: '/ɡreɪ/', cl12: '/ɡoʊld/',
  cl13: '/ˈsɪlvər/', cl14: '/ˈneɪvi/', cl15: '/beɪʒ/', cl16: '/ˈvaɪələt/',
  // --- nature ---
  nt01: '/sʌn/', nt02: '/muːn/', nt03: '/stɑːr/', nt04: '/reɪn/', nt05: '/triː/',
  nt06: '/skaɪ/', nt07: '/ˈwɔːtər/', nt08: '/ˈflaʊər/', nt09: '/ɡræs/', nt10: '/snoʊ/',
  nt11: '/klaʊd/', nt12: '/ˈrɪvər/', nt13: '/ˈmaʊntən/', nt14: '/wɪnd/', nt15: '/ˈreɪnboʊ/',
  nt16: '/ˈoʊʃn/', nt17: '/ˈfɔːrɪst/', nt18: '/ˈdezərt/', nt19: '/ˈaɪlənd/', nt20: '/ˈθʌndər/',
  // --- family ---
  fm01: '/mɑːm/', fm02: '/dæd/', fm03: '/ˈbeɪbi/', fm04: '/ˈfæməli/',
  fm05: '/ˈsɪstər/', fm06: '/ˈbrʌðər/', fm07: '/ˈɡrænmɑː/', fm08: '/ˈɡrænpɑː/',
  fm09: '/ænt/', fm10: '/ˈʌŋkl/', fm11: '/ˈkʌzn/', fm12: '/ˈperənts/',
  fm13: '/ˈnefjuː/', fm14: '/niːs/',
  // --- school ---
  sc01: '/bʊk/', sc02: '/pen/', sc03: '/bæɡ/', sc04: '/desk/',
  sc05: '/ˈtiːtʃər/', sc06: '/ˈpeɪpər/', sc07: '/ˈruːlər/', sc08: '/tʃer/',
  sc09: '/ˈpensl/', sc10: '/ɪˈreɪzər/', sc11: '/ˈblækbɔːrd/', sc12: '/ˈhoʊmwɜːrk/',
  sc13: '/ˈdɪkʃəneri/', sc14: '/ˈnoʊtbʊk/',
  // --- clothes ---
  cw01: '/hæt/', cw02: '/ʃuː/', cw03: '/sɑːk/', cw04: '/ʃɜːrt/',
  cw05: '/pænts/', cw06: '/dres/', cw07: '/koʊt/', cw08: '/skɜːrt/',
  cw09: '/ˈdʒækɪt/', cw10: '/ˈswetər/', cw11: '/ɡlʌv/', cw12: '/skɑːrf/',
  cw13: '/belt/', cw14: '/ˈjuːnɪfɔːrm/',
  // --- transport ---
  tr01: '/kɑːr/', tr02: '/bʌs/', tr03: '/baɪk/', tr04: '/boʊt/',
  tr05: '/treɪn/', tr06: '/pleɪn/', tr07: '/ʃɪp/', tr08: '/ˈtæksi/',
  tr09: '/trʌk/', tr10: '/ˈhelɪkɑːptər/', tr11: '/ˈsʌbweɪ/', tr12: '/ˈrɑːkɪt/',
  tr13: '/ˈæmbjələns/', tr14: '/ˈtræktər/',
  // --- actions ---
  ac01: '/rʌn/', ac02: '/iːt/', ac03: '/drɪŋk/', ac04: '/sliːp/', ac05: '/dʒʌmp/',
  ac06: '/swɪm/', ac07: '/riːd/', ac08: '/sɪŋ/', ac09: '/dæns/', ac10: '/flaɪ/',
  ac11: '/drɔː/', ac12: '/raɪt/', ac13: '/klaɪm/', ac14: '/læf/', ac15: '/kraɪ/',
  ac16: '/kʊk/', ac17: '/kɪk/', ac18: '/θroʊ/', ac19: '/kætʃ/', ac20: '/draɪv/',
  // --- numbers ---
  nb01: '/wʌn/', nb02: '/tuː/', nb03: '/θriː/', nb04: '/fɔːr/', nb05: '/faɪv/',
  nb06: '/sɪks/', nb07: '/ˈsevən/', nb08: '/eɪt/', nb09: '/naɪn/', nb10: '/ten/',
  nb11: '/ɪˈlevən/', nb12: '/twelv/', nb13: '/ˌθɜːrˈtiːn/', nb14: '/ˌfɔːrˈtiːn/', nb15: '/ˌfɪfˈtiːn/',
  nb16: '/ˈtwenti/', nb17: '/ˈhʌndrəd/',
  // --- house ---
  hs01: '/dɔːr/', hs02: '/bed/', hs03: '/ˈteɪbl/', hs04: '/tʃer/',
  hs05: '/ˈwɪndoʊ/', hs06: '/ruːm/', hs07: '/ˈkɪtʃɪn/', hs08: '/ˈbæθruːm/',
  hs09: '/ˈsoʊfə/', hs10: '/ˈmɪrər/', hs11: '/klɑːk/', hs12: '/sterz/',
  hs13: '/ˈbælkəni/', hs14: '/ˈkɜːrtən/'
};

const vocab = JSON.parse(fs.readFileSync(VOCAB, 'utf-8'));

let added = 0;
let missing = [];
for (const w of vocab.words) {
  if (PHONETIC[w.id]) {
    w.phonetic = PHONETIC[w.id];
    added++;
  } else {
    missing.push(w.id);
  }
}

// Any unused map keys (typos in ids)?
const ids = new Set(vocab.words.map(w => w.id));
const unused = Object.keys(PHONETIC).filter(k => !ids.has(k));

fs.writeFileSync(VOCAB, JSON.stringify(vocab, null, 2), 'utf-8');
console.log(`✅ 已添加 ${added} 个音标`);
if (missing.length) console.log(`⚠️ 缺少音标的词: ${missing.join(', ')}`);
if (unused.length) console.log(`⚠️ 未匹配的键(可能是id拼写错误): ${unused.join(', ')}`);
console.log('总词数:', vocab.words.length);
