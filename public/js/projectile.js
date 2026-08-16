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
    }

    update(dtMs, worldW, worldH) {
      // Clamp dt like every other entity so a background-tab pause doesn't
      // teleport the projectile.
      const dt = Math.max(0, Math.min(50, dtMs || 0));
      const step = dt / 16;   // normalize movement to ~60fps
      this.x += this.vx * step;
      this.y += this.vy * step;
      this.traveled += Math.hypot(this.vx * step, this.vy * step);

      // Short trail for a motion cue
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 6) this.trail.shift();

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
      // Trail (fading tail)
      for (let i = 0; i < this.trail.length; i++) {
        const p = this.trail[i];
        const t = i / this.trail.length;
        ctx.globalAlpha = t * 0.4;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, this.radius * (0.5 + 0.5 * t), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Core body
      ctx.fillStyle = this.color;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fill();
      // Hot white highlight
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(this.x - this.radius * 0.25, this.y - this.radius * 0.25, this.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  window.Projectile = Projectile;
  window.ProjectileOwner = { PLAYER: OWNER_PLAYER, MONSTER: OWNER_MONSTER };
})();
