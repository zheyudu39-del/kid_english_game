/**
 * test-register.js - E2E test for registration and login functionality
 * Verifies:
 *  - Backend API: POST /api/register, POST /api/login
 *  - Title screen shows login and register buttons
 *  - Registration modal opens and form works
 *  - Successful registration redirects to login
 *  - Duplicate nickname registration fails
 *  - Successful login with correct password
 *  - Failed login with wrong password
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 3000;
const BASE = 'http://localhost:' + PORT;

const results = [];
function check(name, ok, detail) {
  detail = detail || '';
  results.push({ name, ok, detail });
  console.log((ok ? '\u2705' : '\u274c') + ' ' + name + (detail ? ' \u2014 ' + detail : ''));
}

async function testBackendAPIs() {
  console.log('--- Backend API Tests ---');
  // Nickname must be 1-12 chars to match server's NICKNAME_RE
  const testNickname = 'TU' + Date.now().toString().slice(-9);  // ~11 chars
  const testPassword = 'testpass123';
  const testAge = 7;

  // Helper to wait between requests to avoid rate limiting
  const wait = function() { return new Promise(function(r) { setTimeout(r, 1500); }); };

  // Test 1: Register new account via API
  await wait();
  try {
    const regResponse = await fetch(BASE + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: testNickname, password: testPassword, age: testAge })
    });
    const regData = await regResponse.json();
    check('API: register new account', regResponse.ok && regData.success, 'status=' + regResponse.status);
    check('API: player data returned (no password)', regData.player && !regData.player.passwordHash, '');
    check('API: player has correct nickname', regData.player && regData.player.nickname === testNickname, '');
  } catch (err) {
    check('API: register new account', false, err.message);
  }

  // Test 2: Duplicate registration should fail
  await wait();
  try {
    const dupResponse = await fetch(BASE + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: testNickname, password: 'anotherpass', age: 7 })
    });
    const dupData = await dupResponse.json();
    check('API: duplicate registration fails', dupResponse.status === 409 && dupData.error, 'status=' + dupResponse.status);
  } catch (err) {
    check('API: duplicate registration fails', false, err.message);
  }

  // Test 3: Login with correct password
  await wait();
  try {
    const loginResponse = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: testNickname, password: testPassword })
    });
    const loginData = await loginResponse.json();
    check('API: login with correct password', loginResponse.ok && loginData.success, 'status=' + loginResponse.status);
    check('API: login returns player data', loginData.player && loginData.player.nickname === testNickname, '');
  } catch (err) {
    check('API: login with correct password', false, err.message);
  }

  // Test 4: Login with wrong password
  await wait();
  try {
    const wrongResponse = await fetch(BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: testNickname, password: 'wrongpassword' })
    });
    const wrongData = await wrongResponse.json();
    check('API: login with wrong password fails', wrongResponse.status === 401 && wrongData.error, 'status=' + wrongResponse.status);
  } catch (err) {
    check('API: login with wrong password fails', false, err.message);
  }

    // Test 5: Password too short
    await wait();
    try {
      const shortResponse = await fetch(BASE + '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: 'S' + Date.now().toString().slice(-10), password: '123', age: 7 })
      });
      const shortData = await shortResponse.json();
      check('API: short password registration fails', shortResponse.status === 400 && shortData.error, 'status=' + shortResponse.status);
    } catch (err) {
      check('API: short password registration fails', false, err.message);
    }
}

async function testUI() {
  console.log('\n--- Frontend UI Tests ---');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--window-size=900,700']
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', function(e) { errors.push('pageerror: ' + e.message); });
  page.on('console', function(m) { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  try {
    // Navigate to home and clear storage
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 10000 });
    await page.evaluate(function() { localStorage.clear(); });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('#screen-title:not(.hidden)', { timeout: 10000 });

    // Test 1: Auth buttons are present
    const hasLoginBtn = await page.$('#btn-show-login') !== null;
    const hasRegisterBtn = await page.$('#btn-show-register') !== null;
    check('UI: login button exists', hasLoginBtn);
    check('UI: register button exists', hasRegisterBtn);

    // Test 2: Click register button -> modal opens
    await page.click('#btn-show-register');
    await new Promise(function(r) { setTimeout(r, 300); });
    const registerModalVisible = await page.$eval('#register-modal', function(el) { return !el.classList.contains('hidden'); });
    check('UI: clicking register opens modal', registerModalVisible);

    // Test 3: Register form has all required fields
    const hasNickname = await page.$('#register-nickname') !== null;
    const hasPassword = await page.$('#register-password') !== null;
    const hasConfirm = await page.$('#register-confirm-password') !== null;
    const ageBtnCount = (await page.$$('#register-modal .age-btn')).length;
    check('UI: register form has nickname field', hasNickname);
    check('UI: register form has password field', hasPassword);
    check('UI: register form has confirm password field', hasConfirm);
    check('UI: register form has 5 age buttons', ageBtnCount === 5, 'count=' + ageBtnCount);

    // Test 4: Fill and submit registration
    // Input has maxLength=10, server allows 1-12 chars
    const testUser = 'U' + Date.now().toString().slice(-9);  // 10 chars
    await page.type('#register-nickname', testUser);
    await page.type('#register-password', 'testpass123');
    await page.type('#register-confirm-password', 'testpass123');
    await page.click('#register-modal .age-btn[data-age="9"]');
    
    // Submit form
    await page.evaluate(function() {
      document.getElementById('register-form').dispatchEvent(new Event('submit', { cancelable: true }));
    });
    
    // Wait for the API call and modal switch (need 2s+ to avoid rate limit)
    await new Promise(function(r) { setTimeout(r, 3000); });
    
    // Should now show login modal
    const loginModalVisible = await page.$eval('#login-modal', function(el) { return !el.classList.contains('hidden'); });
    check('UI: after register, switch to login modal', loginModalVisible);
    
    // Login form should have the registered nickname
    const prefilledNickname = await page.$eval('#login-nickname', function(el) { return el.value; });
    check('UI: login form prefilled with registered nickname', prefilledNickname === testUser, 'value=[' + prefilledNickname + '] expected=[' + testUser + ']');

    // Test 5: Try to login with wrong password
    await page.evaluate(function() { 
      const field = document.getElementById('login-password');
      if (field) field.value = '';
    });
    await page.type('#login-password', 'wrongpassword');
    await page.evaluate(function() {
      document.getElementById('login-form').dispatchEvent(new Event('submit', { cancelable: true }));
    });
    await new Promise(function(r) { setTimeout(r, 2000); });
    
    // Should still be on login modal (failed login)
    const stillOnLogin = await page.$eval('#login-modal', function(el) { return !el.classList.contains('hidden'); });
    check('UI: wrong password login fails, still on login page', stillOnLogin);

    // Test 6: Login with correct password
    await page.evaluate(function() { 
      const field = document.getElementById('login-password');
      if (field) field.value = '';
    });
    await page.type('#login-password', 'testpass123');
    await page.evaluate(function() {
      document.getElementById('login-form').dispatchEvent(new Event('submit', { cancelable: true }));
    });
    await new Promise(function(r) { setTimeout(r, 2000); });
    
    // Login modal should be closed
    const loginClosed = await page.$eval('#login-modal', function(el) { return el.classList.contains('hidden'); });
    check('UI: correct password login success, close modal', loginClosed);
    
    // localStorage should have the logged-in nickname
    const storedUser = await page.evaluate(function() { return localStorage.getItem('wordhunter:logged-in'); });
    check('UI: localStorage stores logged-in nickname', storedUser === testUser, 'stored=[' + storedUser + '] expected=[' + testUser + ']');
    
    // Player name input should be filled
    const nameInputValue = await page.$eval('#player-name', function(el) { return el.value; });
    check('UI: player name input is filled', nameInputValue === testUser, 'value=' + nameInputValue);

    // Test 7: Try to register duplicate nickname
    await page.click('#btn-show-register');
    await new Promise(function(r) { setTimeout(r, 500); });
    await page.type('#register-nickname', testUser);
    await page.type('#register-password', 'anotherpass');
    await page.type('#register-confirm-password', 'anotherpass');
    await page.evaluate(function() {
      document.getElementById('register-form').dispatchEvent(new Event('submit', { cancelable: true }));
    });
    await new Promise(function(r) { setTimeout(r, 2000); });
    
    // Should still be on register modal (duplicate)
    const stillOnRegister = await page.$eval('#register-modal', function(el) { return !el.classList.contains('hidden'); });
    check('UI: duplicate registration fails, still on register page', stillOnRegister);

    // ---- New: Test logout flow ----
    // Close the modal first (still on register)
    await page.evaluate(function() { window.RegisterModule.hideAllModals(); });
    await new Promise(function(r) { setTimeout(r, 200); });

    // Verify the logged-in state UI is showing
    const userStatusVisible = await page.$eval('#user-status', function(el) { return !el.classList.contains('hidden'); });
    check('UI: user-status badge visible when logged in', userStatusVisible);
    const logoutVisible = await page.$eval('#btn-logout', function(el) { return !el.classList.contains('hidden'); });
    check('UI: logout button visible when logged in', logoutVisible);
    const loginHidden = await page.$eval('#btn-show-login', function(el) { return el.classList.contains('hidden'); });
    check('UI: login button hidden when logged in', loginHidden);
    const registerHidden = await page.$eval('#btn-show-register', function(el) { return el.classList.contains('hidden'); });
    check('UI: register button hidden when logged in', registerHidden);

    // Click logout and verify state resets
    await page.click('#btn-logout');
    await new Promise(function(r) { setTimeout(r, 300); });
    const userStatusHiddenAfterLogout = await page.$eval('#user-status', function(el) { return el.classList.contains('hidden'); });
    check('UI: user-status hidden after logout', userStatusHiddenAfterLogout);
    const logoutHidden = await page.$eval('#btn-logout', function(el) { return el.classList.contains('hidden'); });
    check('UI: logout hidden after logout', logoutHidden);
    const loginShownAgain = await page.$eval('#btn-show-login', function(el) { return !el.classList.contains('hidden'); });
    check('UI: login button visible after logout', loginShownAgain);
    const storedAfterLogout = await page.evaluate(function() { return localStorage.getItem('wordhunter:logged-in'); });
    check('UI: localStorage cleared after logout', storedAfterLogout === null, 'stored=[' + storedAfterLogout + ']');

    // ---- New: Test password validation (short password) ----
    await page.click('#btn-show-register');
    await new Promise(function(r) { setTimeout(r, 200); });
    await page.type('#register-nickname', 'TU' + Date.now().toString().slice(-9));
    await page.type('#register-password', '123'); // too short
    await page.type('#register-confirm-password', '123');
    await page.evaluate(function() {
      document.getElementById('register-form').dispatchEvent(new Event('submit', { cancelable: true }));
    });
    await new Promise(function(r) { setTimeout(r, 200); });
    // Modal should still be open (validation prevented submit)
    const stillOnRegisterAfterShort = await page.$eval('#register-modal', function(el) { return !el.classList.contains('hidden'); });
    check('UI: short password blocks submit, modal still open', stillOnRegisterAfterShort);
    // Error message should be visible in the aria-live region
    const errorText = await page.$eval('#register-form .form-error', function(el) { return el.textContent; });
    check('UI: short password error message shown', errorText.indexOf('密码') !== -1, 'error=[' + errorText + ']');

    // ---- New: Test password mismatch validation ----
    await page.evaluate(function() {
      document.getElementById('register-nickname').value = '';
      document.getElementById('register-password').value = '';
      document.getElementById('register-confirm-password').value = '';
      const err = document.querySelector('#register-form .form-error');
      if (err) err.textContent = '';
    });
    await new Promise(function(r) { setTimeout(r, 300); });
    const mismatchUser = 'TU' + Date.now().toString().slice(-9);
    // Set values directly (puppeteer.type is flaky across fields)
    await page.evaluate(function(user) {
      document.getElementById('register-nickname').value = user;
      document.getElementById('register-password').value = 'pass123';
      document.getElementById('register-confirm-password').value = 'pass456';
    }, mismatchUser);
    await page.evaluate(function() {
      document.getElementById('register-form').dispatchEvent(new Event('submit', { cancelable: true }));
    });
    await new Promise(function(r) { setTimeout(r, 300); });
    const mismatchError = await page.$eval('#register-form .form-error', function(el) { return el.textContent; });
    check('UI: password mismatch error shown', mismatchError.indexOf('不一致') !== -1, 'error=[' + mismatchError + ']');

    // ---- New: Test modal switch via link (login <-> register) ----
    await page.evaluate(function() { window.RegisterModule.hideAllModals(); });
    await new Promise(function(r) { setTimeout(r, 200); });
    await page.click('#btn-show-login');
    await new Promise(function(r) { setTimeout(r, 200); });
    // Click "立即注册" link inside login modal
    await page.click('#link-to-register');
    await new Promise(function(r) { setTimeout(r, 300); });
    const switchedToRegister = await page.$eval('#register-modal', function(el) { return !el.classList.contains('hidden'); });
    check('UI: link-to-register switches to register modal', switchedToRegister);
    // Click "直接登录" link inside register modal
    await page.click('#link-to-login');
    await new Promise(function(r) { setTimeout(r, 300); });
    const switchedToLogin = await page.$eval('#login-modal', function(el) { return !el.classList.contains('hidden'); });
    check('UI: link-to-login switches to login modal', switchedToLogin);
    await page.evaluate(function() { window.RegisterModule.hideAllModals(); });

    // ---- New: Test ESC key closes modal ----
    await page.click('#btn-show-login');
    await new Promise(function(r) { setTimeout(r, 200); });
    await page.keyboard.press('Escape');
    await new Promise(function(r) { setTimeout(r, 200); });
    const closedByEsc = await page.$eval('#login-modal', function(el) { return el.classList.contains('hidden'); });
    check('UI: ESC key closes login modal', closedByEsc);

    // ---- New: Test aria-labels on register modal age buttons ----
    const ageBtnAria = await page.$eval('#register-modal .age-btn[data-age="9"]', function(el) { return el.getAttribute('aria-label'); });
    check('UI: register modal age buttons have aria-label', !!ageBtnAria, 'aria-label=[' + ageBtnAria + ']');

    // ---- New: Test password is not stored in localStorage ----
    // Re-login and check that localStorage doesn't contain the password
    await page.click('#btn-show-login');
    await new Promise(function(r) { setTimeout(r, 200); });
    const lsContents = await page.evaluate(function() {
      const out = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        out[k] = localStorage.getItem(k);
      }
      return JSON.stringify(out);
    });
    check('UI: no password stored in localStorage', lsContents.indexOf('testpass123') === -1 && lsContents.indexOf('pass123') === -1, 'ls=' + lsContents.substring(0, 200));
    await page.evaluate(function() { window.RegisterModule.hideAllModals(); });

    // Filter out expected 401/409 errors (these are by design for failed login/duplicate registration)
    const expectedErrorPatterns = [
      'status of 401',
      'status of 409',
      'Login error:',  // our own console.error for the expected 401
      'Register error:' // our own console.error for the expected 409
    ];
    const unexpectedErrors = errors.filter(function(e) {
      return !expectedErrorPatterns.some(function(p) { return e.indexOf(p) !== -1; });
    });
    
    // Errors check
    check('No unexpected console errors', unexpectedErrors.length === 0, unexpectedErrors.slice(0, 2).join(' | '));

    if (errors.length) {
      console.log('\nError details:');
      errors.forEach(function(e, i) { console.log('  [' + (i+1) + ']', e.substring(0, 300)); });
    }
  } catch (err) {
    console.error('Test error:', err);
    check('UI test execution', false, err.message);
  }

  await browser.close();
}

(async function() {
  await testBackendAPIs();
  await testUI();
  const failed = results.filter(function(r) { return !r.ok; });
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed');
  process.exit(failed.length ? 1 : 0);
})().catch(function(e) { console.error('FATAL:', e); process.exit(1); });