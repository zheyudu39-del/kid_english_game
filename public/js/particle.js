// particle.js - Lightweight particle effects on the FX canvas (top layer)
(function () {
  'use strict';

  class ParticleSystem {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.particles = [];
      this._resize();
      window.addEventListener('resize', () => this._resize());
    }

    _resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.w = w;
      this.h = h;
    }

    // worldX/worldY is in WORLD coords; we need to convert via camera
    emit(x, y, opts = {}) {
      const count = opts.count || 12;
      const color = opts.color || '#feca57';
      const speed = opts.speed || 4;
      const life = opts.life || 600;
      const size = opts.size || 6;
      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Utils.randFloat(-0.3, 0.3);
        const sp = Utils.randFloat(speed * 0.4, speed);
        this.particles.push({
          x, y,
          vx: Math.cos(angle) * sp,
          vy: Math.sin(angle) * sp,
          life: 0,
          maxLife: life,
          size: Utils.randFloat(size * 0.5, size * 1.3),
          color,
          gravity: opts.gravity || 0
        });
      }
    }

    burst(x, y, emoji, count = 8, spriteName) {
      for (let i = 0; i < count; i++) {
        const angle = Utils.randFloat(0, Math.PI * 2);
        const sp = Utils.randFloat(2, 5);
        this.particles.push({
          x, y,
          vx: Math.cos(angle) * sp,
          vy: Math.sin(angle) * sp - 2,
          life: 0,
          maxLife: 800,
          size: Utils.randFloat(20, 32),
          color: '',
          gravity: 0.1,
          emoji,
          sprite: spriteName || null  // optional sprite sheet name
        });
      }
    }

    update(dtMs) {
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life += dtMs;
        if (p.life >= p.maxLife) {
          this.particles.splice(i, 1);
          continue;
        }
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.96;
        p.vy *= 0.96;
      }
    }

    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      for (const p of this.particles) {
        const alpha = 1 - (p.life / p.maxLife);
        if (p.sprite && window.Sprites && Sprites.draw(ctx, p.sprite, p.x, p.y, { size: p.size, alpha })) {
          // Pixel-art sprite particle (drawn via Sprites.draw)
        } else if (p.emoji) {
          ctx.globalAlpha = alpha;
          ctx.font = `${p.size}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.emoji, p.x, p.y);
        } else {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  window.ParticleSystem = ParticleSystem;
})();
