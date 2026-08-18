// build-sprites.js - Generate a pixel-art sprite sheet to replace emoji
// Uses CC0 icons from the 496 RPG Icons pack (OpenGameArt) + programmatic
// pixel art for the few icons the pack doesn't cover.
//
// Output: public/img/sprites/sprite_sheet.png (single row, 32x32 each)
//         public/img/sprites/sprite_map.json (name → x offset)

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const RPG_DIR = path.join(process.env.TEMP || '/tmp', 'rpg_icons');
const OUT_DIR = path.join(__dirname, '..', 'public', 'img', 'sprites');
const SPRITE_SIZE = 32;

// ---- Which icons from the 496 RPG pack to use ----
const SOURCES = {
  thunder:   path.join(RPG_DIR, 'S_Thunder01.png'),  // ⚡ lightning bolt
  fire:      path.join(RPG_DIR, 'S_Fire01.png'),      // 💥 explosion/burst
  sparkle:   path.join(RPG_DIR, 'I_Diamond.png'),     // ✨ sparkle/star
  shield:    path.join(RPG_DIR, 'S_Buff01.png'),      // 🛡️ shield/buff
  dizzy:     path.join(RPG_DIR, 'S_Holy01.png'),      // 💫 dizzy/stun
};

// ---- Programmatic pixel art for missing icons ----
// Each is a 32x32 RGBA buffer. We draw simple shapes.
function makeSkull() {
  // Simple pixel skull: white skull on transparent
  const buf = Buffer.alloc(32 * 32 * 4, 0); // RGBA, all transparent
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= 32 || y < 0 || y >= 32) return;
    const i = (y * 32 + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  // Skull shape (approximate with pixels)
  // Top dome
  for (let y = 2; y <= 10; y++) {
    const w = 6 + Math.floor((y - 2) * 0.9);
    for (let x = 16 - w; x <= 16 + w; x++) set(x, y, 240, 240, 240);
  }
  // Cheekbones
  for (let y = 10; y <= 14; y++) {
    const w = 10;
    for (let x = 16 - w; x <= 16 + w; x++) set(x, y, 220, 220, 220);
  }
  // Jaw narrowing
  for (let y = 15; y <= 18; y++) {
    const w = 10 - (y - 15) * 2;
    for (let x = 16 - w; x <= 16 + w; x++) set(x, y, 200, 200, 200);
  }
  // Teeth
  for (let y = 19; y <= 20; y++) {
    for (let x = 10; x <= 22; x++) set(x, y, 180, 180, 180);
  }
  // Eyes (dark sockets)
  for (let y = 6; y <= 9; y++) {
    for (let x = 11; x <= 13; x++) set(x, y, 20, 20, 30);
    for (let x = 19; x <= 21; x++) set(x, y, 20, 20, 30);
  }
  // Nose hole
  for (let y = 12; y <= 13; y++) {
    for (let x = 15; x <= 17; x++) set(x, y, 20, 20, 30);
  }
  return sharp(buf, { raw: { width: 32, height: 32, channels: 4 } }).png();
}

function makeCrown() {
  const buf = Buffer.alloc(32 * 32 * 4, 0);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= 32 || y < 0 || y >= 32) return;
    const i = (y * 32 + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  // Base band
  for (let y = 16; y <= 22; y++) {
    for (let x = 4; x <= 28; x++) set(x, y, 255, 200, 40);
  }
  // Band outline
  for (let x = 4; x <= 28; x++) { set(x, 16, 200, 150, 20); set(x, 22, 200, 150, 20); }
  for (let y = 16; y <= 22; y++) { set(4, y, 200, 150, 20); set(28, y, 200, 150, 20); }
  // Points (3 spikes)
  for (let y = 3; y <= 15; y++) {
    const w = Math.max(1, Math.floor((16 - y) * 0.5));
    // Left spike
    for (let x = 8 - w; x <= 8 + w; x++) set(x, y, 255, 200, 40);
    // Center spike
    for (let x = 16 - w; x <= 16 + w; x++) set(x, y, 255, 220, 60);
    // Right spike
    for (let x = 24 - w; x <= 24 + w; x++) set(x, y, 255, 200, 40);
  }
  // Gems on spikes
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      set(8 + dx, 5 + dy, 255, 50, 50, 220);
      set(16 + dx, 4 + dy, 255, 50, 50, 220);
      set(24 + dx, 5 + dy, 255, 50, 50, 220);
    }
  }
  return sharp(buf, { raw: { width: 32, height: 32, channels: 4 } }).png();
}

