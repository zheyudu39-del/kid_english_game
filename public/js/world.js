// world.js - World rendering (background tiles, ground, decorations)
(function () {
  'use strict';

  class World {
    constructor(worldDef, levelCfg, viewW, viewH) {
      this.def = worldDef;
      this.levelCfg = levelCfg;
      // World must always be at least the size of the viewport so the
      // canvas never shows a "letterbox" / black bar on the right or
      // bottom of the screen. We also add horizontal scroll room so the
      // camera can follow the player and the world feels explorable.
      const vw = viewW || window.innerWidth || 1280;
      const vh = viewH || window.innerHeight || 720;
      this.width  = Math.max(1200, vw, vw + 240);
      this.height = Math.max(600,  vh, vh + 120);
      // Ground sits ~75% down the world (was hard-coded 450)
      this.groundY = Math.round(this.height * 0.72);
      this.starCache = null;
      this.leafPositions = [];
      this.bubblePositions = [];
      this.rockPositions = [];
      this.treePositions = [];
      this._initDecorations();
    }

    _initDecorations() {
      for (let i = 0; i < 30; i++) {
        this.leafPositions.push({
          x: Utils.randInt(0, this.width),
          y: Utils.randInt(0, this.height),
          size: Utils.randInt(8, 16),
          color: `hsl(${Utils.randInt(80, 140)}, 60%, 40%)`,
          speed: Utils.randFloat(0.3, 1.2)
        });
      }
      for (let i = 0; i < 24; i++) {
        // Pre-assign a stable color so theme-specific rendering (e.g.
        // embers) doesn't have to call Utils.randInt every frame and
        // produce per-frame flicker.
        const color = `hsl(${Utils.randInt(10, 40)}, 100%, 50%)`;
        this.bubblePositions.push({
          x: Utils.randInt(0, this.width),
          y: Utils.randInt(0, this.height),
          size: Utils.randInt(6, 20),
          speed: Utils.randFloat(0.4, 1.5),
          color
        });
      }
      for (let i = 0; i < 12; i++) {
        this.rockPositions.push({
          x: Utils.randInt(0, this.width),
          y: Utils.randInt(this.groundY + 20, this.height - 30),
          size: Utils.randInt(15, 40),
          type: Utils.randInt(0, 2)
        });
      }
      // Trees / decorations: distribute across the full world width
      const treeCount = Math.max(8, Math.floor(this.width / 150));
      for (let i = 0; i < treeCount; i++) {
        this.treePositions.push({
          x: 80 + i * (this.width - 160) / Math.max(1, treeCount - 1) + Utils.randInt(-30, 30),
          y: this.groundY - 10 + Utils.randInt(-10, 10)
        });
      }
    }

    // Allow live resize: keep the world covering the new viewport
    resize(viewW, viewH) {
      // Guard against undefined / NaN / non-numeric inputs (e.g. when called
      // before the viewport is sized, or with a 0 from a hidden tab).
      // Falling back to the previous size keeps the world consistent.
      const safeW = (typeof viewW === 'number' && isFinite(viewW) && viewW > 0)
        ? viewW
        : (this.width || window.innerWidth || 1280);
      const safeH = (typeof viewH === 'number' && isFinite(viewH) && viewH > 0)
        ? viewH
        : (this.height || window.innerHeight || 720);
      const newW = Math.max(1200, safeW, safeW + 240);
      const newH = Math.max(600,  safeH, safeH + 120);
      this.width  = newW;
      this.height = newH;
      this.groundY = Math.round(newH * 0.72);
      // Re-scatter decorations that fell outside the new bounds
      this.leafPositions.forEach(p => {
        if (p.x > this.width)  p.x = Utils.randInt(0, this.width);
        if (p.y > this.height) p.y = Utils.randInt(0, this.height);
      });
      this.bubblePositions.forEach(p => {
        if (p.x > this.width)  p.x = Utils.randInt(0, this.width);
        if (p.y > this.height) p.y = Utils.randInt(0, this.height);
      });
      this.rockPositions.forEach(r => {
        if (r.x > this.width)  r.x = Utils.randInt(0, this.width);
        // Re-scatter rocks that ended up above the new ground line (world
        // grew taller) OR below the new bottom edge (world shrank).
        if (r.y < this.groundY || r.y > this.height - 30) {
          r.y = Utils.randInt(this.groundY + 20, this.height - 30);
        }
      });
      // Re-clamp trees so they remain on/above the ground.
      this.treePositions.forEach(t => {
        if (t.x > this.width - 30) t.x = Utils.randInt(40, Math.max(41, this.width - 30));
        // Keep y within a small band around the ground line.
        t.y = this.groundY - 10 + Utils.randInt(-10, 10);
      });
    }

    update(dtMs) {
      // Animate particles. Keep dtMs bounded so a long pause / tab switch
      // doesn't make particles teleport a huge distance in one frame.
      const dt = Math.max(0, Math.min(50, dtMs || 0));
      // Animate particles
      for (const p of this.leafPositions) {
        p.y += p.speed * (dt / 16);
        p.x += Math.sin(p.y * 0.02) * 0.5;
        if (p.y > this.height) {
          p.y = -10;
          p.x = Utils.randInt(0, this.width);
        }
      }
      for (const b of this.bubblePositions) {
        b.y -= b.speed * (dt / 16);
        b.x += Math.sin(b.y * 0.015) * 0.4;
        if (b.y < -20) {
          b.y = this.height + 10;
          b.x = Utils.randInt(0, this.width);
        }
      }
    }

    render(ctx) {
      // Sky/background gradient
      const grad = ctx.createLinearGradient(0, 0, 0, this.height);
      grad.addColorStop(0, this.def.bgColor);
      grad.addColorStop(1, this.shadeColor(this.def.bgColor, -30));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.width, this.height);

      // Particles (theme-specific)
      if (this.def.particles === 'leaves') {
        for (const p of this.leafPositions) {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, p.size/2, p.size/3, Math.PI/4, 0, Math.PI*2);
          ctx.fill();
        }
      } else if (this.def.particles === 'snow' || this.def.particles === 'stars') {
        ctx.fillStyle = '#fff';
        for (const p of this.bubblePositions) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size/4, 0, Math.PI*2);
          ctx.fill();
        }
      } else if (this.def.particles === 'bubbles') {
        for (const p of this.bubblePositions) {
          ctx.strokeStyle = 'rgba(255,255,255,0.6)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size/2, 0, Math.PI*2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.fill();
        }
      } else if (this.def.particles === 'embers') {
        // Embers: each particle owns a stable color (set in _initDecorations)
        // so they don't flicker every frame.
        for (const p of this.bubblePositions) {
          ctx.fillStyle = p.color || `hsl(${Utils.randInt(10, 40)}, 100%, 50%)`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size/4, 0, Math.PI*2);
          ctx.fill();
        }
      } else if (this.def.particles === 'sand') {
        for (const p of this.bubblePositions) {
          ctx.fillStyle = 'rgba(255, 220, 150, 0.3)';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size/3, 0, Math.PI*2);
          ctx.fill();
        }
      }

      // Ground
      ctx.fillStyle = this.def.groundColor;
      ctx.fillRect(0, this.groundY, this.width, this.height - this.groundY);

      // Ground texture lines
      ctx.strokeStyle = this.shadeColor(this.def.groundColor, -20);
      ctx.lineWidth = 2;
      for (let x = 0; x < this.width; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x, this.groundY);
        ctx.lineTo(x + 15, this.groundY + 10);
        ctx.stroke();
      }

      // Decorations based on world type
      if (this.def.groundType === 'grass') {
        // Trees distributed across the world
        for (const t of this.treePositions) {
          this.drawTree(ctx, t.x, t.y);
        }
      } else if (this.def.groundType === 'sand' && this.def.id === 4) {
        // Cacti distributed across the world
        for (const t of this.treePositions) {
          this.drawCactus(ctx, t.x, t.y);
        }
      } else if (this.def.groundType === 'snow') {
        for (const t of this.treePositions) {
          this.drawPine(ctx, t.x, t.y, true);
        }
      } else if (this.def.groundType === 'rock') {
        // Lava rocks
        for (const r of this.rockPositions) {
          this.drawRock(ctx, r.x, r.y, r.size, r.type);
        }
      } else if (this.def.groundType === 'cloud') {
        // Floating clouds spread across the full world width. The old fixed
        // loop only covered the left ~1150px, leaving wide worlds (e.g. a
        // 3000px viewport → 3240px world) bare on the right.
        const cloudCount = Math.max(6, Math.ceil(this.width / 220));
        for (let i = 0; i < cloudCount; i++) {
          const x = 150 + i * (this.width - 300) / Math.max(1, cloudCount - 1);
          this.drawCloud(ctx, x, 150 + (i % 2) * 60);
        }
      }

      // HUD area gradient overlay (top)
      const overlay = ctx.createLinearGradient(0, 0, 0, 100);
      overlay.addColorStop(0, 'rgba(0,0,0,0.3)');
      overlay.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, this.width, 100);
    }

    drawTree(ctx, x, y) {
      // Trunk
      ctx.fillStyle = '#5d3a1a';
      ctx.fillRect(x - 8, y, 16, 70);
      // Leaves
      ctx.fillStyle = '#1e7e34';
      ctx.beginPath();
      ctx.arc(x, y, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2ed573';
      ctx.beginPath();
      ctx.arc(x - 10, y - 10, 25, 0, Math.PI * 2);
      ctx.fill();
    }

    drawCactus(ctx, x, y) {
      ctx.fillStyle = '#2d5e3a';
      ctx.fillRect(x - 8, y, 16, 60);
      ctx.fillRect(x - 18, y + 10, 10, 30);
      ctx.fillRect(x + 8, y + 15, 10, 25);
    }

    drawPine(ctx, x, y, snowy) {
      ctx.fillStyle = snowy ? '#5a3a1a' : '#3a2a1a';
      ctx.fillRect(x - 6, y, 12, 70);
      ctx.fillStyle = snowy ? '#1a4a2a' : '#1e5e3a';
      ctx.beginPath();
      ctx.moveTo(x, y - 50);
      ctx.lineTo(x - 30, y + 20);
      ctx.lineTo(x + 30, y + 20);
      ctx.closePath();
      ctx.fill();
      if (snowy) {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(x, y - 50);
        ctx.lineTo(x - 25, y + 15);
        ctx.lineTo(x + 25, y + 15);
        ctx.closePath();
        ctx.fill();
      }
    }

    drawRock(ctx, x, y, size, type) {
      ctx.fillStyle = type === 0 ? '#3a2a2a' : '#2a1a1a';
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x - size/2, y - size/2);
      ctx.lineTo(x + size/2, y - size/3);
      ctx.lineTo(x + size, y);
      ctx.closePath();
      ctx.fill();
      // Lava glow
      ctx.fillStyle = `rgba(255, 100, 30, ${0.4 + Math.random() * 0.2})`;
      ctx.beginPath();
      ctx.arc(x, y - size/4, size/4, 0, Math.PI * 2);
      ctx.fill();
    }

    drawCloud(ctx, x, y) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.arc(x + 25, y, 25, 0, Math.PI * 2);
      ctx.arc(x - 25, y, 20, 0, Math.PI * 2);
      ctx.fill();
    }

    shadeColor(hex, percent) {
      // hex like '#1a3a2e' → darker by percent.
      // Guard: not all bgColor values are guaranteed to be #rrggbb strings
      // (e.g. 'hsl(...)' or undefined). If we can't parse it, return the
      // input unchanged so rendering still works (it just won't be shaded).
      if (typeof hex !== 'string' || hex.charAt(0) !== '#' || hex.length < 7) {
        return hex;
      }
      const num = parseInt(hex.slice(1, 7), 16);
      if (!isFinite(num)) return hex;
      let r = (num >> 16) + percent;
      let g = ((num >> 8) & 0xff) + percent;
      let b = (num & 0xff) + percent;
      r = Math.max(0, Math.min(255, r));
      g = Math.max(0, Math.min(255, g));
      b = Math.max(0, Math.min(255, b));
      return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
    }
  }

  window.World = World;
})();
