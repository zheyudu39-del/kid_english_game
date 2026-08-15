/**
 * api.js - fetch() wrappers for the score and vocabulary API
 * Exposed as window.API
 */
(function () {
  'use strict';

  async function request(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) {
      let msg = '网络请求失败';
      try {
        const body = await res.json();
        if (body && body.error) msg = body.error;
      } catch (err) { /* ignore */ }
      // Attach status code so callers can branch (e.g. 404 = not-found vs 500 = server error)
      const error = new Error(msg);
      error.status = res.status;
      error.url = url;
      throw error;
    }
    return res.json();
  }

  const API = {
    /**
     * Get leaderboard scores. Filters: { limit, age, game, nickname }
     * @returns {Promise<{scores: Array}>}
     */
    getScores(filters = {}) {
      const qs = new URLSearchParams();
      if (filters.limit) qs.set('limit', filters.limit);
      if (filters.age) qs.set('age', filters.age);
      if (filters.game) qs.set('game', filters.game);
      if (filters.nickname) qs.set('nickname', filters.nickname);
      return request('/api/scores?' + qs.toString());
    },

    /**
     * Submit a game result.
     * @param {object} payload { nickname, score, ageGroup, gameMode, category, roundsPlayed, correctCount }
     */
    submitScore(payload) {
      return request('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    /**
     * Get one player's score history.
     */
    getNicknameScores(nickname) {
      return request('/api/scores/' + encodeURIComponent(nickname));
    },

    /**
     * Get vocabulary filtered by age group.
     */
    getVocabulary(age) {
      return request('/api/vocabulary' + (age ? '?age=' + age : ''));
    },

    /**
     * Health check.
     */
    health() {
      return request('/api/health');
    },

    /**
     * Fetch (or auto-create) the campaign profile for a nickname.
     * @param {string} nickname
     * @param {number} [ageGroup]
     */
    getPlayer(nickname, ageGroup) {
      const qs = ageGroup != null ? ('?age=' + ageGroup) : '';
      return request('/api/players/' + encodeURIComponent(nickname) + qs);
    },

    /**
     * Persist a level result.
     * @param {string} nickname
     * @param {object} payload { level, won, coinsEarned, correctCount, totalRounds }
     */
    submitProgress(nickname, payload) {
      return request('/api/players/' + encodeURIComponent(nickname) + '/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    /**
     * Get a single level's configuration.
     * @param {number} levelNum
     */
    getLevel(levelNum) {
      return request('/api/levels/' + levelNum);
    }
  };

  window.API = API;
})();
