// game.js - Core game loop, scene/state management
(function () {
  'use strict';

  const GameState = {
    TITLE: 'title',
    LEVEL_INTRO: 'level_intro',
    PLAYING: 'playing',
    PAUSED_QUESTION: 'paused_question',
    WIN: 'win',
    LOSE: 'lose'
  };

  class Game {
    constructor() {
      this.canvas = document.getElementById('game-canvas');
      this.ctx = this.canvas.getContext('2d');
      this.fxCanvas = document.getElementById('fx-canvas');
      this.fx = new ParticleSystem(this.fxCanvas);

      this.input = new Input();
      this.state = GameState.TITLE;

      // Save data
      this.playerName = '';
      this.ageGroup = 7;
      this.hp = 3;
      this.maxHp = 3;
      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.captured = 0;
      this.coins = 0;
      this.equippedWeapon = 'wooden';
      this.items = {};              // consumable counts { id: n }
      this.inventory = { weapons: ['wooden'], items: {} };
      this.shieldTime = 0;          // ms of invulnerability shield remaining
      this.vocabulary = null;
      this.words = [];

      // Level state
      this.currentLevel = null;       // {level, world, target, ...}
      this.currentLevelNum = 1;
      this._levelGen = 0;            // increments on each level start; guards stale async results
      this.maxUnlocked = 1;
      this.world = null;
      this.player = null;
      this.monsters = [];
      this.coinList = [];
      this.bullets = [];          // player bullets (world space)
      this.enemyProjectiles = []; // monster fireballs (world space)
      this.fireCooldown = 0;      // ms until the player can fire again
      this.ammo = 0;              // remaining bullets this level (limited)
      this.timeRemaining = 0;
      this.lastTime = 0;
      this.camera = { x: 0, y: 0 };

      // Pause flag (so PAUSED_QUESTION doesn't update gameplay)
      this.paused = false;

      // Pause flag set by external modals (login/register). Lets us
      // resume cleanly when the modal closes, even if other state changed.
      this._modalPause = false;

      // For initial question
      this.activeMonster = null;

      // Review-level word pool (wrong-word book); null on normal levels.
      this._reviewWords = null;

      // SRS tracking: accumulate word results during the level for batch upload
      this._srsWords = {};  // { wordId: { english, chinese, difficulty, correct, wrong } }

      // Multiplayer (versus race) state. In net mode the server owns the
      // spawns / engagement locks / answer verdicts / match end; this loop
      // only simulates the local view and relays events.
      this.netMode = false;
      this.myNetId = null;
      this.remotePlayers = new Map();  // netId -> {player, name, color, tx, ty, facing}
      this.mpCounts = new Map();       // netId -> captures (for the HUD bar)
      this._mpKnockedOut = false;
      this._bindNet();

      // Pending delayed endLevel() timers (capture-win / hp-0). Tracked so
      // they can be cancelled on level restart and cleaned up on resolve.
      this._pendingEndTimers = [];

      this._resize();
      this._resizeHandler = () => this._resize();
      window.addEventListener('resize', this._resizeHandler);

      // Show joystick on mobile
      if (this.input.isMobile()) this.input.showJoystick();

      // In-game consumable item bar (delegated click → useItem).
      const itemBar = document.getElementById('item-bar');
      if (itemBar && !itemBar.dataset.wired) {
        itemBar.addEventListener('click', (e) => {
          const btn = e.target.closest('.item-btn');
          if (btn && btn.dataset.itemId) this.useItem(btn.dataset.itemId);
        });
        itemBar.dataset.wired = '1';
      }

      // Game loop
      this._rafId = requestAnimationFrame((t) => this._loop(t));
    }

    // Clean up event listeners and timers. The game is a singleton in normal
    // use, but this provides a safe teardown for tests and SPA navigation.
    destroy() {
      if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
      if (this._resizeHandler) {
        window.removeEventListener('resize', this._resizeHandler);
        this._resizeHandler = null;
      }
      this._cancelPendingEnds();
      this.monsters.forEach(m => { if (m && m.cleanup) m.cleanup(); });
      this.monsters = [];
      this.bullets = [];
      this.enemyProjectiles = [];
      this.coinList = [];
      this.remotePlayers = new Map();
      this.player = null;
    }

    _resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.viewW = w;
      this.viewH = h;
      // If a world already exists, expand it to keep filling the viewport.
      // Versus keeps the fixed 1440x720 arena (shared coordinate space);
      // the camera centers a smaller world in a larger viewport anyway.
      if (this.world) {
        if (!this.netMode) this.world.resize(w, h);
        // Re-clamp player into the new bounds
        if (this.player) {
          this.player.x = Utils.clamp(this.player.x, 24, this.world.width  - 24);
          this.player.y = Utils.clamp(this.player.y, 24, this.world.height - 24);
        }
      }
    }

    // ---------- Scene management ----------

    showScreen(id) {
      ['screen-title', 'screen-level-intro', 'screen-win', 'screen-lose'].forEach(s => {
        document.getElementById(s).classList.toggle('hidden', s !== id);
      });
      this.canvas.style.display = (id === null) ? 'block' : 'none';
      document.getElementById('hud').classList.toggle('hidden', id !== null);
    }

    showHUD(show) {
      document.getElementById('hud').classList.toggle('hidden', !show);
    }

    // Track whether game is paused by an external modal (e.g. login/register).
    // Distinct from the question-modal pause so we can resume cleanly when the
    // user closes the auth modal.
    pauseForModal() {
      const wasPlaying = this.state === GameState.PLAYING;
      if (wasPlaying) {
        this._modalPause = true;
        this.paused = true;
        // Clear input axes so the player doesn't keep moving once we resume
        if (this.input && this.input.setLocked) {
          this.input.setLocked(true);
        }
      }
      return wasPlaying;
    }

    // Resume a game that was paused by pauseForModal(). Safe to call when
    // the game wasn't paused by us.
    resumeFromModal() {
      if (this._modalPause) {
        this._modalPause = false;
        // Only resume gameplay if the level is still actually running.
        // endLevel() can resolve the level while the auth modal is open
        // (a pending 600ms capture/HP timer fires regardless), and
        // unconditionally forcing PLAYING here would resurrect a finished
        // level behind the result screen.
        if (this.state === GameState.PLAYING) {
          this.paused = false;
          if (this.input && this.input.setLocked) {
            this.input.setLocked(false);
          }
        }
      }
    }

    isModalPaused() { return this._modalPause; }

    // ---------- Save / Load ----------

    saveKey() {
      return 'wordhunter:save:' + (this.playerName || 'guest');
    }

    loadSave() {
      try {
        const raw = localStorage.getItem(this.saveKey());
        if (!raw) return null;
        return JSON.parse(raw);
      } catch (e) { return null; }
    }

    persistSave() {
      const data = {
        name: this.playerName,
        age: this.ageGroup,
        maxUnlocked: this.maxUnlocked,
        bestScore: Math.max(this.score, 0),
        lastPlayed: Date.now()
      };
      try { localStorage.setItem(this.saveKey(), JSON.stringify(data)); } catch (e) {}
    }

    // ---------- Game lifecycle ----------

    async startLevel(num) {
      this.currentLevelNum = num;
      this._levelGen = (this._levelGen || 0) + 1;
      // Solo run: leave any versus state behind.
      this.netMode = false;
      this.myNetId = null;
      this.remotePlayers = new Map();
      this.mpCounts = new Map();
      this._mpKnockedOut = false;
      this._updateMpHud();
      // Cancel any delayed endLevel() from the previous run so it can't
      // resolve the new level. Also drop any lingering question modal and
      // stale engagement bookkeeping.
      this._cancelPendingEnds();
      const staleModal = document.getElementById('question-modal');
      if (staleModal) staleModal.classList.add('hidden');
      this.activeMonster = null;
      // The title start button normally preloads the vocabulary, but the
      // map entry (and any direct start) can begin a level on a fresh page
      // where this.words is still empty — without this the level spawns
      // zero monsters. Same guard the net-mode path uses.
      if (!this.words || this.words.length === 0) {
        try {
          this.vocabulary = await API.getVocabulary();
          this.words = (this.vocabulary && this.vocabulary.words) || [];
        } catch (e) {
          this.vocabulary = null;
          this.words = [];
          // Questions still work with the static fallback distractors.
        }
      }
      // Make sure /api/levels has been fetched at least once. If the
      // network is down we still fall back to the sync `getLevel` path
      // which generates reasonable defaults.
      try { await Levels.loadAll(); } catch (e) { /* offline ok */ }
      // Pull the full per-level config (HP, monsterName, reward) from
      // the server; this also gives us the most up-to-date difficulty.
      const baseLevel = Levels.getLevel(num);
      try {
        const full = await Levels.getLevelAsync(num);
        this.currentLevel = { ...baseLevel, ...full };
      } catch (e) {
        this.currentLevel = baseLevel;
        // Ensure critical fields exist even in offline mode
        if (!this.currentLevel.monsterHP) this.currentLevel.monsterHP = baseLevel.difficulty || 1;
        if (!this.currentLevel.monsterName) this.currentLevel.monsterName = (Levels.getWorld(baseLevel.world) || {}).name || '小怪';
        if (!this.currentLevel.isBoss) this.currentLevel.isBoss = false;
        if (!this.currentLevel.reward) this.currentLevel.reward = 0;
      }
      const worldDef = Levels.getWorld(this.currentLevel.world);
      this._reviewWords = null; // leaving any review level behind
      // Boss levels are a duel: ONE oversized, hyper-aggressive boss and a
      // translation challenge instead of the usual capture-a-bunch flow.
      if (this.currentLevel.isBoss && !this.netMode) {
        this.currentLevel.target = 1;
        this.currentLevel.monsterCount = 1;
        // Translating ~50 chars needs time; never below 150s.
        this.currentLevel.timeLimit = Math.max(this.currentLevel.timeLimit || 60, 150);
      }
      // Ensure view dimensions are initialized
      if (this.viewW === undefined) this._resize();
      this.world = new World(worldDef, this.currentLevel, this.viewW, this.viewH);

      // Reset state
      this.hp = this.maxHp;
      this.shieldTime = 0;
      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.captured = 0;
      this.timeRemaining = this.currentLevel.timeLimit;
      this._lowTimeWarned = false;
      // Clear existing entities to prevent memory leaks
      this.monsters.forEach(m => { if (m.cleanup) m.cleanup(); });
      this.monsters = [];
      this.coinList.forEach(c => { if (c.cleanup) c.cleanup(); });
      this.coinList = [];
      this.bullets = [];
      this.enemyProjectiles = [];
      this.fireCooldown = 0;
      // Limited ammo: enough bullets to capture the target plus a small
      // margin for wrong answers. Running dry before the target = lose.
      // Boss duels give generous ammo — the translation can take several
      // attempts and the boss must stay shootable the whole fight.
      this.ammo = (this.currentLevel.isBoss ? 30 : this.currentLevel.target + 5) +
        (this._weaponStats().ammoBonus || 0);
      this.player = new Player(this.world.width / 2, this.world.groundY - 60);
      this.paused = false;

      // Spawn monsters. Guard against an empty word pool: spawnMonsters()
      // would create monsters with word === undefined, and the first
      // render of such a monster throws (m.word.english), killing the
      // whole rAF loop.
      const eligible = this._eligibleWords();
      if (this.currentLevel.isBoss && !this.netMode) {
        // Boss duel: exactly one giant aggressive boss in the arena center.
        const word = (eligible.length > 0 && Utils.randItem(eligible)) ||
          { id: 'boss', english: 'BOSS', chinese: '大王', difficulty: this.currentLevel.difficulty || 1 };
        this.monsters = [new Monster(
          this.world.width / 2 + Utils.randInt(-80, 80),
          this.world.height / 2 + Utils.randInt(-40, 40),
          word, 'aggressive',
          Math.max(1.1, this.currentLevel.monsterSpeed || 1.2),
          1.8
        )];
        // Boss HP: 5 hp per hit, scaled so higher-level bosses are tougher.
        // Each correct vocabulary answer chips 1 HP; the essay translation
        // is the finishing blow after HP reaches 0.
        const bossHP = Math.min(10, Math.max(3, Math.floor((this.currentLevel.monsterHP || 90) / 18)));
        this.monsters[0].hp = bossHP;
        this.monsters[0].maxHp = bossHP;
        this._nudgeAwayFromPlayer(this.monsters);
      } else {
        this.monsters = eligible.length > 0
          ? spawnMonsters(eligible, this.currentLevel.monsterCount, this.currentLevel.monsterSpeed, this.world.width, this.world.height, this._monsterScale())
          : [];
      }

      // Show level intro
      this._showLevelIntro();
    }

    // Review level over the wrong-word book (错词本). Spawns exactly the
    // due words — one monster each — as a normal playable level whose
    // answers feed the spaced-repetition scheduler in wrongbook.js.
    // Resolves true when the review level started (false = nothing due).
    async startReviewLevel() {
      const due = (window.WrongBook && WrongBook.dueWords(10)) || [];
      if (!due.length) {
        Utils.toast('暂无需要复习的错词，先去闯关吧！');
        return false;
      }
      // Leave any versus state behind (mirrors startLevel()).
      this.netMode = false;
      this.myNetId = null;
      this.remotePlayers = new Map();
      this.mpCounts = new Map();
      this._mpKnockedOut = false;
      this._updateMpHud();
      this._cancelPendingEnds();
      const staleModal = document.getElementById('question-modal');
      if (staleModal) staleModal.classList.add('hidden');
      this.activeMonster = null;

      // Review questions want a distractor pool; on a fresh page the
      // vocabulary may not be loaded yet (same guard as startLevel).
      if (!this.words || this.words.length === 0) {
        try {
          this.vocabulary = await API.getVocabulary();
          this.words = (this.vocabulary && this.vocabulary.words) || [];
        } catch (e) {
          this.vocabulary = null;
          this.words = [];
        }
      }

      const maxD = due.reduce((m, w) => Math.max(m, Number(w.difficulty) || 1), 1);
      const cfg = {
        level: 0,
        world: 1,
        isReview: true,
        difficulty: maxD,
        monsterHP: 3,
        monsterName: '错词小怪',
        monsterCount: due.length,
        monsterSpeed: 1.2,
        target: due.length,
        timeLimit: 60 + due.length * 12,
        reward: { coins: 0, xp: 0 },
        isBoss: false
      };
      this.currentLevelNum = 0;
      this._levelGen = (this._levelGen || 0) + 1;
      this.currentLevel = cfg;
      this._reviewWords = due;

      const worldDef = Levels.getWorld(cfg.world);
      if (this.viewW === undefined) this._resize();
      this.world = new World(worldDef, cfg, this.viewW, this.viewH);
      this.hp = this.maxHp;
      this.shieldTime = 0;
      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.captured = 0;
      this.timeRemaining = cfg.timeLimit;
      this._lowTimeWarned = false;
      this.monsters.forEach(m => { if (m.cleanup) m.cleanup(); });
      this.monsters = [];
      this.coinList = [];
      this.bullets = [];
      this.enemyProjectiles = [];
      this.fireCooldown = 0;
      this.ammo = cfg.target + 5 + (this._weaponStats().ammoBonus || 0);
      this.player = new Player(this.world.width / 2, this.world.groundY - 60);
      this.paused = false;
      // spawnMonsters() samples words WITH replacement; overwrite each
      // monster's word so every due word appears exactly once.
      this.monsters = spawnMonsters(due, due.length, cfg.monsterSpeed, this.world.width, this.world.height, this._monsterScale());
      this.monsters.forEach((m, i) => { m.word = due[i % due.length]; });
      this._showLevelIntro();
      return true;
    }

    _showLevelIntro() {
      this.state = GameState.LEVEL_INTRO;
      const worldDef = Levels.getWorld(this.currentLevel.world);
      const cfg = this.currentLevel;
      const isReview = !!cfg.isReview;
      document.getElementById('level-intro-emoji').textContent = isReview ? '📕' : (cfg.isBoss ? '👑' : (worldDef ? worldDef.emoji : '🌲'));
      document.getElementById('level-intro-num').textContent = isReview
        ? '错词复习'
        : `第 ${this.currentLevelNum} 关${cfg.isBoss ? ' 👑BOSS' : ''}`;
      document.getElementById('level-intro-name').textContent = isReview
        ? '错词小怪出没！'
        : (cfg.monsterName || (worldDef ? worldDef.name : '神秘关卡'));
      document.getElementById('level-intro-goal').textContent = isReview
        ? `复习 ${cfg.target} 个易错单词 (${cfg.timeLimit}秒)`
        : cfg.isBoss
          ? `答对单词削减 Boss 血量，最后翻译小作文致命一击！(${cfg.timeLimit}秒)`
          : `难度 d${cfg.difficulty} · 捕获 ${cfg.target} 只小怪 (${cfg.timeLimit}秒)`;
      Utils.playBeep(cfg.isBoss ? 'boss' : 'click');
      this.showScreen('screen-level-intro');
    }

    beginPlay() {
      this.showScreen(null);
      this.showHUD(true);
      this._updateHUD();
      this._renderItemBar();
      this._updateMpHud();
      this.state = GameState.PLAYING;
      if (window.Sound && Sound.playBgm) {
        Sound.playBgm((this.currentLevel && this.currentLevel.isBoss) ? 'boss' : 'level');
      }
      Utils.playBeep('click');
    }

    // Schedule a delayed endLevel (e.g. let the capture animation play
    // out). All pending timers are tracked so a level restart can cancel
    // them and endLevel() can clear any remaining ones.
    _scheduleEndLevel(won, delay) {
      // Cancel any previously scheduled end to avoid timer pile-up when
      // multiple end conditions fire in quick succession (e.g. boss win
      // followed by a lingering fireball hitting the player).
      this._cancelPendingEnds();
      const id = setTimeout(() => {
        this._pendingEndTimers = this._pendingEndTimers.filter(t => t !== id);
        this.endLevel(won);
      }, delay);
      this._pendingEndTimers.push(id);
    }

    _cancelPendingEnds() {
      for (const id of this._pendingEndTimers) clearTimeout(id);
      this._pendingEndTimers = [];
    }

    async endLevel(won) {
      // Re-entrancy guard. endLevel can be triggered from several sources
      // in quick succession (capture-target reached, HP 0, countdown) and
      // the 600ms delays mean a second call can land after the first one
      // already resolved the level. Ignore any call once the level is over
      // or hasn't started (a stale timer firing across a level restart).
      // Also bail out if a question is still in progress (PAUSED_QUESTION)
      // — the question's settle handler will trigger endLevel afterwards.
      if (this.state === GameState.WIN || this.state === GameState.LOSE ||
          this.state === GameState.TITLE || this.state === GameState.LEVEL_INTRO ||
          this.state === GameState.PAUSED_QUESTION) {
        return;
      }

      this._cancelPendingEnds();
      this.paused = true;
      this.showHUD(false);
      const itemBar = document.getElementById('item-bar');
      if (itemBar) itemBar.classList.add('hidden');
      this.state = won ? GameState.WIN : GameState.LOSE;
      this.activeMonster = null;
      // Clear the stage music so the win/lose jingle plays by itself.
      if (window.Sound && Sound.stopBgm) Sound.stopBgm();

      // endLevel can fire while a question modal is still open (the 600ms
      // capture timer outlives a follow-up collision). Hide it so it
      // doesn't sit on top of the result screen.
      const qm = document.getElementById('question-modal');
      if (qm) qm.classList.add('hidden');

      // Unlock next level + persist locally (sync, before any network I/O).
      // Review levels have no level number to unlock and nothing to persist.
      if (won && !(this.currentLevel && this.currentLevel.isReview)) {
        const cap = Levels.TOTAL_LEVELS;
        this.maxUnlocked = Math.max(this.maxUnlocked, Math.min(cap, this.currentLevelNum + 1));
        this.maxUnlocked = Math.min(this.maxUnlocked, cap);
        this.persistSave();
      }

      // Star rating + result screen. Build the screen FIRST so slow
      // network submissions below can never leave the player staring at a
      // frozen playfield for up to the API timeout (30s each).
      const stars = won ? this._calcStars() : '☆☆☆';
      document.getElementById('result-stars').textContent = stars;
      document.getElementById('result-score').textContent = this.score;
      document.getElementById('result-captured').textContent = this.captured;
      document.getElementById('result-combo').textContent = 'x' + this.maxCombo;
      const rewardCoins = (this.currentLevel.reward && this.currentLevel.reward.coins) || 0;
      const resultCoinsEl = document.getElementById('result-coins');
      if (resultCoinsEl) resultCoinsEl.textContent = won ? '+' + rewardCoins : '0';
      document.getElementById('result-score-lose').textContent = this.score;
      document.getElementById('result-captured-lose').textContent = this.captured;
      this.showScreen(won ? 'screen-win' : 'screen-lose');
      if (won) Utils.playBeep(this.currentLevel.isBoss ? 'bossDown' : 'win');
      else Utils.playBeep('lose');

      // Review levels are a local study aid: no level to unlock, no server
      // progress / score rows (level 0 isn't a real level), no reward coins.
      // Instead, re-label the result buttons for another review round and
      // refresh the badge.
      if (this.currentLevel.isReview) {
        const nextBtn = document.getElementById('btn-next-level');
        if (nextBtn) nextBtn.classList.add('hidden');
        const replayBtn = document.getElementById('btn-replay');
        if (replayBtn) replayBtn.textContent = '再复习一轮';
        document.querySelector('#screen-win h2').textContent = '复习完成!';
        if (window.WrongBook) WrongBook.refreshBadge();
        return;
      }
      // Restore the normal result-screen labels after any review run.
      const nextBtn = document.getElementById('btn-next-level');
      if (nextBtn) nextBtn.classList.remove('hidden');
      const replayBtn = document.getElementById('btn-replay');
      if (replayBtn) replayBtn.textContent = '重玩';
      document.querySelector('#screen-win h2').textContent = '关卡完成!';

      // Time actually spent in the level (for the parent report). Clamped:
      // the countdown can overshoot slightly on laggy frames and a stuck
      // tab must not report hours.
      const playSec = Math.round(Math.min(600, Math.max(5,
        (this.currentLevel.timeLimit || 60) - this.timeRemaining)));

      // Backend submissions (best-effort, after the screen is up).
      // Submit a score record for EVERY finished session (win or lose) so
      // the parent learning report gets a complete picture — every session
      // row, accuracy trend, play time, and play-days count.
      // Progress (unlock + coins) is submitted separately for wins only
      // and requires auth; score records work for guests too.
      const gen = this._levelGen; // guard against stale async results after level restart
      const submissionKey = `submitted_level_${this.currentLevelNum}_${this.playerName || 'guest'}`;
      if (!sessionStorage.getItem(submissionKey)) {
        let submitted = false;
        // Always submit a score row so the report sees every session.
        try {
          await API.submitScore({
            nickname: this.playerName, score: this.score, ageGroup: this.ageGroup,
            gameMode: 'word-hunter', category: 'mixed',
            roundsPlayed: this.captured, correctCount: this.captured,
            playSec, won
          });
          submitted = true;
        } catch (e) { /* offline ok */ }
        if (won) {
          try {
            const prog = await API.submitProgress(this.playerName, {
              level: this.currentLevelNum, won: true, correctCount: this.captured, totalRounds: this.captured
            });
            if (prog && prog.player) {
              if (this._levelGen !== gen) return; // a new level started while we were waiting
              // The server returns the authoritative profile; sync coins AND
              // shop state (equipped weapon / consumable counts) so item use
              // in one level is reflected in the next without reopening the shop.
              if (typeof prog.player.coins === 'number') {
                this.coins = prog.player.coins;
                if (window.ShopModule && typeof window.ShopModule.setCoins === 'function') {
                  window.ShopModule.setCoins(this.coins);
                }
              }
              if (window.ShopModule && typeof window.ShopModule.syncToGame === 'function') {
                window.ShopModule.syncToGame(prog.player);
              }
            }
            submitted = true;
          } catch (e) { /* offline ok */ }
        }
        if (submitted) {
          try { sessionStorage.setItem(submissionKey, 'true'); } catch (e) {}
        }
      }

      // Nudge toward the wrong-word book once a review batch is ready.
      if (window.WrongBook && !this.netMode) {
        const due = WrongBook.stats().due;
        if (due >= WrongBook.REVIEW_HINT_THRESHOLD) {
          Utils.toast('📕 错词本里有 ' + due + ' 个单词待复习！');
        }
      }

      // Upload SRS batch to the server (best-effort, fire-and-forget).
      this._uploadSRS();
    }

    // Send this level's accumulated word results to the server SRS store.
    // Only logged-in players have an SRS account; guests skip silently.
    _uploadSRS() {
      const keys = Object.keys(this._srsWords);
      if (!keys.length || this.netMode) { this._srsWords = {}; return; }
      const reg = window.RegisterModule;
      const logged = reg && typeof reg.getNickname === 'function' ? (reg.getNickname() || '') : '';
      if (!logged) { this._srsWords = {}; return; }
      const results = keys.map(k => {
        const w = this._srsWords[k];
        // Send one row per word: correct if answered correctly at least as often as wrong
        return {
          wordId: w.wordId,
          english: w.english,
          chinese: w.chinese,
          difficulty: w.difficulty,
          correct: w.correct >= w.wrong
        };
      });
      this._srsWords = {};
      if (window.API && typeof API.srsBatch === 'function') {
        API.srsBatch(results).catch(e => { /* offline ok */ });
      }
    }

    _calcStars() {
      // Star rating: 3 = reach target with >50% HP; 2 = reach target; 1 = reach target with time low.
      // Ratio-based so it keeps working if maxHp ever changes (hp is always an integer).
      const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 0;
      if (this.captured >= this.currentLevel.target && hpRatio > 0.5) return '⭐⭐⭐';
      if (this.captured >= this.currentLevel.target) return '⭐⭐☆';
      return '⭐☆☆';
    }

    // ---------- Multiplayer (versus) ----------

    // Register the persistent WebSocket handlers once. Every handler
    // no-ops outside net mode, so single-player sessions are unaffected
    // even with a live socket from an earlier match.
    _bindNet() {
      const Net = window.Net;
      if (!Net) return;

      Net.on('peer_pos', (msg) => {
        const rp = this.remotePlayers.get(msg.id);
        if (!rp) return;
        rp.tx = msg.x;
        rp.ty = msg.y;
        if (msg.f) rp.facing = msg.f;
      });

      Net.on('engage', (msg) => {
        if (!this.netMode) return;
        const m = this.monsters.find(x => x.netId === msg.monsterId);
        if (!m) return;
        m.hitPending = false;
        if (msg.by === this.myNetId) {
          this._netEngage(m);
        } else {
          // Another hunter locked this monster — show it and stand by.
          m.netLocked = msg.by;
        }
      });

      Net.on('capture', (msg) => {
        if (!this.netMode) return;
        const m = this.monsters.find(x => x.netId === msg.monsterId);
        if (m) {
          m.netLocked = null;
          m.hitPending = false;
          m.startCapture();
          const screen = this._worldToScreen(m.x, m.y);
          this.fx.burst(screen.x, screen.y, '✨', 10, 'sparkle');
        }
        this.mpCounts.set(msg.by, msg.captured != null ? msg.captured : (this.mpCounts.get(msg.by) || 0) + 1);
        if (msg.by === this.myNetId) {
          this.combo += 1;
          this.maxCombo = Math.max(this.maxCombo, this.combo);
          const basePts = 100;
          const comboBonus = Math.floor(this.combo * 20);
          const pts = basePts + comboBonus;
          this.score += pts;
          this.captured += 1;
          Utils.playBeep('catch');
          Utils.toast('+' + pts + (comboBonus ? ' (Combo x' + this.combo + ')' : ''));
        }
        this._updateMpHud();
        this._updateHUD();
      });

      Net.on('peer_ko', (msg) => {
        if (!this.netMode) return;
        // A remote player was knocked out. Show a toast so the alive player
        // knows they're the last one standing.
        if (msg.id !== this.myNetId) {
          const rp = this.remotePlayers.get(msg.id);
          const name = (rp && rp.name) || '对手';
          Utils.toast('⚡ ' + name + ' 被击倒了！');
        }
      });

      Net.on('wrong', (msg) => {
        if (!this.netMode) return;
        const m = this.monsters.find(x => x.netId === msg.monsterId);
        if (m) {
          m.netLocked = null;
          m.hitPending = false;
          if (msg.by === this.myNetId) {
            this.combo = 0;
            this._damagePlayer(1, m.x, m.y);
          }
        }
      });

      Net.on('spawn', (msg) => {
        if (!this.netMode) return;
        const more = (msg.spawns || []).map(s => this._monsterFromSpawn(s));
        this._nudgeAwayFromPlayer(more);
        this.monsters.push(...more);
      });

      Net.on('end', (msg) => {
        this._endLevelNet(msg);
      });
    }

    // Boss levels spawn bigger monsters in solo mode only (solo boss = duel).
    // In net mode the server sends regular spawns; they should not get the
    // boss visual treatment (aura + crown) just because the level is a boss.
    _monsterScale() {
      return (this.currentLevel && this.currentLevel.isBoss && !this.netMode) ? 1.5 : 1;
    }

    // Build a Monster from a server spawn entry, clamped into our world
    // (the server uses a fixed 1440x720 arena).
    _monsterFromSpawn(s) {
      const scale = this._monsterScale();
      const half = 22 * scale;
      const m = new Monster(
        Utils.clamp(s.x, half, this.world.width - half),
        Utils.clamp(s.y, half, this.world.height - half),
        s.word, s.ai, this.currentLevel.monsterSpeed, scale
      );
      m.netId = s.id;
      return m;
    }

    // The server ruled that THIS player may answer monster m. Pop the
    // question, then report the chosen text — the server decides the
    // verdict and the effects come back via capture/wrong events.
    async _netEngage(m) {
      if (!m || !m.alive || m.captured || !m.word) return;
      m.isEngaged = true;
      this.activeMonster = m;
      this.paused = true;
      this.state = GameState.PAUSED_QUESTION;
      const result = await Question.show(m.word, this.words, { type: 'en2cn' });
      if (this.state !== GameState.PAUSED_QUESTION) {
        m.isEngaged = false;
        this.activeMonster = null;
        return;
      }
      this.paused = this._modalPause; // stay paused if a modal (login/register) is open
      this.state = GameState.PLAYING;
      m.isEngaged = false;
      window.Net.reportAnswer(m.netId, result.choice);
      this.activeMonster = null;
    }

    // Start a versus race from the server's start payload.
    async startLevelNet(startMsg, myId) {
      this.netMode = true;
      this.myNetId = myId;
      this._levelGen = (this._levelGen || 0) + 1;
      this._mpKnockedOut = false;
      this.remotePlayers = new Map();
      this.mpCounts = new Map();
      this._cancelPendingEnds();
      const staleModal = document.getElementById('question-modal');
      if (staleModal) staleModal.classList.add('hidden');
      this.activeMonster = null;

      const level = Math.max(1, Math.min(Levels.TOTAL_LEVELS, startMsg.level || 1));
      const cfg = startMsg.cfg || {};
      const monsterSpeed = Math.min(3.6, 0.6 + level * 0.005); // mirrors levels.js
      this.currentLevelNum = level;
      this.currentLevel = {
        level,
        world: cfg.world || 1,
        isBoss: !!cfg.isBoss,
        difficulty: cfg.difficulty || 1,
        monsterName: cfg.monsterName || '联机对战',
        monsterHP: cfg.monsterHP || 12,
        reward: cfg.reward || { coins: 0, xp: 0 },
        target: startMsg.target || 5,
        timeLimit: startMsg.timeLimit || 60,
        monsterSpeed
      };

      // Question modal needs a distractor pool; the versus flow doesn't go
      // through the title-screen start button, so load it here.
      if (!this.words || this.words.length === 0) {
        try {
          this.vocabulary = await API.getVocabulary();
          this.words = (this.vocabulary && this.vocabulary.words) || [];
        } catch (e) {
          this.vocabulary = null;
          this.words = [];
          // Questions still work with the static fallback distractors.
        }
      }

      const worldDef = Levels.getWorld(this.currentLevel.world);
      // Fixed arena matching the server's spawn space (World computes
      // max(1200, vw, vw+240) x max(600, vh, vh+120) = 1440x720 for these
      // inputs), so every client shares one coordinate system for spawns
      // and peer positions regardless of viewport size.
      this.world = new World(worldDef, this.currentLevel, 1200, 600);

      // Reset run state (mirrors startLevel()).
      this.hp = this.maxHp;
      this.shieldTime = 0;
      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.captured = 0;
      this.timeRemaining = this.currentLevel.timeLimit;
      this._lowTimeWarned = false;
      this.monsters.forEach(m => { if (m.cleanup) m.cleanup(); });
      this.monsters = [];
      this.coinList = [];
      this.bullets = [];
      this.enemyProjectiles = [];
      this.fireCooldown = 0;
      this.ammo = this.currentLevel.target + 5 + (this._weaponStats().ammoBonus || 0);
      this.player = new Player(this.world.width / 2, this.world.groundY - 60);
      this.paused = false;

      // Remote hunters from the server-authoritative start message.
      const players = startMsg.players || [];
      for (const p of players) {
        this.mpCounts.set(p.id, 0);
        if (p.id === myId) continue;
        const rp = new Player(this.world.width / 2, this.world.groundY - 60);
        this.remotePlayers.set(p.id, {
          player: rp, name: p.name, color: p.color || '#2ed573',
          tx: rp.x, ty: rp.y, facing: { x: 0, y: 1 }
        });
      }
      this._updateMpHud();

      // Monsters come from the server's spawn list — one shared field.
      this.monsters = Array.isArray(startMsg.spawns) ? startMsg.spawns.map(s => this._monsterFromSpawn(s)) : [];

      this._showLevelIntro();
    }

    _updateMpHud() {
      const bar = document.getElementById('hud-mp');
      if (!bar) return;
      if (!this.netMode) {
        bar.classList.add('hidden');
        return;
      }
      bar.textContent = '';
      const roomInfo = (window.MPModule && window.MPModule.getRoom()) || {};
      for (const p of (roomInfo.players || [])) {
        const item = document.createElement('span');
        item.className = 'hud-mp__item' + (p.id === this.myNetId ? ' me' : '');
        item.textContent = p.name + ' ' + (this.mpCounts.get(p.id) || 0) + '/' + this.currentLevel.target;
        bar.appendChild(item);
      }
      bar.classList.toggle('hidden', (roomInfo.players || []).length === 0);
    }

    // Versus match finished: standings + own progress submission. The
    // server's unlock/first-clear rules apply as in single player.
    _endLevelNet(msg) {
      if (!this.netMode) return;
      this._cancelPendingEnds();
      this.paused = true;
      this.showHUD(false);
      this.state = GameState.WIN; // stops the update loop; not a "win" per se
      this.activeMonster = null;
      const qm = document.getElementById('question-modal');
      if (qm) qm.classList.add('hidden');

      const iWon = !!(msg.winner && msg.winner.id === this.myNetId);
      if (iWon) {
        const cap = Levels.TOTAL_LEVELS;
        this.maxUnlocked = Math.max(this.maxUnlocked, Math.min(cap, this.currentLevelNum + 1));
        this.maxUnlocked = Math.min(this.maxUnlocked, cap);
        this.persistSave();
      }

      // Result screen (screen-mp-result; mp.js owns its buttons).
      const emojiEl = document.getElementById('mp-result-emoji');
      const titleEl = document.getElementById('mp-result-title');
      if (emojiEl) emojiEl.textContent = iWon ? '🏆' : '💀';
      if (titleEl) titleEl.textContent = iWon ? '对战胜利！' : '再接再厉！';
      const list = document.getElementById('mp-standings');
      if (list) {
        list.textContent = '';
        const medals = ['🥇', '🥈', '🥉'];
        (msg.standings || []).forEach((s, i) => {
          const row = document.createElement('div');
          row.className = 'mp-standing' + (s.id === this.myNetId ? ' me' : '');
          const rank = document.createElement('span');
          rank.className = 'mp-standing__rank';
          rank.textContent = i < 3 ? medals[i] : String(i + 1);
          const name = document.createElement('span');
          name.className = 'mp-standing__name';
          name.textContent = s.name + (s.id === this.myNetId ? '（你）' : '');
          const count = document.createElement('span');
          count.className = 'mp-standing__count';
          count.textContent = '捕获 ' + s.captured;
          row.append(rank, name, count);
          list.appendChild(row);
        });
      }
      const result = document.getElementById('screen-mp-result');
      if (result) result.classList.remove('hidden');
      if (window.Sound && Sound.stopBgm) Sound.stopBgm();
      if (iWon) Utils.playBeep(this.currentLevel.isBoss ? 'bossDown' : 'win');
      else Utils.playBeep('lose');

      // Best-effort own-progress submission (same anti-cheat path as solo).
      if (this.playerName) {
        API.submitProgress(this.playerName, {
          level: this.currentLevelNum, won: iWon,
          correctCount: this.captured, totalRounds: this.captured
        }).then(prog => {
          if (prog && prog.player) {
            if (typeof prog.player.coins === 'number') {
              this.coins = prog.player.coins;
              if (window.ShopModule && typeof window.ShopModule.setCoins === 'function') {
                window.ShopModule.setCoins(this.coins);
              }
            }
            if (window.ShopModule && typeof window.ShopModule.syncToGame === 'function') {
              window.ShopModule.syncToGame(prog.player);
            }
          }
        }).catch(() => { /* offline ok */ });
        // Also submit a score row so the parent report sees MP matches.
        API.submitScore({
          nickname: this.playerName, score: this.score, ageGroup: this.ageGroup,
          gameMode: 'word-hunter', category: 'mixed',
          roundsPlayed: this.captured, correctCount: this.captured,
          playSec: Math.round(Math.min(600, Math.max(5,
            (this.currentLevel.timeLimit || 60) - this.timeRemaining))),
          won: iWon
        }).catch(() => { /* offline ok */ });
      }
    }

    // ---------- Collision / Interact ----------

    // Words whose difficulty falls within the level's band. Falls back to
    // all words with a numeric difficulty if the band matches nothing, so
    // spawnMonsters() never receives an empty pool (which would create
    // word-less monsters and crash the render loop). Words must also carry
    // an English string and a non-empty Chinese meaning — a monster without
    // both can't be rendered or answered correctly.
    _eligibleWords() {
      // Review levels use exactly the due words from the wrong-word book.
      if (this.currentLevel && this.currentLevel.isReview && this._reviewWords && this._reviewWords.length) {
        return this._reviewWords;
      }
      const minD = this.currentLevel.minDifficulty || 1;
      const maxD = this.currentLevel.maxDifficulty || 8;
      const answerable = w => w && Number.isFinite(Number(w.difficulty)) &&
        typeof w.english === 'string' && w.english &&
        typeof w.chinese === 'string' && w.chinese.trim();
      const valid = (this.words || []).filter(answerable);
      const inBand = valid.filter(w => w.difficulty >= minD && w.difficulty <= maxD);
      return inBand.length > 0 ? inBand : valid;
    }

    // Push freshly spawned monsters away from the player so a respawn
    // can't trigger an instant, invisible question.
    _nudgeAwayFromPlayer(monsters) {
      if (!this.player || !this.world) return;
      for (const m of monsters) {
        let guard = 0;
        while (guard++ < 8 && Utils.dist(m, this.player) < 140) {
          m.x = Utils.clamp(m.x + (m.x >= this.player.x ? 120 : -120), 30, this.world.width - 30);
          m.y = Utils.clamp(m.y + (m.y >= this.player.y ? 90 : -90), 30, this.world.height - 30);
        }
      }
    }

    async _tryCollide() {
      // 1. Player bullets vs monsters → question (net mode: report the hit,
      //    the server decides who gets to answer).
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        if (!b.alive) continue;
        for (const m of this.monsters) {
          if (!m.alive || m.captured || !m.word || m.isEngaged) continue;
          if (this.netMode && (m.netLocked != null || m.hitPending)) continue;
          if (Utils.aabb(b.getHitbox(), m.getHitbox())) {
            b.alive = false;
            if (this.netMode) {
              // One report per monster until the server answers with
              // engage / capture / wrong.
              m.hitPending = true;
              window.Net.reportHit(m.netId);
            } else {
              await this._engageMonster(m);
            }
            break;
          }
        }
      }

      // 2. Enemy fireballs vs player → damage
      const pBox = this.player.getHitbox();
      for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
        const ep = this.enemyProjectiles[i];
        if (!ep.alive) continue;
        if (Utils.aabb(pBox, ep.getHitbox())) {
          ep.alive = false;
          this._damagePlayer(1, ep.x, ep.y);
          // small knockback away from the impact
          const dx = this.player.x - ep.x;
          const dy = this.player.y - ep.y;
          const mag = Math.hypot(dx, dy) || 1;
          this.player.x += (dx / mag) * 20;
          this.player.y += (dy / mag) * 20;
        }
      }

      // 3. Monster contact → melee attack
      for (const m of this.monsters) {
        if (!m.alive || m.captured || !m.word) continue;
        if (Utils.aabb(pBox, m.getHitbox())) {
          if (m.canMeleeAttack && m.canMeleeAttack()) {
            m.resetMeleeCooldown(m.boss ? 350 : 500);
            this._damagePlayer(1, m.x, m.y);
            // knock the player away from the monster
            const dx = this.player.x - m.x;
            const dy = this.player.y - m.y;
            const mag = Math.hypot(dx, dy) || 1;
            this.player.x += (dx / mag) * 30;
            this.player.y += (dy / mag) * 30;
          }
        }
      }

      // 4. Player vs coins (collect)
      const coinPlayerBox = this.player.getHitbox();
      for (let i = this.coinList.length - 1; i >= 0; i--) {
        const c = this.coinList[i];
        if (c.collected || c.isExpired()) continue;
        if (Utils.aabb(coinPlayerBox, c.getHitbox())) {
          c.collected = true;
          this.coins += c.value;
          this.score += c.value;
          const screen = this._worldToScreen(c.x, c.y);
          this.fx.burst(screen.x, screen.y, '💰', 4);
          Utils.playBeep('coin');
          this.coinList.splice(i, 1);
          this._updateHUD();
        }
      }
    }

    // Pick the question type for the next solo question. New hunters (and
    // the first levels) stay on the classic English→Chinese question; the
    // other formats unlock gradually by age band and level depth so kids
    // meet "listen & pick", Chinese→English and spelling only after the
    // basic format is familiar. Review levels deliberately rotate through
    // every format — re-testing a word in a different shape is what makes
    // it stick. Net mode must keep en2cn: the server validates the answer
    // as the word's Chinese option text.
    _pickQuestionType(word) {
      if (this.netMode) return 'en2cn';
      const isReview = !!(this.currentLevel && this.currentLevel.isReview);
      const lvl = this.currentLevelNum || 1;
      const age = Number(this.ageGroup) || 7;
      const spellable = /^[a-z]{3,9}$/.test(String((word && word.english) || '').trim().toLowerCase());
      const tts = !!(window.TTS && TTS.isSupported());
      const hasEmoji = !!(word && word.emoji && word.emoji !== '📚');
      const bag = ['en2cn', 'en2cn'];
      if (isReview) {
        bag.push('cn2en');
        if (tts) { bag.push('listen'); bag.push('listen2cn'); }
        if (spellable) bag.push('spell');
        if (hasEmoji) bag.push('picture');
        bag.push('fillblank');
      } else {
        if (lvl <= 9) return 'en2cn'; // onboarding band
        if (age >= 5 || lvl >= 40) bag.push('cn2en');
        if ((age >= 7 || lvl >= 90) && tts) { bag.push('listen'); bag.push('listen2cn'); }
        if ((age >= 9 || lvl >= 160) && spellable) bag.push('spell');
        if ((age >= 12 || lvl >= 250) && hasEmoji) bag.push('picture');
        if (age >= 7 || lvl >= 100) bag.push('fillblank');
      }
      return Utils.randItem(bag);
    }

    // Feed a solo/practice answer into the wrong-word book (spaced
    // repetition). MP verdicts belong to the server, so net mode is
    // excluded to keep local and authoritative state from drifting.
    _recordWordResult(word, correct) {
      if (this.netMode) return;
      // WrongBook (client-side immediate review)
      if (window.WrongBook) {
        try {
          if (correct) WrongBook.recordRight(word);
          else WrongBook.recordWrong(word);
        } catch (e) { /* the book must never break gameplay */ }
      }
      // SRS batch (server-side long-term spaced repetition)
      if (word && word.english) {
        const key = (word.id || word.english.trim().toLowerCase());
        if (!this._srsWords[key]) {
          this._srsWords[key] = {
            wordId: word.id || word.english.trim().toLowerCase(),
            english: word.english,
            chinese: word.chinese || '',
            difficulty: word.difficulty || 1,
            correct: 0,
            wrong: 0
          };
        }
        if (correct) this._srsWords[key].correct++;
        else this._srsWords[key].wrong++;
      }
    }

    // Pop the vocabulary question for a monster hit by a bullet. Correct =
    // capture + rewards; wrong = monster counterattacks and player loses HP.
    // Boss duels: while the boss still has HP, hitting it pops a regular
    // vocabulary question — each correct answer chips HP away. Only once HP
    // is depleted does the essay translation appear as the finishing blow;
    // a correct translation then defeats the boss.
    async _engageMonster(m) {
      if (!m || !m.alive || m.captured || !m.word || m.isEngaged) return;
      m.isEngaged = true;
      Utils.playBeep('engage');
      this.activeMonster = m;
      this.paused = true;
      this.state = GameState.PAUSED_QUESTION;
      let result;
      if (m.boss && !this.netMode && window.Essays && window.Essay && m.hp <= 0) {
        const essay = Essays.makeEssay((this.currentLevel && this.currentLevel.world) || 1);
        result = await Essay.show(essay);
        result.type = 'translate';
      } else {
        result = await Question.show(m.word, this.words, { type: this._pickQuestionType(m.word) });
      }
      // endLevel() can run while the question is open. If the level resolved
      // during the question, bail without clobbering WIN/LOSE state.
      if (this.state !== GameState.PAUSED_QUESTION) {
        m.isEngaged = false;
        this.activeMonster = null;
        return;
      }
      this.paused = false;
      this.state = GameState.PLAYING;
      m.isEngaged = false;
      // The translation isn't a vocabulary word — keep it out of the
      // wrong-word book.
      if (result.type !== 'translate') {
        this._recordWordResult(m.word, result.correct);
      }

      if (result.correct) {
        if (m.boss && result.type !== 'translate') {
          // Correct vocabulary answer chips boss HP — the boss survives
          // until HP is depleted, then the essay translation finishes it.
          this.combo += 1;
          this.maxCombo = Math.max(this.maxCombo, this.combo);
          if (this.combo >= 3 && this.combo % 3 === 0) Utils.playBeep('combo', { combo: this.combo });
          const basePts = 100;
          const comboBonus = Math.floor(this.combo * 20);
          const pts = basePts + comboBonus;
          this.score += pts;
          const alive = m.takeDamage(1);
          const screen = this._worldToScreen(m.x, m.y);
          this.fx.burst(screen.x, screen.y, '💥', 6, 'fire');
          this.fx.burst(screen.x, screen.y, '⚡', 4, 'thunder');
          Utils.playBeep('hit');
          Utils.shake(this.canvas, 8, 250);
          if (alive) {
            Utils.toast('+' + pts + '  Boss HP ' + m.hp + '/' + m.maxHp);
          } else {
            Utils.toast('💀 Boss 血量耗尽！再击中一次完成翻译致命一击！');
          }
          // Knock back the boss so it doesn't sit on top of the player
          const dx = m.x - this.player.x;
          const dy = m.y - this.player.y;
          const mag = Math.hypot(dx, dy) || 1;
          m.x += (dx / mag) * 40;
          m.y += (dy / mag) * 40;
        } else {
          m.startCapture();
          this.combo += 1;
          this.maxCombo = Math.max(this.maxCombo, this.combo);
          if (this.combo >= 3 && this.combo % 3 === 0) Utils.playBeep('combo', { combo: this.combo });
          const basePts = 100;
          const comboBonus = Math.floor(this.combo * 20);
          const pts = basePts + comboBonus;
          this.score += pts;
          this.captured += 1;
          // Drop coins (bounce off the real ground)
          for (let i = 0; i < 3; i++) {
            this.coinList.push(new Coin(
              m.x + Utils.randInt(-20, 20),
              m.y + Utils.randInt(-10, 10),
              10,
              this.world.groundY
            ));
          }
          const screen = this._worldToScreen(m.x, m.y);
          this.fx.burst(screen.x, screen.y, '✨', 10, 'sparkle');
          this.fx.burst(screen.x, screen.y, '💥', 4, 'fire');
          Utils.playBeep('catch');
          Utils.toast('+' + pts + (comboBonus ? ' (Combo x' + this.combo + ')' : ''));

          if (this.captured >= this.currentLevel.target) {
            this._scheduleEndLevel(true, 600);
          }
        }
      } else {
        // Wrong answer: monster survives and counterattacks.
        this.combo = 0;
        this._damagePlayer(1, m.x, m.y);
        // Knock back the monster and player apart.
        const dx = m.x - this.player.x;
        const dy = m.y - this.player.y;
        const mag = Math.hypot(dx, dy) || 1;
        m.x += (dx / mag) * 60;
        m.y += (dy / mag) * 60;
        this.player.x -= (dx / mag) * 30;
        this.player.y -= (dy / mag) * 30;
      }
      this._updateHUD();
      this.activeMonster = null;
    }

    // Apply damage to the player (respects the invulnerability window), play
    // hit FX, and end the level when HP reaches 0. Callers handle knockback.
    _damagePlayer(amount, sx, sy) {
      // A knocked-out hunter is out of the fight: no further damage, HP
      // stays at 0 instead of going negative.
      if (this._mpKnockedOut) return;
      if (this.shieldTime > 0) {
        // Shield absorbs the hit: visual ping, no damage.
        if (sx !== undefined && sy !== undefined) {
          const s = this._worldToScreen(sx, sy);
          this.fx.burst(s.x, s.y, '🛡️', 6, 'shield');
        }
        return;
      }
      if (!this.player || !this.player.takeHit()) return;   // invulnerable
      this.hp -= amount;
      Utils.playBeep('hit');
      const hpEl = document.getElementById('hud-hp');
      if (hpEl) {
        hpEl.classList.remove('hit');
        void hpEl.offsetWidth;
        hpEl.classList.add('hit');
      }
      Utils.shake(this.canvas, 12, 350);
      if (sx !== undefined && sy !== undefined) {
        const s = this._worldToScreen(sx, sy);
        this.fx.burst(s.x, s.y, '💥', 6, 'fire');
      }
      this.fx.burst(this.viewW / 2, this.viewH / 2, '💢', 6);
      this._updateHUD();

      if (this.hp <= 0 && !this.netMode) {
        // If the target was already reached, a pending win timer may still
        // fire — don't downgrade a win to a loss. Pause immediately so the
        // player can't trigger another question / boss translation after
        // death (which would schedule a competing endLevel timer).
        this.paused = true;
        this._scheduleEndLevel(this.captured >= this.currentLevel.target, 600);
      }
      if (this.hp <= 0 && this.netMode && !this._mpKnockedOut) {
        Utils.playBeep('knockout');
        // Versus: no permadeath — the hunter is knocked out for the rest
        // of the match (movement + firing freeze; the match goes on).
        this._mpKnockedOut = true;
        Utils.toast('你已被击倒，等待对战结束…');
        window.Net.sendKo();
      }
    }

    // Resolve the equipped weapon's firing stats. Reads the ShopModule
    // catalog when present; otherwise falls back to defaults (offline / pre-load).
    _weaponStats() {
      if (window.ShopModule && typeof window.ShopModule.getWeaponStats === 'function') {
        return window.ShopModule.getWeaponStats(this.equippedWeapon || 'wooden');
      }
      return { fireCooldown: 320, bulletSpeed: 9, bulletRadius: 6, multishot: 1, spread: 0, ammoBonus: 0, color: '#ffd700' };
    }

    _fireBullet() {
      const p = this.player;
      const f = p.facing || { x: 0, y: 1 };
      const s = this._weaponStats();
      const shots = Math.max(1, s.multishot || 1);
      const spread = s.spread || 0;
      this.ammo -= 1;
      for (let i = 0; i < shots; i++) {
        // Spread shots evenly around the facing angle.
        const base = Math.atan2(f.y, f.x);
        const offset = shots > 1 ? (i - (shots - 1) / 2) * spread : 0;
        const ang = base + offset;
        this.bullets.push(new Projectile(
          p.x + f.x * 30, p.y + f.y * 30, Math.cos(ang), Math.sin(ang), {
            owner: ProjectileOwner.PLAYER,
            speed: s.bulletSpeed || 9,
            radius: s.bulletRadius || 6,
            color: s.color || '#ffd700',
            maxDist: 1600
          }
        ));
      }
      p.shootFlash = 120;
      Utils.playBeep('shoot');
    }

    _monsterShoot(m, opts) {
      opts = opts || {};
      const dx = this.player.x - m.x;
      const dy = this.player.y - m.y;
      const base = Math.atan2(dy, dx);
      const ang = base + (opts.ang || 0);
      this.enemyProjectiles.push(new Projectile(m.x, m.y, Math.cos(ang), Math.sin(ang), {
        owner: ProjectileOwner.MONSTER,
        speed: opts.speed || 4.5,
        radius: 9,
        color: m.boss ? '#ff2d55' : '#ff6b3d',
        maxDist: 1400
      }));
    }

    _worldToScreen(wx, wy) {
      // World may be larger or smaller than the viewport; in either case
      // the camera is computed once per frame by _computeCamera().
      return { x: wx + this.camera.x, y: wy + this.camera.y };
    }

    _computeCamera() {
      // Center the player on screen, then clamp so we never see outside
      // the world. If the world is SMALLER than the viewport, center
      // the world in the viewport to avoid asymmetry.
      if (this.world.width >= this.viewW) {
        const tx = this.viewW / 2 - this.player.x;
        this.camera.x = Utils.clamp(tx, -(this.world.width - this.viewW), 0);
      } else {
        // Center the smaller world in the viewport
        this.camera.x = (this.viewW - this.world.width) / 2;
      }
      if (this.world.height >= this.viewH) {
        const ty = this.viewH / 2 - this.player.y;
        this.camera.y = Utils.clamp(ty, -(this.world.height - this.viewH), 0);
      } else {
        // Center the smaller world in the viewport
        this.camera.y = (this.viewH - this.world.height) / 2;
      }
    }

    _updateHUD() {
      const hearts = '❤'.repeat(Math.max(0, this.hp)) + '🖤'.repeat(Math.max(0, this.maxHp - this.hp));
      document.getElementById('hud-hp').textContent = hearts;
      document.getElementById('hud-score').textContent = this.score;
      document.getElementById('hud-level').textContent =
        (this.currentLevel && this.currentLevel.isReview) ? '复习' : 'Lv.' + this.currentLevelNum;
      document.getElementById('hud-target').textContent = this.captured + '/' + this.currentLevel.target;
      document.getElementById('hud-time').textContent = Math.max(0, Math.ceil(this.timeRemaining));
      const ammoEl = document.getElementById('hud-ammo-num');
      if (ammoEl) ammoEl.textContent = this.ammo;
      const ammoBox = document.getElementById('hud-ammo');
      if (ammoBox) ammoBox.classList.toggle('low', this.ammo <= 3);
      const comboEl = document.getElementById('hud-combo');
      if (this.combo >= 2) {
        comboEl.textContent = 'COMBO x' + this.combo;
        comboEl.classList.remove('hidden');
        // Re-trigger animation
        void comboEl.offsetWidth;
      } else {
        comboEl.classList.add('hidden');
      }
    }

    // ---------- Consumable items ----------

    // Build the in-game item bar from this.items (counts > 0), pulling each
    // item's emoji from the ShopModule catalog.
    _renderItemBar() {
      const bar = document.getElementById('item-bar');
      if (!bar) return;
      bar.innerHTML = '';
      let any = false;
      for (const id in this.items) {
        const n = Number(this.items[id]);
        if (!n || n <= 0) continue;
        const meta = (window.ShopModule && window.ShopModule.getItemMeta && window.ShopModule.getItemMeta(id))
          || { emoji: '🎁', name: id };
        const btn = document.createElement('button');
        btn.className = 'item-btn';
        btn.type = 'button';
        btn.dataset.itemId = id;
        btn.setAttribute('aria-label', '使用 ' + (meta.name || id));
        const emoji = document.createElement('span');
        emoji.className = 'item-btn__emoji';
        emoji.textContent = meta.emoji || '🎁';
        const count = document.createElement('span');
        count.className = 'item-btn__count';
        count.textContent = 'x' + n;
        btn.appendChild(emoji);
        btn.appendChild(count);
        bar.appendChild(btn);
        any = true;
      }
      bar.classList.toggle('hidden', !any);
    }

    // Use a consumable during play. Applies the effect client-side and
    // best-effort decrements the server count (only for logged-in players).
    useItem(id) {
      if (this.state !== GameState.PLAYING || this.paused) return;
      const n = Number(this.items[id]) || 0;
      if (n <= 0) return;
      let consumed = false;
      switch (id) {
        case 'health-potion':
          if (this.hp >= this.maxHp) { Utils.toast('生命已满'); return; }
          this.hp = Math.min(this.maxHp, this.hp + 1);
          this.fx.burst(this.viewW / 2, this.viewH / 2, '❤️', 8);
          consumed = true;
          break;
        case 'ammo-crate':
          this.ammo += 10;
          this.fx.burst(this.viewW / 2, this.viewH / 2, '🔋', 8);
          consumed = true;
          break;
        case 'guard-shield':
          this.shieldTime = 6000;
          this.fx.burst(this.viewW / 2, this.viewH / 2, '🛡️', 10, 'shield');
          consumed = true;
          break;
        case 'time-hourglass':
          this.timeRemaining += 15;
          this.fx.burst(this.viewW / 2, this.viewH / 2, '⏳', 8);
          consumed = true;
          break;
        case 'stun-bomb':
          for (const m of this.monsters) m.stunned = 4000;
          this.fx.burst(this.viewW / 2, this.viewH / 2, '💥', 14, 'fire');
          consumed = true;
          break;
        default:
          return;
      }
      if (!consumed) return;
      this.items[id] = n - 1;
      Utils.playBeep('catch');
      this._updateHUD();
      this._renderItemBar();
      if (this.playerName) {
        window.API.useItem(this.playerName, id).catch(() => { /* offline ok */ });
      }
    }

    // ---------- Main loop ----------

    _loop(now) {
      // Clamp dt: the first frame has lastTime === 0 (so `now` alone can
      // be huge) and a backgrounded tab can pause rAF for a long time.
      const dt = Math.min(50, Math.max(0, now - this.lastTime));
      this.lastTime = now;
      this._update(dt);
      this._render();
      this._rafId = requestAnimationFrame((t) => this._loop(t));
    }

    _update(dt) {
      // Always update FX
      this.fx.update(dt);

      // Interpolate remote hunters toward their last reported position.
      // Runs even when the local player is paused (answering a question),
      // so the other player's movement stays smooth on our screen.
      for (const rp of this.remotePlayers.values()) {
        const p = rp.player;
        const dx = rp.tx - p.x;
        const dy = rp.ty - p.y;
        p.isMoving = Math.hypot(dx, dy) > 4;
        const k = Math.min(1, dt / 100);
        p.x += dx * k;
        p.y += dy * k;
        if (rp.facing) p.facing = rp.facing;
        if (p.isMoving) {
          p.walkTimer += dt;
          if (p.walkTimer > 200) {
            p.walkTimer = 0;
            p.emojiIndex = (p.emojiIndex + 1) % 2;
          }
        }
      }

      if (this.state !== GameState.PLAYING) return;
      if (this.paused) return;

      // Countdown the consumable invulnerability shield.
      if (this.shieldTime > 0) this.shieldTime -= dt;

      // Versus: a knocked-out hunter can't move or shoot anymore.
      const knockedOut = this.netMode && this.hp <= 0;

      // Input → player (pass analog vector for any-angle movement)
      const vec = knockedOut ? { x: 0, y: 0 } : this.input.getMoveVector();
      this.player.update(dt, { vx: vec.x, vy: vec.y }, this.world.width, this.world.height);

      // Update world
      this.world.update(dt);

      // Broadcast our position to the room (~20Hz, throttled by net.js).
      if (this.netMode && !knockedOut) {
        window.Net.sendPos(this.player.x, this.player.y, this.player.facing);
      }

      // Player shooting: hold to auto-fire, rate-limited by fireCooldown.
      this.fireCooldown -= dt;
      if (!knockedOut && this.input.state.fire && this.fireCooldown <= 0) {
        if (this.ammo > 0) {
          this._fireBullet();
          this.fireCooldown = this._weaponStats().fireCooldown || 320;
        } else {
          // Out of ammo: give a short "empty" click so the player knows.
          Utils.playBeep('wrong');
          this.fireCooldown = 400;
        }
      }

      // Update monsters
      for (const m of this.monsters) {
        m.update(dt, this.player, this.world.width, this.world.height);
      }
      // Remove dead monsters (post-capture)
      this.monsters = this.monsters.filter(m => m.alive);

      // Monster ranged attacks (aggressive monsters shoot fireballs).
      // Boss monsters are far more ferocious: longer reach, twin
      // fireballs per volley, faster projectiles, shorter cooldown.
      for (const m of this.monsters) {
        const bossMon = !!m.boss;
        const range = bossMon ? 430 : 320;
        if (!m.captured && m.canShoot && m.canShoot() && Utils.dist(m, this.player) < range) {
          if (bossMon) {
            this._monsterShoot(m, { speed: 5.5, ang: -0.2 });
            this._monsterShoot(m, { speed: 5.5, ang: 0.2 });
            m.shootTimer = 450;
          } else {
            this._monsterShoot(m);
            m.resetShootTimer();
          }
        }
      }

      // Update projectiles
      for (const b of this.bullets) b.update(dt, this.world.width, this.world.height);
      for (const p of this.enemyProjectiles) p.update(dt, this.world.width, this.world.height);
      this.bullets = this.bullets.filter(b => b.alive);
      this.enemyProjectiles = this.enemyProjectiles.filter(p => p.alive);

      // Update coins
      for (const c of this.coinList) c.update(dt);
      this.coinList = this.coinList.filter(c => !c.isExpired() && !c.collected);

      // Collisions
      this._tryCollide().catch(e => console.warn('_tryCollide error:', e));

      // Respawn if too few (keep some pressure). Guard against an empty
      // word pool — spawnMonsters() with no words creates monsters with
      // word === undefined, whose render throws and kills the game loop.
      // Net mode: the server owns respawn waves (spawn events). Boss duels
      // are a 1v1 — never respawn minions.
      if (!this.netMode && !(this.currentLevel && this.currentLevel.isBoss) &&
          this.monsters.length < 3 && this.timeRemaining > 5) {
        const eligible = this._eligibleWords();
        if (eligible.length > 0) {
          const more = spawnMonsters(eligible, 2, this.currentLevel.monsterSpeed, this.world.width, this.world.height, this._monsterScale());
          // spawnMonsters() only spaces monsters against each other, so a
          // respawn can land on top of the player and instantly damage them.
          // Nudge any too-close spawns away.
          this._nudgeAwayFromPlayer(more);
          this.monsters.push(...more);
        }
      }

      // Timer
      this.timeRemaining -= dt / 1000;
      // Low-time warning: one soft tick when crossing 10s (kids get a
      // gentle cue instead of a wall of beeps for the whole last stretch).
      if (!this.netMode && this.timeRemaining <= 10 && this.timeRemaining > 0 && !this._lowTimeWarned) {
        this._lowTimeWarned = true;
        Utils.playBeep('tick');
      }
      this._updateHUD();

      if (this.timeRemaining <= 0) {
        // Net mode: the server owns the match clock — just hold at zero
        // and wait for its end event.
        if (!this.netMode) {
          this.endLevel(this.captured >= this.currentLevel.target);
          return;
        }
        this.timeRemaining = 0;
      }

      // Limited ammo: if the player runs dry before reaching the target they
      // can no longer capture any monsters → lose. Wait until the last bullet
      // has landed or despawned (bullets empty) so a winning shot isn't cut
      // off by an instant loss. (Net mode: no local loss — server decides.)
      if (!this.netMode && this.ammo <= 0 && this.bullets.length === 0 &&
          this.captured < this.currentLevel.target) {
        this.endLevel(false);
      }
    }

    _render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.viewW, this.viewH);

      if (this.world && this.player) {
        this._computeCamera();
        ctx.save();
        ctx.translate(this.camera.x, this.camera.y);
        this.world.render(ctx);
        // Draw bullets + enemy fireballs
        for (const b of this.bullets) b.render(ctx);
        for (const p of this.enemyProjectiles) p.render(ctx);
        // Draw coins
        for (const c of this.coinList) c.render(ctx);
        // Draw monsters
        for (const m of this.monsters) m.render(ctx);
        // Draw player
        this.player.render(ctx);
        // Draw remote hunters (versus) with a color ring + name tag
        for (const rp of this.remotePlayers.values()) {
          const p = rp.player;
          ctx.save();
          ctx.strokeStyle = rp.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y + 24, 24, 9, 0, 0, Math.PI * 2);
          ctx.stroke();
          p.render(ctx);
          ctx.font = 'bold 12px "Nunito", system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const tw = ctx.measureText(rp.name).width;
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(p.x - tw / 2 - 5, p.y - 48, tw + 10, 17);
          ctx.fillStyle = rp.color;
          ctx.fillText(rp.name, p.x, p.y - 39);
          ctx.restore();
        }
        ctx.restore();
      } else {
        // Title bg already drawn via CSS; render a starfield
        this._renderTitleBg(ctx);
      }

      // FX layer
      this.fx.render();
    }

    _renderTitleBg(ctx) {
      // (Title screen has its own CSS background; we just draw subtle starfield)
      const w = this.viewW, h = this.viewH;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(0, 0, w, h);
      if (!this._stars) {
        this._stars = [];
        for (let i = 0; i < 80; i++) {
          this._stars.push({
            x: Math.random() * w,
            y: Math.random() * h,
            r: Math.random() * 1.5 + 0.5,
            t: Math.random() * Math.PI * 2
          });
        }
      }
      const now = performance.now() * 0.001;
      for (const s of this._stars) {
        const alpha = 0.4 + Math.sin(now + s.t) * 0.4;
        ctx.fillStyle = `rgba(255,255,255,${alpha})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  window.Game = Game;
  window.GameState = GameState;
})();
