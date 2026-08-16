// api.js - Server communication for Word Hunter
// Only uses: vocabulary + player save/load
(function () {
  'use strict';

  const REQUEST_TIMEOUT = 30000; // 30 seconds
  const TOKEN_KEY = 'wordhunter:token';

  // Session token issued by /api/login and /api/register. Attached to every
  // request below; the server only honours it on endpoints that need proof
  // of identity (profile / progress / shop writes). Never stores anything
  // derived from the password.
  function sessionToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; }
    catch (e) { return ''; }
  }

  async function request(url, options) {
    const controller = new AbortController();
    // Keep the timer armed until the response body has been fully consumed
    // (finally block below). Clearing it right after fetch() resolved used
    // to leave res.json() body reads un-abortable, so a server that sent
    // headers but stalled the body could hang forever.
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    // Merge caller headers with the session token so every endpoint gets it.
    const headers = Object.assign({}, options && options.headers);
    const token = sessionToken();
    if (token) headers['X-Player-Token'] = token;

    try {
      const res = await fetch(url, {
        ...options,
        headers,
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

    // Fetch the caller's own profile. The server's ownership gate requires
    // the session token (attached by request()), so this only works while
    // logged in.
    getOwnProfile(name) {
      const caller = name && name.length ? name : this._currentPlayer();
      return request('/api/players/' + encodeURIComponent(caller || 'guest'));
    },

    // Look up the currently-logged-in nickname (if any) so callers don't
    // have to thread it through everywhere. Returns '' when not logged in.
    _currentPlayer() {
      try { return localStorage.getItem('wordhunter:logged-in') || ''; }
      catch (e) { return ''; }
    },

    // Store / drop the session token. Called by register.js after a
    // successful login and on logout / session invalidation.
    setToken(token) {
      try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        else localStorage.removeItem(TOKEN_KEY);
      } catch (e) { /* non-fatal */ }
    },

    // Current session token ('' when not logged in). net.js uses this to
    // authenticate the WebSocket connection.
    getToken() {
      return sessionToken();
    },

    submitProgress(name, payload) {
      // Server enforces that the caller's session token matches the
      // profile nickname. If the client passed an empty name, fall back to
      // the locally-logged-in nickname; if still empty, the request will
      // 401 — which is correct, because the player isn't really logged in.
      const caller = name && name.length ? name : this._currentPlayer();
      return request('/api/players/' + encodeURIComponent(caller || name || 'guest') + '/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    },

    // ---- Shop ----
    getShop() {
      return request('/api/shop');
    },

    // ---- Leaderboard ----
    // Rank players by cleared-level count. `nickname` additionally asks the
    // server for that player's own row + rank.
    getLevelLeaderboard(nickname, limit = 50) {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (nickname) qs.set('nickname', nickname);
      return request('/api/leaderboard/levels?' + qs.toString());
    },

    // Shop action endpoints write to the caller's profile, so the session
    // token (attached by request()) is what authorizes them.

    buyItem(name, itemId) {
      const caller = name && name.length ? name : this._currentPlayer();
      return request('/api/players/' + encodeURIComponent(caller || 'guest') + '/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });
    },

    equipWeapon(name, weaponId) {
      const caller = name && name.length ? name : this._currentPlayer();
      return request('/api/players/' + encodeURIComponent(caller || 'guest') + '/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weaponId })
      });
    },

    useItem(name, itemId) {
      const caller = name && name.length ? name : this._currentPlayer();
      return request('/api/players/' + encodeURIComponent(caller || 'guest') + '/use-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId })
      });
    }
  };

  window.API = API;
})();
