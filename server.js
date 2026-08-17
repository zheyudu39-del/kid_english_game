/**
 * Kids English Learning Game - Express server
 * Serves static frontend, vocabulary data, and score CRUD API.
 * Scores persist to data/scores.json (no database needed).
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { attachRealtime } = require('./realtime');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Trust X-Forwarded-For only when explicitly deployed behind a reverse proxy
// (see deploy/nginx.conf). This keeps rate-limiting keyed to real client IPs.
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
}
app.disable('x-powered-by');

const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const VOCAB_FILE = path.join(DATA_DIR, 'vocabulary.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const SRS_FILE = path.join(DATA_DIR, 'srs.json');

const VALID_AGE_GROUPS = [3, 5, 7, 9, 12, 15, 18, 'adult'];
const VALID_GAME_MODES = ['word-recognition', 'listening', 'spelling', 'sentences', 'word-hunter'];
const TOTAL_LEVELS = 666;
const WORLDS = 6;
const LEVELS_PER_WORLD = 111;

// ---------------------------------------------------------------- sessions
// Stateless HMAC-signed tokens: the server keeps no session table. A token
// embeds `nickname|expiryEpochMs` and is signed with a persistent secret
// (data/session-secret, gitignored), so tokens survive restarts and need
// no cleanup. Clients send them via the X-Player-Token header; the old
// "X-Player header must equal the nickname" check was forgeable by anyone
// who knew the nickname and has been removed.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SECRET_FILE = path.join(DATA_DIR, 'session-secret');
let _sessionSecret = null;

function getSessionSecret() {
  if (_sessionSecret) return _sessionSecret;
  try { _sessionSecret = fs.readFileSync(SECRET_FILE, 'utf-8').trim(); } catch (e) { /* not created yet */ }
  if (!_sessionSecret || _sessionSecret.length < 64) {
    _sessionSecret = crypto.randomBytes(32).toString('hex');
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SECRET_FILE, _sessionSecret + '\n', { mode: 0o600 });
    } catch (err) {
      console.error('Failed to persist session secret:', err.message);
    }
  }
  return _sessionSecret;
}

function hmacPayload(payload) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('hex');
}

// token = base64url("nickname|expiryMs") + "." + hex hmac of that payload.
function createSessionToken(nickname) {
  const payload = nickname + '|' + (Date.now() + SESSION_TTL_MS);
  return Buffer.from(payload, 'utf-8').toString('base64url') + '.' + hmacPayload(payload);
}

// Returns the nickname the token was minted for, or null when the token is
// malformed, tampered with, or expired.
function verifySessionToken(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  let payload;
  try { payload = Buffer.from(token.slice(0, dot), 'base64url').toString('utf-8'); }
  catch (e) { return null; }
  const sig = Buffer.from(token.slice(dot + 1), 'utf-8');
  const expected = Buffer.from(hmacPayload(payload), 'utf-8');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  const sep = payload.lastIndexOf('|');
  if (sep <= 0) return null;
  const nickname = payload.slice(0, sep);
  const expiry = Number(payload.slice(sep + 1));
  if (!Number.isInteger(expiry) || expiry < Date.now()) return null;
  return isValidNickname(nickname) ? nickname : null;
}

// ---------------------------------------------------------------- shop
// Shop catalog is server-authoritative for PRICES and OWNERSHIP. The client
// mirrors the same ids + gameplay stats (public/js/shop.js) so firing logic
// still works offline; only the server decides how coins are spent.
const STARTING_WEAPON = 'wooden';

// Weapons: one-time purchase, equippable, and their `stats` feed straight
// into game.js firing (fireCooldown ms / bulletSpeed / bulletRadius /
// multishot count / spread radians / ammoBonus / bullet color).
const SHOP_WEAPONS = [
  { id: 'wooden',      name: '木制猎枪', emoji: '🔫', price: 0,   desc: '猎人的第一把枪，稳定可靠。', stats: { fireCooldown: 320, bulletSpeed: 9,  bulletRadius: 6, multishot: 1, spread: 0,    ammoBonus: 0, color: '#ffd700' } },
  { id: 'longbow',     name: '猎鹰长弓', emoji: '🏹', price: 120, desc: '弹道极快、命中判定大，射速较慢。', stats: { fireCooldown: 620, bulletSpeed: 14, bulletRadius: 10, multishot: 1, spread: 0,    ammoBonus: 0, color: '#ffd700' } },
  { id: 'crossbow',    name: '疾风连弩', emoji: '⚡', price: 200, desc: '极速连发，附带额外弹药。', stats: { fireCooldown: 170, bulletSpeed: 10, bulletRadius: 5,  multishot: 1, spread: 0,    ammoBonus: 3, color: '#9ecbff' } },
  { id: 'blunderbuss', name: '轰天火铳', emoji: '🧨', price: 320, desc: '一枪五弹扇形散射，近身火力十足。', stats: { fireCooldown: 700, bulletSpeed: 8,  bulletRadius: 5,  multishot: 5, spread: 0.55, ammoBonus: 2, color: '#ff9f43' } },
  { id: 'starstaff',   name: '星辰法杖', emoji: '🌟', price: 500, desc: '星光弹极速飞行，弹药储备充足。', stats: { fireCooldown: 260, bulletSpeed: 16, bulletRadius: 8,  multishot: 1, spread: 0,    ammoBonus: 5, color: '#c9a6ff' } }
];

// Items: consumables. Counts live in player.inventory.items; using one in a
// level applies the effect client-side and decrements the count server-side.
const SHOP_ITEMS = [
  { id: 'health-potion',  name: '生命药水', emoji: '❤️', price: 50,  desc: '立即回复 1 点生命（最多 3 点）。' },
  { id: 'ammo-crate',     name: '弹药箱',   emoji: '🔋', price: 60,  desc: '本关立即补充 10 发子弹。' },
  { id: 'guard-shield',   name: '守护护盾', emoji: '🛡️', price: 80,  desc: '获得 6 秒无敌护盾。' },
  { id: 'time-hourglass', name: '时间沙漏', emoji: '⏳', price: 90,  desc: '本关剩余时间 +15 秒。' },
  { id: 'stun-bomb',      name: '眩晕手雷', emoji: '💥', price: 100, desc: '眩晕全场小怪 4 秒。' }
];

// Look up an item id across both catalogs. Returns { kind, item } or null.
function findShopItem(id) {
  const weapon = SHOP_WEAPONS.find(w => w.id === id);
  if (weapon) return { kind: 'weapon', item: weapon };
  const item = SHOP_ITEMS.find(i => i.id === id);
  if (item) return { kind: 'item', item };
  return null;
}

// Normalize the shop fields on a (possibly legacy) player profile so every
// consumer can trust inventory / equippedWeapon to be present and sane.
function ensureShopFields(player) {
  if (!player.inventory || typeof player.inventory !== 'object' || Array.isArray(player.inventory)) {
    player.inventory = { weapons: [STARTING_WEAPON], items: {} };
  } else {
    if (!Array.isArray(player.inventory.weapons)) {
      player.inventory.weapons = [STARTING_WEAPON];
    } else if (!player.inventory.weapons.includes(STARTING_WEAPON)) {
      player.inventory.weapons.unshift(STARTING_WEAPON);
    }
    if (!player.inventory.items || typeof player.inventory.items !== 'object' || Array.isArray(player.inventory.items)) {
      player.inventory.items = {};
    }
  }
  if (typeof player.equippedWeapon !== 'string' || !player.equippedWeapon) {
    player.equippedWeapon = STARTING_WEAPON;
  }
}

// Hard caps so the JSON store can't be flooded to unbounded disk growth.
const MAX_SCORES = 5000;   // leaderboard entries retained
const MAX_PLAYERS = 5000;  // auto-created player profiles

// Whitelist for nicknames: alphanumerics, CJK, underscore, hyphen. 1-12 chars.
const NICKNAME_RE = /^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,12}$/;

function isValidNickname(nickname) {
  return typeof nickname === 'string' && NICKNAME_RE.test(nickname.trim());
}

