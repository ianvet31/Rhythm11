/**
 * Scenes — the three landscapes.
 *
 * Backdrops obey two rules that exist purely to protect gameplay readability:
 *
 *   1. Nothing in the background moves ON the beat. Background elements drift,
 *      sway at half or quarter time, or scroll continuously. If the scenery
 *      pulsed on the beat it would compete with the cue objects, and the player
 *      would start reading the wrong motion.
 *
 *   2. The horizontal band where cues travel is kept low-contrast and free of
 *      detail. You'll see each scene deliberately place its busy elements above
 *      or below the cue lane.
 *
 * Parallax layers are generated from a fixed seed rather than random, so the
 * skyline is the same every run — a level you've played twenty times should
 * look familiar.
 */

import {
  circle, ellipse, roundRect, poly, blob, stroke_, star, layer, INK, lerp, clamp,
} from './shapes.js';
import { VW, VH } from './view.js';
import { seedOffset } from './critters.js';

const CUE_Y = 372;   // the lane cues travel along; keep it clean

function skyGradient(c, P) {
  const g = c.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, P.skyTop);
  g.addColorStop(1, P.skyBot);
  c.fillStyle = g;
  c.fillRect(0, 0, VW, VH);
}

/* ══ SAVANNA ═══════════════════════════════════════════════════════════════ */

export function savannaScene(c, P, { beat = 0, hype = 0, time = 0 }) {
  skyGradient(c, P);

  // Sun — swells on a 4-bar cycle, far too slow to be read as a beat cue.
  const sunR = 78 + Math.sin(beat / 16 * Math.PI * 2) * 5;
  circle(c, 720, 132, sunR, P.sun, 0);
  circle(c, 720, 132, sunR + 22, 'rgba(255,240,194,0.22)', 0);

  // Heat-haze bands
  for (let i = 0; i < 5; i++) {
    const y = 190 + i * 13;
    const w = 200 + Math.sin(time * 0.5 + i) * 40;
    ellipse(c, 720 + Math.sin(time * 0.3 + i * 2) * 30, y, w, 4, 'rgba(255,255,255,0.10)', 0);
  }

  // Far hills
  c.fillStyle = P.far;
  c.beginPath();
  c.moveTo(0, 300);
  for (let x = 0; x <= VW; x += 40) {
    const h = 300 - 40 * Math.sin(x * 0.004) - 22 * Math.sin(x * 0.011 + 1.3);
    c.lineTo(x, h);
  }
  c.lineTo(VW, VH); c.lineTo(0, VH); c.closePath(); c.fill();

  // Acacia trees — the savanna silhouette read
  const trees = [[120, 300, 1.15], [290, 292, 0.8], [560, 298, 0.95], [860, 288, 1.05]];
  for (const [tx, ty, ts] of trees) {
    const sway = Math.sin(time * 0.6 + tx) * 2;
    stroke_(c, [[tx, ty + 24], [tx + sway * 0.5, ty - 30 * ts], [tx + sway, ty - 52 * ts]], 9 * ts, P.mid);
    for (const [dx, dy, rs] of [[-30, -56, 1], [16, -62, 0.85], [40, -48, 0.6]]) {
      ellipse(c, tx + dx * ts + sway, ty + dy * ts, 42 * ts * rs, 15 * ts * rs, P.mid, 0);
    }
    ellipse(c, tx + sway, ty - 66 * ts, 62 * ts, 17 * ts, P.mid, 0);
  }

  // Mid ground
  c.fillStyle = P.ground;
  c.beginPath();
  c.moveTo(0, 322);
  for (let x = 0; x <= VW; x += 60) c.lineTo(x, 322 + Math.sin(x * 0.007) * 6);
  c.lineTo(VW, VH); c.lineTo(0, VH); c.closePath(); c.fill();

  // The stage floor the cast stands on
  c.fillStyle = P.groundDark;
  c.fillRect(0, CUE_Y + 62, VW, VH - CUE_Y - 62);
  c.strokeStyle = 'rgba(29,21,38,0.35)';
  c.lineWidth = 4;
  c.beginPath(); c.moveTo(0, CUE_Y + 62); c.lineTo(VW, CUE_Y + 62); c.stroke();

  // Grass tufts, below the cue lane so they never distract
  for (let i = 0; i < 26; i++) {
    const gx = seedOffset(i * 5.1) * VW;
    const gy = CUE_Y + 74 + seedOffset(i * 9.3) * 90;
    const sc = 0.6 + seedOffset(i * 2.2) * 0.7;
    const w = Math.sin(time * 1.1 + i) * 2.5;
    for (const d of [-1, 0, 1]) {
      stroke_(c, [[gx + d * 5 * sc, gy], [gx + d * 8 * sc + w, gy - 16 * sc]], 3 * sc, P.groundDark);
    }
  }
}

/* ══ TIDE POOL ═════════════════════════════════════════════════════════════ */

