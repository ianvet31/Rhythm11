/**
 * Critters — the cast, drawn procedurally.
 *
 * ── Why animation is driven by beat phase, not by time ───────────────────────
 *
 * Every character takes a `phase` in [0,1) meaning "where we are inside the
 * current beat". Nothing is animated with a free-running timer. This has one
 * enormous consequence: the cast is *physically incapable* of drifting out of
 * sync with the music, at any tempo, through any tempo change, on any frame
 * rate. The animation is a pure function of musical position.
 *
 * ── The three-part motion vocabulary ─────────────────────────────────────────
 *
 * Cartoon motion that reads on the beat needs three things, and all of them are
 * about the moments *around* the beat rather than the beat itself:
 *
 *   ANTICIPATION  — wind up against the direction of motion just before the
 *                   beat. This is what tells the player a hit is coming, and
 *                   it's why Rhythm Heaven cues are readable without a UI.
 *   IMPACT        — squash on the beat. Brief, extreme, 1–2 frames.
 *   RECOVERY      — overshoot back past neutral, then settle.
 *
 * `bounce()` below packages that curve. A character using it will look like it
 * lands ON the beat rather than starting to move on the beat — a distinction
 * that is the whole difference between "synced" and "sloppy".
 */

import {
  circle, ellipse, roundRect, poly, blob, stroke_, star, eye, mouth, blush,
  layer, INK, ease, clamp, lerp,
} from './shapes.js';

/**
 * The canonical beat-bounce curve.
 *
 *   height
 *     │      ╭─╮ recovery overshoot
 *     │     ╱   ╰──
 *   0 ├────╯ ← impact (beat)
 *     │  ╱ anticipation dip
 *     └──────────────────► phase
 *        0.75   0   0.5
 *
 * @param {number} phase   0..1 within the beat
 * @param {number} amp     peak displacement
 * @returns {{y:number, squash:number}} y is up-positive; squash >1 is squat.
 */
export function bounce(phase, amp = 1) {
  // Anticipation occupies the last 22% of the previous beat.
  if (phase > 0.78) {
    const t = (phase - 0.78) / 0.22;
    return { y: -amp * 0.18 * ease.inQuad(t), squash: 1 + 0.14 * t };
  }
  // Impact + recovery.
  const t = phase / 0.78;
  const hop = Math.sin(Math.PI * Math.min(t * 1.35, 1)) * ease.outQuint(1 - t * 0.35);
  const squash = t < 0.09
    ? lerp(1.28, 1, t / 0.09)          // hard squash for ~1 frame
    : 1 - 0.10 * hop;                   // stretch while airborne
  return { y: amp * hop, squash };
}

/** Idle sway for characters that aren't the focus — slower, half-time. */
export function sway(beat, amp = 1, period = 2) {
  return Math.sin((beat / period) * Math.PI * 2) * amp;
}

