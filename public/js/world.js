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
      this.leafPositions = [];
      this.bubblePositions = [];
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
      // Background: the animated GIF / PNG is a CSS layer behind the
      // transparent canvas. A single very light veil keeps game objects
      // readable against a bright background without covering it up.
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      ctx.fillRect(0, 0, this.width, this.height);

      // HUD area gradient overlay (top)
      const overlay = ctx.createLinearGradient(0, 0, 0, 100);
      overlay.addColorStop(0, 'rgba(0,0,0,0.3)');
      overlay.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, this.width, 100);
    }
  }

  window.World = World;
})();
