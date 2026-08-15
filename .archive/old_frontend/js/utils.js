/**
 * utils.js - Shared utilities for the game
 * Exposed as window.Utils
 */
(function () {
  'use strict';

  const Utils = {
    /**
     * Fisher-Yates shuffle (returns a new array)
     */
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    },

    /**
     * Pick n random distinct items from an array.
     * If there are fewer than n available, returns all of them.
     */
    randomPick(arr, n) {
      return this.shuffle(arr).slice(0, n);
    },

    /**
     * Pick a random item from an array (null if empty).
     */
    randomItem(arr) {
      if (!arr || arr.length === 0) return null;
      return arr[Math.floor(Math.random() * arr.length)];
    },

    /**
     * Get the age label for an age-group code (3, 5, 7, 9).
     */
    ageLabel(code) {
      const labels = {
        3: '3-4岁 · 启蒙级',
        5: '5-6岁 · 入门级',
        7: '7-8岁 · 进阶级',
        9: '9-10岁 · 挑战级'
      };
      return labels[code] || '';
    },

    /**
     * Get the game-mode display info.
     */
    gameInfo(modeId) {
      const map = {
        'word-recognition': { name: '单词认知', emoji: '🔤', desc: '看图识单词' },
        'listening':        { name: '听力反应', emoji: '🔊', desc: '听到选对图' },
        'spelling':         { name: '字母拼写', emoji: '✏️', desc: '认识字母和拼写' },
        'sentences':        { name: '简单句对', emoji: '💬', desc: '学会日常对话' }
      };
      return map[modeId] || { name: modeId, emoji: '🎮', desc: '' };
    },

    /**
     * Play a short beep using the Web Audio API.
     * type: 'correct' (rising), 'wrong' (descending), 'win' (fanfare), 'click'
     */
    playBeep(type) {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const now = ctx.currentTime;

        const tone = (freq, start, dur, typeOsc = 'sine', vol = 0.18) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = typeOsc;
          osc.frequency.setValueAtTime(freq, start);
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(vol, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(start);
          osc.stop(start + dur + 0.05);
        };

        if (type === 'correct') {
          tone(523.25, now, 0.12);          // C5
          tone(659.25, now + 0.12, 0.18);   // E5
        } else if (type === 'wrong') {
          tone(329.63, now, 0.14);          // E4
          tone(261.63, now + 0.14, 0.22);   // C4
        } else if (type === 'win') {
          tone(261.63, now, 0.15);          // C4
          tone(329.63, now + 0.15, 0.15);   // E4
          tone(392.00, now + 0.30, 0.15);   // G4
          tone(523.25, now + 0.45, 0.35);   // C5
        } else if (type === 'star') {
          tone(783.99, now, 0.1, 'triangle', 0.12); // G5 ding
        } else {
          tone(440, now, 0.08, 'triangle', 0.1);    // click
        }
      } catch (err) {
        /* audio not available - ignore */
      }
    },

    /**
     * Spawn star burst particles at (x, y). Returns the layer element.
     */
    showStars(x, y, count = 6) {
      let layer = document.getElementById('keg-star-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'keg-star-layer';
        document.body.appendChild(layer);
      }
      const emojis = ['⭐', '🌟', '✨', '💫'];
      for (let i = 0; i < count; i++) {
        const star = document.createElement('div');
        star.className = 'keg-star-burst';
        star.textContent = Utils.randomItem(emojis);
        star.style.left = (x + Utils.randomInt(-30, 30)) + 'px';
        star.style.top = (y + Utils.randomInt(-20, 20)) + 'px';
        star.style.fontSize = Utils.randomInt(20, 40) + 'px';
        layer.appendChild(star);
        setTimeout(() => star.remove(), 800);
      }
      Utils.playBeep('star');
      return layer;
    },

    /**
     * Trigger confetti rain from the top of the screen.
     */
    showConfetti(count = 60) {
      let layer = document.getElementById('keg-confetti-layer');
      if (!layer) {
        layer = document.createElement('div');
        layer.id = 'keg-confetti-layer';
        document.body.appendChild(layer);
      }
      const colors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#00B894', '#A29BFE', '#74B9FF', '#FABE79'];
      for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'keg-confetti';
        p.style.left = Utils.randomInt(0, 100) + '%';
        p.style.width = Utils.randomInt(6, 12) + 'px';
        p.style.height = Utils.randomInt(8, 16) + 'px';
        p.style.background = colors[Utils.randomInt(0, colors.length - 1)];
        p.style.animationDuration = Utils.randomInt(2, 4) + 's';
        p.style.animationDelay = Utils.randomInt(0, 8) / 10 + 's';
        layer.appendChild(p);
        setTimeout(() => p.remove(), 5000);
      }
    },

    /**
     * Random integer between min and max inclusive.
     */
    randomInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    /**
     * Escape HTML to avoid breaking the DOM.
     */
    escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },

    /**
     * Create a DOM element quickly.
     */
    el(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
  };

  window.Utils = Utils;
})();