function loadSRS() {
  if (_srsCache.data) return _srsCache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(SRS_FILE, 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.players && typeof parsed.players === 'object' && !Array.isArray(parsed.players)) {
      parsed.players = Object.assign(Object.create(null), parsed.players);
      _srsCache.data = parsed;
    } else {
      _srsCache.loadFailed = true;
      _srsCache.data = { version: '1.0', players: Object.create(null) };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('srs.json load failed:', err.message);
      _srsCache.loadFailed = true;
    }
    _srsCache.data = { version: '1.0', players: Object.create(null) };
  }
  return _srsCache.data;
}

function saveSRS(data) {
  _srsCache.data = data;
  const write = _srsCache.writeQueue.then(() => {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      if (_srsCache.loadFailed) {
        try { fs.copyFileSync(SRS_FILE, SRS_FILE + '.corrupt-' + Date.now()); } catch (e) { /* non-fatal */ }
      }
      const tmp = SRS_FILE + '.tmp';
      fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8', (err) => {
        if (err) { reject(err); return; }
        fs.rename(tmp, SRS_FILE, (err2) => {
          if (err2) reject(err2);
          else { _srsCache.loadFailed = false; resolve(); }
        });
      });
    });
  });
  _srsCache.writeQueue = write.catch(err => {
    console.error('saveSRS failed:', err);
  });
  return write;
}

// SM-2 spaced repetition algorithm.
// Returns the updated entry (mutated in place). Default ease = 2.5 (Anki default).
function applySM2(entry, correct) {
  if (!entry) return entry;
  // Ensure numeric fields
  if (typeof entry.ease !== 'number' || !Number.isFinite(entry.ease)) entry.ease = 2.5;
  if (typeof entry.interval !== 'number' || !Number.isFinite(entry.interval)) entry.interval = 0;
  if (typeof entry.repetitions !== 'number' || !Number.isFinite(entry.repetitions)) entry.repetitions = 0;
  if (typeof entry.correct !== 'number' || !Number.isFinite(entry.correct)) entry.correct = 0;
  if (typeof entry.wrong !== 'number' || !Number.isFinite(entry.wrong)) entry.wrong = 0;

  if (correct) {
    entry.correct++;
    if (entry.repetitions === 0) {
      entry.interval = 1;
    } else if (entry.repetitions === 1) {
      entry.interval = 3;
    } else {
      entry.interval = Math.round(entry.interval * entry.ease);
    }
    entry.repetitions++;
    entry.ease = Math.max(1.3, entry.ease + 0.1);
  } else {
    entry.wrong++;
    entry.repetitions = 0;
    entry.interval = 1;
    entry.ease = Math.max(1.3, entry.ease - 0.2);
  }
  entry.lastSeen = new Date().toISOString();
  // nextReview = today + interval days (truncate to midnight UTC for deterministic "due" calc)
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + Math.max(1, entry.interval));
  entry.nextReview = d.toISOString().slice(0, 10);
  return entry;
}

// SM-2 helper: count words mastered (interval >= 21 days = 3-week retention)
function isMastered(entry) {
  return entry && entry.interval >= 21 && entry.repetitions >= 3;
}

// SM-2 helper: count words due for review today
function isDueToday(entry) {
  if (!entry || !entry.nextReview) return true;
  const today = new Date().toISOString().slice(0, 10);
  return entry.nextReview <= today;
}

// SM-2 helper: compute mastery score 0-100
function masteryScore(entry) {
  if (!entry) return 0;
  const accuracy = entry.correct + entry.wrong > 0
    ? entry.correct / (entry.correct + entry.wrong)
    : 0;
  const intervalScore = Math.min(1, entry.interval / 60); // 60 days = 100% interval
  return Math.round(50 * accuracy + 50 * intervalScore);
}

function loadScores() {
  if (_scoresCache.data) return _scoresCache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf-8'));
    // Defensive: tolerate hand-edited / partially-corrupt files.
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.scores)) {
      _scoresCache.data = parsed;
    } else {
      console.error('scores.json missing "scores" array — resetting to empty store');
      _scoresCache.loadFailed = true; // back up before any overwrite
      _scoresCache.data = { scores: [] };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('scores.json load failed:', err.message);
      _scoresCache.loadFailed = true; // don't silently destroy recoverable data
    }
    _scoresCache.data = { scores: [] };
  }
  return _scoresCache.data;
}

function saveScores(data) {
  _scoresCache.data = data;
  // Chain onto the queue for ordering, but capture the write promise itself
  // so callers see real failures (the queue swallows errors to stay alive).
  const write = _scoresCache.writeQueue.then(() => {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      // If the file failed to parse on load, back it up before overwriting so
      // corrupt-but-recoverable data isn't destroyed by the next save.
      if (_scoresCache.loadFailed) {
        try { fs.copyFileSync(SCORES_FILE, SCORES_FILE + '.corrupt-' + Date.now()); } catch (e) { /* non-fatal */ }
      }
      const tmp = SCORES_FILE + '.tmp';
      fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8', (err) => {
        if (err) { reject(err); return; }
        fs.rename(tmp, SCORES_FILE, (err2) => {
          if (err2) reject(err2);
          else { _scoresCache.loadFailed = false; resolve(); }
        });
      });
    });
  });
  _scoresCache.writeQueue = write.catch(err => {
    console.error('saveScores failed:', err);
  });
  return write;
}

// In-memory caches with lazy-load + serialized writes (prevent file race conditions)
const _playersCache = { data: null, loading: false, loadFailed: false, writeQueue: Promise.resolve() };
const _scoresCache = { data: null, loading: false, loadFailed: false, writeQueue: Promise.resolve() };
const _vocabCache = { data: null };
const _srsCache = { data: null, loading: false, loadFailed: false, writeQueue: Promise.resolve() };

function loadVocabulary() {
  // Cache the parsed vocabulary: the file is ~1.7MB and reading + parsing it
  // synchronously on every /api/vocabulary request blocks the event loop.
  if (_vocabCache.data) return _vocabCache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(VOCAB_FILE, 'utf-8'));
    if (parsed && typeof parsed === 'object' && parsed.ageGroups && parsed.words) {
      _vocabCache.data = parsed;
      return _vocabCache.data;
    }
    console.error('vocabulary.json has unexpected shape — serving empty vocabulary');
  } catch (err) {
    // Only fall back to empty structure when file genuinely missing;
    // a parse error should be visible in logs.
    if (err.code !== 'ENOENT') {
      console.error('vocabulary.json parse failed:', err.message);
    }
  }
  _vocabCache.data = {
    version: '1.0',
    ageGroups: {
      '3':  { label: '3-4岁',  maxDifficulty: 1 },
      '5':  { label: '5-6岁',  maxDifficulty: 2 },
      '7':  { label: '7-8岁',  maxDifficulty: 3 },
      '9':  { label: '9-10岁', maxDifficulty: 4 },
      '12': { label: '11-13岁', maxDifficulty: 5 },
      '15': { label: '14-16岁', maxDifficulty: 6 },
      '18': { label: '17-18岁', maxDifficulty: 7 },
      'adult': { label: '雅思8分', maxDifficulty: 8 }
    },
    categories: [],
    words: [],
    sentences: [],
    letters: []
  };
  return _vocabCache.data;
}

function loadPlayers() {
  if (_playersCache.data) return _playersCache.data;
  try {
    const parsed = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf-8'));
    // Defensive: a tampered or hand-edited file might not have the expected
    // shape. Reset to empty rather than crashing every later request on
    // `data.players[nickname]`.
    if (parsed && typeof parsed === 'object' && parsed.players && typeof parsed.players === 'object' && !Array.isArray(parsed.players)) {
      // Rebuild as a null-prototype map so hostile nicknames such as
      // '__proto__' / 'constructor' / 'toString' can never hit
      // Object.prototype properties (false "already registered" 409s, and
      // prototype pollution when a progress write mutates `player.*`).
      parsed.players = Object.assign(Object.create(null), parsed.players);
      _playersCache.data = parsed;
    } else {
      console.error('players.json missing "players" object — resetting to empty store');
      _playersCache.loadFailed = true; // back up before any overwrite
      _playersCache.data = { version: '1.0', players: Object.create(null) };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('players.json load failed:', err.message);
      _playersCache.loadFailed = true; // don't silently destroy recoverable data
    }
    _playersCache.data = { version: '1.0', players: Object.create(null) };
  }
  return _playersCache.data;
}

/**
 * Save players atomically. Serializes concurrent writes via a chained promise
 * so two simultaneous updates don't clobber each other on disk.
 */
