// sprites.js - Pixel-art sprite sheet loader (replaces canvas emoji)
// Sprite sheet: public/img/sprites/sprite_sheet.png (single row, 32x32 each)
// Map:        public/img/sprites/sprite_map.json

(function () {
  'use strict';

  const SPRITE_URL = 'img/sprites/sprite_sheet.png';
  const MAP_URL = 'img/sprites/sprite_map.json';

  let _image = null;
  let _map = null;
  let _size = 32;
  let _ready = false;
  let _loading = null;

  async function load() {
    if (_ready) return { image: _image, map: _map, size: _size };
    if (_loading) return _loading;
    _loading = (async () => {
      // Load the sprite map
      const resp = await fetch(MAP_URL);
      if (!resp.ok) throw new Error('Failed to load sprite map: ' + resp.status);
      const data = await resp.json();
      _map = data.map;
      _size = data.size || 32;

      // Load the sprite sheet image
      _image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load sprite sheet'));
        img.src = SPRITE_URL;
      });
      _ready = true;
      console.log('Sprites loaded: ' + Object.keys(_map).length + ' icons, ' + _size + 'x' + _size + ' each');
      return { image: _image, map: _map, size: _size };
    })();
    return _loading;
  }

  // Draw a sprite by name at (x, y) with optional size and alpha
  function draw(ctx, name, x, y, opts = {}) {
    if (!_image || !_map || !_map[name]) return false;
    const size = opts.size || _size;
    const alpha = opts.alpha != null ? opts.alpha : 1;
    const sx = _map[name];
    const sy = 0;
    const sw = _size;
    const sh = _size;
    const dx = x - size / 2;
    const dy = y - size / 2;
    const dw = size;
    const dh = size;

    if (alpha < 1) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(_image, sx, sy, sw, sh, dx, dy, dw, dh);
      ctx.globalAlpha = 1;
    } else {
      ctx.drawImage(_image, sx, sy, sw, sh, dx, dy, dw, dh);
    }
    return true;
  }

  // Check if a sprite name exists
  function has(name) {
    return _map && !!_map[name];
  }

  // Whether the sprite sheet is fully loaded and ready to draw
  function isReady() {
    return _ready && _image && _map;
  }

  window.Sprites = { load, draw, has, isReady };
})();