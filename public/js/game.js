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
      this.vocabulary = null;
      this.words = [];

      // Level state
      this.currentLevel = null;       // {level, world, target, ...}
      this.currentLevelNum = 1;
      this.maxUnlocked = 1;
      this.world = null;
      this.player = null;
      this.monsters = [];
      this.coinList = [];
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

      // Pending delayed endLevel() timers (capture-win / hp-0). Tracked so
      // they can be cancelled on level restart and cleaned up on resolve.
      this._pendingEndTimers = [];

      this._resize();
      window.addEventListener('resize', () => this._resize());

      // Show joystick on mobile
      if (this.input.isMobile()) this.input.showJoystick();

      // Game loop
      requestAnimationFrame((t) => this._loop(t));
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
      // If a world already exists, expand it to keep filling the viewport
      if (this.world) {
        this.world.resize(w, h);
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
      // Cancel any delayed endLevel() from the previous run so it can't
      // resolve the new level. Also drop any lingering question modal and
      // stale engagement bookkeeping.
      this._cancelPendingEnds();
      const staleModal = document.getElementById('question-modal');
      if (staleModal) staleModal.classList.add('hidden');
      this.activeMonster = null;
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
      // Ensure view dimensions are initialized
      if (this.viewW === undefined) this._resize();
      this.world = new World(worldDef, this.currentLevel, this.viewW, this.viewH);

      // Reset state
      this.hp = this.maxHp;
      this.score = 0;
      this.combo = 0;
      this.maxCombo = 0;
      this.captured = 0;
      this.timeRemaining = this.currentLevel.timeLimit;
      // Clear existing entities to prevent memory leaks
      this.monsters.forEach(m => { if (m.cleanup) m.cleanup(); });
      this.monsters = [];
      this.coinList.forEach(c => { if (c.cleanup) c.cleanup(); });
      this.coinList = [];
      this.player = new Player(this.world.width / 2, this.world.groundY - 60);
      this.paused = false;

      // Spawn monsters. Guard against an empty word pool: spawnMonsters()
      // would create monsters with word === undefined, and the first
      // render of such a monster throws (m.word.english), killing the
      // whole rAF loop.
      const eligible = this._eligibleWords();
      this.monsters = eligible.length > 0
        ? spawnMonsters(eligible, this.currentLevel.monsterCount, this.currentLevel.monsterSpeed, this.world.width, this.world.height)
        : [];

      // Show level intro
      this._showLevelIntro();
    }

    _showLevelIntro() {
      this.state = GameState.LEVEL_INTRO;
      const worldDef = Levels.getWorld(this.currentLevel.world);
      const cfg = this.currentLevel;
      document.getElementById('level-intro-emoji').textContent = cfg.isBoss ? '👑' : (worldDef ? worldDef.emoji : '🌲');
      const tag = cfg.isBoss ? ' 👑BOSS' : '';
      document.getElementById('level-intro-num').textContent = `第 ${this.currentLevelNum} 关${tag}`;
      document.getElementById('level-intro-name').textContent = cfg.monsterName
        || (worldDef ? worldDef.name : '神秘关卡');
      document.getElementById('level-intro-goal').textContent =
        `难度 d${cfg.difficulty} · 捕获 ${cfg.target} 只小怪 (${cfg.timeLimit}秒)`;
      this.showScreen('screen-level-intro');
    }

    beginPlay() {
      this.showScreen(null);
      this.showHUD(true);
      this._updateHUD();
      this.state = GameState.PLAYING;
      Utils.playBeep('click');
    }

    // Schedule a delayed endLevel (e.g. let the capture animation play
    // out). All pending timers are tracked so a level restart can cancel
    // them and endLevel() can clear any remaining ones.
    _scheduleEndLevel(won, delay) {
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
      if (this.state === GameState.WIN || this.state === GameState.LOSE ||
          this.state === GameState.TITLE || this.state === GameState.LEVEL_INTRO) {
        return;
      }

      this._cancelPendingEnds();
      this.paused = true;
      this.showHUD(false);
      this.state = won ? GameState.WIN : GameState.LOSE;
      this.activeMonster = null;

      // endLevel can fire while a question modal is still open (the 600ms
      // capture timer outlives a follow-up collision). Hide it so it
      // doesn't sit on top of the result screen.
      const qm = document.getElementById('question-modal');
      if (qm) qm.classList.add('hidden');

      // Unlock next level + persist locally (sync, before any network I/O)
      if (won) {
        const cap = (window.Levels && Levels.TOTAL_LEVELS) || 666;
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
      document.getElementById('result-score-lose').textContent = this.score;
      document.getElementById('result-captured-lose').textContent = this.captured;
      this.showScreen(won ? 'screen-win' : 'screen-lose');
      if (won) Utils.playBeep('win');

      // Backend submissions (best-effort, after the screen is up)
      if (!won) {
        // Track fail count for analytics (without blocking gameplay)
        try {
          await API.submitProgress(this.playerName, {
            level: this.currentLevelNum, won: false, correctCount: this.captured, totalRounds: this.captured
          });
        } catch (e) { /* offline ok */ }
      } else {
        // Submit a win once per player per level per browser session.
        // Only mark it submitted if at least one request succeeded, so an
        // offline win is not silently lost and can be recorded later.
        const submissionKey = `submitted_level_${this.currentLevelNum}_${this.playerName || 'guest'}`;
        if (!sessionStorage.getItem(submissionKey)) {
          let submitted = false;
          try {
            await API.submitProgress(this.playerName, {
              level: this.currentLevelNum, won: true, correctCount: this.captured, totalRounds: this.captured
            });
            submitted = true;
          } catch (e) { /* offline ok */ }
          try {
            await API.submitScore({
              nickname: this.playerName, score: this.score, ageGroup: this.ageGroup,
              gameMode: 'word-hunter', category: 'mixed',
              roundsPlayed: this.captured, correctCount: this.captured
            });
            submitted = true;
          } catch (e) {}
          if (submitted) {
            try { sessionStorage.setItem(submissionKey, 'true'); } catch (e) {}
          }
        }
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

    // ---------- Collision / Interact ----------

    // Words whose difficulty falls within the level's band. Falls back to
    // all words with a numeric difficulty if the band matches nothing, so
    // spawnMonsters() never receives an empty pool (which would create
    // word-less monsters and crash the render loop).
    _eligibleWords() {
      const minD = this.currentLevel.minDifficulty || 1;
      const maxD = this.currentLevel.maxDifficulty || 8;
      const valid = (this.words || []).filter(w => w && Number.isFinite(Number(w.difficulty)));
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
      // Player vs monsters
      const playerBox = this.player.getHitbox();
      for (const m of this.monsters) {
        if (!m.alive || m.captured || !m.word) continue;
        if (Utils.aabb(playerBox, m.getHitbox())) {
          // Mark monster as engaged to prevent duplicate triggers
          if (m.isEngaged) continue;
          m.isEngaged = true;
          this.activeMonster = m;
          this.paused = true;
          this.state = GameState.PAUSED_QUESTION;
          // Freeze monsters in place during the question
          const result = await Question.show(m.word, this.words);
          // endLevel() can run while the question is open (the 600ms
          // capture/HP timer fires regardless of state). If the level
          // resolved during the question, bail without clobbering the
          // WIN/LOSE state or continuing to score the result.
          if (this.state !== GameState.PAUSED_QUESTION) {
            m.isEngaged = false;
            this.activeMonster = null;
            return;
          }
          this.paused = false;
          this.state = GameState.PLAYING;
          m.isEngaged = false;

          if (result.correct) {
            m.startCapture();
            this.combo += 1;
            this.maxCombo = Math.max(this.maxCombo, this.combo);
            const basePts = 100;
            const comboBonus = Math.floor(this.combo * 20);
            const pts = basePts + comboBonus;
            this.score += pts;
            this.captured += 1;
            // Drop coins (use world.groundY so they bounce off the real ground)
            for (let i = 0; i < 3; i++) {
              this.coinList.push(new Coin(
                m.x + Utils.randInt(-20, 20),
                m.y + Utils.randInt(-10, 10),
                10,
                this.world.groundY
              ));
            }
            // FX
            const screen = this._worldToScreen(m.x, m.y);
            this.fx.burst(screen.x, screen.y, '✨', 10);
            this.fx.burst(screen.x, screen.y, '💥', 4);
            Utils.playBeep('catch');
            Utils.toast('+' + pts + (comboBonus ? ' (Combo x' + this.combo + ')' : ''));

            if (this.captured >= this.currentLevel.target) {
              this._scheduleEndLevel(true, 600);
            }
          } else {
            // Player takes damage
            this.combo = 0;
            const gotHit = this.player.takeHit();
            if (gotHit) {
              this.hp -= 1;
              Utils.playBeep('hit');
              const hpEl = document.getElementById('hud-hp');
              hpEl.classList.remove('hit');
              void hpEl.offsetWidth;
              hpEl.classList.add('hit');
              Utils.shake(this.canvas, 12, 350);
              this.fx.burst(this.viewW/2, this.viewH/2, '💢', 6);
              this.fx.burst(this._worldToScreen(m.x, m.y).x, this._worldToScreen(m.x, m.y).y, '💥', 6);
            }
            // Knock back the monster
            const dx = m.x - this.player.x;
            const dy = m.y - this.player.y;
            const mag = Math.hypot(dx, dy) || 1;
            m.x += (dx / mag) * 60;
            m.y += (dy / mag) * 60;
            // Knock back the player
            this.player.x -= (dx / mag) * 30;
            this.player.y -= (dy / mag) * 30;

            if (this.hp <= 0) {
              // If the target was already reached, a win timer from an
              // earlier capture may still be pending — don't downgrade a
              // win to a loss. Mirrors the countdown path in _update().
              this._scheduleEndLevel(this.captured >= this.currentLevel.target, 600);
            }
          }
          this._updateHUD();
          this.activeMonster = null;
          break;
        }
      }

      // Player vs coins. Refresh the hitbox: a wrong answer above knocks
      // the player back, and the stale box would miss or misfire.
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
      document.getElementById('hud-level').textContent = 'Lv.' + this.currentLevelNum;
      document.getElementById('hud-target').textContent = this.captured + '/' + this.currentLevel.target;
      document.getElementById('hud-time').textContent = Math.max(0, Math.ceil(this.timeRemaining));
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

    // ---------- Main loop ----------

    _loop(now) {
      // Clamp dt: the first frame has lastTime === 0 (so `now` alone can
      // be huge) and a backgrounded tab can pause rAF for a long time.
      const dt = Math.min(50, Math.max(0, now - this.lastTime));
      this.lastTime = now;
      this._update(dt);
      this._render();
      requestAnimationFrame((t) => this._loop(t));
    }

    _update(dt) {
      // Always update FX
      this.fx.update(dt);

      if (this.state !== GameState.PLAYING) return;
      if (this.paused) return;

      // Input → player
      const vec = this.input.getMoveVector();
      // Temporarily stuff axis into input.state shape for Player
      this.input.state.left  = vec.x < -0.1;
      this.input.state.right = vec.x >  0.1;
      this.input.state.up    = vec.y < -0.1;
      this.input.state.down  = vec.y >  0.1;
      this.player.update(dt, this.input.state, this.world.width, this.world.height);

      // Update world
      this.world.update(dt);

      // Update monsters
      for (const m of this.monsters) {
        m.update(dt, this.player, this.world.width, this.world.height);
      }
      // Remove dead monsters (post-capture)
      this.monsters = this.monsters.filter(m => m.alive);

      // Update coins
      for (const c of this.coinList) c.update(dt);
      this.coinList = this.coinList.filter(c => !c.isExpired() && !c.collected);

      // Collisions
      this._tryCollide();

      // Respawn if too few (keep some pressure). Guard against an empty
      // word pool — spawnMonsters() with no words creates monsters with
      // word === undefined, whose render throws and kills the game loop.
      if (this.monsters.length < 3 && this.timeRemaining > 5) {
        const eligible = this._eligibleWords();
        if (eligible.length > 0) {
          const more = spawnMonsters(eligible, 2, this.currentLevel.monsterSpeed, this.world.width, this.world.height);
          // spawnMonsters() only spaces monsters against each other, so a
          // respawn can land on top of the player and instantly pop a
          // question. Nudge any too-close spawns away.
          this._nudgeAwayFromPlayer(more);
          this.monsters.push(...more);
        }
      }

      // Timer
      this.timeRemaining -= dt / 1000;
      this._updateHUD();

      if (this.timeRemaining <= 0) {
        this.endLevel(this.captured >= this.currentLevel.target);
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
        // Draw coins
        for (const c of this.coinList) c.render(ctx);
        // Draw monsters
        for (const m of this.monsters) m.render(ctx);
        // Draw player
        this.player.render(ctx);
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