export function tidepoolScene(c, P, { beat = 0, hype = 0, time = 0 }) {
  skyGradient(c, P);

  // Caustic light shafts from above
  for (let i = 0; i < 7; i++) {
    const bx = 60 + i * 140 + Math.sin(time * 0.4 + i) * 24;
    layer(c, () => {
      c.globalAlpha = 0.07 + 0.03 * Math.sin(time * 0.8 + i * 2);
      c.fillStyle = P.sun;
      c.beginPath();
      c.moveTo(bx - 26, 0); c.lineTo(bx + 26, 0);
      c.lineTo(bx + 78, VH); c.lineTo(bx - 62, VH);
      c.closePath(); c.fill();
    });
  }

  // Distant coral silhouettes
  for (let i = 0; i < 9; i++) {
    const cx = 40 + i * 110 + seedOffset(i * 3.3) * 40;
    const h = 60 + seedOffset(i * 7.7) * 90;
    layer(c, () => {
      c.globalAlpha = 0.55;
      stroke_(c, [[cx, 330], [cx + 6, 330 - h * 0.6], [cx - 4, 330 - h]], 14, P.far);
      stroke_(c, [[cx, 330 - h * 0.4], [cx + 26, 330 - h * 0.55], [cx + 34, 330 - h * 0.85]], 10, P.far);
      stroke_(c, [[cx, 330 - h * 0.5], [cx - 24, 330 - h * 0.68], [cx - 30, 330 - h * 0.95]], 10, P.far);
    });
  }

  // Rising bubbles — continuous, deliberately not beat-locked
  for (let i = 0; i < 34; i++) {
    const seed = seedOffset(i * 1.37);
    const bx = seed * VW + Math.sin(time * 0.7 + i) * 12;
    const speed = 22 + seed * 30;
    const by = VH - ((time * speed + seed * VH * 2) % (VH + 60));
    const r = 2.5 + seed * 5;
    layer(c, () => {
      c.globalAlpha = 0.30;
      circle(c, bx, by, r, '#bff4ff', 0);
    });
  }

  // Sea floor
  c.fillStyle = P.ground;
  c.beginPath();
  c.moveTo(0, 340);
  for (let x = 0; x <= VW; x += 50) c.lineTo(x, 340 + Math.sin(x * 0.009 + 2) * 12);
  c.lineTo(VW, VH); c.lineTo(0, VH); c.closePath(); c.fill();

  c.fillStyle = P.groundDark;
  c.fillRect(0, CUE_Y + 62, VW, VH - CUE_Y - 62);

  // Kelp swaying at quarter time
  for (let i = 0; i < 12; i++) {
    const kx = seedOffset(i * 4.9) * VW;
    const kh = 60 + seedOffset(i * 8.1) * 110;
    const w = Math.sin(beat * 0.25 * Math.PI * 2 + i) * 16;
    layer(c, () => {
      c.globalAlpha = 0.5;
      stroke_(c, [
        [kx, VH],
        [kx + w * 0.5, VH - kh * 0.5],
        [kx + w, VH - kh],
      ], 11, P.accent);
    });
  }
}

/* ══ OVERDRIVE ═════════════════════════════════════════════════════════════ */

export function overdriveScene(c, P, { beat = 0, hype = 0, time = 0, scroll = 0 }) {
  skyGradient(c, P);

  // Synthwave sun with scan-line gaps
  const sy = 176;
  layer(c, () => {
    c.beginPath(); c.arc(480, sy, 96, 0, Math.PI * 2); c.clip();
    const g = c.createLinearGradient(0, sy - 96, 0, sy + 96);
    g.addColorStop(0, '#ffe14d');
    g.addColorStop(0.5, '#ff2e88');
    g.addColorStop(1, '#8a1a5e');
    c.fillStyle = g;
    c.fillRect(384, sy - 96, 192, 192);
    c.fillStyle = P.skyBot;
    for (let i = 0; i < 9; i++) {
      const yy = sy + 6 + i * 11;
      c.fillRect(384, yy, 192, 2 + i * 0.9);
    }
  });

  // Neon canyon walls, scrolling
  for (const [depth, col, alpha] of [[0.25, P.far, 0.9], [0.5, P.mid, 0.95], [0.85, P.near, 1]]) {
    const off = (scroll * depth * 220) % 320;
    layer(c, () => {
      c.globalAlpha = alpha;
      c.fillStyle = col;
      for (let i = -1; i < 5; i++) {
        const bx = i * 320 - off;
        const h = 120 + Math.sin(i * 2.3 + depth * 10) * 50 + depth * 60;
        c.beginPath();
        c.moveTo(bx, 340);
        c.lineTo(bx + 40, 340 - h);
        c.lineTo(bx + 150, 340 - h * 0.75);
        c.lineTo(bx + 230, 340 - h * 1.1);
        c.lineTo(bx + 320, 340);
        c.closePath(); c.fill();
      }
    });
  }

  // Perspective grid floor — the classic. Lines converge on the vanishing point,
  // and horizontal lines scroll toward the viewer with 1/z spacing.
  const horizon = 340;
  c.strokeStyle = 'rgba(255,46,136,0.55)';
  c.lineWidth = 2;
  for (let i = -14; i <= 14; i++) {
    c.beginPath();
    c.moveTo(480 + i * 22, horizon);
    c.lineTo(480 + i * 190, VH + 40);
    c.stroke();
  }
  const gscroll = (scroll * 1.4) % 1;
  for (let i = 0; i < 14; i++) {
    const t = (i + gscroll) / 14;
    const z = Math.pow(t, 2.6);
    const y = horizon + z * (VH + 40 - horizon);
    c.globalAlpha = clamp(t * 1.6, 0, 1) * 0.6;
    c.beginPath(); c.moveTo(0, y); c.lineTo(VW, y); c.stroke();
  }
  c.globalAlpha = 1;

  // Hype vignette: the world literally gets hotter as the combo climbs.
  if (hype > 0.05) {
    const g = c.createRadialGradient(480, 300, 120, 480, 300, 620);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(255,46,136,${0.22 * hype})`);
    c.fillStyle = g;
    c.fillRect(0, 0, VW, VH);
  }
}

export const SCENES = {
  savanna: savannaScene,
  tidepool: tidepoolScene,
  overdrive: overdriveScene,
};

export { CUE_Y };
