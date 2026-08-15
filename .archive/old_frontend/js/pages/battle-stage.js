/**
 * battle-stage.js - Hosts the active battle for a given level.
 * Manages a turn-based loop:
 *   PLAYER TURN  -> show question -> correct -> player attack animation
 *                  -> projectile flies to monster -> monster HP drops -> monster death
 *                  -> wrong -> monster counter-attack -> player HP drops
 *   MONSTER TURN -> charge -> lunge -> projectile -> player HP drops (skipped if shielded)
 * Bridged with the per-round game modules (word-recognition, listening, etc.).
 * Exposed as window.BattleStage
 */
(function () {
  'use strict';

  const gameModules = {
    'word-recognition': window.WordRecognitionGame,
    'listening':        window.ListeningGame,
    'spelling':         window.SpellingGame,
    'sentences':        window.SentencesGame
  };

  // Rounds per level: short for early levels, longer for bosses
  function roundsForLevel(levelCfg) {
    if (levelCfg.isBoss) return 12;
    if (levelCfg.level <= 30) return 5;
    if (levelCfg.level <= 150) return 7;
    if (levelCfg.level <= 400) return 9;
    return 11;
  }

  // Player HP scales with level too (so the game is not 1-shot)
  function playerHPForLevel(levelCfg) {
    return 50 + Math.floor(levelCfg.level / 5) * 5;
  }

  // Choose projectile type based on damage type / crit
  function pickProjectileType(isCorrect, hasCrit, isBoss) {
    if (!isCorrect) return 'hit';
    if (hasCrit) return 'crit';
    if (isBoss) return 'fire';
    return Math.random() < 0.3 ? 'fire' : 'arrow';
  }

  const BattleStage = {
    async start() {
      const levelNum = AppState.currentLevel;
      if (!levelNum) { App.go('world-map'); return; }

      // Load player profile if not already
      if (!AppState.player) {
        try { AppState.player = await API.getPlayer(AppState.nickname, AppState.ageGroup); }
        catch (e) { console.warn('加载玩家数据失败', e); AppState.player = null; }
      }
      const levelCfg = LevelGenerator.computeLevel(levelNum);
      AppState.currentLevelCfg = levelCfg;

      // Make sure the matching vocabulary is loaded
      await App.loadVocabulary();

      const app = App.renderPage(`<div id="battle-container" class="keg-battle" style="width:100%"></div>`);
      const container = app.querySelector('#battle-container');
      container.style.background = levelCfg.worldGradient;

      // Runtime battle state
      const state = {
        levelCfg,
        monsterHP: levelCfg.monsterHP,
        playerHP: playerHPForLevel(levelCfg),
        shieldActive: false,
        critActive: false,
        round: 0,
        totalRounds: roundsForLevel(levelCfg),
        won: false,
        streak: 0,
        damageDealt: 0,
        damageTaken: 0,
        busy: false  // lock during animations
      };

      this._renderFrame(container, state);

      const module = gameModules[levelCfg.monsterType];
      if (!module) {
        console.error('没有对应的游戏模块:', levelCfg.monsterType);
        App.go('world-map');
        return;
      }

      // The game module replaces container.innerHTML, so point it at a
      // scoped game slot inside the battle frame.
      const gameSlot = container.querySelector('#keg-battle-game');
      module.start(gameSlot, AppState.vocabulary, (stats) => {
        this._onBattleEnd(container, state, stats);
      });

      // Patch the engine's submitAnswer to apply battle damage logic.
      this._wireEnginePatches(container, state, levelCfg);
    },

    _renderFrame(container, state) {
      const heroEmoji = (window.HERO_EMOJI && window.HERO_EMOJI[AppState.ageGroup]) || '🧒';
      const maxPlayerHP = playerHPForLevel(state.levelCfg);
      const levelNum = state.levelCfg.level;

      container.innerHTML = `
        <div class="keg-battle__inner keg-slide-in">
          <div class="keg-battle__topbar">
            <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-flee">
              <span class="keg-btn__emoji">🏃</span> 撤退
            </button>
            <div class="keg-battle__world">
              ${state.levelCfg.worldEmoji} 第${state.levelCfg.world}世界 · ${state.levelCfg.worldName}
            </div>
            <div class="keg-battle__level">关卡 ${levelNum}</div>
          </div>

          <div class="keg-arena" id="keg-arena">
            <div class="keg-arena__scene">
              <div class="keg-arena__bg" id="keg-arena-bg"></div>

              <div class="keg-arena__player" id="keg-arena-player">
                ${PlayerCard.render({
                  heroEmoji: heroEmoji,
                  ageGroup: AppState.ageGroup,
                  level: Math.max(1, levelNum),
                  maxHP: maxPlayerHP,
                  currentHP: state.playerHP
                })}
              </div>

              <div class="keg-arena__vs">⚔️ VS</div>

              <div class="keg-arena__monster" id="keg-arena-monster">
                ${MonsterCard.render(state.levelCfg, { currentHP: state.monsterHP })}
              </div>
            </div>

            <div class="keg-battle__game keg-game keg-slide-in" id="keg-battle-game"></div>
          </div>

          <div id="keg-skills-slot"></div>
        </div>
      `;
      // Render skills bar
      const skillsSlot = container.querySelector('#keg-skills-slot');
      skillsSlot.innerHTML = SkillsBar.render(AppState.player, {
        shieldActive: state.shieldActive,
        critActive: state.critActive
      });
      SkillsBar.bind(container, (id) => this._onUseSkill(container, state, id));

      // Flee button
      container.querySelector('#btn-flee').addEventListener('click', () => {
        if (confirm('确定要撤退吗？当前关卡进度不会保存。')) {
          App.go('world-map');
        }
      });
    },

    _wireEnginePatches(container, state, levelCfg) {
      // The game module may build its GameEngine after a microtask; wait a bit
      // and re-poll until window._currentEngine appears.
      const tryPatch = (attempt) => {
        const engine = window._currentEngine;
        if (engine && !engine._battlePatched) {
          engine._battlePatched = true;
          const originalSubmit = engine.submitAnswer.bind(engine);
          engine.submitAnswer = (isCorrect) => {
            const stat = originalSubmit(isCorrect);
            this._applyBattleHit(container, state, isCorrect, stat);
            return stat;
          };
          return;
        }
        if (attempt < 20) setTimeout(() => tryPatch(attempt + 1), 30);
      };
      tryPatch(0);
    },

    _applyBattleHit(container, state, isCorrect, stat) {
      if (state.busy) return stat;  // ignore inputs during animation
      if (state._ended) return stat; // battle already finished
      state.busy = true;
      // Disable answer options during animation
      container.querySelectorAll('.keg-option').forEach(b => b.classList.add('keg-option--disabled'));

      if (isCorrect) {
        state.streak++;
        const dmg = LevelGenerator.computeDamage(state.levelCfg, state.streak, state.critActive);
        const wasCrit = state.critActive;
        state.monsterHP = Math.max(0, state.monsterHP - dmg);
        state.damageDealt += dmg;
        if (state.critActive) state.critActive = false;

        this._playerAttackSequence(container, state, dmg, wasCrit, () => {
          if (state.monsterHP === 0) {
            this._endBattle(container, state, true);
          } else {
            // Monster counter-attack after a short pause
            setTimeout(() => this._monsterTurn(container, state), 700);
          }
        });
      } else {
        state.streak = 0;
        if (state.shieldActive) {
          // Player used shield: defend this hit, NO monster counter-attack
          state.shieldActive = false;
          this._shieldBlockSequence(container, state, () => {
            state.busy = false;
            this._unlockOptions(container);
          });
        } else {
          // Monster counter-attack
          this._monsterTurn(container, state, true);
        }
      }
      this._refreshSkillsBar(container, state);
    },

    /**
     * Play full attack sequence: player swings -> projectile -> monster hit -> HP drop.
     */
    _playerAttackSequence(container, state, dmg, isCrit, onDone) {
      if (state._ended) { if (onDone) onDone(); return; }
      const playerEl = container.querySelector('#keg-player-card');
      const monsterEl = container.querySelector('#keg-monster-card');
      const arena = container.querySelector('.keg-arena__scene');

      // 1) Player swings
      PlayerCard.playAttack(container, () => {
        // 2) Projectile
        const startRect = playerEl && playerEl.getBoundingClientRect();
        const endRect = monsterEl && monsterEl.getBoundingClientRect();
        const type = pickProjectileType(true, isCrit, state.levelCfg.isBoss);
        const finish = () => {
          // 3) Monster hit shake + flash
          MonsterCard.flashDamage(container.querySelector('#keg-arena-monster'));
          // 4) HP drop
          const monsterSlot = container.querySelector('#keg-arena-monster');
          MonsterCard.updateHP(monsterSlot, state.levelCfg, state.monsterHP);
          // 5) Damage number + burst particles
          this._showDamageNumber(container, dmg, isCrit);
          // 6) Streak callout
          if (state.streak >= 3) this._showStreakCallout(container, state.streak);
          if (isCrit) this._showCritBanner(container);
          Utils.playBeep('correct');
          if (onDone) setTimeout(onDone, 350);
        };
        if (isCrit) {
          // barrage(arena, type, startRect, endRect, count, onComplete)
          Projectile.barrage(arena, type, startRect, endRect, 3, finish);
        } else {
          // shoot(arena, type, startRect, endRect, onComplete)
          Projectile.shoot(arena, type, startRect, endRect, finish);
        }
      });
    },

    /**
     * Play monster counter-attack sequence: monster charges -> lunges -> projectile -> player hit.
     */
    _monsterTurn(container, state, fromWrong) {
      if (state._ended) return;
      const monsterEl = container.querySelector('#keg-monster-card');
      const playerEl = container.querySelector('#keg-player-card');
      const arena = container.querySelector('.keg-arena__scene');
      const arenaWrap = container.querySelector('.keg-arena');

      // 1) Monster attack animation
      MonsterCard.playAttack(container.querySelector('#keg-arena-monster'), () => {
        // 2) Projectile (always hits for now)
        const startRect = monsterEl.getBoundingClientRect();
        const endRect = playerEl.getBoundingClientRect();
        // Damage scales with difficulty but reduced coefficient for balance
        // Player HP at level 666 is ~716, so max damage should be ~25 (29 hits to die)
        const baseDmg = state.levelCfg.isBoss ? 12 : 8;
        const difficultyBonus = state.levelCfg.difficulty * 2;
        const dmg = Math.max(3, baseDmg + difficultyBonus);
        state.playerHP = Math.max(0, state.playerHP - dmg);
        state.damageTaken += dmg;
        Projectile.shoot(arena, 'fire', startRect, endRect, () => {
          // 3) Player hit — also screen shake
          if (arenaWrap) {
            arenaWrap.classList.remove('keg-arena--shake');
            // force reflow so animation re-triggers
            void arenaWrap.offsetWidth;
            arenaWrap.classList.add('keg-arena--shake');
            setTimeout(() => arenaWrap.classList.remove('keg-arena--shake'), 420);
          }
          PlayerCard.playHit(container, () => {
            PlayerCard.updateHP(container, state.playerHP, playerHPForLevel(state.levelCfg));
            this._showPlayerDamageNumber(container, dmg);
            Utils.playBeep('wrong');
            if (state.playerHP === 0) {
              this._endBattle(container, state, false);
            } else {
              state.busy = false;
              // Re-enable options for next round
              this._unlockOptions(container);
            }
          });
        });
      });
    },

    /**
     * Play shield defense: glowing ring around player, monster attack absorbed.
     */
    _shieldBlockSequence(container, state, onDone) {
      if (state._ended) { if (onDone) onDone(); return; }
      PlayerCard.playShield(container, () => {
        this._showToast(container, '🛡️ 护盾抵挡了攻击！');
        Utils.playBeep('click');
        state.busy = false;
        this._unlockOptions(container);
        if (onDone) onDone();
      });
    },

    _unlockOptions(container) {
      container.querySelectorAll('.keg-option--disabled').forEach(b => b.classList.remove('keg-option--disabled'));
    },

    _onUseSkill(container, state, skillId) {
      const def = Worlds.SKILLS[skillId];
      const player = AppState.player;
      if (!player || !def) return false;
      if ((player.skills[skillId] || 0) <= 0) return false;
      if (player.coins < def.cost) {
        this._showToast(container, '金币不足！');
        return false;
      }
      // Consume
      player.coins -= def.cost;
      player.skills[skillId] -= 1;
      if (skillId === 'hint') {
        this._showToast(container, '💡 提示已激活（排除一个错误选项）');
        // Auto-trigger: hide one wrong option
        this._applyHint(container);
      } else if (skillId === 'shield') {
        state.shieldActive = true;
        this._showToast(container, '🛡️ 护盾已激活');
      } else if (skillId === 'crit') {
        state.critActive = true;
        this._showToast(container, '⚡ 下一击暴击！');
      }
      AppState.player = player;
      this._refreshSkillsBar(container, state);
      SkillsBar.updateCoins(container, player.coins);
      return true;
    },

    _applyHint(container) {
      // Find a WRONG option (not the correct one) and dim it.
      const opts = Array.from(container.querySelectorAll('.keg-option'));
      if (opts.length <= 1) return;
      const engine = window._currentEngine;
      const correctId = engine && engine.currentCorrectId;
      let wrongOpts;
      if (correctId != null) {
        wrongOpts = opts.filter(o => o.dataset.id !== String(correctId));
      } else {
        // Fallback: pick a random wrong one (may accidentally be correct)
        wrongOpts = opts.slice(0, -1);
      }
      if (wrongOpts.length === 0) return;
      const target = wrongOpts[Math.floor(Math.random() * wrongOpts.length)];
      target.classList.add('keg-option--hint');
      target.style.opacity = '0.35';
      target.style.pointerEvents = 'none';
    },

    _refreshSkillsBar(container, state) {
      // Only update the dynamic parts (count + disabled state) without re-rendering
      // the whole bar — that would interrupt ongoing CSS animations.
      if (!AppState.player || !AppState.player.skills) return;
      ['hint', 'shield', 'crit'].forEach(id => {
        const btn = container.querySelector(`.keg-skill[data-skill="${id}"]`);
        if (!btn) return;
        const count = AppState.player.skills[id] || 0;
        const def = Worlds.SKILLS[id];
        const cost = def.cost;
        const coins = AppState.player.coins || 0;
        const countEl = btn.querySelector('.keg-skill__count');
        if (countEl) countEl.textContent = '×' + count;
        const shouldDisable = count <= 0 || coins < cost || (state && state[id + 'Active']);
        btn.disabled = shouldDisable;
        btn.classList.toggle('keg-skill--owned', count > 0);
        btn.classList.toggle('keg-skill--empty', count <= 0);
      });
    },

    _showDamageNumber(container, dmg, isCrit) {
      const arena = container.querySelector('.keg-arena__scene');
      if (!arena) return;
      const monsterEl = arena.querySelector('.keg-arena__monster');
      if (!monsterEl) return;
      const rect = monsterEl.getBoundingClientRect();
      const arenaRect = arena.getBoundingClientRect();
      const x = rect.left - arenaRect.left + rect.width / 2 + (Math.random() * 30 - 15);
      const y = rect.top - arenaRect.top + 20;
      const float = document.createElement('div');
      float.className = 'keg-dmg-number' + (isCrit ? ' keg-dmg-number--crit' : '');
      float.textContent = '-' + dmg;
      float.style.left = x + 'px';
      float.style.top = y + 'px';
      arena.appendChild(float);
      // Burst particles
      Projectile.burst(arena, x, y + 20, isCrit ? '#ef4444' : '#facc15', isCrit ? 12 : 6);
      setTimeout(() => float.remove(), 900);
    },

    _showPlayerDamageNumber(container, dmg) {
      const arena = container.querySelector('.keg-arena__scene');
      if (!arena) return;
      const playerEl = arena.querySelector('.keg-arena__player');
      if (!playerEl) return;
      const rect = playerEl.getBoundingClientRect();
      const arenaRect = arena.getBoundingClientRect();
      const x = rect.left - arenaRect.left + rect.width / 2 + (Math.random() * 30 - 15);
      const y = rect.top - arenaRect.top + 20;
      const float = document.createElement('div');
      float.className = 'keg-dmg-number keg-dmg-number--taken';
      float.textContent = '-' + dmg;
      float.style.left = x + 'px';
      float.style.top = y + 'px';
      arena.appendChild(float);
      Projectile.burst(arena, x, y + 20, '#ef4444', 6);
      setTimeout(() => float.remove(), 900);
    },

    _showStreakCallout(container, streak) {
      const arena = container.querySelector('.keg-arena__scene');
      if (!arena) return;
      const callout = document.createElement('div');
      callout.className = 'keg-streak-callout';
      const labels = { 3: '连击!', 5: '出色!', 7: '完美!', 10: '神来之笔!' };
      callout.textContent = '🔥 ' + (labels[streak] || (streak + ' COMBO!'));
      arena.appendChild(callout);
      setTimeout(() => callout.remove(), 1200);
    },

    _showCritBanner(container) {
      const arena = container.querySelector('.keg-arena__scene');
      if (!arena) return;
      const banner = document.createElement('div');
      banner.className = 'keg-crit-banner';
      banner.textContent = '💥 暴击!';
      arena.appendChild(banner);
      setTimeout(() => banner.remove(), 900);
    },

    _showToast(container, msg) {
      const arena = container.querySelector('.keg-arena__scene') || container;
      const t = document.createElement('div');
      t.className = 'keg-toast';
      t.textContent = msg;
      arena.appendChild(t);
      setTimeout(() => t.remove(), 1500);
    },

    _endBattle(container, state, won) {
      if (state._ended) return;
      state._ended = true;
      state.busy = true;
      TTS.stop();

      const finishSequence = (onDone) => {
        if (won) {
          // Play monster death, then victory
          MonsterCard.playDeath(container.querySelector('#keg-arena-monster'), () => {
            onDone();
          });
        } else {
          onDone();
        }
      };

      finishSequence(() => {
        // Persist progress
        if (won && AppState.player) {
          API.submitProgress(AppState.nickname, {
            level: state.levelCfg.level,
            won: true,
            coinsEarned: state.levelCfg.reward.coins,
            correctCount: 0,
            totalRounds: state.totalRounds
          }).then(updated => { AppState.player = updated; })
            .catch(err => console.warn('保存进度失败', err));
        }
        this._showResultModal(container, state, won);
      });
    },

    _showResultModal(container, state, won) {
      const overlay = document.createElement('div');
      overlay.className = 'keg-battle-result keg-slide-in ' + (won ? 'keg-battle-result--win' : 'keg-battle-result--lose');
      // 3 stars: full HP remaining, 2 stars: 50%+, 1 star: <50%
      let stars;
      if (!won) {
        stars = '☆☆☆';
      } else {
        const maxPlayerHP = playerHPForLevel(state.levelCfg);
        const hpPct = maxPlayerHP > 0 ? (state.playerHP / maxPlayerHP) : 0;
        if (hpPct >= 0.75) stars = '⭐⭐⭐';
        else if (hpPct >= 0.4) stars = '⭐⭐☆';
        else stars = '⭐☆☆';
      }
      overlay.innerHTML = `
        <div class="keg-battle-result__panel">
          <div class="keg-battle-result__emoji">${won ? '🎉' : '💀'}</div>
          <h2>${won ? '胜利！' : '失败…'}</h2>
          ${won ? `<p>击败了 ${state.levelCfg.monsterName}，获得 ${state.levelCfg.reward.coins} 💰</p>` : '<p>再试一次吧！</p>'}
          <div class="keg-battle-result__stars">${stars}</div>
          <div class="keg-battle-result__stats">
            <div>造成伤害：<strong>${state.damageDealt}</strong></div>
            <div>受到伤害：<strong>${state.damageTaken}</strong></div>
            <div>最高连击：<strong>${state.streak}</strong></div>
          </div>
          <div class="keg-game__controls">
            <button class="keg-btn keg-btn--primary" id="btn-back-map">
              <span class="keg-btn__emoji">🗺️</span> 返回地图
            </button>
            ${won ? '' : '<button class="keg-btn keg-btn--ghost" id="btn-retry"><span class="keg-btn__emoji">🔄</span> 再战</button>'}
          </div>
        </div>
      `;
      container.appendChild(overlay);
      overlay.querySelector('#btn-back-map').addEventListener('click', () => App.go('world-map'));
      const retry = overlay.querySelector('#btn-retry');
      if (retry) retry.addEventListener('click', () => {
        AppState.currentLevel = state.levelCfg.level;
        App.go('battle');
      });
    },

    _onBattleEnd(container, state, stats) {
      // If the game module finishes (all rounds used) and monster is still alive, player loses.
      if (state.monsterHP > 0 && state.playerHP > 0 && !state._ended) {
        this._endBattle(container, state, false);
      } else if (state.monsterHP <= 0 && !state._ended) {
        this._endBattle(container, state, true);
      }
    }
  };

  window.BattleStage = BattleStage;
})();