function makeLock() {
  const buf = Buffer.alloc(32 * 32 * 4, 0);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= 32 || y < 0 || y >= 32) return;
    const i = (y * 32 + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  // Shackle (U-shape top)
  for (let y = 4; y <= 8; y++) {
    for (let x = 10; x <= 22; x++) set(x, y, 180, 180, 180);
  }
  // Clear middle of shackle
  for (let y = 6; y <= 8; y++) {
    for (let x = 13; x <= 19; x++) set(x, y, 0, 0, 0, 0);
  }
  // Shackle outline
  for (let x = 10; x <= 22; x++) { set(x, 4, 140, 140, 140); set(x, 8, 140, 140, 140); }
  for (let y = 4; y <= 8; y++) { set(10, y, 140, 140, 140); set(22, y, 140, 140, 140); }
  // Body
  for (let y = 9; y <= 22; y++) {
    for (let x = 8; x <= 24; x++) set(x, y, 200, 180, 40);
  }
  // Body outline
  for (let x = 8; x <= 24; x++) { set(x, 9, 160, 140, 20); set(x, 22, 160, 140, 20); }
  for (let y = 9; y <= 22; y++) { set(8, y, 160, 140, 20); set(24, y, 160, 140, 20); }
  // Keyhole
  for (let y = 12; y <= 16; y++) {
    for (let x = 14; x <= 18; x++) set(x, y, 80, 60, 10);
  }
  // Keyhole circle
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      set(16 + dx, 12 + dy, 80, 60, 10);
    }
  }
  return sharp(buf, { raw: { width: 32, height: 32, channels: 4 } }).png();
}

function makeStar() {
  const buf = Buffer.alloc(32 * 32 * 4, 0);
  const set = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= 32 || y < 0 || y >= 32) return;
    const i = (y * 32 + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };
  // 5-pointed star centered at (16, 16)
  const cx = 16, cy = 16, outerR = 14, innerR = 6;
  const points = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 2 * 3) + (i * Math.PI / 5); // start from top
    const r = i % 2 === 0 ? outerR : innerR;
    points.push({ x: Math.round(cx + r * Math.cos(angle)), y: Math.round(cy - r * Math.sin(angle)) });
  }
  // Fill star (simple scanline)
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      // Check if point is inside the star polygon (ray casting)
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) set(x, y, 255, 220, 50);
    }
  }
  // Outline
  for (let i = 0; i < points.length; i++) {
    const p0 = points[i], p1 = points[(i + 1) % points.length];
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const steps = Math.max(Math.abs(dx), Math.abs(dy));
    for (let s = 0; s <= steps; s++) {
      const x = Math.round(p0.x + dx * s / steps);
      const y = Math.round(p0.y + dy * s / steps);
      set(x, y, 200, 160, 20);
    }
  }
  return sharp(buf, { raw: { width: 32, height: 32, channels: 4 } }).png();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Load source icons from the RPG pack, resize to 32x32
  const icons = {};
  for (const [name, srcPath] of Object.entries(SOURCES)) {
    if (fs.existsSync(srcPath)) {
      icons[name] = await sharp(srcPath)
        .resize(SPRITE_SIZE, SPRITE_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      console.log(`  [OK] ${name} ← ${path.basename(srcPath)}`);
    } else {
      console.warn(`  [MISSING] ${name} ← ${srcPath} — generating fallback`);
    }
  }

  // Generate programmatic icons
  icons.skull = await makeSkull().toBuffer();
  console.log('  [OK] skull (programmatic)');
  icons.crown = await makeCrown().toBuffer();
  console.log('  [OK] crown (programmatic)');
  icons.lock = await makeLock().toBuffer();
  console.log('  [OK] lock (programmatic)');
  icons.star = await makeStar().toBuffer();
  console.log('  [OK] star (programmatic)');

  // Build sprite sheet: single row, each icon 32x32
  const NAMES = ['thunder', 'fire', 'sparkle', 'star', 'shield', 'dizzy', 'crown', 'skull', 'lock'];
  const totalW = NAMES.length * SPRITE_SIZE;
  const totalH = SPRITE_SIZE;

  const composites = [];
  const map = {};
  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[i];
    if (icons[name]) {
      composites.push({ input: icons[name], left: i * SPRITE_SIZE, top: 0 });
      map[name] = i * SPRITE_SIZE;
    }
  }

  const sheet = await sharp({
    create: {
      width: totalW,
      height: totalH,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite(composites)
    .png()
    .toFile(path.join(OUT_DIR, 'sprite_sheet.png'));

  // Write the sprite map
  fs.writeFileSync(
    path.join(OUT_DIR, 'sprite_map.json'),
    JSON.stringify({ size: SPRITE_SIZE, map }, null, 2)
  );

  console.log(`\nDone! Sprite sheet: ${totalW}x${totalH} (${NAMES.length} icons)`);
  console.log(`Output: ${path.join(OUT_DIR, 'sprite_sheet.png')}`);
}

main().catch(err => { console.error(err); process.exit(1); });