function savePlayers(data) {
  _playersCache.data = data;
  // Chain onto the queue for ordering, but return the actual write promise
  // so route handlers see failures instead of a false "success".
  const write = _playersCache.writeQueue.then(() => {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      // If the file failed to parse on load, back it up before overwriting so
      // corrupt-but-recoverable data isn't destroyed by the next save.
      if (_playersCache.loadFailed) {
        try { fs.copyFileSync(PLAYERS_FILE, PLAYERS_FILE + '.corrupt-' + Date.now()); } catch (e) { /* non-fatal */ }
      }
      const tmp = PLAYERS_FILE + '.tmp';
      fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8', (err) => {
        if (err) { reject(err); return; }
        fs.rename(tmp, PLAYERS_FILE, (err2) => {
          if (err2) reject(err2);
          else { _playersCache.loadFailed = false; invalidateLeaderboard(); resolve(); }
        });
      });
    });
  });
  _playersCache.writeQueue = write.catch(err => {
    console.error('savePlayers failed:', err);
  });
  return write;
}

/**
 * Hash a password with scrypt (memory-hard KDF) and a per-user random salt.
 * Stored format: `scrypt:<saltHex>:<hashHex>`.
 *
 * scrypt was chosen over the earlier salted SHA-256 because it is
 * memory-hard, which makes offline brute-force of a stolen players.json
 * dramatically more expensive. Legacy hashes still verify (see below) and
 * are migrated to scrypt on the account's next successful login.
 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };

function scryptHex(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS).toString('hex');
}

// Constant-time equality for two hex strings (timingSafeEqual throws on
// length mismatch, so check first — a length mismatch just means "wrong").
function timingSafeHexEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf-8'), Buffer.from(b, 'utf-8'));
}

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  return 'scrypt:' + salt + ':' + scryptHex(password, salt);
}

// True for hashes written by earlier server versions (verifyPassword still
// understands both, and login migrates them in place).
//   - v1: unsalted SHA-256 of the password, 64 hex chars.
//   - v2: salted SHA-256, `saltHex:hashHex` (no "scrypt:" prefix).
function isLegacyHash(stored) {
  return typeof stored === 'string' && /^[0-9a-f]{64}$/i.test(stored);
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || stored.length === 0) return false;
  if (stored.startsWith('scrypt:')) {
    const parts = stored.split(':');
    if (parts.length !== 3 || !/^[0-9a-f]+$/i.test(parts[1]) || !/^[0-9a-f]{64}$/i.test(parts[2])) return false;
    return timingSafeHexEqual(scryptHex(password, parts[1]), parts[2].toLowerCase());
  }
  if (!stored.includes(':')) {
    // v1 legacy format: plain unsalted SHA-256 of the password.
    if (!isLegacyHash(stored)) return false;
    return timingSafeHexEqual(crypto.createHash('sha256').update(password).digest('hex'), stored.toLowerCase());
  }
  // v2 legacy format: salted SHA-256 of `salt + ':' + password`.
  const [salt, want] = stored.split(':');
  return timingSafeHexEqual(crypto.createHash('sha256').update(salt + ':' + password).digest('hex'), (want || '').toLowerCase());
}

/**
 * A caller is authorized to act on a profile iff they present a valid,
 * unexpired session token (X-Player-Token) that was minted at login or
 * register for exactly that nickname. Knowing the nickname alone proves
 * nothing, so cross-account reads/writes are impossible without the
 * account's token.
 */
function isAuthorizedCaller(req, nickname) {
  const token = (req.get('X-Player-Token') || '').trim();
  if (!token) return false;
  return verifySessionToken(token) === nickname;
}

/**
 * Create a default player profile for a new nickname.
 */
function createDefaultPlayer(nickname, ageGroup) {
  // Normalize age: number or 'adult' both allowed
  const normalized = (ageGroup === 'adult' || (typeof ageGroup === 'number' && VALID_AGE_GROUPS.includes(ageGroup)))
    ? ageGroup
    : 7;
  return {
    nickname: nickname.trim(),
    ageGroup: normalized,
    currentLevel: 1,
    maxLevel: 1,
    currentWorld: 1,
    bossDefeated: [],  // world numbers whose boss is beaten
    coins: 50,
    skills: { hint: 3, shield: 2, crit: 2 },
    inventory: { weapons: [STARTING_WEAPON], items: {} },
    equippedWeapon: STARTING_WEAPON,
    completedLevels: [],
    createdAt: new Date().toISOString(),
    lastPlayAt: new Date().toISOString()
  };
}

/**
 * Compute the world number (1..6) for a given level (1..666).
 */
function worldOfLevel(levelNum) {
  return Math.min(WORLDS, Math.ceil(levelNum / LEVELS_PER_WORLD));
}

/**
 * Compute the difficulty band (1..8) for a level.
 * Piecewise mapping that:
 *  - world 1 ramps 1..1.5  → rounds to 1
 *  - world 6 ramps 7.5..8  → rounds to 8 for the final boss
 * Achieves monotonic growth and hits exactly 8 at level 666.
 */
function difficultyOfLevel(levelNum) {
  // Map 1..666 → 1..8 with non-linear curve weighted toward the high end.
  const t = (levelNum - 1) / (TOTAL_LEVELS - 1); // 0..1
  // Power curve < 1 makes early levels gentler, late levels hit the cap.
  const eased = Math.pow(t, 0.85);
  const raw = 1 + eased * 7;
  return Math.min(8, Math.max(1, Math.round(raw)));
}

/**
 * Build a battle config for the requested level.
 * Used by both the GET /api/levels/:id and the battle-stage frontend.
 */
function buildLevelConfig(levelNum) {
  const level = Math.max(1, Math.min(TOTAL_LEVELS, parseInt(levelNum, 10) || 1));
  const world = worldOfLevel(level);
  const worldProgress = ((level - 1) % LEVELS_PER_WORLD) + 1;
  // Boss cadence: a "guard" boss every 10th level inside a world plus the
  // "lord" boss closing each world (worldProgress 111) — 12 per world, 72
  // across the game, so the growth tree has regular boss milestones.
  const isWorldFinal = worldProgress === LEVELS_PER_WORLD;
  const isBoss = isWorldFinal || worldProgress % 10 === 0;
  const difficulty = difficultyOfLevel(level);

  // Monster HP scales with level
  const baseHP = level * 2 + 10;
  const monsterHP = isBoss ? baseHP * 3 : baseHP;

  // Determine monster type by rotation among 4 main game modes
  const types = ['word-recognition', 'listening', 'spelling', 'sentences'];
  const monsterType = types[(level - 1) % 4];

  // Monster name pool — expanded to 12+ per type to avoid 4-level repetition
  const monsterNames = {
    'word-recognition': ['字母怪', '拼写怪', '词典怪', '语法怪', '字精灵', '词霸怪', '发音怪', '构词怪', '字母鬼', '单词兽', '字谜怪', '词库怪', '词根怪', '词缀怪'],
    'listening':        ['沉默怪', '回声怪', '耳语怪', '声波怪', '音律怪', '听觉怪', '音符怪', '音波兽', '聆听怪', '谐音怪', '共鸣怪', '震波怪', '静音怪', '回音怪'],
    'spelling':         ['字母怪', '拼写怪', '字母鬼', '错字怪', '笔画怪', '排字怪', '字形怪', '偏旁怪', '部首怪', '笔顺怪', '拼字兽', '纠错怪', '字符怪', '正字怪'],
    'sentences':        ['话痨怪', '句子怪', '对话怪', '翻译怪', '语序怪', '句型怪', '语法怪', '时态怪', '从句怪', '短句怪', '复合怪', '语篇怪', '修辞怪', '句法怪']
  };
  const namePool = monsterNames[monsterType] || ['神秘怪'];
  const monsterName = isBoss
    ? `${['森林','海洋','火山','雪山','天空','星空'][world-1]}${isWorldFinal ? '领主' : '守卫' + (worldProgress / 10)}`
    : namePool[(level - 1) % namePool.length];

  // Reward
  const coins = isBoss ? Math.floor(monsterHP / 3) * 2 : Math.floor(monsterHP / 3);

  return {
    level,
    world,
    worldProgress,
    isBoss,
    difficulty,
    monsterHP,
    monsterType,
    monsterName,
    reward: { coins, xp: isBoss ? 100 : 30 }
  };
}

