// monster.js - Word monsters with 3 AI behaviors
(function () {
  'use strict';

  const SIZE = 44;          // visual size
  const HITBOX = 36;        // collision size
  const DETECT_RADIUS = 180; // when aggressive, notice player this far

  const MONSTER_EMOJIS = ['👾', '👻', '🤖', '👹', '🧟', '🦇', '🐙', '🦑', '🐲', '🐍', '🕷️', '🦂', '🐢', '🦖'];
  const SPEECH_BUBBLE_EMOJIS = ['💢', '❗', '💢', '❓'];

  // AI types
  const AI = {
    WANDER: 'wander',     // random walk
    PATROL: 'patrol',     // between two points
    AGGRESSIVE: 'aggressive' // chases player when close
  };

  // Polyfill ctx.roundRect for browsers that lack it
  // (Chrome < 99, Firefox < 112, Safari < 16). Without this, rendering a
  // monster label throws a TypeError every frame and kills the game loop.
  if (typeof CanvasRenderingContext2D !== 'undefined' &&
      !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, radius) {
      const r = Math.max(0, Math.min(typeof radius === 'number' ? radius : 0, Math.abs(w) / 2, Math.abs(h) / 2));
      this.moveTo(x + r, y);
      this.arcTo(x + w, y, x + w, y + h, r);
      this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r);
      this.arcTo(x, y, x + w, y, r);
      this.closePath();
      return this;
    };
  }

  class Monster {
    constructor(x, y, word, aiType, speed) {
      this.x = x;
      this.y = y;
      this.spawnX = x;
      this.spawnY = y;
      this.word = word;                 // { id, english, chinese, emoji, ... }
      this.ai = aiType || AI.WANDER;
      this.speed = speed || 0.8;
      this.dir = { x: Utils.randFloat(-1, 1), y: Utils.randFloat(-1, 1) };
      this.normalize();
      this.emoji = Utils.randItem(MONSTER_EMOJIS);
      this.color = `hsl(${Utils.randInt(0, 360)}, 70%, 60%)`;
      this.wobble = 0;
      this.alive = true;
      this.captured = false;
      this.captureAnim = 0;        // 0..1 animation progress
      this.patrolTarget = {
        x: x + Utils.randInt(-120, 120),
        y: y + Utils.randInt(-120, 120)
      };
      this.thinkTimer = 0;
    }

    normalize() {
      const m = Math.hypot(this.dir.x, this.dir.y) || 1;
      this.dir.x /= m; this.dir.y /= m;
    }

    // Keep the patrol target inside the world. A monster spawned near an
    // edge gets a target outside the world; without clamping it walks into
    // the wall, bounces, and re-aims at the unreachable target forever.
    clampPatrolTarget(worldW, worldH) {
      this.patrolTarget.x = Utils.clamp(this.patrolTarget.x, SIZE / 2, worldW - SIZE / 2);
      this.patrolTarget.y = Utils.clamp(this.patrolTarget.y, SIZE / 2, worldH - SIZE / 2);
    }

    update(dtMs, player, worldW, worldH) {
      // Defensive dt clamp: a long background-tab pause must not
      // fast-forward the capture animation or teleport the monster.
      const dt = Math.max(0, Math.min(50, dtMs || 0));

      if (this.captureAnim > 0) {
        this.captureAnim += dt / 600;
        if (this.captureAnim >= 1) this.alive = false;
        return;
      }

      this.wobble += dt * 0.005;

      // AI logic
      // Dynamic detect radius based on world size (min 100, max 300).
      // Use both width and height (not just the smaller) so a tall but
      // narrow world still gets a sensible detection range.
      const detectRadius = Math.min(300, Math.max(100, Math.floor((worldW + worldH) / 6)));
      const distToPlayer = Utils.dist(this, player);
      if (this.ai === AI.AGGRESSIVE && distToPlayer < detectRadius) {
        // Move toward player
        const dx = player.x - this.x;
        const dy = player.y - this.y;
        const m = Math.hypot(dx, dy) || 1;
        this.dir.x = dx / m;
        this.dir.y = dy / m;
      } else if (this.ai === AI.PATROL) {
        // Move toward patrol target; pick new one when reached
        const d = Utils.dist(this, this.patrolTarget);
        if (d < 10) {
          // Clamp patrol target to world bounds
          this.patrolTarget = {
            x: Utils.clamp(this.spawnX + Utils.randInt(-150, 150), SIZE/2, worldW - SIZE/2),
            y: Utils.clamp(this.spawnY + Utils.randInt(-150, 150), SIZE/2, worldH - SIZE/2)
          };
        }
        const dx = this.patrolTarget.x - this.x;
        const dy = this.patrolTarget.y - this.y;
        const m = Math.hypot(dx, dy) || 1;
        this.dir.x = dx / m;
        this.dir.y = dy / m;
      } else {
        // WANDER: change direction occasionally
        this.thinkTimer -= dt;
        if (this.thinkTimer <= 0) {
          this.dir = { x: Utils.randFloat(-1, 1), y: Utils.randFloat(-1, 1) };
          this.normalize();
          this.thinkTimer = Utils.randInt(800, 2400);
        }
      }

      // Move
      const move = this.speed * (dt / 16);  // normalize to ~60fps
      this.x += this.dir.x * move;
      this.y += this.dir.y * move;

      // Soft world bounds: bounce off edges
      const margin = SIZE/2;
      if (this.x < margin)       { this.x = margin;       this.dir.x = Math.abs(this.dir.x); }
      if (this.x > worldW-margin){ this.x = worldW-margin;this.dir.x = -Math.abs(this.dir.x); }
      if (this.y < margin)       { this.y = margin;       this.dir.y = Math.abs(this.dir.y); }
      if (this.y > worldH-margin){ this.y = worldH-margin;this.dir.y = -Math.abs(this.dir.y); }
    }

    startCapture() {
      this.captured = true;
      this.captureAnim = 0.001;
    }

    getHitbox() {
      return { x: this.x, y: this.y, w: HITBOX, h: HITBOX };
    }

    render(ctx) {
      ctx.save();

      if (this.captureAnim > 0) {
        // Capture animation: scale up + spin + fade
        const t = this.captureAnim;
        const scale = 1 + t * 0.5;
        const alpha = 1 - t;
        ctx.globalAlpha = alpha;
        ctx.translate(this.x, this.y);
        ctx.rotate(t * Math.PI * 2);
        ctx.scale(scale, scale);
        ctx.translate(-this.x, -this.y);

        // Sparkles
        if (Math.floor(t * 10) % 2 === 0) {
          ctx.font = '24px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('✨', this.x - 12, this.y - 8);
          ctx.fillText('💫', this.x + 12, this.y + 8);
        }
      } else {
        // Wobble idle
        const wobY = Math.sin(this.wobble * 3) * 3;
        ctx.translate(0, wobY);
      }

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + SIZE/2 - 2, SIZE/2.4, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Monster body (emoji) - restroed for scene navigation
      ctx.font = `${SIZE}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.emoji, this.x, this.y);

      // Word label below
      const labelY = this.y + SIZE/2 + 12;
      // Pill background
      ctx.font = 'bold 14px "Nunito", system-ui, sans-serif';
      const text = this.word.english;
      const w = ctx.measureText(text).width + 14;
      const h = 20;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.beginPath();
      ctx.roundRect(this.x - w/2, labelY - h/2, w, h, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, this.x, labelY);

      // Speech bubble (small) when aggressive/close to player
      if (this.ai === AI.AGGRESSIVE) {
        ctx.font = '14px serif';
        ctx.fillText(Utils.randItem(SPEECH_BUBBLE_EMOJIS), this.x + 14, this.y - 22);
      }

      ctx.restore();
    }
  }

  // Spawn N monsters for a level, distributed across the world
  function spawnMonsters(words, count, speed, worldW, worldH) {
    const aiTypes = [AI.WANDER, AI.WANDER, AI.PATROL, AI.AGGRESSIVE];
    const monsters = [];
    const minDist = 80;
    let attempts = 0;
    const maxAttempts = count * 30;

    // Validate world dimensions
    if (worldW < 120 || worldH < 120) {
      console.warn('World dimensions too small for monster spawning');
      return monsters;
    }

    while (monsters.length < count && attempts < maxAttempts) {
      attempts++;
      const x = Utils.randInt(60, worldW - 60);
      const y = Utils.randInt(60, worldH - 60);
      // Don't pile on top of each other
      let tooClose = false;
      for (const m of monsters) {
        if (Math.hypot(m.x - x, m.y - y) < minDist) { tooClose = true; break; }
      }
      if (tooClose) continue;

      const word = Utils.randItem(words);
      const ai = Utils.randItem(aiTypes);
      monsters.push(new Monster(x, y, word, ai, speed));
    }

    return monsters;
  }

  window.Monster = Monster;
  window.spawnMonsters = spawnMonsters;
  window.MONSTER_AI = AI;
})();
