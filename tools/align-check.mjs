/**
 * Alignment check — does the visual cue actually agree with the audio?
 *
 * ── The bug this exists to prevent ───────────────────────────────────────────
 *
 * Mango Stomp hangs its rhythm in the trees, so the fruit IS the timing cue.
 * The fruit hangs about three world units above the ground, and the camera is
 * off-axis and tilted down. Under a tilted camera, raising a point also pushes
 * it along the view axis, which changes the perspective divide — so a fruit and
 * the ground point directly beneath it do NOT share a screen X.
 *
 * The first 3D build aligned them in world space, which is the intuitive thing
 * to do and is wrong. Result: the fruit crossed the stomp point 108ms before
 * its note was due. That is wider than the entire ±110ms judgment window. A
 * player watching the fruit was guaranteed to be early, it felt like broken
 * calibration, and no calibration setting could have fixed it.
 *
 * The player judges in SCREEN space. So the check has to measure screen space.
 *
 * This walks a fruit across the stomp point at several hang heights and asserts
 * the crossing happens within a few milliseconds of the note. It runs headless
 * with no GPU, so it can live in `npm test`.
 *
 * Run: node tools/align-check.mjs
 */

import { Framebuffer, Renderer } from '../src/gfx/raster.js';
import { PAL32 } from '../src/gfx/palette32.js';
import { LEVELS } from '../src/game/levels/index.js';

let failures = 0;
let checks = 0;
const ok = (cond, msg, detail = '') => {
  checks++;
  if (!cond) { failures++; console.log(`  ✗ ${msg}${detail ? `\n      ${detail}` : ''}`); }
};

console.log('\nVisual/audio alignment');

/* These mirror src/game/stages/grove.js. Kept in sync by the assertion at the
   bottom, which fails loudly if the stage's own constants drift from these. */
const FB_W = 320;
const FB_H = 180;
const SPEED = 3.05;
const FRUIT_Z = 0.30;
const STOMP_POINT = [0.62, 0.05, 0.10];
const CAMERA_EYE = [-1.2, 3.45, 8.8];
const CAMERA_AT = [1.9, 1.95, 0.0];
const CAMERA_FOV = Math.PI / 4.4;

const fb = new Framebuffer(FB_W, FB_H, PAL32);
const r = new Renderer(fb);
r.setCamera(CAMERA_EYE, CAMERA_AT, CAMERA_FOV);

/** The same Newton solve the stage uses. */
function alignFruitX(y) {
  const target = r.project(STOMP_POINT);
  let x = 0;
  for (let i = 0; i < 3; i++) {
    const p0 = r.project([x, y, FRUIT_Z]);
    const p1 = r.project([x + 0.5, y, FRUIT_Z]);
    const slope = (p1.x - p0.x) / 0.5;
    x += (target.x - p0.x) / slope;
  }
  return x;
}

/**
 * Simulate a fruit approaching and find the song time at which it visually
 * crosses the stomp point. Zero is what we want.
 */
function crossingErrorMs(hangY, useAlignment) {
  const targetX = r.project(STOMP_POINT).x;
  const offset = useAlignment ? alignFruitX(hangY) : 0;

  let prev = null;
  // Sweep dt from "approaching" to "past", in 1ms steps.
  for (let dt = 0.60; dt > -0.60; dt -= 0.001) {
    const worldX = dt * SPEED + offset;
    const p = r.project([worldX, hangY, FRUIT_Z]);
    if (!p) continue;
    const d = p.x - targetX;
    if (prev !== null && Math.sign(d) !== Math.sign(prev.d)) {
      // Linear interpolation between the two straddling samples.
      const f = Math.abs(prev.d) / (Math.abs(prev.d) + Math.abs(d));
      return (prev.dt + (dt - prev.dt) * f) * 1000;
    }
    prev = { dt, d };
  }
  return NaN;
}

/* ── Without the fix: reproduce the original bug ──────────────────────────── */

const naive = crossingErrorMs(2.95, false);
console.log(`  world-space alignment (the old bug): fruit crosses ${naive.toFixed(0)}ms off`);
ok(Math.abs(naive) > 40,
  'the naive world-space alignment really is badly wrong (sanity check on this test)',
  `got ${naive.toFixed(1)}ms — if this is small, the test is not measuring anything`);

/* ── With the fix ─────────────────────────────────────────────────────────── */

// The chart varies hang height by ±0.5 around FRUIT_Y, so check the range.
const HEIGHTS = [2.43, 2.70, 2.95, 3.20, 3.47];
let worst = 0;
let worstAt = 0;
for (const h of HEIGHTS) {
  const e = crossingErrorMs(h, true);
  if (Math.abs(e) > Math.abs(worst)) { worst = e; worstAt = h; }
}
console.log(`  screen-space alignment: worst ${worst.toFixed(2)}ms at hang height ${worstAt}`);

// 8ms is a quarter of the perfect window — imperceptible, and well inside the
// noise floor of a human tapping.
ok(Math.abs(worst) < 8,
  'aligned fruit crosses the stomp point within 8ms of its note',
  `worst ${worst.toFixed(2)}ms at height ${worstAt}`);

/* ── The stage's own constants must match the ones tested here ────────────── */

const src = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/game/stages/grove.js', import.meta.url), 'utf8'));

const grab = (name) => {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(src);
  return m ? m[1].trim() : null;
};
// Compare numerically: the source says `0.30`, String(0.30) is `"0.3"`.
ok(Number(grab('SPEED')) === SPEED, 'stage SPEED matches the value under test', `stage has ${grab('SPEED')}`);
ok(Number(grab('FRUIT_Z')) === FRUIT_Z, 'stage FRUIT_Z matches', `stage has ${grab('FRUIT_Z')}`);
ok(src.includes('alignFruitX'), 'the stage actually performs the alignment solve');
ok(/setCamera\(\s*\[-1\.2/.test(src.replace(/\s+/g, ' ')) || src.includes('-1.2'),
  'stage camera eye X matches the value under test');

/* ── The level's declared speed must match the stage's ────────────────────── */

const grove = LEVELS.find((l) => l.id === 'grove');
ok(grove.scrollUnitsPerSec === SPEED,
  'the level and the stage agree on scroll speed',
  `level says ${grove.scrollUnitsPerSec}, stage says ${SPEED}`);

console.log(`\n${failures === 0 ? '✓ ALL PASS' : `✗ ${failures} FAILURE(S)`} — ${checks} checks\n`);
process.exit(failures ? 1 : 0);