/**
 * Server-side mirror of the frontend LevelGenerator.isUnlocked().
 * A player may only record a win for a level the UI would actually let them
 * play, otherwise an attacker could POST any level as "won" and skip ahead.
 * Rules:
 *   - Level 1 is always unlocked (even for brand-new players).
 *   - Any level the player has already completed is replayable.
 *   - First level of a world (worldProgress === 1, world >= 2): the
 *     previous world's boss must be defeated.
 *   - Boss level (worldProgress === LEVELS_PER_WORLD): the previous level
 *     must be completed (i.e. the player reached the boss legitimately).
 *   - Normal level: the immediately-previous level must be completed.
 * This matches the frontend isUnlocked() which gates boss access on having
 * beaten level 110 in the same world (no "world === 1" carve-out).
 */
function isLevelUnlockedServer(levelNum, player) {
  // Integers only: NaN / Infinity / 3.5-style garbage can never unlock anything,
  // and `includes()` comparisons are always against integer level numbers.
  const completed = (player.completedLevels || []).filter(l => typeof l === 'number' && Number.isInteger(l));
  const bossDefeated = (player.bossDefeated || []).filter(w => typeof w === 'number' && Number.isInteger(w));
  // Level 1 is always unlocked, even for brand-new players with no history.
  if (levelNum === 1) return true;
  // If a player has never finished anything, only level 1 is reachable.
  if (completed.length === 0 && bossDefeated.length === 0) return false;
  // Already-completed levels are always replayable (no progression penalty
  // for re-running; the progress endpoint is idempotent on `completedLevels`).
  if (completed.includes(levelNum)) return true;
  const cfg = buildLevelConfig(levelNum);
  if (cfg.worldProgress === 1) {
    // First level of a world (>=2): the previous world's boss must be down.
    // A legacy profile may have the boss in completedLevels but never got a
    // bossDefeated entry, so treat "completed the boss level" as defeated.
    const prevBoss = (cfg.world - 1) * LEVELS_PER_WORLD;
    return cfg.world >= 2 && (bossDefeated.includes(cfg.world - 1) || completed.includes(prevBoss));
  }
  if (cfg.isBoss) {
    // Boss is reachable only by clearing the level just before it.
    return completed.includes(cfg.level - 1);
  }
  // Normal level: the immediately-previous level must be completed.
  return completed.includes(cfg.level - 1);
}

function validateScore(req, res, next) {
  const { nickname, score, ageGroup, gameMode } = req.body || {};
  if (!isValidNickname(nickname)) {
    return res.status(400).json({ error: '昵称格式不合法' });
  }
  if (typeof score !== 'number' || score < 0 || score > 20000) {
    return res.status(400).json({ error: '分数不合法（0-20000）' });
  }
  if (!VALID_AGE_GROUPS.includes(ageGroup)) {
    return res.status(400).json({ error: '年龄段不合法' });
  }
  if (!VALID_GAME_MODES.includes(gameMode)) {
    return res.status(400).json({ error: '游戏模式不合法' });
  }
  next();
}

// ---------------------------------------------------------------- middleware

// Bound the JSON body size so a single client can't pin memory or disk by
// streaming a huge payload. Real submissions are < 1KB; 16KB is plenty of
// slack for any future field while still capping per-request memory.
app.use(express.json({ limit: '16kb' }));

// ---- security headers -------------------------------------------------
// The SPA relies on inline style attributes, so CSP allows 'unsafe-inline'
// for styles only. No inline scripts / eval are used anywhere in the app.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' data:; connect-src 'self'; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ---- rate limiting (in-memory sliding window, keyed by client IP) ------
// Bounds write-endpoint spam so the JSON store can't be flooded (DoS / disk fill).
const RATE_LIMITS = {
  read:  { limit: 600, windowMs: 60 * 1000 },
  write: { limit: 60,  windowMs: 60 * 1000 },
  // Login/register get their own much tighter budget (brute-force defense)
  // so password guessing can't exhaust the general write allowance.
  auth:  { limit: 10,  windowMs: 60 * 1000 }
};
const _rateBuckets = new Map();

function rateLimit(kind) {
  return (req, res, next) => {
    const cfg = RATE_LIMITS[kind];
    const now = Date.now();
    // Key by IP *and* kind so read traffic can't exhaust the write budget
    // (and vice versa).
    const key = req.ip + '|' + kind;
    let bucket = _rateBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { hits: 0, resetAt: now + cfg.windowMs };
      _rateBuckets.set(key, bucket);
    }
    bucket.hits++;
    if (bucket.hits > cfg.limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return res.status(429).json({ error: '请求太频繁，请稍后再试' });
    }
    // Opportunistic cleanup so the bucket map itself can't grow without bound.
    if (_rateBuckets.size > 10000) {
      for (const [k, v] of _rateBuckets) {
        if (v.resetAt <= now) _rateBuckets.delete(k);
      }
    }
    next();
  };
}

// Periodic sweep of expired rate-limit buckets. The per-request cleanup only
// triggers above 10k entries, so without this a trickle of one-off IPs would
// accumulate buckets forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _rateBuckets) {
    if (v.resetAt <= now) _rateBuckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

// Every /api request is rate-limited. POSTs and /api/players* (which can
// auto-create a profile on GET) use the stricter write budget. Login and
// register use the tightest "auth" budget to slow password guessing.
// Normalize the path so case differences and trailing slashes can't bypass
// the auth budget (e.g. /LOGIN, /login/ would otherwise fall through).
app.use('/api', (req, res, next) => {
  const normPath = req.path.replace(/\/+$/, '').toLowerCase();
  if (req.method === 'POST' && (normPath === '/login' || normPath === '/register')) {
    return rateLimit('auth')(req, res, next);
  }
  const isWrite = req.method === 'POST' || req.originalUrl.startsWith('/api/players');
  rateLimit(isWrite ? 'write' : 'read')(req, res, next);
});

