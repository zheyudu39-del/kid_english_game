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
      this.animPhase = 0;      // continuous stride phase (drives boots/sway)
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

      // Walk animation: cycle emoji every 200ms when moving. animPhase is a
      // continuous stride oscillator (~2.5 steps/sec) so the boots and rifle
      // sway smoothly instead of snapping between two poses.
      if (this.isMoving) {
        this.walkTimer += dtMs;
        this.animPhase += dtMs * 0.016;
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
      // Stride: -1..1 alternates the boots; bob lifts the body at each
      // step-plant. Both freeze at 0 when standing.
      const step = this.isMoving ? Math.sin(this.animPhase) : 0;
      const bob = this.isMoving ? -Math.abs(Math.cos(this.animPhase)) * 1.2 : 0;

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

      // animPhase drives a smooth stride: the rifle group gets a gentle
      // carry-sway instead of the old two-pose snap.
      this._drawHero(ctx, s, step);

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

    // Top-down soldier, drawn facing +x. The caller rotates the context so
    // the body tracks the movement direction. Layer order mimics a real
    // top-down view: boots (ground) → backpack → torso/vest → arms+rifle →
    // helmet (highest point). `step` is -1..1 and alternates the boots plus
    // a slight rifle carry-sway.
    _drawHero(ctx, s, step) {
      const OUT = '#241609';                        // unified outline color
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Rounded-rect helper with a graceful fallback if roundRect is absent.
      const rr = (px, py, w, h, r) => {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(px, py, w, h, r);
        else ctx.rect(px, py, w, h);
      };
      const stroke = (lw) => { ctx.lineWidth = lw; ctx.strokeStyle = OUT; ctx.stroke(); };
      // 5-point star path (helmet emblem).
      const star = (cx, cy, r, rot) => {
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
          const rad = i % 2 === 0 ? r : r * 0.45;
          const a = rot + (i * Math.PI) / 5;
          const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };

      const sway = step * 1.4;
      const stride = step * 3.2;   // forward boot offset

      // ---- boots (combat soles, alternating stride) ----
      const boot = (bx, by) => {
        ctx.fillStyle = '#2c2115';
        rr(bx - 5 * s, by - 2.7 * s, 10 * s, 5.4 * s, 2.2 * s); ctx.fill(); stroke(1.2 * s);
        // toe cap (front third, slightly lighter leather)
        ctx.fillStyle = '#3a2c1c';
        rr(bx + 1.2 * s, by - 2.4 * s, 3.4 * s, 4.8 * s, 1.4 * s); ctx.fill();
        // tread lines across the sole
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = 0.9 * s;
        ctx.beginPath();
        ctx.moveTo(bx - 2.6 * s, by - 1.8 * s); ctx.lineTo(bx - 2.6 * s, by + 1.8 * s);
        ctx.moveTo(bx - 0.4 * s, by - 2.1 * s); ctx.lineTo(bx - 0.4 * s, by + 2.1 * s);
        ctx.stroke();
      };
      boot(stride, -7.6 * s);     // left boot steps forward…
      boot(-stride, 7.6 * s);     // …while the right steps back

      // ---- backpack (peeking out behind the torso) ----
      ctx.fillStyle = '#4a3a28';
      rr(-15 * s, -6 * s, 7 * s, 12 * s, 2.5 * s); ctx.fill(); stroke(1.2 * s);
      // pack straps on the flap
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1 * s;
      ctx.beginPath();
      ctx.moveTo(-12 * s, -4 * s); ctx.lineTo(-12 * s, 4 * s);
      ctx.moveTo(-9.5 * s, -4 * s); ctx.lineTo(-9.5 * s, 4 * s);
      ctx.stroke();
      // bedroll strapped on top
      ctx.fillStyle = '#5d6b46';
      rr(-14.5 * s, -8.6 * s, 8 * s, 3 * s, 1.5 * s); ctx.fill(); stroke(1 * s);

      // ---- torso: shoulders + tactical vest ----
      const torso = ctx.createRadialGradient(-2 * s, 2 * s, 2 * s, -2 * s, 2 * s, 14 * s);
      torso.addColorStop(0, '#5a7a44');
      torso.addColorStop(1, '#3a5428');
      ctx.fillStyle = torso;
      ctx.beginPath();
      ctx.ellipse(-2 * s, 2 * s, 11 * s, 12.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      stroke(1.6 * s);

      // vest chest plate (front half of the torso)
      ctx.fillStyle = '#45572f';
      rr(-6 * s, -6.5 * s, 10 * s, 17 * s, 3 * s); ctx.fill(); stroke(1.1 * s);
      // chest straps across the vest
      ctx.strokeStyle = '#2d3b1d';
      ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      ctx.moveTo(-4.5 * s, -8.5 * s); ctx.lineTo(-4.5 * s, 12.5 * s);
      ctx.moveTo(2 * s, -9 * s); ctx.lineTo(2 * s, 13 * s);
      ctx.stroke();
      // side mag pouches (left + right ribs)
      ctx.fillStyle = '#3d5029';
      rr(-3.5 * s, -12.4 * s, 5 * s, 4 * s, 1.4 * s); ctx.fill(); stroke(1 * s);
      rr(-3.5 * s, 8.4 * s, 5 * s, 4 * s, 1.4 * s); ctx.fill(); stroke(1 * s);
      // pouch flaps
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 1 * s;
      ctx.beginPath();
      ctx.moveTo(-3.2 * s, -11.4 * s); ctx.lineTo(1.2 * s, -11.4 * s);
      ctx.moveTo(-3.2 * s, 9.4 * s); ctx.lineTo(1.2 * s, 9.4 * s);
      ctx.stroke();

      // ---- arms (olive sleeves, two-pass outline+fill) ----
      const arm = (x1, y1, x2, y2) => {
        ctx.strokeStyle = OUT;
        ctx.lineWidth = 8 * s;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.strokeStyle = '#4a6b3a';
        ctx.lineWidth = 5.5 * s;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      };

      // ---- rifle group (sways with the stride) ----
      ctx.save();
      ctx.translate(0, sway);

      // buttstock + cheek riser (wooden)
      ctx.fillStyle = '#7a5230';
      rr(-14 * s, -2 * s, 9 * s, 4.2 * s, 2 * s); ctx.fill(); stroke(1.3 * s);
      ctx.fillStyle = '#5f3f23';
      rr(-12.5 * s, -2.5 * s, 4.5 * s, 2 * s, 1 * s); ctx.fill();
      // receiver (dark metal) + charging handle
      ctx.fillStyle = '#3a3f4a';
      rr(-5 * s, -2.2 * s, 11 * s, 4.4 * s, 1.5 * s); ctx.fill(); stroke(1.3 * s);
      ctx.fillStyle = '#565e6c';
      rr(-4.2 * s, -3.2 * s, 3 * s, 1.2 * s, 0.5 * s); ctx.fill();
      // pistol grip (angled back-right, below receiver)
      ctx.save();
      ctx.translate(-2.2 * s, 2 * s);
      ctx.rotate(0.5);
      ctx.fillStyle = '#262b33';
      rr(-1.2 * s, 0, 2.6 * s, 5 * s, 1 * s); ctx.fill(); stroke(1 * s);
      ctx.restore();
      // curved magazine (two offset segments suggest the banana curve)
      ctx.save();
      ctx.translate(2.8 * s, 2.2 * s);
      ctx.rotate(0.28);
      ctx.fillStyle = '#333a45';
      rr(-1.5 * s, 0, 3.2 * s, 5.5 * s, 1.2 * s); ctx.fill(); stroke(1 * s);
      ctx.translate(0.6 * s, 5 * s);
      ctx.rotate(0.22);
      ctx.fillStyle = '#2c333d';
      rr(-1.5 * s, 0, 3.2 * s, 4.8 * s, 1.2 * s); ctx.fill(); stroke(1 * s);
      ctx.restore();
      // handguard with picatinny rail notches
      ctx.fillStyle = '#2f3542';
      rr(6 * s, -1.7 * s, 8 * s, 3.4 * s, 1.2 * s); ctx.fill(); stroke(1.2 * s);
      ctx.strokeStyle = '#565e6c';
      ctx.lineWidth = 0.9 * s;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const nx = 7 * s + i * 1.8 * s;
        ctx.moveTo(nx, -1.5 * s); ctx.lineTo(nx, 1.5 * s);
      }
      ctx.stroke();
      // barrel
      ctx.fillStyle = '#232830';
      rr(14 * s, -1 * s, 6.5 * s, 2 * s, 0.8 * s); ctx.fill(); stroke(1 * s);
      // front sight post
      ctx.fillStyle = '#1c2129';
      rr(17.8 * s, -2.4 * s, 1.3 * s, 1.8 * s, 0.4 * s); ctx.fill();
      // muzzle brake (birdcage with two ports)
      ctx.fillStyle = '#1e272e';
      rr(20.5 * s, -1.5 * s, 3.2 * s, 3 * s, 1 * s); ctx.fill(); stroke(1 * s);
      ctx.strokeStyle = '#3a4250';
      ctx.lineWidth = 0.8 * s;
      ctx.beginPath();
      ctx.moveTo(21.4 * s, -1.2 * s); ctx.lineTo(21.4 * s, 1.2 * s);
      ctx.moveTo(22.6 * s, -1.2 * s); ctx.lineTo(22.6 * s, 1.2 * s);
      ctx.stroke();
      // red-dot sight on a low mount, forward of the receiver
      ctx.fillStyle = '#262b33';
      rr(0.2 * s, -3.9 * s, 4.2 * s, 1.8 * s, 0.6 * s); ctx.fill(); stroke(0.9 * s);
      ctx.fillStyle = '#151a20';
      ctx.beginPath(); ctx.arc(2.3 * s, -3.6 * s, 1.35 * s, 0, Math.PI * 2); ctx.fill(); stroke(0.8 * s);
      ctx.fillStyle = '#ff5a5a';
      ctx.beginPath(); ctx.arc(2.3 * s, -3.6 * s, 0.5 * s, 0, Math.PI * 2); ctx.fill();

      // arms reach from the shoulders onto grip + foregrip
      arm(-5 * s, 8 * s, 7.5 * s, 1.8 * s);     // rear arm → pistol grip
      arm(-5 * s, -8 * s, 14.5 * s, -1.4 * s);  // front arm → handguard

      // hands (skin fists with knuckle/thumb detail)
      const fist = (fx, fy) => {
        ctx.fillStyle = '#f4c293';
        ctx.beginPath(); ctx.arc(fx, fy, 2.7 * s, 0, Math.PI * 2); ctx.fill(); stroke(1 * s);
        ctx.strokeStyle = 'rgba(36,22,9,0.55)';
        ctx.lineWidth = 0.8 * s;
        ctx.beginPath(); ctx.arc(fx + 0.6 * s, fy, 1.6 * s, -0.9, 0.9); ctx.stroke();
      };
      fist(7.5 * s, 1.8 * s);
      fist(14.5 * s, -1.4 * s);

      // muzzle flash (4-point star + hot core, while shootFlash is active)
      if (this.shootFlash > 0) {
        const fx = 24.8 * s;
        const flick = 0.8 + 0.2 * Math.sin(Date.now() / 18);
        ctx.fillStyle = 'rgba(255,215,0,0.85)';
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const rad = (i % 2 === 0 ? 6.5 * s : 2.2 * s) * flick;
          const a = (i * Math.PI) / 4;
          const px = fx + Math.cos(a) * rad, py = Math.sin(a) * rad;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(fx, 0, 2.2 * s, 0, Math.PI * 2); ctx.fill();
      }

      ctx.restore();

      // ---- helmet (topmost layer: camo cover, rim, goggles, emblem) ----
      const hx = -2 * s, hy = -3 * s, hr = 11.5 * s;
      const helmet = ctx.createRadialGradient(hx - 3 * s, hy - 3 * s, 2 * s, hx, hy, hr);
      helmet.addColorStop(0, '#5f7f47');
      helmet.addColorStop(1, '#33471f');
      ctx.fillStyle = helmet;
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
      stroke(1.8 * s);
      // camo blotches + net lines
      ctx.fillStyle = 'rgba(42, 62, 28, 0.55)';
      ctx.beginPath(); ctx.ellipse(hx - 5 * s, hy + 3 * s, 3 * s, 2 * s, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx + 2 * s, hy - 5.5 * s, 2.5 * s, 1.8 * s, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(25, 38, 14, 0.5)';
      ctx.lineWidth = 0.8 * s;
      ctx.beginPath();
      ctx.moveTo(hx - hr * 0.8, hy - 2 * s); ctx.lineTo(hx + hr * 0.8, hy - 2 * s);
      ctx.moveTo(hx - hr * 0.7, hy + 3 * s); ctx.lineTo(hx + hr * 0.7, hy + 3 * s);
      ctx.moveTo(hx - 3 * s, hy - hr * 0.8); ctx.lineTo(hx - 3 * s, hy + hr * 0.8);
      ctx.stroke();
      // helmet rim (steel band around the edge)
      ctx.strokeStyle = '#2b3b1c';
      ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.arc(hx, hy, hr - 1.4 * s, 0, Math.PI * 2); ctx.stroke();
      // goggles: dark band across the front rim with two lenses
      ctx.fillStyle = '#1e272e';
      rr(hx + 6.2 * s, hy - 4.2 * s, 4.6 * s, 8.4 * s, 1.8 * s); ctx.fill(); stroke(1 * s);
      ctx.fillStyle = '#151a20';
      ctx.beginPath(); ctx.arc(hx + 8.2 * s, hy - 2 * s, 1.5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx + 8.2 * s, hy + 2 * s, 1.5 * s, 0, Math.PI * 2); ctx.fill();
      // lens glints
      ctx.fillStyle = 'rgba(120, 220, 255, 0.5)';
      ctx.beginPath(); ctx.arc(hx + 8.7 * s, hy - 2.4 * s, 0.5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(hx + 8.7 * s, hy + 1.6 * s, 0.5 * s, 0, Math.PI * 2); ctx.fill();
      // glossy highlight arc across the shell
      ctx.strokeStyle = 'rgba(255,255,255,0.32)';
      ctx.lineWidth = 1.5 * s;
      ctx.beginPath(); ctx.arc(hx, hy, hr - 4 * s, -2.3, -0.9); ctx.stroke();
      // gold star emblem on the crown
      ctx.fillStyle = '#ffd700';
      star(hx - 3 * s, hy - 0.5 * s, 3 * s, -Math.PI / 2);
      ctx.fill(); stroke(0.9 * s);
    }

    getHitbox() {
      return { x: this.x, y: this.y, w: HITBOX, h: HITBOX };
    }
  }

  window.Player = Player;
})();
