/**
 * age-select.js - Age group selection page
 * Exposed as window.AgeSelectPage
 */
(function () {
  'use strict';

  const AGES = [
    { code: 3, emoji: '🧸', title: '3-4岁', desc: '启蒙级 · 初识英语' },
    { code: 5, emoji: '🎨', title: '5-6岁', desc: '入门级 · 基础词句' },
    { code: 7, emoji: '📖', title: '7-8岁', desc: '进阶级 · 读写入门' },
    { code: 9, emoji: '🚀', title: '9-10岁', desc: '挑战级 · 自如表达' }
  ];

  const AgeSelectPage = {
    render() {
      const app = App.renderPage(`
        <div class="keg-slide-in" style="text-align:center;width:100%">
          <h2 class="keg-heading">你好，<span style="color:var(--keg-red)">${Utils.escapeHtml(AppState.nickname)}</span>！</h2>
          <p class="keg-subtitle">你今年几岁啦？🎈</p>

          <div class="keg-card-grid" id="age-grid">
            ${AGES.map((a, i) => `
              <div class="keg-card keg-pop" data-age="${a.code}" style="animation-delay:${i * 0.08}s">
                <div class="keg-card__emoji">${a.emoji}</div>
                <div class="keg-card__title">${a.title}</div>
                <div class="keg-card__desc">${a.desc}</div>
              </div>
            `).join('')}
          </div>

          <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-back">
            <span class="keg-btn__emoji">⬅️</span> 返回
          </button>
        </div>
      `);

      app.querySelectorAll('.keg-card').forEach(card => {
        card.addEventListener('click', () => {
          Utils.playBeep('click');
          AppState.ageGroup = parseInt(card.dataset.age, 10);
          App.go('menu');
        });
      });

      app.querySelector('#btn-back').addEventListener('click', () => {
        Utils.playBeep('click');
        App.go('home');
      });
    }
  };

  window.AgeSelectPage = AgeSelectPage;
})();