// Static assets: always revalidate. The frontend ships as discrete <script>
// files with no build hashing — without an explicit no-cache policy browsers
// heuristic-cache index.html/JS and can end up running a MIX of old and new
// files after an update, which breaks wiring (dead buttons). ETag revalidation
// keeps this cheap (304s) while guaranteeing freshness.
app.use(express.static(PUBLIC_DIR, {
  etag: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else {
      // Images/fonts may cache for a session.
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// ---------------------------------------------------------------- API routes

// GET /api/vocabulary?age=7  -> vocabulary; if age given, restrict to words
// appropriate for that age. The game itself picks a sub-range per level.
app.get('/api/vocabulary', (req, res) => {
  const vocab = loadVocabulary();
  const rawAge = req.query.age;

  // No age param: return the full vocabulary (callers handle their own
  // age gating client-side).
  if (rawAge == null || rawAge === '') {
    return res.json(vocab);
  }

  // Reject obviously bad values (empty after trim, multi-char strings that
  // don't match a valid age key, non-numeric non-'adult' values) with 400
  // so a bug in the client doesn't quietly fall back to the full payload.
  if (rawAge !== 'adult') {
    const ageNum = Number(rawAge);
    if (!Number.isInteger(ageNum) || !VALID_AGE_GROUPS.includes(ageNum)) {
      return res.status(400).json({ error: '年龄段参数不合法' });
    }
    if (!vocab.ageGroups[String(ageNum)]) {
      return res.status(400).json({ error: '年龄段参数不合法' });
    }
    return res.json({
      version: vocab.version,
      ageGroup: ageNum,
      maxDifficulty: vocab.ageGroups[String(ageNum)].maxDifficulty,
      categories: vocab.categories,
      // Send ALL words up to the age-appropriate cap so the game can
      // pick any sub-range per level (older kids can still face easy
      // levels in world 1, and hard words in world 4+).
      words: vocab.words.filter(w => w.difficulty <= vocab.ageGroups[String(ageNum)].maxDifficulty),
      sentences: vocab.sentences.filter(s => s.difficulty <= vocab.ageGroups[String(ageNum)].maxDifficulty),
      letters: vocab.letters
    });
  }

  // rawAge === 'adult'
  const adult = vocab.ageGroups.adult;
  if (!adult) {
    return res.status(500).json({ error: '词库未配置 adult 年龄段' });
  }
  res.json({
    version: vocab.version,
    ageGroup: 'adult',
    maxDifficulty: adult.maxDifficulty,
    categories: vocab.categories,
    words: vocab.words.filter(w => w.difficulty <= adult.maxDifficulty),
    sentences: vocab.sentences.filter(s => s.difficulty <= adult.maxDifficulty),
    letters: vocab.letters
  });
});

// GET /api/scores?limit=20&age=7&game=word-recognition&nickname=xx
app.get('/api/scores', (req, res) => {
  const { limit, age, game, nickname } = req.query;
  let scores = loadScores().scores;

  if (age) {
    // 'adult' must be compared as a string; parseInt('adult') is NaN and the
    // old filter silently matched nothing (empty leaderboard). Validate so a
    // bad value is loud instead of returning a misleading empty list.
    const ageKey = age === 'adult' ? 'adult' : Number(age);
    if (ageKey !== 'adult' && (!Number.isInteger(ageKey) || !VALID_AGE_GROUPS.includes(ageKey))) {
      return res.status(400).json({ error: '年龄段参数不合法' });
    }
    scores = scores.filter(s => s.ageGroup === ageKey);
  }
  if (game) scores = scores.filter(s => s.gameMode === game);
  if (nickname) scores = scores.filter(s => s.nickname === nickname.trim());

  // Sort by score descending (highest first), then most recent
  scores.sort((a, b) => b.score - a.score || new Date(b.date) - new Date(a.date));

  const n = parseInt(limit, 10);
  // Clamp to 500 so a caller can't force a full 5000-entry scan for no reason.
  if (!Number.isNaN(n) && n > 0) scores = scores.slice(0, Math.min(n, 500));

  res.json({ scores });
});

// GET /api/scores/:nickname  -> one player's history + best score
app.get('/api/scores/:nickname', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) {
    return res.status(400).json({ error: '昵称格式不合法' });
  }
  const entries = loadScores().scores
    .filter(s => s.nickname === nickname)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({
    nickname,
    count: entries.length,
    best: entries.reduce((m, s) => Math.max(m, s.score), 0),
    entries
  });
});

// POST /api/scores  -> submit a game result
app.post('/api/scores', validateScore, (req, res) => {
  const { nickname, score, ageGroup, gameMode, category } = req.body;

  // roundsPlayed / correctCount / playSec are informational stats — clamp
  // them so a crafted payload can't store negative numbers, strings, or
  // huge values.
  const roundsPlayed = Math.min(100, Math.max(1, Math.floor(Number(req.body.roundsPlayed)) || 10));
  const correctCount = Math.min(roundsPlayed, Math.max(0, Math.floor(Number(req.body.correctCount)) || 0));
  const playSec = Math.min(7200, Math.max(0, Math.floor(Number(req.body.playSec)) || 0));
  // Category is free-form: strip HTML metacharacters and cap length so a
  // malicious value can never become a stored-XSS payload.
  const cleanCategory = typeof category === 'string'
    ? (category.replace(/[<>"']/g, '').trim().slice(0, 32) || 'mixed')
    : 'mixed';

  const entry = {
    id: crypto.randomBytes(4).toString('hex'),
    nickname: nickname.trim(),
    score,
    ageGroup,
    gameMode,
    category: cleanCategory,
    date: new Date().toISOString(),
    roundsPlayed,
    correctCount,
    playSec,
    won: !!req.body.won
  };

  const data = loadScores();
  data.scores.push(entry);
  // Keep only the most recent entries so the JSON file can't grow unbounded.
  if (data.scores.length > MAX_SCORES) {
    data.scores = data.scores.slice(data.scores.length - MAX_SCORES);
  }
  saveScores(data).then(() => {
    res.status(201).json({ success: true, id: entry.id });
  }).catch(err => {
    res.status(500).json({ error: '保存失败: ' + err.message });
  });
});

// ---------------------------------------------------------------- report
// GET /api/report/:nickname  ->  parent-facing learning report.
// Pure aggregation over data the server already keeps (scores.json session
// rows + players.json profile) — no new storage, nothing written. Word-level
// detail (错词本) lives in the player's browser and is merged client-side.

app.get('/api/report/:nickname', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) {
    return res.status(400).json({ error: '昵称格式不合法' });
  }

  // Session rows for this player, newest first.
  const entries = loadScores().scores
    .filter(s => s.nickname === nickname)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  let totalRounds = 0, totalCorrect = 0, totalPlaySec = 0;
  const playDays = new Set();
  for (const e of entries) {
    totalRounds += e.roundsPlayed || 0;
    totalCorrect += e.correctCount || 0;
    totalPlaySec += e.playSec || 0;
    playDays.add(String(e.date).slice(0, 10));
  }

  // Registered profile (if any) contributes cleared-level data. Guests
  // still get a full session report — only the profile card is absent.
  const player = loadPlayers().players[nickname];
  const profile = (player && player.passwordHash) ? {
    cleared: Array.isArray(player.completedLevels) ? player.completedLevels.length : 0,
    maxLevel: (typeof player.maxLevel === 'number' && Number.isFinite(player.maxLevel)) ? player.maxLevel : 1,
    coins: (typeof player.coins === 'number' && Number.isFinite(player.coins)) ? player.coins : 0,
    age: (typeof player.age === 'number') ? player.age : null,
    lastPlayAt: typeof player.lastPlayAt === 'string' ? player.lastPlayAt : ''
  } : null;

  res.json({
    nickname,
    hasAccount: !!profile,
    profile,
    totals: {
      sessions: entries.length,
      rounds: totalRounds,
      correct: totalCorrect,
      accuracy: totalRounds > 0 ? Math.round((totalCorrect / totalRounds) * 100) : 0,
      playSec: totalPlaySec,
      playDays: playDays.size,
      firstPlay: entries.length ? entries[entries.length - 1].date : '',
      lastPlay: entries.length ? entries[0].date : ''
    },
    // Most recent sessions (chart + list), oldest → newest for plotting.
    sessions: entries.slice(0, 30).reverse().map(e => ({
      date: e.date,
      score: e.score,
      rounds: e.roundsPlayed || 0,
      correct: e.correctCount || 0,
      playSec: e.playSec || 0,
      won: !!e.won
    }))
  });
});

// ---------------------------------------------------------------- SRS (Spaced Repetition System)
// SM-2 based spaced repetition for long-term vocabulary retention.
// Stores per-player word-level tracking: ease, interval, repetitions, review dates.

// POST /api/players/:nickname/srs/batch  ->  record a batch of word results
// Body: { results: [ { wordId, english, chinese, difficulty, correct }, ... ] }
// Each result updates the SM-2 entry for that word. Returns updated stats.
app.post('/api/players/:nickname/srs/batch', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) return res.status(400).json({ error: '昵称格式不合法' });
  if (!isAuthorizedCaller(req, nickname)) return res.status(401).json({ error: '请先登录' });

  const { results } = req.body || {};
  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'results 必须是非空数组' });
  }
  if (results.length > 100) {
    return res.status(400).json({ error: '单次最多上报 100 条结果' });
  }

  const data = loadSRS();
  let playerData = data.players[nickname];
  if (!playerData) {
    playerData = {};
    data.players[nickname] = playerData;
  }

  let updated = 0;
  // Pre-load vocabulary for category lookup during batch processing
  let vocabWords = null;
  try {
    const vocab = loadVocabulary();
    if (vocab && Array.isArray(vocab.words)) vocabWords = vocab.words;
  } catch (e) { /* no vocab, categories will stay as 'unknown' */ }
  for (const r of results) {
    const wordKey = (r.wordId || (r.english || '').trim().toLowerCase()) || '';
    if (!wordKey) continue;
    if (typeof r.correct !== 'boolean') continue;

    let entry = playerData[wordKey];
    if (!entry) {
      entry = {
        ease: 2.5,
        interval: 0,
        repetitions: 0,
        correct: 0,
        wrong: 0,
        lastSeen: null,
        nextReview: new Date().toISOString().slice(0, 10)
      };
      playerData[wordKey] = entry;
    }
    // Store metadata for dashboard display
    if (r.english) entry.english = r.english;
    if (r.chinese) entry.chinese = r.chinese;
    if (typeof r.difficulty === 'number') entry.difficulty = r.difficulty;
    // Look up category from vocabulary
    if (!entry.category && vocabWords) {
      const match = vocabWords.find(w => (w.id || '').toLowerCase() === wordKey.toLowerCase() ||
        (w.english || '').trim().toLowerCase() === wordKey.toLowerCase());
      if (match && match.category) entry.category = match.category;
    }
    applySM2(entry, r.correct);
    updated++;
  }

  if (updated === 0) return res.status(400).json({ error: '没有有效的结果记录' });

  saveSRS(data).then(() => {
    const stats = buildSRSStats(playerData);
    res.json({ success: true, updated, stats });
  }).catch(err => res.status(500).json({ error: '保存失败: ' + err.message }));
});

