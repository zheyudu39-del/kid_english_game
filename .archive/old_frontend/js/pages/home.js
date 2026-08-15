/**
 * home.js - Home page: nickname entry + start
 * Exposed as window.HomePage
 */
(function () {
  'use strict';

  const HomePage = {
    render() {
      const app = App.renderPage(`
        <div class="keg-slide-in" style="text-align:center;width:100%">
          <h1 class="keg-title"><span class="keg-rainbow-text">英语小达人</span></h1>
          <p class="keg-subtitle">English Learning Fun! 🌟</p>

          <div class="keg-form-group" style="margin-top:10px">
            <label class="keg-label" for="nickname-input">🧒 你的昵称</label>
            <input class="keg-input" id="nickname-input" type="text" maxlength="12"
                   placeholder="输入名字开始吧"
                   value="${Utils.escapeHtml(AppState.nickname)}"
                   autocomplete="off" />
          </div>

          <button class="keg-btn keg-btn--primary keg-btn--huge keg-pulse" id="btn-start">
            <span class="keg-btn__emoji">🚀</span> 开始学习！
          </button>

          <div style="height:16px"></div>

          <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-ranking">
            <span class="keg-btn__emoji">🏆</span> 排行榜
          </button>

          <div style="margin-top:36px;font-size:42px;letter-spacing:10px">
            <span class="keg-float">🐕</span>
            <span class="keg-float" style="animation-delay:0.3s">🐈</span>
            <span class="keg-float" style="animation-delay:0.6s">🐘</span>
            <span class="keg-float" style="animation-delay:0.9s">🦁</span>
            <span class="keg-float" style="animation-delay:1.2s">🐼</span>
            <span class="keg-float" style="animation-delay:1.5s">🦊</span>
          </div>
        </div>
      `);

      const input = app.querySelector('#nickname-input');
      const startBtn = app.querySelector('#btn-start');
      const rankingBtn = app.querySelector('#btn-ranking');

      input.focus();

      const start = () => {
        const nickname = input.value.trim();
        if (!nickname) {
          input.classList.add('keg-shake');
          Utils.playBeep('wrong');
          setTimeout(() => input.classList.remove('keg-shake'), 500);
          return;
        }
        Utils.playBeep('click');
        AppState.nickname = nickname;
        App.go('age-select');
      };

      startBtn.addEventListener('click', start);
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') start();
      });
      rankingBtn.addEventListener('click', () => {
        Utils.playBeep('click');
        App.go('ranking');
      });
    }
  };

  window.HomePage = HomePage;
})();
