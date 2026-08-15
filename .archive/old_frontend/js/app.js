/**
 * app.js - SPA shell: hash router, global state, game dispatch
 * Exposed as window.App / window.AppState
 */
(function () {
  'use strict';

  const AppState = {
    nickname: '',
    ageGroup: null,        // 3, 5, 7, 9, 12, 15, 18, adult
    currentGame: null,     // game mode id (legacy / dev use)
    vocabulary: null,      // loaded from /api/vocabulary
    currentScore: 0,
    totalRounds: 10,
    correctCount: 0,
    category: 'mixed',

    // ---- 666-level campaign state ----
    player: null,          // { nickname, maxLevel, currentWorld, coins, skills, completedLevels, bossDefeated, ... }
    currentLevel: 1,       // selected level (1..666) for battle stage
    currentLevelCfg: null   // computed level config (monster, HP, difficulty, ...)
  };

  /**
   * Navigate to a route.
   * Supported routes: home, age-select, menu, game, results, ranking
   */
  function go(route) {
    window.location.hash = route;
  }

  /**
   * Render a page into the #app container.
   */
  function renderPage(html) {
    const app = document.getElementById('app');
    app.innerHTML = html;
    return app;
  }

  /**
   * Load vocabulary for the current age group into AppState.
   */
  async function loadVocabulary() {
    try {
      AppState.vocabulary = await API.getVocabulary(AppState.ageGroup);
    } catch (err) {
      AppState.vocabulary = null;
      console.warn('加载词库失败:', err);
    }
    return AppState.vocabulary;
  }

  // ---- route handlers -------------------------------------------------

  const routes = {
    home() {
      HomePage.render();
    },
    'age-select'() {
      if (!AppState.nickname) return routes.home();
      AgeSelectPage.render();
    },
    menu() {
      if (!AppState.nickname || AppState.ageGroup === null) return routes.home();
      MenuPage.render();
    },
    'world-map'() {
      if (!AppState.nickname || AppState.ageGroup === null) return routes.menu();
      WorldMapPage.render();
    },
    battle() {
      if (!AppState.nickname || AppState.ageGroup === null) return routes.menu();
      if (!AppState.currentLevel) return routes['world-map']();
      BattleStage.start();
    },
    game() {
      // Legacy single-game entry (kept for back-compat with menu buttons)
      if (!AppState.nickname || AppState.ageGroup === null || !AppState.currentGame) {
        return routes.menu();
      }
      GameShell.start();
    },
    results() {
      if (!AppState.nickname) return routes.home();
      ResultsPage.render();
    },
    ranking() {
      RankingPage.render();
    }
  };

  function dispatch() {
    const hash = window.location.hash.replace(/^#\/?/, '') || 'home';
    const route = routes[hash] || routes.home;
    route();
  }

  // ---- public API -----------------------------------------------------

  const App = {
    go,
    renderPage,
    loadVocabulary,
    dispatch,
    state: AppState
  };

  window.App = App;
  window.AppState = AppState;

  // Boot
  window.addEventListener('hashchange', dispatch);
  dispatch();
})();