// GET /api/players/:nickname/srs/due?limit=20  ->  words due for review today
app.get('/api/players/:nickname/srs/due', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) return res.status(400).json({ error: '昵称格式不合法' });
  if (!isAuthorizedCaller(req, nickname)) return res.status(401).json({ error: '请先登录' });

  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;

  const data = loadSRS();
  const playerData = data.players[nickname] || {};

  const due = [];
  for (const key of Object.keys(playerData)) {
    const entry = playerData[key];
    if (isDueToday(entry)) {
      due.push({
        wordId: key,
        english: entry.english || key,
        chinese: entry.chinese || '',
        difficulty: entry.difficulty || 1,
        ease: entry.ease,
        interval: entry.interval,
        repetitions: entry.repetitions,
        correct: entry.correct || 0,
        wrong: entry.wrong || 0,
        mastery: masteryScore(entry),
        nextReview: entry.nextReview || ''
      });
    }
  }
  // Sort by most overdue / weakest first
  due.sort((a, b) => {
    const aWeak = (a.wrong || 0) - (a.correct || 0);
    const bWeak = (b.wrong || 0) - (b.correct || 0);
    return bWeak - aWeak || a.interval - b.interval;
  });

  res.json({ due: due.slice(0, limit), totalDue: due.length });
});

// GET /api/players/:nickname/srs/stats  ->  SRS statistics for dashboard
app.get('/api/players/:nickname/srs/stats', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) return res.status(400).json({ error: '昵称格式不合法' });
  if (!isAuthorizedCaller(req, nickname)) return res.status(401).json({ error: '请先登录' });

  const data = loadSRS();
  const playerData = data.players[nickname] || {};
  const stats = buildSRSStats(playerData);

  // Category breakdown (requires vocabulary data)
  let categories = [];
  try {
    const vocab = loadVocabulary();
    const catMap = {};
    for (const key of Object.keys(playerData)) {
      const entry = playerData[key];
      const cat = entry.category || 'unknown';
      if (!catMap[cat]) catMap[cat] = { total: 0, mastered: 0, learning: 0, scoreSum: 0 };
      catMap[cat].total++;
      if (isMastered(entry)) catMap[cat].mastered++;
      else if (entry.repetitions > 0) catMap[cat].learning++;
      catMap[cat].scoreSum += masteryScore(entry);
    }
    categories = Object.entries(catMap).map(([cat, c]) => ({
      category: cat,
      total: c.total,
      mastered: c.mastered,
      learning: c.learning,
      avgScore: c.total > 0 ? Math.round(c.scoreSum / c.total) : 0
    })).sort((a, b) => b.total - a.total);
  } catch (e) { /* no vocab data */ }

  // Top 10 weakest words
  const weakest = [];
  for (const key of Object.keys(playerData)) {
    const entry = playerData[key];
    if (entry.wrong > 0) {
      weakest.push({
        wordId: key,
        english: entry.english || key,
        chinese: entry.chinese || '',
        correct: entry.correct || 0,
        wrong: entry.wrong || 0,
        mastery: masteryScore(entry)
      });
    }
  }
  weakest.sort((a, b) => b.wrong - a.wrong || a.mastery - b.mastery);

  res.json({
    stats,
    categories: categories.slice(0, 12),
    weakest: weakest.slice(0, 10)
  });
});

// Helper: compute aggregate SRS stats for a player's word data
function buildSRSStats(playerData) {
  const keys = Object.keys(playerData || {});
  let total = keys.length;
  let mastered = 0;
  let learning = 0;
  let dueToday = 0;
  let totalCorrect = 0;
  let totalWrong = 0;
  for (const key of keys) {
    const entry = playerData[key];
    totalCorrect += entry.correct || 0;
    totalWrong += entry.wrong || 0;
    if (isMastered(entry)) mastered++;
    else if (entry.repetitions > 0) learning++;
    if (isDueToday(entry)) dueToday++;
  }
  return {
    total,
    mastered,
    learning,
    newWords: total - mastered - learning,
    dueToday,
    totalCorrect,
    totalWrong,
    accuracy: totalCorrect + totalWrong > 0
      ? Math.round((totalCorrect / (totalCorrect + totalWrong)) * 100)
      : 0
  };
}

// GET /api/health  -> simple health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ---------------------------------------------------------------- leaderboard
// Ranks players by how many levels they have cleared. Cached in memory and
// invalidated by savePlayers(); only self-chosen nicknames and game stats
// are exposed (no credentials / no progress detail).

const LEADERBOARD_TTL = 30 * 1000;
const _leaderboardCache = { rows: null, at: 0 };

function invalidateLeaderboard() {
  _leaderboardCache.rows = null;
  _leaderboardCache.at = 0;
}

// Build the ranked rows (desc: cleared levels, then coins, then recency).
function buildLevelLeaderboard() {
  const players = loadPlayers().players;
  const rows = [];
  for (const nick of Object.keys(players)) {
    const p = players[nick];
    if (!p || !p.passwordHash) continue; // registered accounts only
    const cleared = Array.isArray(p.completedLevels) ? p.completedLevels.length : 0;
    const maxLevel = (typeof p.maxLevel === 'number' && Number.isFinite(p.maxLevel)) ? p.maxLevel : 1;
    rows.push({
      nickname: nick,
      cleared,
      world: worldOfLevel(Math.min(TOTAL_LEVELS, Math.max(1, maxLevel))),
      coins: (typeof p.coins === 'number' && Number.isFinite(p.coins)) ? p.coins : 0,
      lastPlayAt: typeof p.lastPlayAt === 'string' ? p.lastPlayAt : ''
    });
  }
  rows.sort((a, b) =>
    b.cleared - a.cleared ||
    b.coins - a.coins ||
    String(b.lastPlayAt).localeCompare(String(a.lastPlayAt)));
  return rows;
}

// GET /api/leaderboard/levels?limit=50&nickname=me -> rankings by cleared
// level count. `nickname` additionally returns that player's own row+rank
// (null when the name is unknown / not registered).
app.get('/api/leaderboard/levels', (req, res) => {
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50;

  if (!_leaderboardCache.rows || Date.now() - _leaderboardCache.at > LEADERBOARD_TTL) {
    _leaderboardCache.rows = buildLevelLeaderboard();
    _leaderboardCache.at = Date.now();
  }
  const rows = _leaderboardCache.rows;
  const entries = rows.slice(0, limit).map((r, i) => Object.assign({ rank: i + 1 }, r));

  let me = null;
  const nickname = typeof req.query.nickname === 'string' ? req.query.nickname.trim() : '';
  if (nickname && isValidNickname(nickname)) {
    const idx = rows.findIndex(r => r.nickname === nickname);
    if (idx >= 0) me = Object.assign({ rank: idx + 1 }, rows[idx]);
  }
  res.json({ total: rows.length, entries, me });
});

// ---------------------------------------------------------------- Player / Level API

// GET /api/players/:nickname  ->  fetch a player profile (requires registration
// AND a valid session token minted for that nickname). Without that gate any
// anonymous visitor could enumerate every player's progress, coins, and
// world state by guessing / scraping nicknames.
app.get('/api/players/:nickname', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) {
    return res.status(400).json({ error: '昵称格式不合法' });
  }

  // Caller must be authenticated (token must belong to the requested
  // nickname). Returning 401 (not 404) so a logged-in client knows it lost
  // its session.
  if (!isAuthorizedCaller(req, nickname)) {
    return res.status(401).json({ error: '请先登录' });
  }

  const data = loadPlayers();
  const player = data.players[nickname];

  // Check if player exists and is registered (has password hash)
  if (!player) {
    return res.status(404).json({ error: '玩家不存在' });
  }

  if (!player.passwordHash) {
    return res.status(404).json({ error: '该账号未注册' });
  }

  ensureShopFields(player);
  // Return player data without password hash
  const { passwordHash: _, ...playerWithoutPassword } = player;
  res.json(playerWithoutPassword);
});

