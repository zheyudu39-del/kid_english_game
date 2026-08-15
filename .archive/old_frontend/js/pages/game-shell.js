/**
 * game-shell.js - Hosts the active game. Dispatches to the right game module.
 * Exposed as window.GameShell
 */
(function () {
  'use strict';

  const gameModules = {
    'word-recognition': window.WordRecognitionGame,
    'listening':        window.ListeningGame,
    'spelling':         window.SpellingGame,
    'sentences':        window.SentencesGame
  };

  const GameShell = {
    start() {
      const module = gameModules[AppState.currentGame];
      if (!module) {
        App.go('menu');
        return;
      }

      const app = App.renderPage('<div id="game-container" style="width:100%"></div>');
      const container = app.querySelector('#game-container');

      module.start(container, AppState.vocabulary, (stats) => {
        // Game complete -> stash stats, go to results
        AppState.currentScore = stats.score;
        AppState.totalRounds = stats.totalRounds;
        AppState.correctCount = stats.correctCount;
        App.go('results');
      });
    }
  };

  window.GameShell = GameShell;
})();
