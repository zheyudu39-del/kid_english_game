// tools/build-backgrounds.js — composite OpenGameArt layers into game backgrounds
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const TMP = process.env.TEMP || '/tmp';
const OUT = path.join(__dirname, '..', 'public', 'img');
const SCALE = 3; // scale up pixel art 3x for crisp display

const themes = [
  {
    name: 'bg_forest',
    base: path.join(TMP, 'bg_forest', 'parallax_forest_pack', 'layers'),
    layers: [
      'parallax-forest-back-trees.png',
      'parallax-forest-middle-trees.png',
      'parallax-forest-front-trees.png',
      'parallax-forest-lights.png'
    ],
    bg: '#1a0e2e' // dark purple night sky
  },
  {
    name: 'bg_dusk',
    base: path.join(TMP, 'bg_dusk', 'parallax_mountain_pack', 'layers'),
    layers: [
      'parallax-mountain-bg.png',
      'parallax-mountain-montain-far.png',
      'parallax-mountain-mountains.png',
      'parallax-mountain-trees.png',
      'parallax-mountain-foreground-trees.png'
    ],
    bg: '#ff8c42' // sunset orange
  },
  {
    name: 'bg_space',
    base: path.join(TMP, 'bg_space', 'space_background_pack', 'layers'),
    layers: [
      'parallax-space-backgound.png',
      'parallax-space-stars.png',
      'parallax-space-far-planets.png',
      'parallax-space-big-planet.png',
      'parallax-space-ring-planet.png'
    ],
    bg: '#0a0a1a' // deep space
  },
  {
    name: 'bg_ocean',
    base: path.join(TMP, 'bg_underwater', 'underwater-diving-files', 'PNG', 'environment'),
    layers: ['background.png', 'midground.png'],
    bg: '#001a33' // deep ocean
  },
  {
    name: 'bg_snow',
    base: path.join(TMP, 'bg_snow'),
    layers: ['background 3.png'],
    bg: '#c8e8ff' // winter sky
  }
];

async function compositeAll() {
  for (const theme of themes) {
    const layers = [];
    for (const l of theme.layers) {
      const p = path.join(theme.base, l);
      if (fs.existsSync(p)) {
        layers.push(p);
      } else {
        console.log(`  SKIP missing: ${l}`);
      }
    }
    if (layers.length === 0) {
      console.log(`FAIL ${theme.name}: no layers found`);
      continue;
    }

    // Read all layers to find max dimensions
    let maxW = 0, maxH = 0;
    const metaList = [];
    for (const l of layers) {
      const meta = await sharp(l).metadata();
      metaList.push({ path: l, w: meta.width, h: meta.height });
      if (meta.width > maxW) maxW = meta.width;
      if (meta.height > maxH) maxH = meta.height;
    }
    const w = maxW;
    const h = maxH;

    // Create background canvas at max dimensions
    let canvas = await sharp({
      create: { width: w, height: h, channels: 4, background: theme.bg }
    }).png().toBuffer();

    // Composite each layer (centered if smaller than canvas)
    for (const m of metaList) {
      const left = Math.floor((w - m.w) / 2);
      const top = Math.floor((h - m.h) / 2);
      canvas = await sharp(canvas)
        .composite([{ input: m.path, blend: 'over', left, top }])
        .png()
        .toBuffer();
    }

    // Scale up for crisp pixel art
    const final = await sharp(canvas)
      .resize(w * SCALE, h * SCALE, { kernel: 'nearest' })
      .png()
      .toBuffer();

    const outPath = path.join(OUT, `${theme.name}.png`);
    fs.writeFileSync(outPath, final);
    console.log(`OK ${theme.name}.png (${w}x${h} → ${w*SCALE}x${h*SCALE})`);
  }
  console.log('\nDone!');
}

compositeAll().catch(e => { console.error(e); process.exit(1); });