// POST /api/players/:nickname/progress  ->  record a level result
app.post('/api/players/:nickname/progress', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) {
    return res.status(400).json({ error: '昵称格式不合法' });
  }
  const { level, won } = req.body || {};
  if (typeof level !== 'number' || !Number.isInteger(level) || level < 1 || level > TOTAL_LEVELS) {
    return res.status(400).json({ error: '关卡号不合法' });
  }
  if (typeof won !== 'boolean') {
    return res.status(400).json({ error: 'won 参数必须是布尔值' });
  }

  // Auth gate: caller must own the profile (valid session token for this
  // nickname). Without this, any client can rewrite another player's progress.
  if (!isAuthorizedCaller(req, nickname)) {
    return res.status(401).json({ error: '请先登录' });
  }

  // coinsEarned is NOT accepted from client - computed server-side
  const data = loadPlayers();
  const player = data.players[nickname];
  if (!player) return res.status(404).json({ error: '玩家不存在' });

  // Defensive: legacy/corrupt profiles might be missing these fields.
  if (!Array.isArray(player.completedLevels)) {
    player.completedLevels = [];
  } else {
    // Normalize entries to integers so includes() with a number argument
    // can never miss a string-typed entry (e.g. hand-edited players.json).
    player.completedLevels = player.completedLevels
      .map(Number)
      .filter(n => Number.isInteger(n) && n >= 1 && n <= TOTAL_LEVELS);
  }
  if (!Array.isArray(player.bossDefeated)) {
    player.bossDefeated = [];
  } else {
    player.bossDefeated = player.bossDefeated
      .map(Number)
      .filter(w => Number.isInteger(w) && w >= 1 && w <= WORLDS);
  }
  if (typeof player.coins !== 'number' || !Number.isFinite(player.coins)) player.coins = 0;
  if (typeof player.maxLevel !== 'number' || !Number.isFinite(player.maxLevel)) player.maxLevel = 1;
  if (typeof player.currentLevel !== 'number' || !Number.isFinite(player.currentLevel)) player.currentLevel = 1;

  if (won) {
    // Server-authoritative anti-cheat: only record a win for a level the UI
    // would actually let this player play. This stops a client from POSTing
    // "level 666 won" to skip ahead.
    // Note: maxLevel is the highest *next-unlocked* level (= max completed + 1),
    // not the highest played level, so the previous "level > maxLevel" fallback
    // was unsound (a player who has beaten high levels could re-claim any low
    // level for coins). The unlock check is the single source of truth.
    if (!isLevelUnlockedServer(level, player)) {
      return res.status(400).json({ error: '关卡尚未解锁，无法记录通关' });
    }
    // Replays of already-cleared levels are allowed (unlock check above), but
    // rewards are granted ONLY on the first clear — otherwise a client could
    // re-POST "level 1 won" forever and mint unlimited coins.
    const firstClear = !player.completedLevels.includes(level);
    if (firstClear) {
      player.completedLevels.push(level);
      // maxLevel is the next unlocked level = max completed + 1 (clamped so
      // beating the final level can't leave a 667 drifting around).
      player.maxLevel = Math.min(TOTAL_LEVELS, Math.max(player.maxLevel, level + 1));
      player.currentLevel = Math.min(player.maxLevel, TOTAL_LEVELS);
      // Compute reward server-side to prevent cheating
      const cfg = buildLevelConfig(level);
      player.coins += (cfg.reward && cfg.reward.coins) || 0;
      player.currentWorld = cfg.world;

      // Boss defeat?
      if (cfg.isBoss && cfg.world >= 1 && cfg.world <= WORLDS && !player.bossDefeated.includes(cfg.world)) {
        player.bossDefeated.push(cfg.world);
      }
    }
  }
  player.lastPlayAt = new Date().toISOString();
  savePlayers(data).then(() => {
    res.json({ success: true, player });
  }).catch(err => {
    res.status(500).json({ error: '保存失败: ' + err.message });
  });
});

// GET /api/shop  ->  public catalog (weapons + items). Prices and ownership
// are server-authoritative; browsing needs no auth, buying does.
app.get('/api/shop', (req, res) => {
  res.json({ weapons: SHOP_WEAPONS, items: SHOP_ITEMS, startingWeapon: STARTING_WEAPON });
});

// POST /api/players/:nickname/buy  ->  spend coins on a weapon or item.
app.post('/api/players/:nickname/buy', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) return res.status(400).json({ error: '昵称格式不合法' });
  if (!isAuthorizedCaller(req, nickname)) return res.status(401).json({ error: '请先登录' });

  const itemId = (req.body && req.body.itemId) || '';
  const found = findShopItem(itemId);
  if (!found) return res.status(400).json({ error: '商品不存在' });

  const data = loadPlayers();
  const player = data.players[nickname];
  if (!player) return res.status(404).json({ error: '玩家不存在' });
  ensureShopFields(player);
  if (typeof player.coins !== 'number' || !Number.isFinite(player.coins)) player.coins = 0;

  const { kind, item } = found;
  if (kind === 'weapon' && player.inventory.weapons.includes(item.id)) {
    return res.status(409).json({ error: '已拥有该武器' });
  }
  if (player.coins < item.price) {
    return res.status(400).json({ error: '金币不足' });
  }

  player.coins -= item.price;
  if (kind === 'weapon') {
    player.inventory.weapons.push(item.id);
  } else {
    const n = Number(player.inventory.items[item.id]) || 0;
    player.inventory.items[item.id] = Math.min(999, n + 1);
  }
  player.lastPlayAt = new Date().toISOString();
  savePlayers(data).then(() => {
    const { passwordHash: _, ...p } = player;
    res.json({ success: true, player: p });
  }).catch(err => res.status(500).json({ error: '保存失败: ' + err.message }));
});

// POST /api/players/:nickname/equip  ->  switch the equipped weapon.
app.post('/api/players/:nickname/equip', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) return res.status(400).json({ error: '昵称格式不合法' });
  if (!isAuthorizedCaller(req, nickname)) return res.status(401).json({ error: '请先登录' });

  const weaponId = (req.body && req.body.weaponId) || '';
  const data = loadPlayers();
  const player = data.players[nickname];
  if (!player) return res.status(404).json({ error: '玩家不存在' });
  ensureShopFields(player);
  if (!player.inventory.weapons.includes(weaponId)) {
    return res.status(400).json({ error: '尚未拥有该武器' });
  }
  player.equippedWeapon = weaponId;
  player.lastPlayAt = new Date().toISOString();
  savePlayers(data).then(() => {
    const { passwordHash: _, ...p } = player;
    res.json({ success: true, player: p });
  }).catch(err => res.status(500).json({ error: '保存失败: ' + err.message }));
});

// POST /api/players/:nickname/use-item  ->  consume one consumable. The game
// applies the effect client-side; this endpoint persists the decrement.
app.post('/api/players/:nickname/use-item', (req, res) => {
  const nickname = (req.params.nickname || '').trim();
  if (!isValidNickname(nickname)) return res.status(400).json({ error: '昵称格式不合法' });
  if (!isAuthorizedCaller(req, nickname)) return res.status(401).json({ error: '请先登录' });

  const itemId = (req.body && req.body.itemId) || '';
  const found = findShopItem(itemId);
  if (!found || found.kind !== 'item') return res.status(400).json({ error: '道具不存在' });

  const data = loadPlayers();
  const player = data.players[nickname];
  if (!player) return res.status(404).json({ error: '玩家不存在' });
  ensureShopFields(player);
  const count = Number(player.inventory.items[itemId]) || 0;
  if (count <= 0) return res.status(400).json({ error: '道具数量不足' });
  player.inventory.items[itemId] = count - 1;
  player.lastPlayAt = new Date().toISOString();
  savePlayers(data).then(() => {
    const { passwordHash: _, ...p } = player;
    res.json({ success: true, player: p });
  }).catch(err => res.status(500).json({ error: '保存失败: ' + err.message }));
});

