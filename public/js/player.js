// player.js - The hero character (rendered as emoji)
(function () {
  'use strict';

  const SPEED = 3.2;        // base movement speed (units per frame)
  const SIZE = 48;          // visual size
  const HITBOX = 36;        // collision size

  class Player {
    constructor(x, y) {
      this.x = x;
      this.y = y;
      this.vx = 0;
      this.vy = 0;
      this.dir = 'down';       // facing
      this.facing = { x: 0, y: 1 };
      this.emoji = '🧒';
      this.emojiIndex = 0;     // for walk animation
      this.walkTimer = 0;
      this.invulnerable = 0;   // ms of invulnerability after hit
      this.flashTimer = 0;
      this.isMoving = false;
    }

    update(dtMs, input, worldW, worldH) {
      // Determine target velocity from input
      let tx = 0, ty = 0;
      if (input.left)  tx -= 1;
      if (input.right) tx += 1;
      if (input.up)    ty -= 1;
      if (input.down)  ty += 1;

      const mag = Math.hypot(tx, ty);
      if (mag > 0) {
        tx /= mag; ty /= mag;
        this.isMoving = true;
        // Update facing direction
        if (Math.abs(tx) > Math.abs(ty)) {
          this.dir = tx > 0 ? 'right' : 'left';
        } else {
          this.dir = ty > 0 ? 'down' : 'up';
        }
        this.facing = { x: tx, y: ty };
      } else {
        this.isMoving = false;
      }

      this.vx = tx * SPEED;
      this.vy = ty * SPEED;

      // Apply with collision clamping
      this.x = Utils.clamp(this.x + this.vx, SIZE/2, worldW - SIZE/2);
      this.y = Utils.clamp(this.y + this.vy, SIZE/2, worldH - SIZE/2);

      // Walk animation: cycle emoji every 200ms when moving
      if (this.isMoving) {
        this.walkTimer += dtMs;
        if (this.walkTimer > 200) {
          this.walkTimer = 0;
          this.emojiIndex = (this.emojiIndex + 1) % 2;
        }
      } else {
        this.emojiIndex = 0;
      }

      // Invulnerability countdown
      if (this.invulnerable > 0) this.invulnerable -= dtMs;
      if (this.flashTimer > 0) this.flashTimer -= dtMs;
    }

    takeHit() {
      if (this.invulnerable > 0) return false;
      this.invulnerable = 1500;
      this.flashTimer = 1500;
      return true;
    }

    render(ctx) {
      ctx.save();
      const flashing = this.flashTimer > 0 && Math.floor(this.flashTimer / 100) % 2 === 0;
      if (flashing) ctx.globalAlpha = 0.4;

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + SIZE/2 - 4, SIZE/2.2, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Body (emoji-based sprite; toggle for walk animation)
      const sprites = ['🧒', '🏃'];
      const sprite = this.isMoving ? sprites[this.emojiIndex] : this.emoji;
      ctx.font = `${SIZE}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(sprite, this.x, this.y);

      // Direction indicator (small arrow above head when moving)
      if (this.isMoving) {
        ctx.font = '14px serif';
        const ox = this.facing.x * 8;
        const oy = this.facing.y * 8 - SIZE/2 - 4;
        ctx.fillText('✨', this.x + ox, this.y + oy);
      }

      ctx.restore();
    }

    getHitbox() {
      return { x: this.x, y: this.y, w: HITBOX, h: HITBOX };
    }
  }

  window.Player = Player;
})();
