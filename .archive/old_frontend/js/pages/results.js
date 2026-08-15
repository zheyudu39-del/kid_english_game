/**
 * results.js - End-of-game results page
 * Shows score, stars, encouragement, and submits the score to the server.
 * Exposed as window.ResultsPage
 */
(function () {
  'use strict';

  function encouragement(score, totalRounds) {
    const pct = totalRounds > 0 ? score / (totalRounds * 20) : 0; // rough 0..1 scale
    if (pct >= 0.9) return { text: '完美！满分小天才！🧠', emoji: '🏆' };
    if (pct >= 0.7) return { text: '太厉害了！你是英语小达人！🌟', emoji: '🎉' };
    if (pct >= 0.5) return { text: '真棒！你学得很好！👏', emoji: '😄' };
    if (pct >= 0.3) return { text: '不错哦！越来越厉害了！💪', emoji: '😊' };
    return { text: '加油！多练习就会进步！🌈', emoji: '💛' };
  }

  function starCount(score, totalRounds) {
    const pct = score / (totalRounds * 20);
    if (pct >= 0.9) return 5;
    if (pct >= 0.7) return 4;
    if (pct >= 0.5) return 3;
    if (pct >= 0.3) return 2;
    return 1;
  }

  const ResultsPage = {
    render() {
      const stats = {
        score: AppState.currentScore,
        correctCount: AppState.correctCount,
        totalRounds: AppState.totalRounds
      };
      const msg = encouragement(stats.score, stats.totalRounds);
      const stars = starCount(stats.score, stats.totalRounds);
      const gameInfo = Utils.gameInfo(AppState.currentGame);

      const app = App.renderPage(`
        <div class="keg-results keg-slide-in">
          <div class="keg-results__stars" id="result-stars">
            ${'⭐'.repeat(stars)}
          </div>
          <h2 class="keg-title" style="font-size:38px">${msg.emoji} ${msg.text}</h2>
          <div class="keg-results__score" id="result-score">${stats.score} 分</div>
          <div class="keg-results__stats">
            答对 ${stats.correctCount} / ${stats.totalRounds} 题<br>
            游戏：${gameInfo.emoji} ${gameInfo.name}
          </div>

          <div class="keg-game__controls" style="margin-top:12px">
            <button class="keg-btn keg-btn--primary" id="btn-again">
              <span class="keg-btn__emoji">🔄</span> 再来一局
            </button>
            <button class="keg-btn keg-btn--gold" id="btn-home">
              <span class="keg-btn__emoji">🏠</span> 主页
            </button>
          </div>
          <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-ranking">
            <span class="keg-btn__emoji">🏆</span> 查看排行榜
          </button>
        </div>
      `);

      // Animate score counting up
      this._animateScore(app.querySelector('#result-score'), stats.score);
      if (stats.score > 0) Utils.showConfetti(stars >= 4 ? 60 : 30);

      // Submit score to server (best-effort, non-blocking)
      API.submitScore({
        nickname: AppState.nickname,
        score: stats.score,
        ageGroup: AppState.ageGroup,
        gameMode: AppState.currentGame,
        category: AppState.category,
        roundsPlayed: stats.totalRounds,
        correctCount: stats.correctCount
      }).catch(() => { /* offline / server error - silently ignore */ });

      app.querySelector('#btn-again').addEventListener('click', () => {
        Utils.playBeep('click');
        App.go('game');
      });
      app.querySelector('#btn-home').addEventListener('click', () => {
        Utils.playBeep('click');
        App.go('menu');
      });
      app.querySelector('#btn-ranking').addEventListener('click', () => {
        Utils.playBeep('click');
        App.go('ranking');
      });
    },

    _animateScore(el, target) {
      let current = 0;
      const step = Math.max(1, Math.round(target / 40));
      const timer = setInterval(() => {
        current += step;
        if (current >= target) {
          current = target;
          clearInterval(timer);
        }
        el.textContent = current + ' 分';
      }, 30);
    }
  };

  window.ResultsPage = ResultsPage;
})();
