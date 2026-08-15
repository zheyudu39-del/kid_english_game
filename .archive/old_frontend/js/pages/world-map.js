/**
 * world-map.js - World map with 6 worlds and 111 levels each.
 * Shows progress, lets the player pick an unlocked level.
 * Exposed as window.WorldMapPage
 */
(function () {
  'use strict';

  const WorldMapPage = {
    async render() {
      // Load player profile
      let player = AppState.player;
      if (!player) {
        try { player = await API.getPlayer(AppState.nickname, AppState.ageGroup); }
        catch (e) { console.warn('加载玩家失败', e); player = null; }
      }
      AppState.player = player;

      const maxLevel = (player && player.maxLevel) || 1;
      const currentWorld = (player && player.currentWorld) || 1;
      const completed = (player && player.completedLevels) || [];
      const coins = (player && player.coins) || 0;

      const app = App.renderPage(`
        <div class="keg-slide-in" style="width:100%;text-align:center">
          <div class="keg-map-topbar">
            <button class="keg-btn keg-btn--ghost keg-btn--small" id="btn-back">
              <span class="keg-btn__emoji">⬅️</span> 返回
            </button>
            <div class="keg-map-topbar__title">🌍 闯关地图</div>
            <div class="keg-map-topbar__coins">💰 ${coins}</div>
          </div>

          <div class="keg-world-tabs" id="world-tabs">
            ${Worlds.WORLDS.map(w => {
              const isCurrent = w.id === currentWorld;
              const isUnlocked = (player && (player.bossDefeated || []).includes(w.id - 1)) || w.id === 1;
              const isCompleted = (player && (player.bossDefeated || []).includes(w.id));
              const cls = [
                'keg-world-tab',
                isCurrent ? 'keg-world-tab--current' : '',
                !isUnlocked ? 'keg-world-tab--locked' : '',
                isCompleted ? 'keg-world-tab--completed' : ''
              ].join(' ');
              return `<button class="${cls}" data-world="${w.id}">
                <div class="keg-world-tab__emoji">${w.emoji}</div>
                <div class="keg-world-tab__name">${w.name}</div>
                ${isCompleted ? '<div class="keg-world-tab__check">✓</div>' : ''}
                ${!isUnlocked ? '<div class="keg-world-tab__lock">🔒</div>' : ''}
              </button>`;
            }).join('')}
          </div>

          <div id="world-detail"></div>
        </div>
      `);

      app.querySelector('#btn-back').addEventListener('click', () => App.go('menu'));
      app.querySelectorAll('.keg-world-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const wid = parseInt(tab.dataset.world, 10);
          if (tab.classList.contains('keg-world-tab--locked')) {
            Utils.playBeep('wrong');
            return;
          }
          this._renderWorld(app, wid, player);
        });
      });

      // Default to current world
      this._renderWorld(app, currentWorld, player);
    },

    _renderWorld(app, worldId, player) {
      const world = Worlds.WORLDS[worldId - 1];
      const levels = LevelGenerator.buildWorldMap(worldId);
      const maxLevel = (player && player.maxLevel) || 1;
      const completed = (player && player.completedLevels) || [];
      const detail = app.querySelector('#world-detail');
      detail.innerHTML = `
        <div class="keg-world-detail keg-slide-in" style="background:${world.bgGradient}">
          <div class="keg-world-detail__header">
            <div class="keg-world-detail__emoji">${world.emoji}</div>
            <div>
              <h2 class="keg-world-detail__name">${world.name}</h2>
              <p class="keg-world-detail__desc">${world.description} · ${world.levelRange[0]}-${world.levelRange[1]}关</p>
            </div>
          </div>

          <div class="keg-level-grid" id="level-grid">
            ${levels.map(l => {
              const unlocked = LevelGenerator.isUnlocked(l.level, player);
              const done = completed.includes(l.level);
              const isCurrent = l.level === maxLevel;
              let cls = 'keg-level';
              if (!unlocked) cls += ' keg-level--locked';
              else if (done) cls += ' keg-level--done';
              if (l.isBoss) cls += ' keg-level--boss';
              if (isCurrent) cls += ' keg-level--current';
              const stars = done ? '⭐⭐⭐' : (unlocked ? '☆☆☆' : '🔒');
              return `
                <button class="${cls}" data-level="${l.level}" ${unlocked ? '' : 'disabled'}>
                  <div class="keg-level__num">${l.isBoss ? '👑' : l.worldProgress}</div>
                  <div class="keg-level__type">${l.monsterEmoji}</div>
                  <div class="keg-level__stars">${stars}</div>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;

      detail.querySelectorAll('.keg-level').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          const lvl = parseInt(btn.dataset.level, 10);
          AppState.currentLevel = lvl;
          App.go('battle');
        });
      });
    }
  };

  window.WorldMapPage = WorldMapPage;
})();
