// player.js - The hero character (vector top-down soldier, see _drawHero)
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
      this.facing = { x: 0, y: 1 };
      this.emojiIndex = 0;     // toggles 0/1 as the walk-cycle phase
      this.walkTimer = 0;
      this.invulnerable = 0;   // ms of invulnerability after hit
      this.flashTimer = 0;
      this.shootFlash = 0;     // ms of muzzle-flash after firing
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
        // Update facing (unit vector — drives rendering + firing direction)
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
      if (this.shootFlash > 0) this.shootFlash -= dtMs;
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
      if (flashing) ctx.globalAlpha = 0.45;

      const x = this.x, y = this.y;
      const s = SIZE / 48;                          // design drawn at 48 units, scaled
      const bob = this.isMoving ? Math.sin(this.walkTimer * 0.05) * 1.5 : 0;

      // Soft radial drop shadow — crisper and tighter than a flat ellipse.
      const sh = ctx.createRadialGradient(x, y + SIZE / 2 - 2, 2, x, y + SIZE / 2 - 2, SIZE / 2.1);
      sh.addColorStop(0, 'rgba(0,0,0,0.28)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sh;
      ctx.beginPath();
      ctx.ellipse(x, y + SIZE / 2 - 2, SIZE / 2.1, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(x, y + bob);
      // Rotate the whole soldier so the rifle always points along the last
      // movement direction. The body is drawn facing +x, so the angle comes
      // directly from the facing unit vector.
      ctx.rotate(Math.atan2(this.facing.y, this.facing.x));

      // emojiIndex already toggles 0/1 every 200ms while moving — reuse it
      // as the walk phase so the rifle sway animates without new timers.
      const walk = this.isMoving ? (this.emojiIndex === 0 ? 1 : -1) : 0;
      this._drawHero(ctx, s, walk);

      ctx.restore();

      // Direction sparkle while moving
      if (this.isMoving) {
        ctx.font = '13px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✨', x + this.facing.x * 11, y - SIZE / 2 - 7);
      }

      ctx.restore();
    }

    // Top-down soldier (helmet + shoulders + rifle), drawn facing +x. The
    // caller rotates the context so the rifle tracks the movement direction.
    // `walk` is -1/0/+1 and gives the rifle a slight carry-sway.
    _drawHero(ctx, s, walk) {
      const OUT = '#2b1a12';                        // unified outline color
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Rounded-rect helper with a graceful fallback if roundRect is absent.
      const rr = (px, py, w, h, r) => {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px, py, w, h, r);
        else ctx.rect(px, py, w, h);
      };
      const stroke = (lw) => { ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke(); };

      const sway = walk * 1.5;

      // ---- rifle + arms (sway slightly while walking) ----
      ctx.save();
      ctx.translate(0, sway);

      // wooden stock (behind the body)
      ctx.fillStyle = '#7a5230';
      rr(-12 * s, -2.5 * s, 9 * s, 5 * s, 2 * s); ctx.fill(); stroke(1.4 * s);
      // receiver / body
      ctx.fillStyle = '#3a3f4a';
      rr(-4 * s, -2.5 * s, 11 * s, 5 * s, 1.5 * s); ctx.fill(); stroke(1.4 * s);
      // barrel
      ctx.fillStyle = '#2f3542';
      rr(7 * s, -1.5 * s, 13 * s, 3 * s, 1 * s); ctx.fill(); stroke(1.2 * s);
      // muzzle tip
      ctx.fillStyle = '#1e272e';
      rr(20 * s, -1.8 * s, 2.5 * s, 3.6 * s, 1 * s); ctx.fill(); stroke(1 * s);
      // magazine (hangs down below the receiver)
      ctx.fillStyle = '#2f3542';
      rr(-2 * s, 1 * s, 3.5 * s, 6 * s, 1.5 * s); ctx.fill(); stroke(1.2 * s);

      // arms (olive sleeves, outlined)
      ctx.strokeStyle = OUT;
      ctx.lineWidth = 8 * s;
      ctx.beginPath();
      ctx.moveTo(-5 * s, 7 * s); ctx.lineTo(10 * s, 1 * s);    // rear arm → grip
      ctx.moveTo(-5 * s, -7 * s); ctx.lineTo(17 * s, -1 * s);   // front arm → foregrip
      ctx.stroke();
      ctx.strokeStyle = '#4a6b3a';
      ctx.lineWidth = 5.5 * s;
      ctx.beginPath();
      ctx.moveTo(-5 * s, 7 * s); ctx.lineTo(10 * s, 1 * s);
      ctx.moveTo(-5 * s, -7 * s); ctx.lineTo(17 * s, -1 * s);
      ctx.stroke();

      // muzzle flash (while shootFlash is active)
      if (this.shootFlash > 0) {
        const fx = 23.5 * s;
        ctx.fillStyle = '#ffd700';
        ctx.beginPath(); ctx.arc(fx, 0, 5 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(fx, 0, 2.5 * s, 0, Math.PI * 2); ctx.fill();
      }

      ctx.restore();

      // ---- shoulders / torso (olive gradient) ----
      const torso = ctx.createRadialGradient(-2 * s, 2 * s, 2 * s, -2 * s, 2 * s, 14 * s);
      torso.addColorStop(0, '#5a7a44');
      torso.addColorStop(1, '#3a5428');
      ctx.fillStyle = torso;
      ctx.beginPath();
      ctx.ellipse(-2 * s, 2 * s, 11 * s, 12 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      stroke(1.6 * s);

      // ---- helmet (top-down: big circle + rim + camo) ----
      const hx = -2 * s, hy = -3 * s, hr = 12 * s;
      const helmet = ctx.createRadialGradient(hx - 3 * s, hy - 3 * s, 2 * s, hx, hy, hr);
      helmet.addColorStop(0, '#5f7f47');
      helmet.addColorStop(1, '#33471f');
      ctx.fillStyle = helmet;
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
      stroke(1.8 * s);
      // camo blotches
      ctx.fillStyle = 'rgba(42, 62, 28, 0.55)';
      ctx.beginPath(); ctx.ellipse(hx - 5 * s, hy + 2 * s, 3 * s, 2 * s, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx + 4 * s, hy - 5 * s, 2.5 * s, 2 * s, -0.5, 0, Math.PI * 2); ctx.fill();
      // glossy highlight
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath(); ctx.arc(hx, hy, hr - 3.5 * s, -2.2, -0.8); ctx.stroke();
      // gold star emblem (front of the helmet)
      ctx.fillStyle = '#ffd700';
      ctx.beginPath(); ctx.arc(hx + 7 * s, hy - 1 * s, 2.2 * s, 0, Math.PI * 2); ctx.fill();
      stroke(1 * s);

      // ---- hands (skin-toned fists gripping the barrel) ----
      ctx.fillStyle = '#f4c293';
      ctx.beginPath(); ctx.arc(10 * s, 1 * s + sway, 2.6 * s, 0, Math.PI * 2); ctx.fill(); stroke(1 * s);
      ctx.beginPath(); ctx.arc(17 * s, -1 * s + sway, 2.6 * s, 0, Math.PI * 2); ctx.fill(); stroke(1 * s);
    }

    getHitbox() {
      return { x: this.x, y: this.y, w: HITBOX, h: HITBOX };
    }
  }

  window.Player = Player;
})();
