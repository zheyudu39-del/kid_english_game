/**
 * ranking.js - Leaderboard page
 * Exposed as window.RankingPage
 */
(function () {
  'use strict';

  const GAMES_FILTER = [
    { value: '', label: '全部游戏' },
    { value: 'word-recognition', label: '🔤 单词认知' },
    { value: 'listening', label: '🔊 听力反应' },
    { value: 'spelling', label: '✏️ 字母拼写' },
    { value: 'sentences', label: '💬 简单句对' }
  ];

  const AGE_FILTER = [
    { value: '', label: '全部年龄' },
    { value: '3', label: '3-4岁' },
    { value: '5', label: '5-6岁' },
    { value: '7', label: '7-8岁' },
    { value: '9', label: '9-10岁' }
  ];

  function rankIcon(i) {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return '⭐';
  }

  const RankingPage = {
    render() {
      const app = App.renderPage(`
        <div class="keg-ranking keg-slide-in">
          <h2 class="keg-heading">🏆 排行榜</h2>

          <div class="keg-ranking__filters">
            <select class="keg-input" id="filter-game" style="max-width:200px;font-size:16px;padding:10px 14px;width:auto">
              ${GAMES_FILTER.map(f => `<option value="${f.value}">${f.label}</option>`).join('')}
            </select>
            <select class="keg-input" id="filter-age" style="max-width:160px;font-size:16px;padding:10px 14px;width:auto">
              ${AGE_FILTER.map(f => `<option value="${f.value}">${f.label}</option>`).join('')}
            </select>
          </div>

          <div id="ranking-list" class="keg-ranking__table">
            <div class="keg-ranking__empty">加载中...</div>
          </div>

          <div class="keg-game__controls">
            <button class="keg-btn keg-btn--primary" id="btn-home">
              <span class="keg-btn__emoji">🏠</span> 返回
            </button>
          </div>
        </div>
      `);

      const listEl = app.querySelector('#ranking-list');
      const gameSelect = app.querySelector('#filter-game');
      const ageSelect = app.querySelector('#filter-age');

      const load = () => {
        listEl.innerHTML = '<div class="keg-ranking__empty">加载中...</div>';
        API.getScores({ limit: 20, age: ageSelect.value, game: gameSelect.value })
          .then(({ scores }) => {
            if (!scores || scores.length === 0) {
              listEl.innerHTML = '<div class="keg-ranking__empty">还没有成绩，快去玩一局吧！🎮</div>';
              return;
            }
            listEl.innerHTML = scores.map((s, i) => {
              const classes = ['keg-ranking__row'];
              if (i === 0) classes.push('keg-ranking__row--top1');
              if (i === 1) classes.push('keg-ranking__row--top2');
              if (i === 2) classes.push('keg-ranking__row--top3');
              if (s.nickname === AppState.nickname) classes.push('keg-ranking__row--me');
              const g = Utils.gameInfo(s.gameMode);
              return `
                <div class="${classes.join(' ')}">
                  <div class="keg-ranking__rank">${rankIcon(i)}</div>
                  <div class="keg-ranking__name">${Utils.escapeHtml(s.nickname)}
                    <span style="font-size:12px;color:var(--keg-light);font-weight:600">${g.emoji}${Utils.ageLabel(s.ageGroup).split('·')[0]}</span>
                  </div>
                  <div class="keg-ranking__score">${s.score}分</div>
                </div>
              `;
            }).join('');
          })
          .catch(err => {
            listEl.innerHTML = `<div class="keg-ranking__empty">加载失败：${Utils.escapeHtml(err.message)}</div>`;
          });
      };

      gameSelect.addEventListener('change', load);
      ageSelect.addEventListener('change', load);
      app.querySelector('#btn-home').addEventListener('click', () => {
        Utils.playBeep('click');
        App.go('home');
      });

      load();
    }
  };

  window.RankingPage = RankingPage;
})();