/** Deterministic per-character jitter so a row of identical animals isn't. */
export function seedOffset(seed) {
  const s = Math.sin(seed * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Apply squash-and-stretch around a character's feet. Volume-preserving:
 * widening by k narrows by 1/k, which is what stops squash from reading as
 * "the sprite got bigger".
 */
function squashXform(c, x, groundY, squash) {
  c.translate(x, groundY);
  c.scale(squash, 1 / squash);
  c.translate(-x, -groundY);
}

/* ══ MEERKAT — Savanna Stomp ═══════════════════════════════════════════════ */

/**
 * A meerkat popping out of a burrow. The cue read is vertical: it rises out of
 * the ground on the anticipation and is fully up on the beat.
 *
 * @param {object} o
 * @param {number} o.pop  0 = fully underground, 1 = fully out
 */
export function meerkat(c, P, { x, y, s = 1, pop = 1, phase = 0, mood = 1, look = [0, 0], blink = 0, arms = 0, seed = 0 }) {
  if (pop <= 0.01) return;
  const b = bounce(phase, 4 * s);
  const rise = (1 - pop) * 96 * s;

  layer(c, () => {
    // Clip at the burrow lip so the body genuinely emerges from the hole.
    c.beginPath();
    c.rect(x - 80 * s, y - 400 * s, 160 * s, 400 * s);
    c.clip();

    c.translate(0, rise - b.y * 0.35);
    squashXform(c, x, y, b.squash);

    const bodyH = 74 * s, bodyW = 27 * s;

    // Tail
    stroke_(c, [
      [x + bodyW * 0.7, y - 6 * s],
      [x + bodyW * 2.0, y + 4 * s],
      [x + bodyW * 2.6, y - 26 * s],
    ], 8 * s, P.furDark);

    // Body
    ellipse(c, x, y - bodyH * 0.48, bodyW, bodyH * 0.55, P.fur, 5 * s);
    ellipse(c, x, y - bodyH * 0.40, bodyW * 0.6, bodyH * 0.40, P.belly, 0);

    // Arms — raised when drumming
    const armA = lerp(0.5, -0.85, clamp(arms, 0, 1));
    for (const side of [-1, 1]) {
      stroke_(c, [
        [x + side * bodyW * 0.75, y - bodyH * 0.55],
        [x + side * (bodyW * 1.25 + arms * 6 * s), y - bodyH * (0.62 + arms * 0.14)],
        [x + side * (bodyW * 1.15), y - bodyH * (0.5 + armA * 0.28)],
      ], 7.5 * s, P.fur);
    }

    // Head
    const hy = y - bodyH - 14 * s;
    ellipse(c, x, hy, 24 * s, 21 * s, P.fur, 5 * s);
    // Snout
    ellipse(c, x + 2 * s, hy + 8 * s, 12 * s, 8.5 * s, P.belly, 4 * s);
    circle(c, x + 3 * s, hy + 6 * s, 3.6 * s, INK, 0);

    // Ears
    for (const side of [-1, 1]) {
      ellipse(c, x + side * 20 * s, hy - 12 * s, 8 * s, 6.5 * s, P.furDark, 4 * s, side * 0.5);
    }

    // Signature dark eye patches
    for (const side of [-1, 1]) {
      ellipse(c, x + side * 9.5 * s, hy - 3 * s, 10 * s, 8.5 * s, '#4a2c1a', 0);
      eye(c, x + side * 9.5 * s, hy - 3 * s, 5.4 * s, blink, look);
    }
    mouth(c, x + 2 * s, hy + 13.5 * s, 9 * s, mood, 0, 3 * s);
  });
}

/** The burrow mound a meerkat pops from. Drawn after the ground, before them. */
export function burrow(c, P, { x, y, s = 1, glow = 0 }) {
  ellipse(c, x, y + 4 * s, 46 * s, 15 * s, P.groundDark, 5 * s);
  ellipse(c, x, y, 30 * s, 10 * s, '#3a1f14', 4 * s);
  if (glow > 0.01) {
    ellipse(c, x, y, 34 * s, 12 * s, `rgba(255,210,63,${0.4 * glow})`, 0);
  }
}

/* ══ GIRAFFE — the conductor ═══════════════════════════════════════════════ */

/**
 * Tall enough to be the visual anchor of the savanna stage. Her head nods on
 * the downbeat, and the neck follows a beat later — a whip-lag that makes a
 * long shape feel like it has weight.
 */
export function giraffe(c, P, { x, y, s = 1, phase = 0, beat = 0, baton = 0, blink = 0 }) {
  const b = bounce(phase, 3 * s);
  const neckLean = Math.sin(phase * Math.PI * 2) * 5 * s;
  const headLag = bounce((phase + 0.85) % 1, 5 * s);

  layer(c, () => {
    squashXform(c, x, y, lerp(1, b.squash, 0.4));

    // Legs
    for (const [dx, ph] of [[-22, 0], [-8, 0.5], [10, 0.25], [24, 0.75]]) {
      const lift = Math.max(0, Math.sin((beat + ph) * Math.PI)) * 3 * s;
      stroke_(c, [
        [x + dx * s, y - 60 * s],
        [x + dx * s * 1.05, y - 30 * s],
        [x + dx * s * 1.1, y - lift],
      ], 9 * s, P.fur);
    }

    // Body
    ellipse(c, x, y - 82 * s - b.y * 0.3, 46 * s, 32 * s, P.fur, 5.5 * s);
    // Spots
    for (let i = 0; i < 7; i++) {
      const a = i * 1.7;
      ellipse(
        c,
        x + Math.cos(a) * 30 * s, y - 82 * s - b.y * 0.3 + Math.sin(a) * 18 * s,
        8 * s, 6.5 * s, P.furDark, 0, a,
      );
    }

    // Neck
    const nx = x + 30 * s, ny = y - 105 * s;
    const hx = nx + 22 * s + neckLean, hy = ny - 96 * s - headLag.y * 0.5;
    stroke_(c, [[nx, ny], [nx + 8 * s + neckLean * 0.4, ny - 50 * s], [hx, hy + 12 * s]], 22 * s, P.fur);
    for (let i = 0; i < 4; i++) {
      const t = 0.18 + i * 0.22;
      ellipse(
        c,
        lerp(nx, hx, t) + 4 * s, lerp(ny, hy + 12 * s, t),
        6 * s, 5 * s, P.furDark, 0,
      );
    }
    // Mane
    stroke_(c, [[nx - 6 * s, ny - 8 * s], [nx + 2 * s + neckLean * 0.4, ny - 52 * s], [hx - 8 * s, hy + 10 * s]], 6 * s, P.furDark);

    // Head
    layer(c, () => {
      c.translate(hx, hy);
      c.rotate(neckLean * 0.012);
      ellipse(c, 0, 0, 22 * s, 16 * s, P.fur, 5 * s);
      ellipse(c, 16 * s, 6 * s, 12 * s, 9 * s, P.belly, 4.5 * s);   // muzzle
      circle(c, 19 * s, 4 * s, 2.6 * s, INK, 0);
      // Ossicones
      for (const dx of [-6, 5]) {
        stroke_(c, [[dx * s, -13 * s], [dx * s, -24 * s]], 5 * s, P.fur);
        circle(c, dx * s, -26 * s, 4.5 * s, P.furDark, 3.5 * s);
      }
      ellipse(c, -12 * s, -8 * s, 9 * s, 6 * s, P.fur, 4 * s, -0.6); // ear
      eye(c, 4 * s, -4 * s, 6 * s, blink, [0.3, 0.1]);
      mouth(c, 16 * s, 11 * s, 9 * s, 1, 0, 3 * s);
    });

    // Conducting baton
    if (baton > 0) {
      const ang = -0.7 + Math.sin(phase * Math.PI * 2) * 0.9;
      const sx = x - 34 * s, sy = y - 92 * s;
      stroke_(c, [[sx, sy], [sx + Math.cos(ang) * 34 * s, sy + Math.sin(ang) * 34 * s]], 4 * s, '#fff6e0');
    }
  });
}

/* ══ OCTOPUS — Neon Tide Pool DJ ═══════════════════════════════════════════ */

/**
 * Eight arms, each on a different phase offset, so the silhouette is always
 * moving even when the beat is empty. The head pulses with a glow that peaks
 * exactly on the beat — a second, peripheral-vision channel for tempo.
 */
export function octopus(c, P, { x, y, s = 1, phase = 0, beat = 0, throwT = -1, blink = 0, mood = 1 }) {
  const b = bounce(phase, 5 * s);
  const glow = Math.pow(1 - phase, 3);

  layer(c, () => {
    c.translate(0, -b.y * 0.5);

    // Glow halo, additive-ish
    ellipse(c, x, y - 40 * s, 78 * s * (1 + glow * 0.1), 70 * s * (1 + glow * 0.1),
      `rgba(255,92,224,${0.10 + glow * 0.18})`, 0);

    // Arms
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const k = i % 4;
      const ph = (beat * 0.5 + i * 0.13) % 1;
      const wig = Math.sin(ph * Math.PI * 2) * (7 + k * 3) * s;
      const baseX = x + side * (16 + k * 9) * s;
      const len = (48 + k * 16) * s;
      stroke_(c, [
        [baseX, y - 34 * s],
        [baseX + side * 14 * s + wig * 0.5, y - 16 * s + wig * 0.3],
        [baseX + side * 24 * s + wig, y + len * 0.16],
        [baseX + side * 16 * s + wig * 1.6, y + len * 0.3],
      ], (13 - k * 1.6) * s, k % 2 ? P.furDark : P.fur);
    }

    // Head/mantle
    const hy = y - 62 * s;
    layer(c, () => {
      squashXform(c, x, y - 24 * s, b.squash);
      ellipse(c, x, hy, 52 * s, 50 * s, P.fur, 5.5 * s);
      ellipse(c, x, hy - 12 * s, 34 * s, 24 * s, P.belly, 0);

      // Headphones — this is a DJ
      stroke_(c, [[x - 48 * s, hy - 12 * s], [x, hy - 54 * s], [x + 48 * s, hy - 12 * s]], 8 * s, '#2b1b3a');
      for (const side of [-1, 1]) {
        roundRect(c, x + side * 56 * s - 11 * s, hy - 22 * s, 22 * s, 30 * s, 9 * s, P.hot, 5 * s);
      }

      for (const side of [-1, 1]) {
        eye(c, x + side * 17 * s, hy + 2 * s, 11 * s, blink, [0, 0.05]);
      }
      mouth(c, x, hy + 26 * s, 20 * s, mood, throwT >= 0 && throwT < 0.2 ? 1 : 0, 4 * s);
      blush(c, x - 33 * s, hy + 16 * s, 10 * s, 0.35, '255,255,255');
      blush(c, x + 33 * s, hy + 16 * s, 10 * s, 0.35, '255,255,255');
    });
  });
}

/** Jellyfish backup dancers — pure ambience, half-time bob. */
export function jelly(c, P, { x, y, s = 1, beat = 0, seed = 0, hue = null }) {
  const t = (beat * 0.5 + seedOffset(seed)) % 1;
  const yy = y + Math.sin(t * Math.PI * 2) * 12 * s;
  const squish = 1 + Math.sin(t * Math.PI * 2 + 1) * 0.12;
  const col = hue || P.hot;
  layer(c, () => {
    c.globalAlpha = 0.85;
    ellipse(c, x, yy, 22 * s * squish, 18 * s / squish, col, 3.5 * s);
    ellipse(c, x, yy - 4 * s, 12 * s * squish, 8 * s, 'rgba(255,255,255,0.5)', 0);
    for (let i = -2; i <= 2; i++) {
      const wig = Math.sin(t * Math.PI * 2 + i) * 5 * s;
      stroke_(c, [
        [x + i * 7 * s, yy + 14 * s],
        [x + i * 7 * s + wig, yy + 30 * s],
        [x + i * 7 * s + wig * 1.5, yy + 44 * s],
      ], 2.6 * s, col);
    }
  });
}

/* ══ FOX — Vulpine Overdrive ═══════════════════════════════════════════════ */

/**
 * Riding a hoverboard at speed. Leans into the motion, tail streams behind.
 * `crouch` compresses her on impact; `lean` is set by recent hits so the pose
 * itself becomes feedback.
 */
export function fox(c, P, { x, y, s = 1, phase = 0, beat = 0, crouch = 0, lean = 0, blink = 0, mood = 1, boost = 0 }) {
  const b = bounce(phase, 6 * s);
  const hover = Math.sin(beat * Math.PI * 2 * 0.5) * 3 * s;

  layer(c, () => {
    c.translate(x, y + hover - b.y * 0.6);
    c.rotate(lean * 0.16);
    c.scale(1, 1 - crouch * 0.16);

    // Board
    layer(c, () => {
      c.translate(0, 34 * s);
      roundRect(c, -48 * s, -6 * s, 96 * s, 12 * s, 6 * s, '#3a2450', 5 * s);
      roundRect(c, -40 * s, -2 * s, 80 * s, 6 * s, 3 * s, P.hot, 0);
      // Thruster glow
      const g = 0.35 + boost * 0.5 + Math.pow(1 - phase, 4) * 0.3;
      ellipse(c, -56 * s, 0, 18 * s * (1 + boost), 6 * s, `rgba(0,229,255,${g})`, 0);
      ellipse(c, -46 * s, 0, 10 * s, 4 * s, `rgba(255,255,255,${g})`, 0);
    });

    // Tail — big, bushy, trails behind with lag
    const tl = bounce((phase + 0.7) % 1, 8 * s);
    stroke_(c, [
      [-14 * s, 2 * s],
      [-44 * s, -6 * s - tl.y * 0.4],
      [-72 * s, -22 * s - tl.y],
    ], 26 * s, P.fur);
    circle(c, -74 * s, -24 * s - tl.y, 15 * s, P.belly, 0);

    // Legs
    for (const dx of [-16, 12]) {
      stroke_(c, [[dx * s, 4 * s], [dx * s + 3 * s, 20 * s], [dx * s + 6 * s, 30 * s]], 10 * s, P.furDark);
    }

    // Body
    ellipse(c, 0, -8 * s, 28 * s, 32 * s, P.fur, 5.5 * s);
    ellipse(c, 4 * s, -2 * s, 16 * s, 22 * s, P.belly, 0);

    // Arms out for balance
    stroke_(c, [[-18 * s, -18 * s], [-34 * s, -26 * s + b.y * 0.3], [-42 * s, -14 * s]], 8 * s, P.fur);
    stroke_(c, [[20 * s, -18 * s], [38 * s, -28 * s - b.y * 0.3], [46 * s, -18 * s]], 8 * s, P.fur);

    // Head
    layer(c, () => {
      c.translate(6 * s, -52 * s);
      c.rotate(-lean * 0.1);
      // Ears — big triangles, the fox read
      for (const [dx, rot] of [[-14, -0.35], [14, 0.28]]) {
        layer(c, () => {
          c.translate(dx * s, -18 * s);
          c.rotate(rot + b.y * 0.006);
          poly(c, [[-10 * s, 6 * s], [0, -22 * s], [10 * s, 6 * s]], P.fur, 5 * s);
          poly(c, [[-5 * s, 3 * s], [0, -13 * s], [5 * s, 3 * s]], '#ffc9a8', 0);
        });
      }
      ellipse(c, 0, 0, 25 * s, 22 * s, P.fur, 5 * s);
      // Snout
      poly(c, [[6 * s, -2 * s], [30 * s, 6 * s], [6 * s, 14 * s]], P.belly, 5 * s);
      circle(c, 30 * s, 6 * s, 4.2 * s, INK, 0);
      // Cheek ruffs
      ellipse(c, -20 * s, 6 * s, 9 * s, 11 * s, P.belly, 0, -0.3);

      eye(c, -6 * s, -3 * s, 6.5 * s, blink, [0.5, 0]);
      eye(c, 11 * s, -2 * s, 5.5 * s, blink, [0.5, 0]);
      // Goggles strap
      stroke_(c, [[-24 * s, -10 * s], [16 * s, -12 * s]], 4.5 * s, 'rgba(0,229,255,0.75)');
      mouth(c, 14 * s, 12 * s, 8 * s, mood, 0, 3 * s);
    });
  });
}

/* ══ CROWD — generic reactive audience ═════════════════════════════════════ */

/**
 * A row of little animals that bob half-time and cheer on combo. Cheap to draw
 * and it makes the stage feel inhabited; an empty stage reads as a prototype no
 * matter how good the character in front of it is.
 */
export function crowd(c, P, { x, y, w, count = 10, beat = 0, hype = 0, s = 1 }) {
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const cx = x + t * w;
    const off = seedOffset(i * 3.7);
    const ss = s * (0.7 + off * 0.5);
    const ph = (beat * 0.5 + off) % 1;
    const bob = Math.abs(Math.sin(ph * Math.PI)) * (5 + hype * 12) * ss;
    const cy = y - bob;

    layer(c, () => {
      c.globalAlpha = 0.9;
      const body = off > 0.5 ? P.furDark : P.mid;
      ellipse(c, cx, cy, 15 * ss, 17 * ss, body, 4 * ss);
      // Ears vary so the row reads as different species
      if (off > 0.66) {
        for (const d of [-1, 1]) ellipse(c, cx + d * 9 * ss, cy - 15 * ss, 5 * ss, 8 * ss, body, 3.5 * ss, d * 0.3);
      } else if (off > 0.33) {
        for (const d of [-1, 1]) poly(c, [[cx + d * 6 * ss, cy - 10 * ss], [cx + d * 12 * ss, cy - 26 * ss], [cx + d * 14 * ss, cy - 8 * ss]], body, 3.5 * ss);
      } else {
        for (const d of [-1, 1]) circle(c, cx + d * 11 * ss, cy - 9 * ss, 6 * ss, body, 3.5 * ss);
      }
      circle(c, cx - 5 * ss, cy - 2 * ss, 2.4 * ss, INK, 0);
      circle(c, cx + 5 * ss, cy - 2 * ss, 2.4 * ss, INK, 0);
      if (hype > 0.4) {
        // Raised arms when the combo is hot
        for (const d of [-1, 1]) {
          stroke_(c, [[cx + d * 13 * ss, cy], [cx + d * 20 * ss, cy - 16 * ss - bob * 0.5]], 4 * ss, body);
        }
      }
    });
  }
}
