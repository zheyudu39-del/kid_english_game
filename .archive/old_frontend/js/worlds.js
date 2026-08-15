/**
 * worlds.js - World & monster metadata for the 666-level campaign.
 * Exposed as window.Worlds (loaded after utils.js, before pages).
 */
(function () {
  'use strict';

  const WORLDS = [
    {
      id: 1,
      name: '翠绿森林',
      nameEn: 'Emerald Forest',
      emoji: '🌲',
      color: '#4ade80',
      bgGradient: 'linear-gradient(135deg, #d1fae5 0%, #6ee7b7 100%)',
      description: '词汇的萌芽之地，3-4岁起步',
      levelRange: [1, 111],
      bossName: '森林领主',
      bossEmoji: '🌳'
    },
    {
      id: 2,
      name: '蔚蓝海洋',
      nameEn: 'Azure Ocean',
      emoji: '🌊',
      color: '#60a5fa',
      bgGradient: 'linear-gradient(135deg, #dbeafe 0%, #93c5fd 100%)',
      description: '5-6岁进阶听力训练',
      levelRange: [112, 222],
      bossName: '海洋领主',
      bossEmoji: '🐙'
    },
    {
      id: 3,
      name: '炽热火山',
      nameEn: 'Blazing Volcano',
      emoji: '🌋',
      color: '#fb923c',
      bgGradient: 'linear-gradient(135deg, #fed7aa 0%, #fdba74 100%)',
      description: '7-8岁拼写挑战',
      levelRange: [223, 333],
      bossName: '火山领主',
      bossEmoji: '🐉'
    },
    {
      id: 4,
      name: '寒冰雪山',
      nameEn: 'Frozen Mountain',
      emoji: '❄️',
      color: '#a78bfa',
      bgGradient: 'linear-gradient(135deg, #e9d5ff 0%, #c4b5fd 100%)',
      description: '9-10岁句子构造',
      levelRange: [334, 444],
      bossName: '雪山领主',
      bossEmoji: '🦄'
    },
    {
      id: 5,
      name: '金色天际',
      nameEn: 'Golden Sky',
      emoji: '⚡',
      color: '#facc15',
      bgGradient: 'linear-gradient(135deg, #fef3c7 0%, #fcd34d 100%)',
      description: '12-15岁高级翻译与复合句',
      levelRange: [445, 555],
      bossName: '天空领主',
      bossEmoji: '🦅'
    },
    {
      id: 6,
      name: '璀璨星空',
      nameEn: 'Starry Cosmos',
      emoji: '🌌',
      color: '#c084fc',
      bgGradient: 'linear-gradient(135deg, #f3e8ff 0%, #ddd6fe 100%)',
      description: '17-18岁→雅思8分巅峰挑战',
      levelRange: [556, 666],
      bossName: '宇宙领主',
      bossEmoji: '👾'
    }
  ];

  // Single source of truth for game modes (also used by level-generator to avoid drift)
  const MONSTER_GAME_MODES = ['word-recognition', 'listening', 'spelling', 'sentences'];

  const MONSTER_TYPES = {
    'word-recognition': { name: '单词怪', emoji: '👹', color: '#ef4444' },
    'listening':        { name: '听力怪', emoji: '👻', color: '#8b5cf6' },
    'spelling':         { name: '拼写怪', emoji: '💀', color: '#10b981' },
    'sentences':        { name: '句子怪', emoji: '🤖', color: '#f59e0b' }
  };

  const SKILLS = {
    hint:   { id: 'hint',   name: '提示',   emoji: '💡', cost: 20,  desc: '排除一个错误选项' },
    shield: { id: 'shield', name: '护盾',   emoji: '🛡️', cost: 50,  desc: '抵挡一次错误' },
    crit:   { id: 'crit',   name: '暴击',   emoji: '⚡', cost: 30,  desc: '下一题伤害翻倍' }
  };

  const TOTAL_LEVELS = 666;
  const WORLDS_COUNT = 6;
  const LEVELS_PER_WORLD = 111;

  function getWorldByLevel(levelNum) {
    const idx = Math.min(WORLDS_COUNT, Math.max(1, Math.ceil(levelNum / LEVELS_PER_WORLD))) - 1;
    return WORLDS[idx];
  }

  window.Worlds = {
    WORLDS,
    MONSTER_TYPES,
    MONSTER_GAME_MODES,
    SKILLS,
    TOTAL_LEVELS,
    WORLDS_COUNT,
    LEVELS_PER_WORLD,
    getWorldByLevel
  };
})();
