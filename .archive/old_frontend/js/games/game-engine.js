/**
 * game-engine.js - Shared round-loop engine used by all 4 game modes.
 *
 * Responsibilities: progress bar, score/streak tracking, round lifecycle.
 * Each game module renders its own question content into the stage element
 * and calls engine.submitAnswer(isCorrect) then engine.nextRound().
 *
 * Exposed as window.GameEngine
 */
(function () {
  'use strict';

  class GameEngine {
    /**
     * @param {object} opts
     *   container       - DOM element to render the game into
     *   totalRounds     - number of rounds
     *   pointsCorrect   - base points per correct answer (default 10)
     *   streakBonus     - extra points per consecutive streak (default 2)
     *   onRoundStart    - (roundIndex, engine) => void; game builds its round here
     *   onGameEnd       - (stats) => void
     */
    constructor(opts) {
      this.container = opts.container;
      this.totalRounds = opts.totalRounds || 10;
      this.pointsCorrect = opts.pointsCorrect || 10;
      this.streakBonus = opts.streakBonus || 2;
      this.onRoundStart = opts.onRoundStart || function () {};
      this.onGameEnd = opts.onGameEnd || function () {};

      this.round = 0;
      this.score = 0;
      this.correctCount = 0;
      this.streak = 0;
      this.maxStreak = 0;
      this._locked = false;

      this.stage = null;
      this.controls = null;
      this.currentCorrectId = null; // Set by game modules in onRoundStart

      // Publish so the battle stage can monkey-patch submitAnswer
      window._currentEngine = this;
    }

    /** Render the game frame (top bar + stage + controls) and begin. */
    start() {
      this.container.innerHTML = `
        <div class="keg-game keg-slide-in">
          <div class="keg-game__topbar">
            <div class="keg-game__progress"><div class="keg-game__progress-fill"></div></div>
            <div class="keg-game__round">第 1 / ${this.totalRounds} 题</div>
            <div class="keg-game__score">⭐ 0</div>
          </div>
          <div class="keg-game__streak" id="keg-streak"></div>
          <div class="keg-game__stage"></div>
          <div class="keg-game__controls"></div>
        </div>
      `;
      this.stage = this.container.querySelector('.keg-game__stage');
      this.controls = this.container.querySelector('.keg-game__controls');
      this._updateTopBar();
      this.nextRound();
    }

    /** Advance to the next round, or end the game. */
    nextRound() {
      if (this._locked) return;
      this.round++;
      if (this.round > this.totalRounds) {
        this._finish();
        return;
      }
      this._updateTopBar();
      this.stage.innerHTML = '';
      this.controls.innerHTML = '';
      this.onRoundStart(this.round, this);
    }

    /**
     * Register an answer. Returns current stats.
     * @returns {object} { isCorrect, score, streak, correctCount }
     */
    submitAnswer(isCorrect) {
      if (this._locked) return null;
      if (isCorrect) {
        this.correctCount++;
        this.streak++;
        this.maxStreak = Math.max(this.maxStreak, this.streak);
        // Streak bonus: +2 per streak level beyond 1, capped at 5
        const bonus = this.streak >= 2 ? Math.min(this.streak, 5) * this.streakBonus : 0;
        this.score += this.pointsCorrect + bonus;
      } else {
        this.streak = 0;
      }
      this._updateTopBar();
      if (this.streak >= 3 && isCorrect) Utils.showConfetti(20);

      return {
        isCorrect,
        score: this.score,
        streak: this.streak,
        correctCount: this.correctCount
      };
    }

    /**
     * Lock input during the feedback delay. Auto-unlocks after `ms`.
     */
    lock(ms = 1600) {
      this._locked = true;
      setTimeout(() => { this._locked = false; }, ms);
    }

    /**
     * Unlock input early (used when the player clicks "Next").
     */
    unlock() {
      this._locked = false;
    }

    getStats() {
      return {
        score: this.score,
        correctCount: this.correctCount,
        totalRounds: this.totalRounds,
        maxStreak: this.maxStreak
      };
    }

    // -------------------------------------------------- internals

    _updateTopBar() {
      const bar = this.container.querySelector('.keg-game__progress-fill');
      if (bar) {
        const pct = this.round === 0 ? 0 : Math.min(100, Math.round((this.round - (this._locked ? 1 : 0)) / this.totalRounds * 100));
        bar.style.width = pct + '%';
      }
      const roundEl = this.container.querySelector('.keg-game__round');
      if (roundEl) roundEl.textContent = `第 ${Math.min(this.round, this.totalRounds)} / ${this.totalRounds} 题`;
      const scoreEl = this.container.querySelector('.keg-game__score');
      if (scoreEl) scoreEl.textContent = `⭐ ${this.score}`;
      const streakEl = this.container.querySelector('#keg-streak');
      if (streakEl) {
        if (this.streak >= 2) {
          streakEl.textContent = `🔥 连击 x${this.streak}`;
          streakEl.style.visibility = 'visible';
        } else {
          streakEl.style.visibility = 'hidden';
        }
      }
    }

    _finish() {
      TTS.stop();
      const stats = this.getStats();
      if (typeof this.onGameEnd === 'function') this.onGameEnd(stats);
    }
  }

  window.GameEngine = GameEngine;
})();
