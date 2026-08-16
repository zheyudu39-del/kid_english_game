// sound.js - Sound-effect + background-music system for the whole game.
//
// Effects play real audio files downloaded from gamersounds.com (see
// public/sounds/AUDIO_CREDITS.md for the source mapping and license note).
// Every event also has a WebAudio synth fallback (the original catalog
// below), so a missing file, a decode failure, or offline play still
// sounds right and play() never throws.
//
// Public API (unchanged from the synth-only version):
//   Sound.play(name, extra) / toggleMute / setMuted / isMuted /
//   Sound.recent() / Sound._wireButtons
// New for BGM: Sound.playBgm('menu'|'level'|'boss') / Sound.stopBgm().
// Utils.playBeep stays a working alias so all existing call sites upgrade.
(function () {
  'use strict';

  const STORAGE_KEY = 'wordhunter:sound';
  const MASTER_VOLUME = 0.5;   // kid-friendly ceiling
  const BGM_VOLUME = 0.22;     // music sits under effects and TTS
  const MAX_RECENT = 12;       // ring buffer size for tests/debugging
  const SOUND_DIR = 'sounds/';

  let ctx = null;
  let master = null;
  let muted = false;
  const recent = [];           // most-recently-played sound names (tests)

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      muted = !!raw.muted;
    } catch (e) { muted = false; }
  }

  function savePrefs() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ muted })); } catch (e) { /* private mode */ }
  }

  function ensureCtx() {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);
    // Autoplay policy: a context created before the first user gesture sits
    // suspended and would silently swallow every effect. Resume it on the
    // first gesture; by then the game has certainly been interacted with.
    const resume = () => {
      if (ctx && ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
    };
    document.addEventListener('pointerdown', resume, { passive: true });
    document.addEventListener('keydown', resume);
    return ctx;
  }

  // ---- synth primitives (fallback when a file is unavailable) ----

  function tone(freq, start, dur, opts) {
    opts = opts || {};
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = opts.wave || 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    if (opts.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), start + dur);
    const vol = (opts.vol != null ? opts.vol : 0.18);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + (opts.attack || 0.012));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  // White-noise burst through a bandpass — explosions, whooshes, growls.
  let noiseBuf = null;
  function noise(start, dur, opts) {
    opts = opts || {};
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const ch = noiseBuf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter || 'bandpass';
    filter.frequency.setValueAtTime(opts.from || 800, start);
    if (opts.to) filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), start + dur);
    filter.Q.value = opts.q || 1;
    const gain = ctx.createGain();
    const vol = (opts.vol != null ? opts.vol : 0.2);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(start);
    src.stop(start + dur + 0.05);
  }

  // ---- the synth catalog (fallback timbres) ----

  const CATALOG = {
    click:  (t) => tone(700, t, 0.06, { wave: 'sine', vol: 0.12, slideTo: 500 }),

    shoot:  (t) => {
      tone(950, t, 0.09, { wave: 'square', vol: 0.06, slideTo: 320 });
      noise(t, 0.06, { from: 3200, to: 900, vol: 0.05, q: 2 });
    },

    hit:    (t) => {   // player takes damage
      tone(200, t, 0.18, { wave: 'sawtooth', vol: 0.14, slideTo: 70 });
      noise(t, 0.12, { filter: 'lowpass', from: 500, to: 120, vol: 0.16 });
    },

    engage: (t) => {   // monster locked for a question
      tone(520, t, 0.05, { wave: 'sine', vol: 0.12 });
      tone(780, t + 0.07, 0.07, { wave: 'sine', vol: 0.12 });
    },

    correct: (t) => {
      tone(659, t, 0.09, { vol: 0.16 });
      tone(880, t + 0.09, 0.09, { vol: 0.16 });
      tone(1319, t + 0.18, 0.16, { vol: 0.14 });
    },

    wrong:  (t) => {
      tone(300, t, 0.16, { wave: 'triangle', vol: 0.14, slideTo: 240 });
      tone(210, t + 0.16, 0.22, { wave: 'triangle', vol: 0.12, slideTo: 160 });
    },

    catch:  (t) => {   // monster captured
      tone(523, t, 0.07, { vol: 0.15 });
      tone(659, t + 0.07, 0.07, { vol: 0.15 });
      tone(784, t + 0.14, 0.07, { vol: 0.15 });
      tone(1047, t + 0.21, 0.2, { vol: 0.16 });
      noise(t + 0.2, 0.15, { from: 5000, to: 8000, vol: 0.04, q: 3 }); // shimmer
    },

    coin:   (t) => {
      tone(988, t, 0.05, { wave: 'square', vol: 0.08 });
      tone(1319, t + 0.05, 0.12, { wave: 'square', vol: 0.08 });
    },

    combo:  (t, extra) => {   // streak milestone — pitch climbs with combo
      const step = Math.min(8, (extra && extra.combo) || 3);
      tone(440 * Math.pow(1.122, step), t, 0.08, { vol: 0.13 });
      tone(440 * Math.pow(1.122, step + 2), t + 0.08, 0.12, { vol: 0.13 });
    },

    win:    (t) => {   // level fanfare
      [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.12, 0.14, { vol: 0.16 }));
      [523, 659, 784, 1047].forEach((f) => tone(f, t + 0.5, 0.45, { vol: 0.09 }));
    },

    lose:   (t) => {
      [392, 330, 262, 196].forEach((f, i) => tone(f, t + i * 0.16, 0.2, { wave: 'triangle', vol: 0.14 }));
    },

    boss:   (t) => {   // boss level begins — a growl
      tone(90, t, 0.7, { wave: 'sawtooth', vol: 0.16, slideTo: 55 });
      tone(93, t, 0.7, { wave: 'sawtooth', vol: 0.12, slideTo: 58 }); // detune beat
      noise(t, 0.6, { filter: 'lowpass', from: 300, to: 90, vol: 0.12 });
    },

    bossDown: (t) => { // boss defeated
      noise(t, 0.5, { filter: 'lowpass', from: 900, to: 80, vol: 0.2 });
      tone(120, t, 0.5, { wave: 'sawtooth', vol: 0.16, slideTo: 40 });
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, t + 0.15 + i * 0.09, 0.16, { vol: 0.14 }));
    },

    countdown: (t, extra) => { // MP start countdown ticks
      const final = extra && extra.final;
      tone(final ? 1047 : 660, t, final ? 0.25 : 0.08, { wave: 'sine', vol: 0.14 });
    },

    tick:   (t) => tone(880, t, 0.04, { wave: 'sine', vol: 0.07 }), // low-time warning

    join:   (t) => {   // someone joined the room
      tone(392, t, 0.08, { vol: 0.13 });
      tone(523, t + 0.09, 0.12, { vol: 0.13 });
    },

    leave:  (t) => {
      tone(523, t, 0.08, { vol: 0.11 });
      tone(392, t + 0.09, 0.12, { vol: 0.11 });
    },

    matchStart: (t) => {
      noise(t, 0.25, { from: 400, to: 4000, vol: 0.1, q: 1.5 });
      [440, 554, 659].forEach((f) => tone(f, t + 0.1, 0.3, { vol: 0.1 }));
    },

    knockout: (t) => { // MP: a hunter is out
      tone(330, t, 0.25, { wave: 'sawtooth', vol: 0.14, slideTo: 80 });
      noise(t, 0.2, { filter: 'lowpass', from: 700, to: 100, vol: 0.12 });
    },

    unlock: (t) => {   // map / progression unlock
      tone(587, t, 0.08, { vol: 0.13 });
      tone(880, t + 0.08, 0.08, { vol: 0.13 });
      tone(1175, t + 0.16, 0.18, { vol: 0.13 });
    }
  };

  // ---- real-file layer ----
  // file: asset under public/sounds/ (from gamersounds.com)
  // vol:  per-event trim against MASTER_VOLUME
  // rate: playback-rate hook (pitch/speed) so file sounds can still react
  //       to game state the way the synth fallback does
  // maxSec: hard stop for sources that carry long tails (a 5s coin pickup
  //         would stack into mush when several fire back to back)
  const FILES = {
    click:     { file: 'click.mp3',      vol: 0.9 },
    shoot:     { file: 'shoot.mp3',      vol: 0.8 },
    hit:       { file: 'hit.mp3',        vol: 0.9 },
    engage:    { file: 'engage.mp3',     vol: 0.8, maxSec: 1.4 },
    correct:   { file: 'correct.mp3',    vol: 0.9 },
    wrong:     { file: 'wrong.mp3',      vol: 0.9 },
    catch:     { file: 'catch.mp3',      vol: 0.9, maxSec: 2.2 },
    coin:      { file: 'coin.mp3',       vol: 0.8, maxSec: 1.2 },
    combo:     { file: 'combo.mp3',      vol: 0.8,
                 rate: (extra) => 1 + Math.min(8, (extra && extra.combo) || 3) * 0.06 },
    win:       { file: 'win.wav',        vol: 0.9 },
    lose:      { file: 'lose.mp3',       vol: 0.9 },
    boss:      { file: 'boss.wav',       vol: 0.8 },
    bossDown:  { file: 'bossdown.mp3',   vol: 0.9 },
    countdown: { file: 'countdown.mp3',  vol: 0.9, maxSec: 1.0,
                 rate: (extra) => (extra && extra.final) ? 1.35 : 1 },
    tick:      { file: 'tick.mp3',       vol: 0.7 },
    join:      { file: 'join.mp3',       vol: 0.8, maxSec: 1.2 },
    leave:     { file: 'leave.mp3',      vol: 0.7, maxSec: 1.2 },
    matchStart:{ file: 'matchstart.mp3', vol: 0.9 },
    knockout:  { file: 'knockout.mp3',   vol: 0.9 },
    unlock:    { file: 'unlock.mp3',     vol: 0.9 }
  };

  const buffers = {};   // name -> AudioBuffer (once decoded)
  const failed = {};    // name -> true when fetch/decode failed (use synth forever)

  function loadBuffer(name) {
    if (buffers[name] || failed[name]) return;
    const def = FILES[name];
    if (!def || !window.fetch) { failed[name] = true; return; }
    fetch(SOUND_DIR + def.file)
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => {
        // Callback form: decodeAudioData works on a suspended context and
        // keeps IE-Safari promise quirks out of the picture.
        ensureCtx();
        if (!ctx) { rej(new Error('no ctx')); return; }
        ctx.decodeAudioData(ab, res, rej);
      }))
      .then((buf) => { buffers[name] = buf; })
      .catch(() => { failed[name] = true; });
  }

  function preloadAll() {
    Object.keys(FILES).forEach(loadBuffer);
  }

  function playFile(name, extra) {
    const def = FILES[name];
    const buf = buffers[name];
    if (!def || !buf) return false;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (def.rate) {
      const r = def.rate(extra);
      if (isFinite(r) && r > 0) src.playbackRate.value = r;
    }
    const gain = ctx.createGain();
    gain.gain.value = (def.vol != null ? def.vol : 1);
    src.connect(gain);
    gain.connect(master);
    const t0 = ctx.currentTime;
    src.start(t0);
    if (def.maxSec) src.stop(t0 + def.maxSec);
    return true;
  }

  function play(name, extra) {
    try {
      // Record first so tests can assert even when audio is unavailable.
      recent.push(name + (extra && extra.combo ? ':' + extra.combo : ''));
      if (recent.length > MAX_RECENT) recent.shift();
      if (muted) return;
      if (!ensureCtx()) return;
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume().catch(() => {});
      if (!playFile(name, extra)) {
        const fn = CATALOG[name] || CATALOG.click;
        fn(ctx.currentTime, extra);
      }
    } catch (e) { /* audio must never break the game loop */ }
  }

  // ---- background music ----
  // A single looping HTMLAudio layer, cross-faded on switch. Kept separate
  // from the SFX graph so its volume can sit far lower and muting can pause
  // it outright (silenced music still burns battery and bandwidth).

  const BGM = {
    menu:  { file: 'bgm-menu.mp3' },
    level: { file: 'bgm-level.mp3' },
    boss:  { file: 'bgm-boss.mp3', vol: 0.8 }
  };

  let bgmAudio = null;     // current <audio>
  let bgmName = null;      // which track is (supposed to be) playing
  let bgmWanted = null;    // track we want, even if start was deferred
  let bgmFade = null;      // interval handle for volume ramps

  function bgmTargetVol(name) {
    const def = BGM[name];
    return BGM_VOLUME * (def && def.vol != null ? def.vol : 1);
  }

  function rampBgm(to, ms, done) {
    if (bgmFade) { clearInterval(bgmFade); bgmFade = null; }
    if (!bgmAudio) { if (done) done(); return; }
    const from = bgmAudio.volume;
    const steps = Math.max(1, Math.round(ms / 60));
    let i = 0;
    bgmFade = setInterval(() => {
      i++;
      if (!bgmAudio) { clearInterval(bgmFade); bgmFade = null; return; }
      bgmAudio.volume = Math.max(0, Math.min(1, from + (to - from) * (i / steps)));
      if (i >= steps) {
        clearInterval(bgmFade); bgmFade = null;
        if (done) done();
      }
    }, 60);
  }

  function startBgmEl(name) {
    const audio = new Audio(SOUND_DIR + BGM[name].file);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    bgmAudio = audio;
    bgmName = name;
    const p = audio.play();
    if (p && p.catch) p.catch(() => {
      // Autoplay policy: no user gesture yet. Remember the intent and let
      // the first gesture (or an explicit replay) pick it up.
      if (bgmAudio === audio) { bgmAudio = null; bgmName = null; }
    });
    rampBgm(bgmTargetVol(name), 700);
  }

  function playBgm(name) {
    if (!BGM[name]) return;
    bgmWanted = name;
    if (muted) return;              // setMuted(false) restarts bgmWanted
    if (bgmName === name) return;   // already playing this track
    const old = bgmAudio;
    if (old) {
      rampBgm(0, 350, () => { old.pause(); if (bgmAudio !== old) return; });
      bgmAudio = null; bgmName = null;
    }
    startBgmEl(name);
  }

  function stopBgm() {
    bgmWanted = null;
    const old = bgmAudio;
    bgmAudio = null; bgmName = null;
    if (old) rampBgm(0, 350, () => old.pause());
  }

  // First user gesture: retry a BGM the autoplay policy blocked at boot.
  document.addEventListener('pointerdown', () => {
    if (!muted && bgmWanted && !bgmName) playBgm(bgmWanted);
  }, { passive: true });

  // Don't keep music running in a hidden tab.
  document.addEventListener('visibilitychange', () => {
    if (!bgmAudio) return;
    if (document.hidden) { bgmAudio.pause(); }
    else if (!muted && bgmName) { bgmAudio.play().catch(() => {}); }
  });

  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
    if (muted) {
      const old = bgmAudio;
      bgmAudio = null; bgmName = null;
      if (old) { if (bgmFade) { clearInterval(bgmFade); bgmFade = null; } old.pause(); }
    } else if (bgmWanted) {
      playBgm(bgmWanted);
    }
    savePrefs();
    syncButtons();
  }

  function toggleMute() { setMuted(!muted); }

  function isMuted() { return muted; }

  // ---- floating mute buttons (markup lives in index.html) ----

  function syncButtons() {
    document.querySelectorAll('#btn-sound-toggle').forEach((b) => {
      b.textContent = muted ? '🔇' : '🔊';
      b.setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
      b.setAttribute('aria-pressed', muted ? 'true' : 'false');
    });
  }

  function wireButtons() {
    document.querySelectorAll('#btn-sound-toggle').forEach((b) => {
      if (b.dataset.wired) return;
      b.dataset.wired = '1';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMute();
        if (!muted) play('click');
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M') {
        // Don't hijack M while typing in an input (nickname, room code).
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        toggleMute();
      }
    });
    syncButtons();
    preloadAll();
  }

  loadPrefs();

  window.Sound = {
    play,
    playBgm,
    stopBgm,
    toggleMute,
    setMuted,
    isMuted,
    recent: () => recent.slice(),
    // Test/debug hook: which BGM track is wanted vs actually playing.
    bgm: () => ({ wanted: bgmWanted, playing: bgmName }),
    _wireButtons: wireButtons
  };

  // Upgrade every existing Utils.playBeep call site to the new catalog.
  // Old names map 1:1 except 'hit' now means "player hurt" (same intent).
  if (window.Utils && typeof window.Utils.playBeep === 'function') {
    window.Utils.playBeep = function (type, extra) { play(type, extra); };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireButtons);
  } else {
    wireButtons();
  }
})();
