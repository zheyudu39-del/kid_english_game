// levels.js - 666 levels across 6 worlds, source of truth = server.js
//  - World 1 (lvl   1-111):  森林 — 3-4岁 入门     (difficulty 1 → 3)
//  - World 2 (lvl 112-222):  海洋 — 小学 1-3 年级   (difficulty 3 → 4)
//  - World 3 (lvl 223-333):  火山 — 小学 4-6 年级   (difficulty 4 → 5)
//  - World 4 (lvl 334-444):  雪山 — 初中           (difficulty 5 → 6)
//  - World 5 (lvl 445-555):  天空 — 高中           (difficulty 6 → 7)
//  - World 6 (lvl 556-666):  星空 — 雅思 / 高级    (difficulty 7 → 8)
// Each world has 110 normal levels + 1 boss at worldProgress === 111.
// Level metadata is fetched from /api/levels on first call; per-level full
// config (HP, monsterName, reward) is fetched lazily from /api/levels/:id.
(function () {
  'use strict';

  // Theme palette per world. Names match the boss-naming pool in server.js
  // (forest / ocean / volcano / snow / sky / starry).
  const WORLDS = [
    {
      id: 1, name: '魔法森林', emoji: '🌲',
      bgColor: '#1a3a2e', groundColor: '#3d6e4e',
      accentColor: '#2ed573', groundType: 'grass', particles: 'leaves'
    },
    {
      id: 2, name: '深海王国', emoji: '🐠',
      bgColor: '#0a2a4a', groundColor: '#1e5a8e',
      accentColor: '#1e90ff', groundType: 'sand', particles: 'bubbles'
    },
    {
      id: 3, name: '火焰火山', emoji: '🌋',
      bgColor: '#2a0a0a', groundColor: '#5a2a1a',
      accentColor: '#ff4757', groundType: 'rock', particles: 'embers'
    },
    {
      id: 4, name: '冰封雪山', emoji: '❄️',
      bgColor: '#1a2a4a', groundColor: '#a8d5e8',
      accentColor: '#74b9ff', groundType: 'snow', particles: 'snow'
    },
    {
      id: 5, name: '云端天空', emoji: '⚡',
      bgColor: '#0a2a4a', groundColor: '#3a5a8a',
      accentColor: '#ffd700', groundType: 'cloud', particles: 'stars'
    },
    {
      id: 6, name: '星辉之巅', emoji: '🌌',
      bgColor: '#0a0a2a', groundColor: '#2a2a4a',
      accentColor: '#a55eea', groundType: 'cloud', particles: 'stars'
    }
  ];

  const TOTAL_LEVELS = 666;
  const LEVELS_PER_WORLD = 111;
  const WORLD_BY_ID = Object.fromEntries(WORLDS.map(w => [w.id, w]));

  // In-memory caches
  let _meta = null;       // full /api/levels payload
  let _byNumber = null;   // Map<levelNumber, levelMeta>
  let _fullCache = new Map();  // Map<levelNumber, full battle config>
  let _loadingPromises = new Map();  // Map<levelNumber, Promise> for in-flight single-level fetches
  let _loadingPromise = null;

  // Maximum cache size to prevent unbounded memory growth
  const MAX_FULL_CACHE_SIZE = 50;

  // Derive a sensible per-level difficulty window for monster spawning.
  // The server gives us a single integer difficulty (1-8). For monster
  // spawning we want a small band around it so each level feels coherent
  // but we never end up with zero eligible words at the edge cases.
  function bandForDifficulty(d) {
    // Handle null, undefined, NaN, or non-numeric values
    const dNum = Number(d);
    if (!Number.isFinite(dNum)) {
      return { minDifficulty: 1, maxDifficulty: 2 };
    }
    const dInt = Math.max(1, Math.min(8, Math.round(dNum)));
    return {
      minDifficulty: Math.max(1, dInt - 1),
      maxDifficulty: Math.min(8, dInt + 1)
    };
  }

  // Derive a target / time / count / speed from level number so the rest
  // of the game loop (which still thinks in "catch N monsters in T
  // seconds") keeps working. Curve:
  //   target       : 5 + floor(level/40)   (capped 18)
  //   timeLimit    : 60 + floor(level/30)  (capped 180s)
  //   monsterCount : 6 + floor(level/25)   (capped 32)
  //   monsterSpeed : 0.6 + level*0.005     (capped 3.6)
  function battleParamsFor(levelNum) {
    // Handle invalid inputs (null, undefined, NaN, non-numeric)
    const lvlNum = Number(levelNum);
    if (!Number.isFinite(lvlNum) || lvlNum < 1) {
      return {
        target: 5,
        timeLimit: 60,
        monsterCount: 6,
        monsterSpeed: 0.6
      };
    }
    const lvl = Math.max(1, Math.min(TOTAL_LEVELS, Math.floor(lvlNum)));
    return {
      target:       Math.min(18, 5 + Math.floor(lvl / 40)),
      timeLimit:    Math.min(180, 60 + Math.floor(lvl / 30) * 5),
      monsterCount: Math.min(32, 6 + Math.floor(lvl / 25)),
      monsterSpeed: Math.min(3.6, 0.6 + lvl * 0.005)
    };
  }

  // Fetch and cache the full 666-level list. Idempotent: concurrent
  // callers share a single in-flight promise.
  async function loadAll() {
    if (_meta) return _meta;
    if (_loadingPromise) return _loadingPromise;
    _loadingPromise = API.getLevels()
      .then(data => {
        _meta = data;
        _byNumber = new Map();
        for (const lv of data.levels) _byNumber.set(lv.level, lv);
        _loadingPromise = null;
        return data;
      })
      .catch(err => {
        // Reset so a retry can re-attempt.
        _loadingPromise = null;
        console.error('Failed to load levels metadata:', err);
        throw err;
      });
    return _loadingPromise;
  }

  // Fetch full config for one level (HP, monsterName, reward). Cached.
  // Concurrent requests for the same level share a single in-flight promise
  // to prevent race conditions and duplicate API calls.
  async function loadFull(levelNum) {
    if (_fullCache.has(levelNum)) return _fullCache.get(levelNum);

    // Coalesce concurrent requests for the same level
    if (_loadingPromises.has(levelNum)) {
      return _loadingPromises.get(levelNum);
    }

    const promise = API.getLevel(levelNum)
      .then(data => {
        // Evict oldest entries if cache is full (LRU-like)
        if (_fullCache.size >= MAX_FULL_CACHE_SIZE) {
          const firstKey = _fullCache.keys().next().value;
          _fullCache.delete(firstKey);
        }
        _fullCache.set(levelNum, data);
        _loadingPromises.delete(levelNum);
        return data;
      })
      .catch(err => {
        _loadingPromises.delete(levelNum);
        throw err;
      });

    _loadingPromises.set(levelNum, promise);
    return promise;
  }

  // Synchronous accessors (work once loadAll() has resolved).
  function getWorld(id) { return WORLD_BY_ID[id]; }

  // Build a full level config usable by game.js. Pulls metadata from the
  // cached /api/levels list. If metadata isn't loaded yet, fall back to
  // sensible defaults so the rest of the app can still boot.
  function getLevel(num) {
    // Robust input validation
    const parsed = parseInt(num, 10);
    const levelNum = Math.max(1, Math.min(TOTAL_LEVELS, Number.isFinite(parsed) && parsed > 0 ? parsed : 1));
    const meta = _byNumber && _byNumber.get(levelNum);
    const world = meta ? meta.world : Math.min(6, Math.ceil(levelNum / LEVELS_PER_WORLD));
    const worldProgress = ((levelNum - 1) % LEVELS_PER_WORLD) + 1;
    const isBoss = worldProgress === LEVELS_PER_WORLD;
    const difficulty = meta ? meta.difficulty : Math.min(8, Math.max(1, Math.round(1 + Math.pow((levelNum - 1) / (TOTAL_LEVELS - 1), 0.85) * 7)));
    const monsterType = meta ? meta.monsterType : 'word-recognition';
    const band = bandForDifficulty(difficulty);
    const battle = battleParamsFor(levelNum);
    return Object.assign({
      level: levelNum,
      world,
      worldProgress,
      isBoss,
      difficulty,
      monsterType,
      monsterHP: levelNum * 2 + 10,
      monsterName: '',
      // Mirror buildLevelConfig() in server.js so the offline fallback
      // shows the same coins/XP as the server would award.
      reward: {
        coins: isBoss ? (levelNum * 2 + 10) * 2 : Math.floor((levelNum * 2 + 10) / 3),
        xp: isBoss ? 100 : 30
      }
    }, battle, band, {
      // Preserve explicit overrides last so the API / fallback wins.
      monsterName: meta && meta.isBoss
        ? ['森林领主','海洋领主','火山领主','雪山领主','天空领主','星空领主'][world - 1]
        : '小怪'
    });
  }

  // Async variant that fills in monsterHP / monsterName / reward from the
  // full single-level API. Falls back to the sync version on failure.
  async function getLevelAsync(num) {
    const base = getLevel(num);
    // The bulk metadata fetch failing should not prevent the per-level
    // fetch from being attempted — they are independent requests.
    try {
      await loadAll();
    } catch (e) {
      // Offline: keep going, loadFull will either succeed or fall back.
    }
    try {
      const full = await loadFull(base.level);
      // Only let the server payload override fields it actually provides.
      // A bare `Object.assign({}, base, { monsterType: full.monsterType })`
      // would clobber base's fallback with `undefined` if the server ever
      // omits a field (e.g. after a server-side rename), and game.js reads
      // these fields without defaults.
      return Object.assign({}, base, {
        monsterHP: full.monsterHP != null ? full.monsterHP : base.monsterHP,
        monsterName: full.monsterName != null ? full.monsterName : base.monsterName,
        reward: full.reward != null ? full.reward : base.reward,
        difficulty: full.difficulty != null ? full.difficulty : base.difficulty,
        isBoss: full.isBoss != null ? full.isBoss : base.isBoss,
        world: full.world != null ? full.world : base.world,
        monsterType: full.monsterType != null ? full.monsterType : base.monsterType
      });
    } catch (e) {
      return base;
    }
  }

  // Convenience: list of all 6 worlds, always available.
  function listWorlds() { return WORLDS; }

  // Total number of levels.
  function totalLevels() { return TOTAL_LEVELS; }

  // World that this level belongs to.
  function worldOfLevel(levelNum) {
    return Math.min(6, Math.max(1, Math.ceil(levelNum / LEVELS_PER_WORLD)));
  }

  // Server-side mirror of unlock logic. Level N is unlocked iff
  //   N === 1, OR
  //   the previous level (N-1) was already beaten, OR
  //   N is the first level of a world >=2 AND the previous world boss
  //   has been beaten.
  // Frontend doesn't track bossDefeated separately, so we use a
  // pragmatic proxy: any level <= maxUnlocked is playable, AND the
  // first level of each world is also playable if the previous world's
  // boss was beaten. Because maxUnlocked === maxCompleted + 1, "boss
  // level B beaten" is equivalent to maxUnlocked >= B + 1. Requiring
  // only maxUnlocked >= B (i.e. having beaten B-1, the level just
  // before the boss) was MORE lenient than the server's
  // isLevelUnlockedServer (which demands bossDefeated of the previous
  // world): the frontend would let the player start the next world
  // while the server rejected the win submission, silently losing
  // that progress.
  function isUnlocked(levelNum, maxUnlocked) {
    // Validate inputs
    const lvl = Number(levelNum);
    if (!Number.isFinite(lvl) || lvl < 1) return false;

    const max = Number(maxUnlocked) || 0;

    // Level 1 is always unlocked (entry point)
    if (lvl === 1) return true;

    // Any level at or below the player's max unlocked is playable
    if (max >= lvl) return true;

    // Get world info for this level
    const cfg = getLevel(lvl);

    // First level of world >= 2: require the previous world's boss
    // (i.e., the last level of the previous world) to be beaten.
    // maxUnlocked >= lastOfPrev + 1  <=>  level lastOfPrev completed.
    if (cfg.worldProgress === 1 && cfg.world > 1) {
      const lastOfPrev = (cfg.world - 1) * LEVELS_PER_WORLD;
      return max >= lastOfPrev + 1;
    }

    return false;
  }

  window.Levels = {
    WORLDS,
    TOTAL_LEVELS,
    LEVELS_PER_WORLD,
    loadAll,
    getWorld,
    getLevel,
    getLevelAsync,
    listWorlds,
    totalLevels,
    worldOfLevel,
    isUnlocked,
    // For debugging only
    _cache: { get meta() { return _meta; }, get byNumber() { return _byNumber; } }
  };
})();
