/**
 * projectile.js - Visual projectiles that fly from player to monster (or vice versa).
 * Spawns a small DOM element, animates it across the arena, then removes it.
 * Exposed as window.Projectile
 */
(function () {
  'use strict';

  const TYPES = {
    arrow:  { emoji: '➹', color: '#fbbf24' },
    fire:   { emoji: '🔥', color: '#ef4444' },
    ice:    { emoji: '❄️', color: '#60a5fa' },
    star:   { emoji: '⭐', color: '#facc15' },
    bomb:   { emoji: '💣', color: '#1f2937' },
    crit:   { emoji: '💥', color: '#dc2626' },
    hit:    { emoji: '💢', color: '#ef4444' },
    coin:   { emoji: '🪙', color: '#f59e0b' }
  };

  const Projectile = {
    /**
     * Spawn a projectile at startRect, animate to endRect, then call onComplete.
     * @param {HTMLElement} arena - parent where projectile is appended
     * @param {string} type - key in TYPES
     * @param {DOMRect} startRect - source element bounding rect
     * @param {DOMRect} endRect - target element bounding rect
     * @param {Function} onComplete - () => void
     */
    shoot(arena, type, startRect, endRect, onComplete) {
      if (!arena || !startRect || !endRect) {
        if (onComplete) onComplete();
        return;
      }
      const def = TYPES[type] || TYPES.star;
      const arenaRect = arena.getBoundingClientRect();
      const startX = startRect.left + startRect.width / 2 - arenaRect.left;
      const startY = startRect.top + startRect.height / 2 - arenaRect.top;
      const endX = endRect.left + endRect.width / 2 - arenaRect.left;
      const endY = endRect.top + endRect.height / 2 - arenaRect.top;

      const el = document.createElement('div');
      el.className = 'keg-projectile keg-projectile--' + type;
      el.textContent = def.emoji;
      el.style.left = startX + 'px';
      el.style.top = startY + 'px';
      el.style.color = def.color;
      el.style.setProperty('--from-x', startX + 'px');
      el.style.setProperty('--from-y', startY + 'px');
      el.style.setProperty('--to-x', endX + 'px');
      el.style.setProperty('--to-y', endY + 'px');
      arena.appendChild(el);

      // Force reflow then add the flying class
      void el.offsetWidth;
      el.classList.add('keg-projectile--fly');

      setTimeout(() => {
        // Trigger hit effect at the target
        el.classList.add('keg-projectile--burst');
        setTimeout(() => {
          el.remove();
          if (onComplete) onComplete();
        }, 200);
      }, 450);
    },

    /**
     * Multiple projectiles in a fan for crits / finishers.
     * @param {HTMLElement} arena
     * @param {string} type
     * @param {DOMRect} startRect
     * @param {DOMRect} endRect
     * @param {number} count
     * @param {Function} onComplete
     */
    barrage(arena, type, startRect, endRect, count, onComplete) {
      let done = 0;
      const total = count;
      const step = () => {
        this.shoot(arena, type, startRect, endRect, () => {
          done++;
          if (done >= total && onComplete) onComplete();
        });
      };
      for (let i = 0; i < total; i++) {
        setTimeout(step, i * 120);
      }
    },

    /**
     * Burst a small particle shower at the given point (for hit confirmation).
     */
    burst(arena, x, y, color, count) {
      if (!arena) return;
      count = count || 6;
      for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'keg-particle';
        p.style.left = x + 'px';
        p.style.top = y + 'px';
        p.style.background = color || '#facc15';
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const dist = 30 + Math.random() * 30;
        p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
        p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
        arena.appendChild(p);
        setTimeout(() => p.remove(), 700);
      }
    }
  };

  window.Projectile = Projectile;
})();
