// api.js - Server communication for Word Hunter
// Only uses: vocabulary + player save/load
(function () {
  'use strict';

  const REQUEST_TIMEOUT = 30000; // 30 seconds

  async function request(url, options) {
    const controller = new AbortController();
    // Keep the timer armed until the response body has been fully consumed
    // (finally block below). Clearing it right after fetch() resolved used
    // to leave res.json() body reads un-abortable, so a server that sent
    // headers but stalled the body could hang forever.
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      if (!res.ok) {
        let msg = `请求失败 (${res.status})`;
        let details = '';
        
        // Try to parse error details from response
        try {
          const body = await res.json();
          if (body) {
            if (body.error) msg = body.error;
            if (body.message) details = body.message;
            if (body.details) details = body.details;
          }
        } catch (e) {
          // Response body is not JSON or empty
          try {
            details = await res.text();
            if (details && details.length < 200) {
              msg += ': ' + details.trim();
            }
          } catch (e2) {
            // Ignore text parsing errors
          }
        }

        const err = new Error(msg);
        err.status = res.status;
        err.details = details;
        err.url = url;
        throw err;
      }

      // 204 / empty responses carry no JSON payload.
      if (res.status === 204) return null;

      // Validate Content-Type for JSON responses (case-insensitive: a
      // server could send 'Application/JSON' or 'application/json;
      // charset=utf-8').
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        throw new Error(`服务器返回了无效的数据格式 (${contentType || '无Content-Type'})`);
      }

      try {
        return await res.json();
      } catch (e) {
        // Body claimed JSON but failed to parse (truncated / empty).
        throw new Error('服务器返回了无法解析的数据');
      }
    } catch (err) {
      // Handle network errors (no response from server)
      if (err.name === 'AbortError') {
        // A genuine timeout: fetch() or the body read was aborted by the
        // timer above. This is also the right classification when a slow
        // body read trips the timer.
        throw new Error('请求超时，请检查网络连接后重试');
      }
      if (err instanceof TypeError && err.message.includes('fetch')) {
        throw new Error('无法连接到服务器，请检查网络连接');
      }
      
      // Re-throw other errors (already formatted above)
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const API = {
    getVocabulary(age) {
      return request('/api/vocabulary' + (age != null ? '?age=' + age : ''));
    },

    getPlayer(name, age) {
      const qs = age != null ? '?age=' + age : '';
      return request('/api/players/' + encodeURIComponent(name) + qs);
    },

    // Look up the currently-logged-in nickname (if any) so callers don't
    // have to thread it through everywhere. Returns '' when not logged in.
    _currentPlayer() {
      try { return localStorage.getItem('wordhunter:logged-in') || ''; }
      catch (e) { return ''; }
    },

    submitProgress(name, payload) {
      // Server enforces that the caller owns the profile (X-Player == nickname).
      // If the client passed an empty name, fall back to the locally-logged-in
      // nickname; if still empty, the request will 401 — which is correct,
      // because the player isn't really logged in.
      const caller = name && name.length ? name : this._currentPlayer();
      const headers = { 'Content-Type': 'application/json' };
      if (caller) headers['X-Player'] = caller;
      return request('/api/players/' + encodeURIComponent(caller || name || 'guest') + '/progress', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
    },

    submitScore(payload) {
      return request('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    },

    getScores(filters = {}) {
      // Forward every filter the server supports (limit / age / game /
      // nickname); previously only `limit` was passed and the other
      // filters were silently dropped, returning the unfiltered global
      // leaderboard to callers that asked for a specific slice.
      const qs = new URLSearchParams();
      if (filters.limit) qs.set('limit', filters.limit);
      if (filters.age != null && filters.age !== '') qs.set('age', filters.age);
      if (filters.game) qs.set('game', filters.game);
      if (filters.nickname) qs.set('nickname', filters.nickname);
      return request('/api/scores?' + qs.toString());
    },

    // 666-level generator: lightweight metadata for all levels (~5KB).
    // Returned shape: { totalLevels, worlds, levels: [{level, world, isBoss, difficulty, monsterType}] }
    getLevels() {
      return request('/api/levels');
    },

    // Full battle config for one level: { level, world, worldProgress, isBoss, difficulty, monsterHP, monsterType, monsterName, reward }
    getLevel(id) {
      return request('/api/levels/' + encodeURIComponent(id));
    },

    // Registration
    register(nickname, password, age) {
      return request('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, password, age })
      });
    },

    // Login
    login(nickname, password) {
      return request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, password })
      });
    }
  };

  window.API = API;
})();
