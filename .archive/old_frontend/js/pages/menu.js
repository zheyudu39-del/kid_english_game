/**
 * menu.js - Main menu / hub page.
 * Primary CTA: start the 666-level campaign.
 * Secondary actions: dev/test legacy single-game modes + ranking.
 * Exposed as window.MenuPage
 */
(function () {
  'use strict';

  const GAMES = [
    { id: 'word-recognition', emoji: '🔤', name: '单词认知', desc: '看图识单词，打下词汇基础' },
    { id: 'listening',        emoji: '🔊', name: '听力反应', desc: '竖起小耳朵，听到选对图' },
    { id: 'spelling',         emoji: '✏️', name: '字母拼写', desc: '认识字母 ABC，学会拼单词' },
    { id: 'sentences',        emoji: '💬', name: '简单句对', desc: '学会日常英语对话' }
  ];

  const MenuPage = {
    async render() {
      // Pre-load player profile for the world preview banner
      let player = AppState.player;
      if (AppState.nickname) {
        try { player = await API.getPlayer(AppState.nickname, AppState.ageGroup); }
        catch (e) { console.warn('加载玩家失败', e); }
        AppState.player = player;
      }

      const maxLevel = (player && player.maxLevel) || 1;
      const coins = (player && player.coins) || 0;
      const bossDefeated = (player && player.bossDefeated || []).length;

      const app = App.renderPage(`
        <div class="keg-slide-in" style="text-align:center;width:100%">
          <h2 class="keg-heading">欢迎回来，${Utils.escapeHtml(AppState.nickname)}！</h2>
          <p class="keg-subtitle">${Utils.ageLabel(AppState.ageGroup)} · 已闯 ${Math.max(0, maxLevel - 1)} / 666 关</p>

          <div class="keg-card-grid" style="grid-template-columns:1fr;max-width:520px">
            <div class="keg-card keg-card--full keg-pop keg-card--campaign" id="btn-campaign">
              <div class="keg-card__emoji">⚔️</div>
              <div style="text-align:left">
                <div class="keg-card__title">开始闯关</div>
                <div class="keg-card__desc">挑战 666 关，从 3 岁到雅思 8 分 · 已击败 ${bossDefeated} 个 Boss · 💰 ${coins}</div>
              </div>
            </div>
          </div>

          <details class="keg-menu-legacy" style="margin-top:24px">
            <summary>练习单个游戏（不闯关）</summary>
            <div class="keg-card-grid" style="grid-template-columns:1fr 1fr;max-width:520px;margin-top:12px">
              ${GAMES.map((g, i) => `
                <div class="keg-card keg-card--full keg-pop" data-game="${g.id}" style="animation-delay:${i * 0.08}s">
                  <div class="keg-card__emoji">${g.emoji}</div>
                  <div style="text-align:left">
                    <div class="keg-card__title">${g.name}</div>
                    <div class="keg-card__desc">${g.desc}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </details>

          <div class="keg-game__controls">
            <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-back">
              <span class="keg-btn__emoji">⬅️</span> 换年龄
            </button>
            <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-ranking">
              <span class="keg-btn__emoji">🏆</span> 排行榜
            </button>
          </div>
        </div>
      `);

      app.querySelector('#btn-campaign').addEventListener('click', () => {
        Utils.playBeep('click');
        App.go('world-map');
      });
      app.querySelectorAll('.keg-menu-legacy .keg-card').forEach(card => {
        card.addEventListener('click', async () => {
          Utils.playBeep('click');
          AppState.currentGame = card.dataset.game;
          await App.loadVocabulary();
          App.go('game');
        });
      });
      app.querySelector('#btn-back').addEventListener('click', () => {
        Utils.playBeep('click');
        App.go('age-select');
      });
      app.querySelector('#btn-ranking').addEventListener('click', () => {
        Utils.playBeep('click');
        App.go('ranking');
      });
    }
  };

  window.MenuPage = MenuPage;
})();
