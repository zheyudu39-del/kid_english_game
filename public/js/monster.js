// monster.js - Word monsters with 3 AI behaviors
(function () {
  'use strict';

  const SIZE = 44;          // visual size
  const HITBOX = 36;        // collision size

  // Solid body palettes (light→dark) so each monster is a solid outlined
  // creature instead of a floating emoji.
  const BODY_COLORS = [
    { light: '#7bdc5c', dark: '#3f9d2f' },  // green slime
    { light: '#b07bf0', dark: '#7a3fd6' },  // purple
    { light: '#ff7b6b', dark: '#d63f2f' },  // red
    { light: '#5cd0d0', dark: '#2f9d9d' },  // teal
    { light: '#ffb347', dark: '#d67f1f' }   // orange
  ];
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
    constructor(x, y, word, aiType, speed, scale) {
      this.x = x;
      this.y = y;
      this.spawnX = x;
      this.spawnY = y;
      this.word = word;                 // { id, english, chinese, emoji, ... }
      this.ai = aiType || AI.WANDER;
      this.speed = speed || 0.8;
      // Boss monsters spawn at a larger scale (visual + hitbox). Clamped so
      // a bad config can never make a monster cover the whole arena.
      this.scale = Math.max(0.8, Math.min(1.8, Number(scale) || 1));
      this.boss = this.scale >= 1.2;
      this.hp = this.boss ? 5 : 0;       // boss HP: must answer vocab questions to deplete
      this.maxHp = this.hp;
      this.hpFlash = 0;                  // ms remaining for white flash on damage
      this.dir = { x: Utils.randFloat(-1, 1), y: Utils.randFloat(-1, 1) };
      this.normalize();
      this.bodyColor = Utils.randItem(BODY_COLORS);
      // Speech-bubble emoji picked once per monster so it doesn't re-roll
      // (and visually flicker) on every rendered frame.
      this.speechEmoji = Utils.randItem(SPEECH_BUBBLE_EMOJIS);
      this.attackCooldown = 0;     // ms until this monster can melee again
      this.shootTimer = Utils.randInt(300, 800); // ms until next ranged shot (aggressive)
      this.alive = true;
      this.captured = false;
      this.captureAnim = 0;        // 0..1 animation progress
      this.stunned = 0;            // ms remaining while stunned (眩晕手雷)
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

    // Scaled body size — boss monsters are bigger in every dimension
    // (visual, hitbox, world clamping) than regular ones.
    get size() { return SIZE * this.scale; }
    get hitbox() { return HITBOX * this.scale; }

    // Keep the patrol target inside the world. A monster spawned near an
    // edge gets a target outside the world; without clamping it walks into
    // the wall, bounces, and re-aims at the unreachable target forever.
    clampPatrolTarget(worldW, worldH) {
      this.patrolTarget.x = Utils.clamp(this.patrolTarget.x, this.size / 2, worldW - this.size / 2);
      this.patrolTarget.y = Utils.clamp(this.patrolTarget.y, this.size / 2, worldH - this.size / 2);
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

      // Stunned (眩晕手雷): freeze in place — no acting, moving, or shooting.
      if (this.stunned > 0) {
        this.stunned -= dt;
        return;
      }

      // Boss HP flash countdown
      if (this.hpFlash > 0) this.hpFlash -= dt;

      // Attack cooldowns tick down regardless of AI state.
      if (this.attackCooldown > 0) this.attackCooldown -= dt;
      if (this.shootTimer > 0) this.shootTimer -= dt;

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
        // Move toward patrol target; pick new one when reached.
        // Re-clamp every frame: the constructor's initial target is random
        // around the spawn point and can land outside the world when the
        // monster spawns near an edge. An out-of-world target is
        // unreachable (the edge bounce always wins), pinning the monster
        // against the wall forever. (The rebuild path below also clamps.)
        this.clampPatrolTarget(worldW, worldH);
        const d = Utils.dist(this, this.patrolTarget);
        if (d < 10) {
          // Clamp patrol target to world bounds
          this.patrolTarget = {
            x: Utils.clamp(this.spawnX + Utils.randInt(-150, 150), this.size/2, worldW - this.size/2),
            y: Utils.clamp(this.spawnY + Utils.randInt(-150, 150), this.size/2, worldH - this.size/2)
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
      const margin = this.size/2;
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
      return { x: this.x, y: this.y, w: this.hitbox, h: this.hitbox };
    }

    // Boss HP: reduce by 1 per correct answer. Returns true if the boss
    // is still alive (HP > 0), false if HP just reached 0.
    takeDamage(amount) {
      if (!this.boss || this.captured) return false;
      this.hp = Math.max(0, this.hp - (amount || 1));
      this.hpFlash = 200; // 200ms white flash
      return this.hp > 0;
    }

    get isDead() {
      return this.boss && this.hp <= 0;
    }

    // ---- combat helpers (driven by game.js) ----
    // Attack cadence is intentionally brisk (melee every 0.5s, ranged every
    // 0.8s) to keep kids dodging; the 1.5s player invulnerability window is
    // what actually caps damage taken. Bosses get their own shorter cadence
    // via the optional ms argument.
    isAggressive() { return this.ai === AI.AGGRESSIVE; }
    canMeleeAttack() { return this.attackCooldown <= 0; }
    resetMeleeCooldown(ms) { this.attackCooldown = ms || 500; }
    canShoot() { return this.isAggressive() && this.stunned <= 0 && this.shootTimer <= 0; }
    resetShootTimer() { this.shootTimer = 800; }

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
          if (window.Sprites && Sprites.isReady()) {
            Sprites.draw(ctx, 'sparkle', this.x - 12, this.y - 8, { size: 24 });
            Sprites.draw(ctx, 'star', this.x + 12, this.y + 8, { size: 24 });
          } else {
            ctx.font = '24px serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('✨', this.x - 12, this.y - 8);
            ctx.fillText('💫', this.x + 12, this.y + 8);
          }
        }
      } else {
        // (No ghostly float — the vector body below sits grounded on its
        // shadow, which is what makes it read as a solid creature.)
      }

      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + this.size/2 - 2, this.size/2.4, 5 * this.scale, 0, 0, Math.PI * 2);
      ctx.fill();

      // Boss aura: pulsing ring so boss monsters read instantly.
      if (this.boss) {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 260);
        let auraColor;
        if (this.hp <= 0) {
          // Vulnerable state: golden aura — boss is ready for the finishing blow.
          auraColor = 'rgba(255, 215, 0, ' + (0.4 + 0.35 * pulse).toFixed(2) + ')';
        } else {
          auraColor = 'rgba(255, 71, 87, ' + (0.35 + 0.3 * pulse).toFixed(2) + ')';
        }
        ctx.strokeStyle = auraColor;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y - 2, this.size * 0.72, this.size * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Solid vector body (outlined creature, no emoji)
      this._drawBody(ctx);

      // Damage flash: white overlay on the body
      if (this.hpFlash > 0) {
        const flashAlpha = Math.min(0.5, this.hpFlash / 200 * 0.5);
        ctx.fillStyle = 'rgba(255,255,255,' + flashAlpha.toFixed(2) + ')';
        ctx.beginPath();
        ctx.ellipse(this.x, this.y - 2 * (SIZE / 44) * this.scale, 20 * (SIZE / 44) * this.scale, 17 * (SIZE / 44) * this.scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // Word label below — hidden while the player is answering a question
      // so the English word isn't visible through the modal backdrop (which
      // would leak the answer for cn2en / listen / picture / fillblank /
      // spell question types).
      if (!this.isEngaged) {
        const labelY = this.y + this.size/2 + 12;
        // Pill background
        ctx.font = 'bold 14px "Nunito", system-ui, sans-serif';
        // Defensive guard: never let a missing/malformed word crash the
        // render loop (word may be undefined if a caller spawned monsters
        // with an invalid word pool).
        const text = (this.word && typeof this.word.english === 'string')
          ? this.word.english
          : '?';
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
      }

      // Speech bubble (small) when aggressive/close to player. Uses the
      // emoji chosen at construction (stable across frames).
      if (this.ai === AI.AGGRESSIVE) {
        ctx.font = '14px serif';
        ctx.fillText(this.speechEmoji, this.x + 14, this.y - 22);
      }

      // Locked by another hunter's question (versus mode): stand-by mark
      // so everyone can see it's taken.
      if (this.netLocked != null) {
        if (window.Sprites && Sprites.isReady()) {
          Sprites.draw(ctx, 'lock', this.x - 14, this.y - 22, { size: 18 });
        } else {
          ctx.font = '16px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('🔒', this.x - 14, this.y - 22);
        }
      }

      // Boss HP bar — rendered below the crown so HP is visible at a glance.
      if (this.boss && !this.captured && this.maxHp > 0) {
        const barW = this.size * 1.2;
        const barH = 6 * this.scale;
        const barY = this.y - this.size * 0.62 - 26;
        const barX = this.x - barW / 2;
        const ratio = this.hp / this.maxHp;
        // Background track
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.roundRect(barX - 1, barY - 1, barW + 2, barH + 2, 3);
        ctx.fill();
        // HP fill — color shifts from green → yellow → red as HP drops
        let hpColor;
        if (ratio > 0.5) {
          hpColor = `rgb(${Math.round(255*(1-ratio)*2)}, 220, 60)`;
        } else {
          hpColor = `rgb(255, ${Math.round(220*ratio*2)}, 60)`;
        }
        ctx.fillStyle = hpColor;
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW * ratio, barH, 2);
        ctx.fill();
        // HP text
        ctx.font = `bold ${Math.round(10 * this.scale)}px "Nunito", system-ui, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.hp + '/' + this.maxHp, this.x, barY + barH / 2);
      }

// Crown above boss monsters (after body so it sits on top).
      if (this.boss) {
        if (window.Sprites && Sprites.isReady()) {
          Sprites.draw(ctx, 'crown', this.x, this.y - this.size * 0.62 - 4, { size: Math.round(18 * this.scale) });
        } else {
          ctx.font = Math.round(16 * this.scale) + 'px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText('👑', this.x, this.y - this.size * 0.62 - 4);
        }
        // Skull when HP is depleted — "finish him!"
        if (this.hp <= 0) {
          if (window.Sprites && Sprites.isReady()) {
            Sprites.draw(ctx, 'skull', this.x, this.y - this.size * 0.62 - 22, { size: Math.round(16 * this.scale) });
          } else {
            ctx.font = Math.round(14 * this.scale) + 'px serif';
            ctx.fillText('💀', this.x, this.y - this.size * 0.62 - 22);
          }
        }
      }

      // Stun indicator
      if (this.stunned > 0) {
        if (window.Sprites && Sprites.isReady()) {
          Sprites.draw(ctx, 'dizzy', this.x, this.y - 24, { size: 20 });
        } else {
          ctx.font = '18px serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('💫', this.x, this.y - 24);
        }
      }

      ctx.restore();
    }

    // Vector monster: outlined slime body with angry face, feet, and a horn.
    // Drawn centered on (this.x, this.y). This replaces the floating emoji
    // so the monster reads as a solid, grounded creature.
    _drawBody(ctx) {
      const x = this.x, y = this.y;
      const s = (SIZE / 44) * this.scale;   // design at 44 units, scaled
      const OUT = '#2b1a12'; // unified outline (matches the player)
      const c = this.bodyColor || BODY_COLORS[0];
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Body blob with a radial gradient for volume
      const body = ctx.createRadialGradient(x - 6 * s, y - 10 * s, 3 * s, x, y - 2 * s, 24 * s);
      body.addColorStop(0, c.light);
      body.addColorStop(1, c.dark);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(x, y - 2 * s, 20 * s, 17 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.5 * s;
      ctx.strokeStyle = OUT;
      ctx.stroke();

      // Feet (ground contact)
      ctx.fillStyle = c.dark;
      ctx.beginPath(); ctx.ellipse(x - 9 * s, y + 15 * s, 6 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x + 9 * s, y + 15 * s, 6 * s, 4 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      // Horn / spike
      ctx.fillStyle = '#f7d774';
      ctx.beginPath();
      ctx.moveTo(x - 3 * s, y - 17 * s);
      ctx.lineTo(x + 4 * s, y - 17 * s);
      ctx.lineTo(x + 0 * s, y - 27 * s);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.5 * s;
      ctx.stroke();

      // Eyes (white sclera)
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.ellipse(x - 7 * s, y - 6 * s, 5 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 7 * s, y - 6 * s, 5 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.5 * s;
      ctx.strokeStyle = OUT;
      ctx.stroke();

      // Pupils track the facing direction
      const look = Math.sign(this.dir.x) || 0;
      ctx.fillStyle = '#1e1e2e';
      ctx.beginPath(); ctx.arc(x - 7 * s + look * 1.5 * s, y - 5 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x + 7 * s + look * 1.5 * s, y - 5 * s, 2.4 * s, 0, Math.PI * 2); ctx.fill();

      // Angry eyebrows
      ctx.lineWidth = 2.2 * s;
      ctx.strokeStyle = OUT;
      ctx.beginPath();
      ctx.moveTo(x - 12 * s, y - 13 * s); ctx.lineTo(x - 3 * s, y - 10 * s);
      ctx.moveTo(x + 12 * s, y - 13 * s); ctx.lineTo(x + 3 * s, y - 10 * s);
      ctx.stroke();

      // Angry zigzag mouth
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.moveTo(x - 8 * s, y + 6 * s);
      ctx.lineTo(x - 4 * s, y + 4 * s);
      ctx.lineTo(x, y + 6 * s);
      ctx.lineTo(x + 4 * s, y + 4 * s);
      ctx.lineTo(x + 8 * s, y + 6 * s);
      ctx.stroke();
    }
  }

  // Spawn N monsters for a level, distributed across the world
  function spawnMonsters(words, count, speed, worldW, worldH, scale) {
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

    // Guard against an empty/invalid word pool. Utils.randItem([]) returns
    // undefined, and a monster with word === undefined throws in render()
    // (word.english) on the very first frame, killing the whole rAF loop.
    if (!Array.isArray(words) || words.length === 0) {
      console.warn('spawnMonsters: empty word pool, spawning no monsters');
      return monsters;
    }
    const validWords = words.filter(w => w && typeof w === 'object' && w.english);
    if (validWords.length === 0) {
      console.warn('spawnMonsters: no valid words (missing english field), spawning no monsters');
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

      const word = Utils.randItem(validWords);
      const ai = Utils.randItem(aiTypes);
      monsters.push(new Monster(x, y, word, ai, speed, scale));
    }

    return monsters;
  }

  window.Monster = Monster;
  window.spawnMonsters = spawnMonsters;
})();
