/**
 * level-generator.js - Client-side battle logic for the 666-level campaign.
 * Exposed as window.LevelGenerator
 */
(function () {
  'use strict';

  const TOTAL_LEVELS = Worlds.TOTAL_LEVELS;
  const WORLDS_COUNT = Worlds.WORLDS_COUNT;
  const LEVELS_PER_WORLD = Worlds.LEVELS_PER_WORLD;

  /**
   * Compute world (1..6) and metadata for a given level.
   * Mirrors server.js buildLevelConfig().
   */
  function computeLevel(levelNum) {
    const level = Math.max(1, Math.min(TOTAL_LEVELS, parseInt(levelNum, 10) || 1));
    const world = Math.min(WORLDS_COUNT, Math.ceil(level / LEVELS_PER_WORLD));
    const worldProgress = ((level - 1) % LEVELS_PER_WORLD) + 1;
    const isBoss = worldProgress === LEVELS_PER_WORLD;

    // Difficulty band 1..8 — power-eased curve matching server.js
    // Level 1 → 1, level 666 → 8 exactly.
    const t = (level - 1) / (TOTAL_LEVELS - 1);
    const eased = Math.pow(t, 0.85);
    const raw = 1 + eased * 7;
    const difficulty = Math.min(8, Math.max(1, Math.round(raw)));

    // Monster HP
    const baseHP = level * 2 + 10;
    const monsterHP = isBoss ? baseHP * 3 : baseHP;

    // Monster type rotates through the shared game-modes list (single source of truth)
    const types = Worlds.MONSTER_GAME_MODES;
    const monsterType = types[(level - 1) % types.length];

    const worldData = Worlds.getWorldByLevel(level);
    const monsterName = isBoss ? worldData.bossName : Worlds.MONSTER_TYPES[monsterType].name;
    const monsterEmoji = isBoss ? worldData.bossEmoji : Worlds.MONSTER_TYPES[monsterType].emoji;

    return {
      level,
      world,
      worldProgress,
      isBoss,
      difficulty,
      monsterHP,
      maxHP: monsterHP,
      monsterType,
      monsterName,
      monsterEmoji,
      worldName: worldData.name,
      worldEmoji: worldData.emoji,
      worldColor: worldData.color,
      worldGradient: worldData.bgGradient,
      reward: {
        coins: isBoss ? Math.floor(monsterHP / 3) * 2 : Math.floor(monsterHP / 3),
        xp: isBoss ? 100 : 30
      }
    };
  }

  /**
   * Build a 1..N list of synthetic level summaries for the world map.
   * Lightweight (no monsters populated) - enough to draw 111 dots.
   */
  function buildWorldMap(worldId) {
    if (worldId < 1 || worldId > WORLDS_COUNT) return [];
    const start = (worldId - 1) * LEVELS_PER_WORLD + 1;
    const end = worldId * LEVELS_PER_WORLD;
    const out = [];
    for (let i = start; i <= end; i++) {
      out.push(computeLevel(i));
    }
    return out;
  }

  /**
   * Compute attack damage for one correct answer given current streak.
   * Damage = base * 1 + streak bonus. Crit doubles.
   */
  function computeDamage(levelCfg, streak, hasCrit) {
    // Base damage = ~12% of monster HP, so ~8-9 correct answers to kill
    // Level 1: 12 HP monster → 1-2 dmg per hit (was 30 = 1-shot)
    // Level 666: 1342 HP monster → 160 dmg per hit (8 hits to kill)
    const base = Math.max(5, Math.floor(levelCfg.monsterHP * 0.12));
    const streakBonus = Math.max(0, (streak - 1) * Math.floor(base * 0.1));
    let dmg = base + streakBonus;
    if (hasCrit) dmg = Math.floor(dmg * 2);
    return dmg;
  }

  /**
   * Check if a level is unlocked for a player.
   *   - Level 1 always unlocked.
   *   - Otherwise, the previous level must be in completedLevels.
   *   - Boss level (every 111) is unlocked as soon as the world itself is reachable.
   *   - The first level of a world is unlocked when the previous world's boss is defeated.
   */
  function isUnlocked(levelNum, player) {
    if (!player) return levelNum === 1;
    const cfg = computeLevel(levelNum);
    const completed = player.completedLevels || [];
    const bossDefeated = player.bossDefeated || [];

    // Level 1 always unlocked
    if (levelNum === 1) return true;

    // First level of a world: needs previous world boss defeated
    if (cfg.worldProgress === 1) {
      // World 1 first level already handled above
      if (cfg.world === 1) return false; // should not reach here, but defensive
      return bossDefeated.includes(cfg.world - 1);
    }

    // Boss level: unlocked if world is reachable OR previous level completed
    if (cfg.isBoss) {
      return bossDefeated.includes(cfg.world - 1) ||
             completed.includes(cfg.level - 1) ||
             cfg.world === 1;
    }

    // Normal level: previous level must be completed
    return completed.includes(cfg.level - 1);
  }

  /**
   * Filter vocabulary to the right difficulty for a level (with a +1 band tolerance).
   */
  function pickWords(vocab, levelCfg, count) {
    if (!vocab || !vocab.words) return [];
    const min = Math.max(1, levelCfg.difficulty - 1);
    const max = Math.min(8, levelCfg.difficulty + 1);
    const filtered = vocab.words.filter(w => w.difficulty >= min && w.difficulty <= max);
    const pool = filtered.length ? filtered : vocab.words;
    return window.Utils.randomPick(pool, Math.min(count, pool.length));
  }

  function pickSentences(vocab, levelCfg, count) {
    if (!vocab || !vocab.sentences) return [];
    const min = Math.max(1, levelCfg.difficulty - 1);
    const max = Math.min(8, levelCfg.difficulty + 1);
    const filtered = vocab.sentences.filter(s => s.difficulty >= min && s.difficulty <= max);
    const pool = filtered.length ? filtered : vocab.sentences;
    return window.Utils.randomPick(pool, Math.min(count, pool.length));
  }

  window.LevelGenerator = {
    computeLevel,
    buildWorldMap,
    computeDamage,
    isUnlocked,
    pickWords,
    pickSentences
  };
})();
