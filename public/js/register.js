// register.js - Registration and login functionality
(function () {
  'use strict';

  // Guard against double-execution (e.g. the bundle injected twice):
  // init() binds several listeners without dataset guards, so a second run
  // would double-submit login/register forms and double-toast.
  if (window.__wordhunterRegisterBooted) return;
  window.__wordhunterRegisterBooted = true;

  // DOM elements
  let registerModal, loginModal, registerForm, loginForm, closeButtons;
  let game = null;
  // The element that had focus before a modal opened — restored on close.
  let lastFocus = null;
  // Player name displayed in the title-screen auth area (set after login)
  let loggedInNickname = null;

  // Mirror of server's NICKNAME_RE so we can pre-validate before hitting the API.
  // 1-12 chars: alphanumerics, CJK, underscore, hyphen.
  const NICKNAME_RE = /^[A-Za-z0-9_\-\u4e00-\u9fa5]{1,12}$/;
  const PASSWORD_MIN = 6;
  const PASSWORD_MAX = 64;
  const LOGGED_IN_KEY = 'wordhunter:logged-in';

  // Initialize when DOM is ready
  function init() {
    // Get DOM elements
    registerModal = document.getElementById('register-modal');
    loginModal = document.getElementById('login-modal');
    registerForm = document.getElementById('register-form');
    loginForm = document.getElementById('login-form');
    closeButtons = document.querySelectorAll('.close-modal-btn');

    // Inject aria-live regions for form errors so screen readers announce
    // them, then add a logout button to the title screen if not already there.
    ensureAriaLiveRegions();
    ensureLogoutButton();
    ensureLoggedInBadge();
    ensureModalLinks();

    // Wire up buttons
    document.getElementById('btn-show-register')?.addEventListener('click', showRegisterModal);
    document.getElementById('btn-show-login')?.addEventListener('click', showLoginModal);

    // Close modal buttons
    closeButtons.forEach(btn => {
      btn.addEventListener('click', hideAllModals);
    });

    // Close modal when clicking outside
    registerModal?.addEventListener('click', (e) => {
      if (e.target === registerModal) hideAllModals();
    });
    loginModal?.addEventListener('click', (e) => {
      if (e.target === loginModal) hideAllModals();
    });

    // ESC closes any open auth modal — accessibility requirement.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (isAnyModalOpen()) {
          e.preventDefault();
          hideAllModals();
        }
      }
    });

    // Trap Tab focus inside the open modal so keyboard users can't tab
    // out into the (visually hidden) background.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const open = getOpenModal();
      if (!open) return;
      const focusables = getFocusable(open);
      if (focusables.length === 0) {
        // Keep focus on the modal itself
        e.preventDefault();
        open.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Form submissions
    registerForm?.addEventListener('submit', handleRegister);
    loginForm?.addEventListener('submit', handleLogin);

    // Age selection in register form
    const ageButtons = registerModal?.querySelectorAll('.age-btn');
    if (ageButtons) {
      ageButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          ageButtons.forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          // Store selected age on form
          registerForm.dataset.selectedAge = btn.dataset.age;
        });
      });
      // Set default age to 7
      const defaultAgeBtn = registerModal.querySelector('.age-btn[data-age="7"]');
      if (defaultAgeBtn) {
        defaultAgeBtn.classList.add('selected');
        registerForm.dataset.selectedAge = '7';
      }
    }

    // Get game instance
    game = window._game;

    // Wait for game if not ready yet (defer-loaded main.js)
    waitForGame();
  }

  function waitForGame() {
    if (window._game) { game = window._game; restoreSession(); return; }
    let tries = 0;
    const t = setInterval(() => {
      if (window._game) {
        game = window._game;
        clearInterval(t);
        restoreSession();
      } else if (++tries > 50) {
        clearInterval(t);
        restoreSession(); // Proceed without game handle
      }
    }, 20);
  }

  function ensureAriaLiveRegions() {
    // Add an aria-live region inside each form for screen-reader error
    // announcements. The question modal already has aria-live on
    // #modal-feedback; auth forms had none.
    if (registerForm && !registerForm.querySelector('.form-error')) {
      const live = document.createElement('div');
      live.className = 'form-error';
      live.setAttribute('role', 'alert');
      live.setAttribute('aria-live', 'assertive');
      live.style.cssText = 'min-height:1em;color:#ff4757;font-weight:700;margin:8px 0;';
      registerForm.appendChild(live);
    }
    if (loginForm && !loginForm.querySelector('.form-error')) {
      const live = document.createElement('div');
      live.className = 'form-error';
      live.setAttribute('role', 'alert');
      live.setAttribute('aria-live', 'assertive');
      live.style.cssText = 'min-height:1em;color:#ff4757;font-weight:700;margin:8px 0;';
      loginForm.appendChild(live);
    }
  }

  function ensureLogoutButton() {
    // Prefer the static #btn-logout in HTML. If present, just attach handler
    // (guarded against re-init). Fall back to injecting one for safety.
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      if (!logoutBtn.dataset.wired) {
        logoutBtn.addEventListener('click', handleLogout);
        logoutBtn.dataset.wired = '1';
      }
      return;
    }
    const titleForm = document.querySelector('.title-form');
    if (!titleForm) return;
    const btn = document.createElement('button');
    btn.id = 'btn-logout';
    btn.type = 'button';
    btn.className = 'big-btn ghost';
    btn.style.cssText = 'display:none;margin-top:8px;';
    btn.innerHTML = '<span class="btn-emoji" aria-hidden="true">🚪</span><span>退出登录</span>';
    btn.setAttribute('aria-label', '退出当前账号');
    btn.addEventListener('click', handleLogout);
    titleForm.appendChild(btn);
  }

  function ensureLoggedInBadge() {
    // Prefer the static #user-status in HTML; fall back to #logged-in-badge.
    if (document.getElementById('user-status')) return;
    if (document.getElementById('logged-in-badge')) return;
    const titleForm = document.querySelector('.title-form');
    if (!titleForm) return;
    const badge = document.createElement('div');
    badge.id = 'logged-in-badge';
    badge.style.cssText = 'display:none;margin-top:4px;font-size:13px;color:#2ed573;font-weight:800;';
    titleForm.insertBefore(badge, document.getElementById('save-info'));
  }

  function ensureModalLinks() {
    // Wire the "切换到注册/登录" links inside each modal (HTML uses
    // #link-to-register / #link-to-login). They are <a href="#"> so we
    // must preventDefault and switch the modal.
    const toRegister = document.getElementById('link-to-register');
    if (toRegister && !toRegister.dataset.wired) {
      toRegister.addEventListener('click', (e) => { e.preventDefault(); showRegisterModal(); });
      toRegister.dataset.wired = '1';
    }
    const toLogin = document.getElementById('link-to-login');
    if (toLogin && !toLogin.dataset.wired) {
      toLogin.addEventListener('click', (e) => { e.preventDefault(); showLoginModal(); });
      toLogin.dataset.wired = '1';
    }
  }

  function isAnyModalOpen() {
    return isModalOpen(registerModal) || isModalOpen(loginModal);
  }

  function isModalOpen(m) {
    return m && !m.classList.contains('hidden');
  }

  function getOpenModal() {
    if (isModalOpen(registerModal)) return registerModal;
    if (isModalOpen(loginModal)) return loginModal;
    return null;
  }

  function getFocusable(root) {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(root.querySelectorAll(sel)).filter(function (el) {
      return el.offsetParent !== null || el === root;
    });
  }

  function setFormError(form, msg) {
    if (!form) return;
    const live = form.querySelector('.form-error');
    if (live) live.textContent = msg || '';
    if (msg) Utils.toast(msg);
  }

  // Toggle a submit button into a loading state and back. Returns a
  // release function callers MUST invoke (typically in a finally block).
  function setSubmitLoading(form, isLoading, loadingText) {
    const submitBtn = form?.querySelector('button[type="submit"]');
    if (!submitBtn) return () => {};
    if (isLoading) {
      if (!submitBtn.dataset.originalText) {
        submitBtn.dataset.originalText = submitBtn.textContent;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = loadingText || '处理中...';
    } else {
      submitBtn.disabled = false;
      if (submitBtn.dataset.originalText) {
        submitBtn.textContent = submitBtn.dataset.originalText;
        delete submitBtn.dataset.originalText;
      }
    }
    return () => setSubmitLoading(form, false, loadingText);
  }

  // Map an error from API.register/login to a user-facing Chinese message.
  function describeError(err, fallback) {
    if (!err) return fallback || '操作失败';
    if (err.message === '请求超时，请检查网络连接后重试') return '请求超时，请检查网络后重试';
    if (err.message && err.message.indexOf('无法连接到服务器') !== -1) return '无法连接到服务器，请检查网络';
    if (err.status === 401) return '昵称或密码错误';
    if (err.status === 409) return '该昵称已被注册';
    if (err.status === 429) return '请求太频繁，请稍后再试';
    if (err.status === 400) return err.message || '请求参数有误，请检查输入';
    if (err.status === 503) return '服务器繁忙，请稍后重试';
    if (err.status >= 500) return '服务器开了小差，请稍后重试';
    if (err.message && err.message.indexOf('无效的数据格式') !== -1) return '服务器返回异常，请稍后重试';
    return err.message || fallback || '操作失败';
  }

  // ---- Validation helpers ----
  // Returns an error message string or null if the value is OK.
  function validateNickname(nickname) {
    if (!nickname || nickname.length === 0) return '请输入昵称';
    if (nickname.length > 12) return '昵称最多 12 个字符';
    if (!NICKNAME_RE.test(nickname)) return '昵称只能包含字母、数字、汉字、下划线或连字符';
    return null;
  }
  function validatePassword(password) {
    if (!password || password.length === 0) return '请输入密码';
    if (password.length < PASSWORD_MIN) return '密码至少需要 ' + PASSWORD_MIN + ' 位';
    if (password.length > PASSWORD_MAX) return '密码最多 ' + PASSWORD_MAX + ' 位';
    return null;
  }

  function showRegisterModal() {
    // Close any other modal FIRST. hideAllModals() resumes a game that a
    // previous modal had paused; if we paused the game before hiding, the
    // resume inside hideAllModals() would immediately undo our pause and
    // the game would keep running (and reading input) underneath this
    // modal. Pause AFTER hiding so the pause sticks.
    hideAllModals();
    lastFocus = document.activeElement;
    if (game && game.pauseForModal) game.pauseForModal();
    registerModal?.classList.remove('hidden');
    // Clear form
    if (registerForm) {
      registerForm.reset();
      setFormError(registerForm, '');
      // Reset age selection
      const ageButtons = registerModal.querySelectorAll('.age-btn');
      ageButtons.forEach(b => b.classList.remove('selected'));
      const defaultAgeBtn = registerModal.querySelector('.age-btn[data-age="7"]');
      if (defaultAgeBtn) {
        defaultAgeBtn.classList.add('selected');
        registerForm.dataset.selectedAge = '7';
      }
    }
    focusFirstField(registerModal);
  }

  function showLoginModal() {
    // Same ordering as showRegisterModal(): hide (which may resume a
    // previous modal's pause) BEFORE pausing for this modal.
    hideAllModals();
    lastFocus = document.activeElement;
    if (game && game.pauseForModal) game.pauseForModal();
    loginModal?.classList.remove('hidden');
    // Pre-fill with the last logged-in nickname (no password) for convenience.
    if (loginForm) {
      const savedNickname = (() => { try { return localStorage.getItem(LOGGED_IN_KEY); } catch (e) { return null; } })();
      const nicknameField = loginForm.querySelector('#login-nickname');
      const passwordField = loginForm.querySelector('#login-password');
      if (nicknameField) nicknameField.value = savedNickname || '';
      if (passwordField) passwordField.value = '';
      setFormError(loginForm, '');
    }
    focusFirstField(loginModal);
  }

  function focusFirstField(modal) {
    if (!modal) return;
    // Try to focus the first input; otherwise the modal itself.
    const target = modal.querySelector('input, button, [tabindex]') || modal;
    // Tabindex the modal so it can take focus if no children can.
    if (!modal.hasAttribute('tabindex')) modal.setAttribute('tabindex', '-1');
    try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
  }

  function hideAllModals() {
    registerModal?.classList.add('hidden');
    loginModal?.classList.add('hidden');
    // Clear any leftover errors so the next open is fresh
    if (registerForm) setFormError(registerForm, '');
    if (loginForm) setFormError(loginForm, '');
    // Restore the focus we snapshotted on open — and resume the game
    // only if we were the ones who paused it.
    if (game && game.isModalPaused && game.isModalPaused()) {
      game.resumeFromModal();
    }
    // resumeFromModal() deliberately skips unpausing/unlocking when the
    // level is no longer PLAYING (e.g. a pending endLevel timer resolved
    // while the auth modal was open). The input lock set by
    // pauseForModal() would then survive and freeze the next level —
    // getMoveVector() returns a zero vector while locked. Release any
    // lock that no modal pause owns anymore.
    if (game && game.input &&
        typeof game.input.isLocked === 'function' &&
        typeof game.input.setLocked === 'function' &&
        game.input.isLocked() && game.state !== 'playing') {
      game.input.setLocked(false);
    }
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus({ preventScroll: true }); } catch (e) { lastFocus.focus(); }
    }
    lastFocus = null;
  }

  // Fetch the authoritative profile for the locally "logged-in" nickname.
  // Delegates to the shared API client (which attaches the session token
  // and normalizes errors: `.status` on HTTP failures, none on network
  // errors / timeouts). Resolves with the player JSON.
  function fetchProfile(nickname) {
    return window.API.getOwnProfile(nickname);
  }

  // Silently drop an invalid local session (account deleted / password
  // changed server-side) and reset the title screen to the guest state.
  function clearSession() {
    try { localStorage.removeItem(LOGGED_IN_KEY); } catch (e) { /* non-fatal */ }
    if (window.API && window.API.setToken) window.API.setToken(null);
    loggedInNickname = null;
    const nameInput = document.getElementById('player-name');
    const startBtn = document.getElementById('btn-start');
    if (nameInput) nameInput.value = '';
    if (startBtn) startBtn.disabled = true;
    const saveInfo = document.getElementById('save-info');
    if (saveInfo) saveInfo.textContent = '';
    updateLoggedInUI();
    document.dispatchEvent(new CustomEvent('wordhunter:session-cleared'));
  }

  async function restoreSession() {
    let stored = null;
    try { stored = localStorage.getItem(LOGGED_IN_KEY); } catch (e) { return; }
    if (!stored) return;
    const nickname = stored;
    loggedInNickname = nickname;
    const nameInput = document.getElementById('player-name');
    const startBtn = document.getElementById('btn-start');
    if (nameInput) nameInput.value = nickname;
    if (startBtn) startBtn.disabled = false;

    // Verify against the server so a deleted account (or a session the
    // server no longer honours) can't silently leave a fake "已登录 ·
    // 进度已同步" UI. On success we also pull the authoritative progress
    // (maxLevel / coins / ageGroup) into the game instance.
    let profile = null;
    try {
      profile = await fetchProfile(nickname);
    } catch (err) {
      if (err && (err.status === 401 || err.status === 404)) {
        // Account no longer exists / ownership check failed — log out
        // instead of pretending everything is fine.
        console.warn('Session restore: invalid local session for "' + nickname + '", logging out.');
        clearSession();
        Utils.toast('登录状态已失效，请重新登录');
        return;
      }
      // Network failure / timeout: keep the local session (offline-
      // friendly) but we have no server progress, so main.js's
      // updateStartButton() will fall back to the local save for this
      // nickname.
      console.warn('Session restore: server unreachable, keeping local session:', err && err.message);
    }

    if (profile && game) {
      game.playerName = nickname;
      game.ageGroup = profile.ageGroup || game.ageGroup;
      const total = window.Levels.TOTAL_LEVELS;
      game.maxUnlocked = Math.max(1, Math.min(total, parseInt(profile.maxLevel, 10) || 1));
      if (typeof profile.coins === 'number' && Number.isFinite(profile.coins)) {
        game.coins = profile.coins;
      }
      // Shop state lives in the same profile; pull it now so a purchased
      // weapon / consumables work immediately after a page refresh without
      // the player having to open the shop first.
      if (typeof profile.equippedWeapon === 'string' && profile.equippedWeapon) {
        game.equippedWeapon = profile.equippedWeapon;
      }
      if (profile.inventory && typeof profile.inventory === 'object') {
        game.inventory = profile.inventory;
        game.items = Object.assign({}, profile.inventory.items || {});
      }
    }
    updateLoggedInUI();
    // Let main.js re-render the title-screen progress from the freshly
    // synced game state.
    document.dispatchEvent(new CustomEvent('wordhunter:session-restored'));
  }

  function updateLoggedInUI() {
    const logoutBtn = document.getElementById('btn-logout');
    const staticBadge = document.getElementById('user-status');
    const legacyBadge = document.getElementById('logged-in-badge');
    const startBtn = document.getElementById('btn-start');
    const loginBtn = document.getElementById('btn-show-login');
    const registerBtn = document.getElementById('btn-show-register');

    if (loggedInNickname) {
      if (logoutBtn) logoutBtn.classList.remove('hidden');
      if (staticBadge) {
        staticBadge.classList.remove('hidden');
        staticBadge.textContent = '👋 已登录: ' + loggedInNickname + ' · 进度已同步';
      }
      if (legacyBadge) {
        legacyBadge.style.display = '';
        legacyBadge.textContent = '已登录: ' + loggedInNickname;
      }
      if (loginBtn) loginBtn.classList.add('hidden');
      if (registerBtn) registerBtn.classList.add('hidden');
      // "继续狩猎" if progress > 1, else "开始狩猎"
      if (startBtn) {
        const span = startBtn.querySelector('span:nth-child(2)');
        if (span) {
          span.textContent = (game && game.maxUnlocked && game.maxUnlocked > 1)
            ? '继续狩猎' : '开始狩猎';
        }
      }
    } else {
      if (logoutBtn) logoutBtn.classList.add('hidden');
      if (staticBadge) {
        staticBadge.classList.add('hidden');
        staticBadge.textContent = '';
      }
      if (legacyBadge) {
        legacyBadge.style.display = 'none';
        legacyBadge.textContent = '';
      }
      if (loginBtn) loginBtn.classList.remove('hidden');
      if (registerBtn) registerBtn.classList.remove('hidden');
      if (startBtn) {
        const span = startBtn.querySelector('span:nth-child(2)');
        if (span) span.textContent = '开始狩猎';
      }
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    // Guard against duplicate submissions: disabling the submit button does
    // NOT stop Enter-key implicit form submission, which would fire a
    // second concurrent register request.
    if (registerForm.dataset.submitting === '1') return;

    const nickname = registerForm.querySelector('#register-nickname').value.trim();
    const password = registerForm.querySelector('#register-password').value;
    const confirmPassword = registerForm.querySelector('#register-confirm-password').value;
    const age = parseInt(registerForm.dataset.selectedAge || '7', 10);

    // Client-side validation
    const nickErr = validateNickname(nickname);
    if (nickErr) { setFormError(registerForm, nickErr); return; }
    const pwErr = validatePassword(password);
    if (pwErr) { setFormError(registerForm, pwErr); return; }
    if (password !== confirmPassword) {
      setFormError(registerForm, '两次输入的密码不一致');
      // Highlight the mismatch so the user knows which field to fix
      registerForm.querySelector('#register-confirm-password').focus();
      return;
    }
    setFormError(registerForm, '');
    registerForm.dataset.submitting = '1';

    // Disable submit button to prevent duplicate submissions
    const release = setSubmitLoading(registerForm, true, '注册中...');

    try {
      // Use shared API client (gives us timeout + 4xx/5xx error handling)
      await API.register(nickname, password, age);

      Utils.toast('注册成功！请登录');
      release();
      hideAllModals();
      // Show login modal with the registered nickname
      showLoginModal();
      const loginNickname = loginForm?.querySelector('#login-nickname');
      if (loginNickname) loginNickname.value = nickname;
      const loginPassword = loginForm?.querySelector('#login-password');
      if (loginPassword) {
        loginPassword.value = '';
        loginPassword.focus();
      }
    } catch (err) {
      console.error('Register error:', err);
      setFormError(registerForm, describeError(err, '注册失败'));
      release();
    } finally {
      delete registerForm.dataset.submitting;
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    // Guard against duplicate submissions: Enter-key implicit submission
    // still fires even while the submit button is disabled.
    if (loginForm.dataset.submitting === '1') return;

    const nickname = loginForm.querySelector('#login-nickname').value.trim();
    const password = loginForm.querySelector('#login-password').value;

    // Client-side validation
    const nickErr = validateNickname(nickname);
    if (nickErr) { setFormError(loginForm, nickErr); return; }
    const pwErr = validatePassword(password);
    if (pwErr) { setFormError(loginForm, pwErr); return; }
    setFormError(loginForm, '');
    loginForm.dataset.submitting = '1';

    // Disable submit button to prevent duplicate submissions
    const release = setSubmitLoading(loginForm, true, '登录中...');

    try {
      // Use shared API client (timeout + 4xx/5xx error handling)
      const result = await API.login(nickname, password);

      // Login successful
      Utils.toast('登录成功！');
      release();

      // Persist ONLY the nickname + session token; passwords never touch
      // localStorage. The token authorizes all subsequent profile/progress
      // requests (sent as X-Player-Token by the shared API client).
      try { localStorage.setItem(LOGGED_IN_KEY, nickname); } catch (e) { /* non-fatal */ }
      if (result && result.token && window.API && window.API.setToken) {
        window.API.setToken(result.token);
      }
      loggedInNickname = nickname;

      // Apply the new state to the title screen and game instance
      const nameInput = document.getElementById('player-name');
      const startBtn = document.getElementById('btn-start');
      if (nameInput) nameInput.value = nickname;
      if (startBtn) startBtn.disabled = false;

      if (game && result && result.player) {
        game.playerName = nickname;
        game.ageGroup = result.player.ageGroup || game.ageGroup;
        // Server profile is authoritative: maxLevel is the next unlocked
        // level; coins is the server-side total.
        const total = window.Levels.TOTAL_LEVELS;
        game.maxUnlocked = Math.max(1, Math.min(total, parseInt(result.player.maxLevel, 10) || 1));
        if (typeof result.player.coins === 'number' && Number.isFinite(result.player.coins)) {
          game.coins = result.player.coins;
        }

        // Show save info
        updateSaveInfo(result.player);
      }
      updateLoggedInUI();
      hideAllModals();
      // Let main.js re-render the title-screen progress from the freshly
      // synced game.maxUnlocked (server value).
      document.dispatchEvent(new CustomEvent('wordhunter:session-restored'));
    } catch (err) {
      console.error('Login error:', err);
      setFormError(loginForm, describeError(err, '登录失败'));
      release();
    } finally {
      delete loginForm.dataset.submitting;
    }
  }

  function handleLogout() {
    // Confirm if currently in-game to avoid losing progress accidentally
    if (game && game.state === 'playing') {
      const ok = window.confirm('当前正在游戏中，退出登录会返回到主菜单。\n确定要退出登录吗？');
      if (!ok) return;
      // Return to title so the player doesn't see stale state
      try {
        game.showScreen('screen-title');
        game.showHUD(false);
        // Clear held inputs WITHOUT locking: setLocked(true) here would
        // strand the input lock (nothing ever unlocks it outside the modal
        // pause flow), freezing movement in the next level.
        if (game.input && typeof game.input.reset === 'function') game.input.reset();
        game.paused = true;
      } catch (e) { /* non-fatal */ }
    }

    // Clear the persistent login marker and the session token
    try { localStorage.removeItem(LOGGED_IN_KEY); } catch (e) { /* non-fatal */ }
    if (window.API && window.API.setToken) window.API.setToken(null);
    loggedInNickname = null;

    // Reset in-memory game state for the now-guest player. We DO reset
    // maxUnlocked here because the logged-in profile is the only reason
    // we'd have authoritative server-tracked progress; the local save
    // keyed by the typed name will still drive guests. Coins / score /
    // ageGroup / currentLevelNum are reset too so the next user never
    // inherits the previous user's in-memory data.
    if (game) {
      game.playerName = '';
      game.maxUnlocked = 1;
      game.currentLevelNum = 1;
      game.coins = 0;
      game.score = 0;
      game.ageGroup = 7; // Constructor default; must not leak to next user
      // Park the game loop on the title state and release any stale modal
      // input lock so the next player starts from a clean, movable slate.
      game.state = 'title';
      if (game.input && typeof game.input.setLocked === 'function') game.input.setLocked(false);
    }

    // Reset title screen widgets
    const nameInput = document.getElementById('player-name');
    const startBtn = document.getElementById('btn-start');
    if (nameInput) nameInput.value = '';
    if (startBtn) {
      startBtn.disabled = true;
      const span = startBtn.querySelector('span:nth-child(2)');
      if (span) span.textContent = '开始狩猎';
    }
    // Re-render save-info to drop the "已登录" badge
    const saveInfo = document.getElementById('save-info');
    if (saveInfo) saveInfo.textContent = '';
    updateLoggedInUI();
    document.dispatchEvent(new CustomEvent('wordhunter:session-cleared'));
    Utils.toast('已退出登录');
  }

  function updateSaveInfo(player) {
    const saveInfo = document.getElementById('save-info');
    const TOTAL = window.Levels.TOTAL_LEVELS;

    if (!saveInfo) return;

    if (player && player.maxLevel > 1) {
      const n = Math.max(1, Math.min(TOTAL, player.maxLevel));
      saveInfo.textContent = '上次进度: 第 ' + n + ' / ' + TOTAL + ' 关';
    } else {
      saveInfo.textContent = '新玩家: ' + TOTAL + ' 关等你挑战!';
    }
  }

  // Public API
  window.RegisterModule = {
    init,
    showRegisterModal,
    showLoginModal,
    hideAllModals,
    handleLogout,
    isLoggedIn: function () { return !!loggedInNickname; },
    // True when logged in AND the given nickname matches the logged-in
    // account. Used by main.js so that typing a different name in the
    // title field while logged in correctly falls back to guest handling.
    isLoggedInAs: function (name) {
      return !!loggedInNickname && !!name && loggedInNickname === name;
    },
    getNickname: function () { return loggedInNickname; }
  };

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
