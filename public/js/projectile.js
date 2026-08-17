// projectile.js - Shared projectile class for player bullets and monster fireballs
(function () {
  'use strict';

  const OWNER_PLAYER = 'player';
  const OWNER_MONSTER = 'monster';

  class Projectile {
    constructor(x, y, dirX, dirY, opts) {
      opts = opts || {};
      this.x = x;
      this.y = y;
      this.owner = opts.owner || OWNER_PLAYER;
      this.speed = opts.speed || 9;
      this.radius = opts.radius || (this.owner === OWNER_PLAYER ? 6 : 9);
      // Normalize the direction so speed is exact regardless of input length.
      const m = Math.hypot(dirX, dirY) || 1;
      this.vx = (dirX / m) * this.speed;
      this.vy = (dirY / m) * this.speed;
      this.alive = true;
      this.traveled = 0;
      this.maxDist = opts.maxDist || 1600;  // kill off-screen strays
      this.color = opts.color || (this.owner === OWNER_PLAYER ? '#ffd700' : '#ff6b3d');
      this.trail = [];
      this._sparks = [];       // per-frame edge spark particles
      this._born = performance.now();
    }

    update(dtMs, worldW, worldH) {
      // Clamp dt like every other entity so a background-tab pause doesn't
      // teleport the projectile.
      const dt = Math.max(0, Math.min(50, dtMs || 0));
      const step = dt / 16;   // normalize movement to ~60fps
      this.x += this.vx * step;
      this.y += this.vy * step;
      this.traveled += Math.hypot(this.vx * step, this.vy * step);

      // Trail
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 10) this.trail.shift();

      // Sparks — spawn a few per frame
      this._sparks = this._sparks.filter(s => s.life > 0);
      for (let i = 0; i < 2; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = this.radius * (0.6 + Math.random() * 0.8);
        this._sparks.push({
          x: this.x + Math.cos(angle) * dist,
          y: this.y + Math.sin(angle) * dist,
          vx: Math.cos(angle) * (0.5 + Math.random() * 2),
          vy: Math.sin(angle) * (0.5 + Math.random() * 2),
          life: 1, r: 1 + Math.random() * 3
        });
      }
      for (const s of this._sparks) {
        s.x += s.vx * step;
        s.y += s.vy * step;
        s.life -= 0.04 * step;
        s.r *= 0.98;
      }

      // Off-world or ran past max range → despawn
      if (this.x < -30 || this.x > worldW + 30 ||
          this.y < -30 || this.y > worldH + 30 ||
          this.traveled >= this.maxDist) {
        this.alive = false;
      }
    }

    getHitbox() {
      return { x: this.x, y: this.y, w: this.radius * 2, h: this.radius * 2 };
    }

    render(ctx) {
      ctx.save();
      const t = performance.now();
      const age = (t - this._born) * 0.001; // seconds since spawn
      const isPlayer = this.owner === OWNER_PLAYER;
      const speed = Math.hypot(this.vx, this.vy);
      const dirX = speed > 0 ? this.vx / speed : 0;
      const dirY = speed > 0 ? this.vy / speed : 0;
      const angle = Math.atan2(dirY, dirX);
      const r = this.radius;

      // ========== TRAIL ==========
      ctx.shadowBlur = 0;
      for (let i = 0; i < this.trail.length; i++) {
        const p = this.trail[i];
        const progress = i / this.trail.length;
        const alpha = progress * (isPlayer ? 0.5 : 0.55);
        const tr = r * (0.15 + 0.85 * progress);
        if (isPlayer) {
          // Player: golden trail
          const tGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, tr);
          tGrad.addColorStop(0, 'rgba(255,255,200,' + (alpha * 0.9) + ')');
          tGrad.addColorStop(0.6, 'rgba(255,200,30,' + (alpha * 0.5) + ')');
          tGrad.addColorStop(1, 'rgba(255,100,0,0)');
          ctx.fillStyle = tGrad;
        } else {
          // Monster: fire trail
          const tGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, tr);
          tGrad.addColorStop(0, 'rgba(255,200,80,' + (alpha * 0.9) + ')');
          tGrad.addColorStop(0.5, 'rgba(255,80,10,' + (alpha * 0.6) + ')');
          tGrad.addColorStop(1, 'rgba(180,20,0,0)');
          ctx.fillStyle = tGrad;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, tr, 0, Math.PI * 2);
        ctx.fill();
      }

      // ========== SPARKS ==========
      for (const s of this._sparks) {
        const alpha = s.life * 0.8;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = isPlayer ? '#fff8c0' : '#ffcc80';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // ========== OUTER GLOW ==========
      ctx.shadowColor = isPlayer ? '#ffcc00' : '#ff4400';
      ctx.shadowBlur = isPlayer ? 20 : 24;

      // ========== ROTATING ENERGY RINGS ==========
      // Two elliptical rings that spin around the core at different speeds.
      const ringOffsets = [
        { rx: r * 1.6, ry: r * 0.5, spin: age * 5.5, alpha: 0.5, w: 2.5 },
        { rx: r * 1.3, ry: r * 0.8, spin: -age * 3.8, alpha: 0.35, w: 2 }
      ];
      for (const ring of ringOffsets) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(ring.spin);
        ctx.strokeStyle = isPlayer
          ? 'rgba(255,255,180,' + ring.alpha + ')'
          : 'rgba(255,180,50,' + ring.alpha + ')';
        ctx.lineWidth = ring.w;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.ellipse(0, 0, ring.rx, ring.ry, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // ========== CORE BODY (stretched) ==========
      const stretch = 1 + Math.min(speed * 0.01, 0.45);
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(angle);
      ctx.scale(stretch, 1 / stretch);

      if (isPlayer) {
        // --- Player: golden energy bolt ---
        const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.12, '#fffde0');
        g.addColorStop(0.35, this.color);
        g.addColorStop(0.7, '#e6a800');
        g.addColorStop(1, 'rgba(180,100,0,0.3)');
        ctx.fillStyle = g;
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#ffcc00';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // Inner bright core
        ctx.shadowBlur = 0;
        const ig = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.55);
        ig.addColorStop(0, 'rgba(255,255,255,1)');
        ig.addColorStop(0.4, 'rgba(255,255,200,0.5)');
        ig.addColorStop(1, 'rgba(255,255,100,0)');
        ctx.fillStyle = ig;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // --- Monster: lava fireball ---
        const g = ctx.createRadialGradient(-r * 0.2, -r * 0.2, 0, 0, 0, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.1, '#fff4c0');
        g.addColorStop(0.3, '#ffaa30');
        g.addColorStop(0.6, this.color);
        g.addColorStop(0.85, '#cc2200');
        g.addColorStop(1, 'rgba(80,8,0,0.4)');
        ctx.fillStyle = g;
        ctx.shadowBlur = 22;
        ctx.shadowColor = '#ff4400';
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();

        // Flame tendrils — 6 small arcs around the edge
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.6;
        const tendrilCount = 6;
        for (let i = 0; i < tendrilCount; i++) {
          const a = (i / tendrilCount) * Math.PI * 2 + age * 3;
          const tx = Math.cos(a) * r * 0.85;
          const ty = Math.sin(a) * r * 0.85;
          const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, r * 0.45);
          tg.addColorStop(0, 'rgba(255,180,30,0.9)');
          tg.addColorStop(0.6, 'rgba(255,60,0,0.4)');
          tg.addColorStop(1, 'rgba(200,0,0,0)');
          ctx.fillStyle = tg;
          ctx.beginPath();
          ctx.arc(tx, ty, r * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;

        // Inner bright core
        ctx.shadowBlur = 0;
        const ig = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.4);
        ig.addColorStop(0, 'rgba(255,255,255,0.95)');
        ig.addColorStop(0.3, 'rgba(255,255,180,0.5)');
        ig.addColorStop(1, 'rgba(255,150,0,0)');
        ctx.fillStyle = ig;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore(); // undo stretch + rotate
      ctx.restore(); // undo outer ctx.save()
    }
  }

  window.Projectile = Projectile;
  window.ProjectileOwner = { PLAYER: OWNER_PLAYER, MONSTER: OWNER_MONSTER };
})();