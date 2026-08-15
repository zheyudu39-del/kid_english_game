// utils.js - Game utilities
(function () {
  'use strict';

  const Utils = {
    // Random integer in [min, max] inclusive
    randInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    randFloat(min, max) {
      return Math.random() * (max - min) + min;
    },

    randItem(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    },

    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },

    pickN(arr, n) {
      // Guard n<0: slice(0, -1) would silently drop the last element.
      const k = Math.max(0, Math.min(n, arr.length));
      return this.shuffle(arr).slice(0, k);
    },

    clamp(v, min, max) {
      return v < min ? min : v > max ? max : v;
    },

    lerp(a, b, t) {
      return a + (b - a) * t;
    },

    // Distance between two {x,y} points
    dist(a, b) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      return Math.hypot(dx, dy);
    },

    // AABB collision between two boxes with {x,y,w,h} (x,y is center)
    aabb(a, b) {
      return Math.abs(a.x - b.x) < (a.w + b.w) / 2 &&
             Math.abs(a.y - b.y) < (a.h + b.h) / 2;
    },

    escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    // Show a transient toast
    toast(msg, duration = 1600) {
      const el = document.getElementById('toast');
      if (!el) return;
      el.textContent = msg;
      el.classList.remove('hidden');
      // Re-trigger animation
      void el.offsetWidth;
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      clearTimeout(Utils._toastTimer);
      Utils._toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
    },

    playBeep(type) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        if (!Utils._audioCtx) Utils._audioCtx = new Ctx();
        const ctx = Utils._audioCtx;
        // Browsers may create/suspend the AudioContext (autoplay policy,
        // background tab). Resume it so beeps aren't silently dropped; the
        // tones scheduled below play once the context is running.
        if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
          ctx.resume().catch(() => {});
        }
        const now = ctx.currentTime;
        const tone = (freq, start, dur, typeOsc = 'square', vol = 0.08) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = typeOsc;
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(vol, start + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + dur + 0.05);
        };
        if (type === 'correct') { tone(660, now, 0.1); tone(880, now + 0.1, 0.15); }
        else if (type === 'wrong') { tone(220, now, 0.15); tone(165, now + 0.15, 0.2); }
        else if (type === 'catch') { tone(523, now, 0.08); tone(659, now + 0.08, 0.08); tone(784, now + 0.16, 0.15); }
        else if (type === 'coin') { tone(988, now, 0.05); tone(1319, now + 0.05, 0.1); }
        else if (type === 'hit')   { tone(110, now, 0.2, 'sawtooth', 0.1); }
        else if (type === 'win')   { tone(523, now, 0.12); tone(659, now + 0.12, 0.12); tone(784, now + 0.24, 0.12); tone(1047, now + 0.36, 0.3); }
        else                       { tone(440, now, 0.05); }
      } catch (err) { /* audio not available */ }
    },

    // Short visual screen-shake hook
    shake(target, intensity = 8, duration = 300) {
      if (!target) return;
      // Sequence token so a newer shake supersedes an older one. Without it,
      // two overlapping shakes both "restore" the transform when they end:
      // the older one restores to the pre-shake transform mid-flight of the
      // newer one, and the newer one restores to whatever transient
      // translate it captured at start — leaving the canvas permanently
      // offset after the second shake finishes.
      const id = (Utils._shakeId || 0) + 1;
      Utils._shakeId = id;
      // Capture the resting transform only once; a shake that starts while
      // another is running must not record a mid-shake translate as "rest".
      if (target._shakeRest === undefined) target._shakeRest = target.style.transform;
      const rest = target._shakeRest;
      const start = performance.now();
      function frame(now) {
        if (id !== Utils._shakeId) return; // superseded by a newer shake
        const t = (now - start) / duration;
        if (t >= 1) { target.style.transform = rest; return; }
        const decay = 1 - t;
        const dx = (Math.random() - 0.5) * intensity * decay;
        const dy = (Math.random() - 0.5) * intensity * decay;
        target.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
  };

  window.Utils = Utils;
})();
