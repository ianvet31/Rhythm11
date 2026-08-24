/**
 * preview3d — render the 3D models on their own, fast, to PNG.
 *
 * Deliberately separate from tools/shoot.mjs: that one drives the whole game to
 * a musical beat, which is slow and couples art iteration to gameplay state.
 * This just puts a model in front of a camera so the modelling loop is
 * edit → render → look, in about a second.
 *
 * Usage:
 *   node tools/preview3d.mjs elephant
 *   node tools/preview3d.mjs elephant --turn        # 6 angles, contact sheet
 *   node tools/preview3d.mjs elephant --walk        # 8 frames of the gait
 *   node tools/preview3d.mjs scene                  # the whole grove
 *   node tools/preview3d.mjs elephant --scale 3     # bigger PNG
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, Image } from '/tmp/node_modules/@napi-rs/canvas/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const { Framebuffer, Renderer, mat4, m4mul, m4rotY, m4translate, m4scale } =
  await import('../src/gfx/raster.js');
const { PAL32, MATERIALS, SKY_BANDS } = await import('../src/gfx/palette32.js');
const { buildElephant } = await import('../src/gfx/elephant3d.js');

const W = 320;
const H = 180;

const argv = process.argv.slice(2);
const what = argv[0] || 'elephant';
const has = (f) => argv.includes(`--${f}`);
const flag = (f, d) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 ? argv[i + 1] : d;
};
const scale = Number(flag("scale", 3));
const outDir = join(ROOT, 'shots');
mkdirSync(outDir, { recursive: true });

function newFrame() {
  const fb = new Framebuffer(W, H, PAL32);
  fb.clear(0);
  // Sky bands, so models aren't judged against a void.
  const bandH = H / SKY_BANDS.length;
  for (let i = 0; i < SKY_BANDS.length; i++) {
    fb.fillRect(0, i * bandH, W, (i + 1) * bandH, SKY_BANDS[i]);
  }
  return fb;
}

function save(fb, name) {
  const c = createCanvas(W * scale, H * scale);
  const cx = c.getContext('2d');
  const img = cx.createImageData(W * scale, H * scale);
  fb.toRGBA(img.data, scale);
  cx.putImageData(img, 0, 0);
  const f = join(outDir, `${name}.png`);
  writeFileSync(f, c.toBuffer('image/png'));
  console.log(`  ${f}`);
  return f;
}

function contact(files, name, cols = 3) {
  const rows = Math.ceil(files.length / cols);
  const cw = W * scale;
  const ch = H * scale;
  const sheet = createCanvas(cw * cols, ch * rows);
  const sc = sheet.getContext('2d');
  sc.fillStyle = '#111';
  sc.fillRect(0, 0, cw * cols, ch * rows);
  for (let i = 0; i < files.length; i++) {
    const img = new Image();
    img.src = readFileSync(files[i]);
    sc.drawImage(img, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
  }
  const f = join(outDir, `${name}.png`);
  writeFileSync(f, sheet.toBuffer('image/png'));
  console.log(`  ${f}  (contact sheet)`);
}

/* ── Elephant ─────────────────────────────────────────────────────────────── */

function renderElephant(pose, yaw, name) {
  const fb = newFrame();
  const r = new Renderer(fb);
  // Camera: slightly above eye level, pulled back, looking at mid-body.
  r.setCamera([1.6, 2.5, 8.4], [0.05, 1.45, 0], Math.PI / 4.6);
  r.begin();

  const mesh = buildElephant(pose);
  const model = m4mul(m4rotY(yaw), mat4());
  r.mesh(mesh, model, MATERIALS);

  // Ground shadow blob so she isn't floating.
  r.flush();
  return save(fb, name);
}

if (what === 'elephant') {
  const base = {
    walkPhase: 0.1, stomp: 0, trunkCurl: 0, headTurn: 0,
    earFlap: 0.2, blink: 0, chew: 0, walking: 1,
  };

  if (has('turn')) {
    const files = [];
    for (let i = 0; i < 6; i++) {
      const yaw = (i / 6) * Math.PI * 2;
      files.push(renderElephant(base, yaw, `eleph-turn-${i}`));
    }
    contact(files, 'eleph-turn', 3);
  } else if (has('walk')) {
    const files = [];
    for (let i = 0; i < 8; i++) {
      files.push(renderElephant(
        { ...base, walkPhase: i / 8 },
        -0.42,
        `eleph-walk-${i}`,
      ));
    }
    contact(files, 'eleph-walk', 4);
  } else if (has('poses')) {
    const files = [];
    const poses = [
      ['neutral', { ...base }],
      ['curl', { ...base, trunkCurl: 1 }],
      ['stomp', { ...base, stomp: 1, walkPhase: 0.0 }],
      ['chew', { ...base, trunkCurl: 0.85, chew: 1 }],
      ['blink', { ...base, blink: 1 }],
      ['flap', { ...base, earFlap: 1 }],
    ];
    for (const [n, p] of poses) files.push(renderElephant(p, -0.42, `eleph-${n}`));
    contact(files, 'eleph-poses', 3);
  } else {
    // The money shot: the actual in-game three-quarter angle.
    renderElephant(base, -0.42, 'eleph');
  }
}

/* ── Whole scene ──────────────────────────────────────────────────────────── */

if (what === 'scene') {
  const { buildGrove, drawSky } = await import('../src/gfx/grove3d.js');
  const fb = new Framebuffer(W, H, PAL32);
  const r = new Renderer(fb);
  const scroll = Number(flag('scroll', 0));
  fb.clear(0);
  drawSky(fb);
  r.setCamera([-1.2, 3.4, 8.8], [1.9, 1.9, 0.0], Math.PI / 4.4);
  r.begin();
  buildGrove(r, { scroll, sway: 0, materials: MATERIALS });
  const G = await import('../src/gfx/grove3d.js');
  G.buildFruitCanopy(r, MATERIALS, scroll, 0);
  G.drawShadow(r, MATERIALS, 0.1, 0, 1.6, 1.0);
  // A row of fruit at rhythm positions, to judge the real composition.
  const kinds = ['mango', 'plum', 'lime'];
  for (let i = 0; i < 16; i++) {
    const fx = -2 + i * 1.35;
    const fy = G.FRUIT_Y + Math.sin(i * 2.3) * 0.42;
    G.drawStalk(r, MATERIALS, fx, fy, 0.35, G.CANOPY_Y - fy);
    G.drawFruit(r, MATERIALS, fx, fy, 0.35, kinds[i % 3], 1, i * 0.7);
  }
  const mesh = buildElephant({ walkPhase: 0.1, earFlap: 0.25, walking: 1 });
  r.mesh(mesh, m4rotY(-0.42), MATERIALS);
  r.flush();
  save(fb, 'scene');
}
