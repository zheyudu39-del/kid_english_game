// coin.js - Dropped coins and floating pickups
(function () {
  'use strict';

  const SIZE = 28;
  const HITBOX = 24;
  const LIFETIME = 6000; // ms before coin fades out
  const DEFAULT_GROUND_Y = 480; // fallback when world.groundY isn't supplied

  class Coin {
    constructor(x, y, value = 10, groundY) {
      this.x = x;
      this.y = y;
      this.value = value;
      this.groundY = (typeof groundY === 'number' && isFinite(groundY)) ? groundY : DEFAULT_GROUND_Y;
      this.vx = Utils.randFloat(-1.5, 1.5);
      this.vy = Utils.randFloat(-2.5, -1.0);
      this.gravity = 0.15;
      this.life = 0;
      this.alive = true;
      this.collected = false;
      this.bobT = Utils.randFloat(0, Math.PI * 2);
    }

    update(dtMs) {
      this.life += dtMs;
      this.bobT += dtMs * 0.008;
      // Simple physics
      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.vx *= 0.98;
      if (this.vy > 0 && this.y > this.groundY) this.vy *= -0.4; // bounce off ground
    }

    isExpired() {
      return this.life > LIFETIME;
    }

    getHitbox() {
      return { x: this.x, y: this.y, w: HITBOX, h: HITBOX };
    }

    render(ctx) {
      const lifeRatio = this.life / LIFETIME;
      if (lifeRatio > 0.7) {
        // Fade out in last 30%
        ctx.globalAlpha = 1 - (lifeRatio - 0.7) / 0.3;
      }
      const bob = Math.sin(this.bobT) * 3;
      ctx.font = `${SIZE}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🪙', this.x, this.y + bob);
      ctx.globalAlpha = 1;
    }
  }

  window.Coin = Coin;
})();
