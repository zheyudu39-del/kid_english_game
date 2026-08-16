// essays.js - 中文小作文题库 + 组卷 + 英译评分 (boss-level translation).
//
// Boss levels are beaten by translating a short Chinese essay (~50 chars)
// into English. Each world has a themed sentence bank; an essay is 4
// random sentences. Grading is keyword-based and lenient (kids!): a
// sentence passes when at least half of its core words appear in the
// translation, and the essay passes when at least 3 of 4 sentences pass.
(function () {
  'use strict';

  // One entry: { zh, en, keys[] } — `en` is the reference translation shown
  // as feedback; `keys` are the core English content words that must
  // appear (light suffix stripping: s/es/ing/ed).
  const BANK = {
    1: [ // 魔法森林
      { zh: '森林里有很多高大的树。', en: 'There are many tall trees in the forest.', keys: ['forest', 'trees', 'tall'] },
      { zh: '小鸟在树上唱歌。', en: 'The bird sings in the tree.', keys: ['bird', 'sings', 'tree'] },
      { zh: '我喜欢在森林里散步。', en: 'I like walking in the forest.', keys: ['like', 'walking', 'forest'] },
      { zh: '草地上开着美丽的花。', en: 'Beautiful flowers bloom on the grass.', keys: ['flowers', 'grass'] },
      { zh: '一只兔子在树下吃草。', en: 'A rabbit eats grass under the tree.', keys: ['rabbit', 'grass', 'tree'] },
      { zh: '太阳从树后升起来了。', en: 'The sun rises behind the trees.', keys: ['sun', 'rises', 'trees'] }
    ],
    2: [ // 深海王国
      { zh: '大海是蓝色的。', en: 'The sea is blue.', keys: ['sea', 'blue'] },
      { zh: '鱼儿在水里游来游去。', en: 'Fish swim in the water.', keys: ['fish', 'swim', 'water'] },
      { zh: '沙滩上有白色的贝壳。', en: 'There are white shells on the beach.', keys: ['shells', 'beach'] },
      { zh: '海豚跳出了水面。', en: 'The dolphin jumps out of the water.', keys: ['dolphin', 'jumps', 'water'] },
      { zh: '我们坐小船出海。', en: 'We go to sea in a small boat.', keys: ['boat', 'sea'] },
      { zh: '海底住着很多小鱼。', en: 'Many small fish live under the sea.', keys: ['fish', 'sea'] }
    ],
    3: [ // 火焰火山
      { zh: '火山会喷出火焰。', en: 'The volcano shoots fire.', keys: ['volcano', 'fire'] },
      { zh: '山上的石头是红色的。', en: 'The rocks on the mountain are red.', keys: ['rocks', 'mountain', 'red'] },
      { zh: '这里非常炎热。', en: 'It is very hot here.', keys: ['very', 'hot'] },
      { zh: '勇敢的骑士走近火山。', en: 'The brave knight walks near the volcano.', keys: ['brave', 'knight', 'volcano'] },
      { zh: '灰烬飘在空中。', en: 'Ashes float in the air.', keys: ['float', 'air'] },
      { zh: '岩浆像河流一样流淌。', en: 'Lava flows like a river.', keys: ['lava', 'river'] }
    ],
    4: [ // 冰封雪山
      { zh: '山上覆盖着白雪。', en: 'The mountain is covered with snow.', keys: ['mountain', 'snow'] },
      { zh: '雪花从天上飘下来。', en: 'Snowflakes fall from the sky.', keys: ['snow', 'sky'] },
      { zh: '天气非常寒冷。', en: 'The weather is very cold.', keys: ['weather', 'cold'] },
      { zh: '企鹅在冰上走路。', en: 'Penguins walk on the ice.', keys: ['penguins', 'ice'] },
      { zh: '我戴上了厚厚的帽子。', en: 'I put on a thick hat.', keys: ['hat'] },
      { zh: '湖面结了冰。', en: 'The lake is frozen.', keys: ['lake', 'ice'] }
    ],
    5: [ // 云端天空
      { zh: '天空中有白色的云。', en: 'There are white clouds in the sky.', keys: ['clouds', 'sky'] },
      { zh: '飞机在云上飞行。', en: 'The plane flies above the clouds.', keys: ['plane', 'flies', 'clouds'] },
      { zh: '星星在夜里闪烁。', en: 'Stars twinkle at night.', keys: ['stars', 'night'] },
      { zh: '月亮又圆又亮。', en: 'The moon is round and bright.', keys: ['moon', 'bright'] },
      { zh: '小鸟飞得很高。', en: 'The bird flies very high.', keys: ['bird', 'high'] },
      { zh: '彩虹出现在雨后。', en: 'A rainbow appears after the rain.', keys: ['rainbow', 'rain'] }
    ],
    6: [ // 星辉之巅
      { zh: '夜空中有无数星星。', en: 'There are many stars in the night sky.', keys: ['stars', 'night', 'sky'] },
      { zh: '流星划过天空。', en: 'A shooting star crosses the sky.', keys: ['star', 'sky'] },
      { zh: '宇宙非常广阔。', en: 'The universe is very big.', keys: ['universe', 'big'] },
      { zh: '月亮照亮了大地。', en: 'The moon lights up the earth.', keys: ['moon', 'earth'] },
      { zh: '宇航员飞向太空。', en: 'The astronaut flies into space.', keys: ['astronaut', 'space'] },
      { zh: '星星一闪一闪地发光。', en: 'The stars twinkle and shine.', keys: ['stars', 'shine'] }
    ]
  };

  const ESSAY_SENTENCES = 4;         // ~50 Chinese chars per essay
  const PASS_SENTENCES = 3;          // sentences that must pass
  const MAX_ESSAY_CHARS = 80;

  function worldBank(world) {
    return BANK[world] || BANK[1];
  }

  // Build one essay: `sentences` shuffled sentences from the world bank,
  // capped so the essay stays around 50 chars.
  function makeEssay(world) {
    const pool = Utils.shuffle(worldBank(world).slice());
    const picked = [];
    let chars = 0;
    for (const s of pool) {
      if (picked.length >= ESSAY_SENTENCES) break;
      const len = s.zh.replace(/[，。！？、]/g, '').length;
      if (chars + len > MAX_ESSAY_CHARS && picked.length > 0) break;
      picked.push(s);
      chars += len;
    }
    if (picked.length === 0) picked.push(pool[0]);
    return {
      world: world,
      zh: picked.map(s => s.zh).join(''),
      sentences: picked.map(s => ({ zh: s.zh, en: s.en, keys: s.keys.slice() }))
    };
  }

  // ---- grading ----

  // Normalize a word: lowercase + strip a common plural/tense suffix so
  // "swims"/"swim", "trees"/"tree" all match.
  function stem(w) {
    let s = String(w).toLowerCase();
    if (s.length > 4 && s.endsWith('es')) s = s.slice(0, -2);
    else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
    if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
    else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
    return s;
  }

  function wordSet(text) {
    return new Set(
      String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9'\- ]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(stem)
    );
  }

  // Grade one sentence against the player's normalized word set.
  function gradeSentence(sentence, set) {
    const matched = sentence.keys.filter(k => set.has(stem(k)));
    return {
      zh: sentence.zh,
      en: sentence.en,
      keys: sentence.keys,
      matched,
      pass: matched.length >= Math.max(1, Math.ceil(sentence.keys.length / 2))
    };
  }

  // Grade the whole translation. Returns { correct, details[] } where
  // details[] carries per-sentence pass state + reference translation.
  function grade(essay, text) {
    const set = wordSet(text);
    const details = essay.sentences.map(s => gradeSentence(s, set));
    const passed = details.filter(d => d.pass).length;
    return {
      correct: passed >= Math.min(PASS_SENTENCES, details.length) && passed >= Math.ceil(details.length / 2),
      passed,
      total: details.length,
      details
    };
  }

  window.Essays = { BANK, makeEssay, grade, stem, wordSet };
})();
