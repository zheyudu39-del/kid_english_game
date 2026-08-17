// open-boss.js — Launch Chrome, navigate to the game, jump to boss level 10
const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const GAME_URL = 'http://localhost:3000';
const CDP_PORT = 9223;
const BOSS_LEVEL = 10;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJSON(url) {
  const resp = await fetch(url);
  return resp.json();
}

function findChrome() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'chrome.exe';
}

class CDPClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch (e) { /* ignore */ }
    });
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    const msg = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(msg);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 15000);
    });
  }
}

async function main() {
  console.log('=== Opening Boss Level ===');
  
  const chromeExe = findChrome();
  console.log('Chrome:', chromeExe);
  
  const userDataDir = path.join(process.env.TEMP || 'C:\\Windows\\Temp', 'kid-game-boss-profile2');
  
  // Kill existing Chrome instances
  try {
    require('child_process').execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' });
    await sleep(1500);
  } catch (e) { /* ok */ }
  
  const chromeArgs = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=1280,800`,
    GAME_URL,
  ];
  
  console.log('Launching Chrome...');
  const chrome = spawn(chromeExe, chromeArgs, {
    stdio: 'ignore',
    detached: true,
  });
  chrome.unref();
  
  // Wait for CDP
  let wsUrl = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const tabs = await fetchJSON(`http://localhost:${CDP_PORT}/json/list`);
      const page = tabs.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        console.log('CDP ready');
        break;
      }
    } catch (e) {
      process.stdout.write('.');
    }
  }
  if (!wsUrl) {
    console.error('\nFailed to connect to Chrome CDP');
    process.exit(1);
  }
  
  // Connect
  console.log('Connecting...');
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('WS timeout')), 10000);
    ws.on('open', () => { clearTimeout(t); resolve(); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
  console.log('Connected');
  
  const cdp = new CDPClient(ws);
  await cdp.send('Runtime.enable');
  
  // Wait for game object
  console.log('Waiting for game to initialize...');
  let gameReady = false;
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: 'typeof window._game === "object" && typeof window.API === "object"',
        returnByValue: true,
      });
      if (r.result?.value === true) {
        gameReady = true;
        console.log('Game object ready');
        break;
      }
    } catch (e) { /* retry */ }
    process.stdout.write('.');
  }
  
  if (!gameReady) {
    console.error('\nGame not initialized');
    process.exit(1);
  }
  
  // Load vocabulary and start boss level via injected script
  console.log('\nLoading vocabulary and starting boss level ' + BOSS_LEVEL + '...');
  
  const injectCode = `
  (async function() {
    try {
      // Set player name
      window._game.playerName = '访客';
      
      // Load vocabulary
      if (!window._game.words || window._game.words.length === 0) {
        console.log('Loading vocabulary...');
        var data = await window.API.getVocabulary();
        window._game.vocabulary = data;
        window._game.words = (data && data.words) || [];
        console.log('Vocabulary loaded: ' + window._game.words.length + ' words');
      }
      
      if (window._game.words.length === 0) {
        document.title = 'FAIL: no words';
        return;
      }
      
      // Hide title screen
      var ts = document.getElementById('screen-title');
      if (ts) ts.classList.add('hidden');
      window._game.showScreen(null);
      
      await new Promise(r => setTimeout(r, 300));
      
      // Start boss level
      console.log('Starting level ' + ${BOSS_LEVEL} + '...');
      await window._game.startLevel(${BOSS_LEVEL});
      console.log('startLevel done');
      
      // Click 出发 button
      await new Promise(r => setTimeout(r, 500));
      var btn = document.getElementById('btn-go');
      if (btn && !btn.classList.contains('hidden')) {
        btn.click();
        console.log('Clicked 出发');
        document.title = 'BOSS_LEVEL_${BOSS_LEVEL}_READY';
      } else {
        document.title = 'BOSS_LEVEL_${BOSS_LEVEL}_NO_BTN';
      }
    } catch(e) {
      console.error('Error:', e);
      document.title = 'FAIL: ' + e.message;
    }
  })();
  `;
  
  await cdp.send('Runtime.evaluate', {
    expression: injectCode,
    awaitPromise: false,
  });
  
  console.log('Injected startup script, waiting...');
  
  // Wait for result
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    try {
      const t = await cdp.send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true,
      });
      const title = t.result?.value || '';
      console.log(`[${i}s] Title: ${title}`);
      if (title.includes('READY') || title.includes('FAIL')) {
        break;
      }
    } catch (e) { /* retry */ }
  }
  
  console.log('\n=== DONE ===');
  console.log('Boss level ' + BOSS_LEVEL + ' should be visible in the Chrome window.');
  console.log('Close Chrome or press Ctrl+C to exit.');
  
  process.stdin.resume();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});