// GET /api/levels/:id  ->  configuration for a specific level
app.get('/api/levels/:id', (req, res) => {
  // Require a pure digit string: parseInt would silently accept "1abc", "1e2"
  // or "1.5" and return the wrong level's config.
  const idRaw = String(req.params.id || '');
  if (!/^\d{1,3}$/.test(idRaw)) {
    return res.status(400).json({ error: '关卡号必须在 1-' + TOTAL_LEVELS + ' 之间' });
  }
  const levelNum = parseInt(idRaw, 10);
  if (levelNum < 1 || levelNum > TOTAL_LEVELS) {
    return res.status(400).json({ error: '关卡号必须在 1-' + TOTAL_LEVELS + ' 之间' });
  }
  res.json(buildLevelConfig(levelNum));
});

// GET /api/levels  ->  metadata for all 666 levels (lightweight; ~5KB)
app.get('/api/levels', (req, res) => {
  const list = [];
  for (let i = 1; i <= TOTAL_LEVELS; i++) {
    const c = buildLevelConfig(i);
    list.push({
      level: c.level,
      world: c.world,
      isBoss: c.isBoss,
      difficulty: c.difficulty,
      monsterType: c.monsterType
    });
  }
  res.json({ totalLevels: TOTAL_LEVELS, worlds: WORLDS, levels: list });
});

// POST /api/register  ->  register a new player account
app.post('/api/register', (req, res) => {
  const { nickname, password, age } = req.body || {};

  // Validate nickname
  if (!isValidNickname(nickname)) {
    return res.status(400).json({ error: '昵称格式不合法' });
  }

  // Validate password: 6-64 chars, matching the frontend's PASSWORD_MAX so
  // a password the UI would never let you type can't be stored either.
  if (typeof password !== 'string' || password.length < 6 || password.length > 64) {
    return res.status(400).json({ error: '密码长度必须为 6-64 位' });
  }

  // Validate age: must be EXACTLY one of the allowed values (number or 'adult').
  // Reject missing / null / out-of-range rather than silently defaulting,
  // otherwise a bug in the client could lock a player into the wrong bucket
  // with no way to tell from the API.
  if (age !== 'adult' && (typeof age !== 'number' || !Number.isInteger(age) || !VALID_AGE_GROUPS.includes(age))) {
    return res.status(400).json({ error: '年龄段不合法' });
  }

  const data = loadPlayers();
  const trimmedName = nickname.trim();

  // Check if nickname already exists.
  const existing = data.players[trimmedName];
  if (existing) {
    if (existing.passwordHash) {
      return res.status(409).json({ error: '该昵称已被注册' });
    }
    // Legacy profile (created before accounts existed, so no password yet):
    // let the player claim it by setting a password. Keep all progress,
    // coins and skills — only add the credential. Without this, legacy
    // players are permanently locked out of both login and register.
    existing.passwordHash = hashPassword(password);
    if (!Array.isArray(existing.completedLevels)) {
      existing.completedLevels = [];
    } else {
      existing.completedLevels = existing.completedLevels
        .map(Number)
        .filter(n => Number.isInteger(n) && n >= 1 && n <= TOTAL_LEVELS);
    }
    if (!Array.isArray(existing.bossDefeated)) {
      existing.bossDefeated = [];
    } else {
      existing.bossDefeated = existing.bossDefeated
        .map(Number)
        .filter(w => Number.isInteger(w) && w >= 1 && w <= WORLDS);
    }
    if (typeof existing.coins !== 'number' || !Number.isFinite(existing.coins)) existing.coins = 50;
    if (typeof existing.maxLevel !== 'number' || !Number.isFinite(existing.maxLevel)) existing.maxLevel = 1;
    if (typeof existing.currentLevel !== 'number' || !Number.isFinite(existing.currentLevel)) existing.currentLevel = 1;
    if (!existing.skills || typeof existing.skills !== 'object') existing.skills = { hint: 3, shield: 2, crit: 2 };
    ensureShopFields(existing);
    existing.lastPlayAt = new Date().toISOString();
    savePlayers(data).then(() => {
      // Return player data without password hash, plus a session token
      const { passwordHash: _, ...playerWithoutPassword } = existing;
      res.status(201).json({ success: true, token: createSessionToken(trimmedName), player: playerWithoutPassword });
    }).catch(err => {
      res.status(500).json({ error: '注册失败: ' + err.message });
    });
    return;
  }

  // Hard cap so a scripted flood of nicknames can't grow the store forever
  if (Object.keys(data.players).length >= MAX_PLAYERS) {
    return res.status(503).json({ error: '玩家数量已达上限，暂时无法注册' });
  }

  // Hash password with a fresh per-user salt.
  const passwordHash = hashPassword(password);
  
  // Create new player with password hash
  const newPlayer = createDefaultPlayer(trimmedName, age);
  newPlayer.passwordHash = passwordHash;
  newPlayer.createdAt = new Date().toISOString();
  newPlayer.lastPlayAt = new Date().toISOString();
  
  data.players[trimmedName] = newPlayer;

  savePlayers(data).then(() => {
    // Return player data without password hash, plus a session token
    const { passwordHash: _, ...playerWithoutPassword } = newPlayer;
    res.status(201).json({ success: true, token: createSessionToken(trimmedName), player: playerWithoutPassword });
  }).catch(err => {
    res.status(500).json({ error: '注册失败: ' + err.message });
  });
});

// POST /api/login  ->  login with nickname and password
app.post('/api/login', (req, res) => {
  const { nickname, password } = req.body || {};

  // Validate nickname
  if (!isValidNickname(nickname)) {
    return res.status(400).json({ error: '昵称格式不合法' });
  }

  // Validate password
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: '密码不能为空' });
  }

  const data = loadPlayers();
  const trimmedName = nickname.trim();
  const player = data.players[trimmedName];

  // SECURITY: collapse every "credential wrong" case to the SAME error
  // message, with the SAME timing, so an attacker can't tell from the
  // response whether the nickname is registered, has no password yet
  // (legacy profile), or simply had the wrong password. When the user
  // doesn't exist we still burn exactly one KDF call (against a constant
  // dummy hash) so all branches cost the same CPU — but the dummy
  // comparison result is discarded; only a real stored hash can verify.
  const dummyHash = hashPassword(password, '0'.repeat(32));
  const stored = (player && typeof player.passwordHash === 'string') ? player.passwordHash : null;
  const ok = stored ? verifyPassword(password, stored)
                    : (verifyPassword(password, dummyHash), false);
  if (!ok) {
    return res.status(401).json({ error: '昵称或密码错误' });
  }

  // Migrate legacy password hashes (v1 unsalted / v2 salted SHA-256) to
  // scrypt in place on the first successful login.
  if (!stored.startsWith('scrypt:')) {
    player.passwordHash = hashPassword(password);
  }

  ensureShopFields(player);
  // Update last play time
  player.lastPlayAt = new Date().toISOString();
  savePlayers(data).then(() => {
    // Return player data without password hash, plus a fresh session token
    const { passwordHash: _, ...playerWithoutPassword } = player;
    res.json({ success: true, token: createSessionToken(trimmedName), player: playerWithoutPassword });
  }).catch(err => {
    res.status(500).json({ error: '登录失败: ' + err.message });
  });
});

// Unmatched /api routes get a JSON 404, so a typo'd API path doesn't
// silently return the SPA HTML.
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// SPA fallback: any non-API GET route returns index.html
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Final error handler: never leak stack traces or internal paths (e.g. a
// malformed JSON body must not echo body-parser internals).
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('Unhandled error:', err);
  res.status(status).json({
    error: status >= 500 ? '服务器内部错误' : '请求无效'
  });
});

// ---------------------------------------------------------------- start

// Default to loopback: nginx (deploy/nginx.conf) proxies public traffic to
// 127.0.0.1:3000. Set HOST=0.0.0.0 to expose directly on the network.
// The realtime multiplayer server shares this port via HTTP upgrade (/ws).
const httpServer = http.createServer(app);
attachRealtime(httpServer, {
  verifySessionToken,
  buildLevelConfig,
  loadVocabulary,
  TOTAL_LEVELS
});
httpServer.listen(PORT, HOST, () => {
  console.log(`\n🎮  Kids English Learning Game`);
  console.log(`   Listening on http://${HOST}:${PORT}`);
  console.log(`   Multiplayer (WebSocket) on ws://${HOST}:${PORT}/ws\n`);
});
