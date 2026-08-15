/**
 * Beasts — the elephant, and the grove she walks through.
 *
 * ── What "smooth and satisfying" actually means, mechanically ────────────────
 *
 * Smoothness is not a matter of adding more frames. It's four specific things,
 * and every function in this file is built around them:
 *
 * 1. CONTINUITY OF VALUE *AND* SLOPE.
 *    Animation that jumps looks bad; animation whose *speed* jumps looks cheap.
 *    So nothing here snaps a value on an event. Trunk position, head angle and
 *    body lean all run through a damped spring (`Spring` below), which is
 *    continuous in position and velocity by construction. You can interrupt a
 *    spring mid-flight and it stays smooth — impossible with a tween.
 *
 * 2. OVERLAPPING ACTION.
 *    Real bodies don't move as one piece. The trunk lags the head, the head lags
 *    the body, the ears lag everything, and the tail lags most of all. Each part
 *    here reads the beat phase with its own offset, so the silhouette is always
 *    in motion even on a still beat. A rig where everything moves in lockstep
 *    reads as a puppet no matter how good the drawing is.
 *
 * 3. ANTICIPATION AND FOLLOW-THROUGH ON IMPACT.
 *    The stomp rises before it falls and the body keeps compressing for a beat
 *    after contact. The impact frame itself is one or two frames of extreme
 *    squash — brief enough that you never consciously see it, long enough that
 *    you feel the weight.
 *
 * 4. VOLUME PRESERVATION.
 *    Squash by k, stretch by 1/k. Otherwise "squash" reads as "the sprite got
 *    smaller", which is the single most common tell of amateur cartoon motion.
 *
 * Everything cyclic is a function of BEAT PHASE, never a free-running timer, so
 * the walk cannot drift out of sync with the music at any tempo or frame rate.
 */

import {
  circle, ellipse, roundRect, poly, blob, stroke_, star, eye, mouth, blush,
  layer, INK, ease, clamp, lerp,
} from './shapes.js';

const TAU = Math.PI * 2;

/**
 * Critically-damped-ish spring. The workhorse for smoothness.
 *
 * Why a spring instead of `value += (target - value) * 0.2`?
 *   • That exponential chase is frame-rate dependent and has zero momentum —
 *     it decelerates into every target identically, which reads as floaty.
 *   • A spring carries velocity, so it overshoots slightly and settles. That
 *     tiny overshoot is most of what makes motion feel physical.
 *   • It's interruptible: retarget mid-flight and the motion stays continuous.
 *
 * `stiffness` sets how eagerly it chases; `damping` how much it overshoots.
 * damping ≈ 2·√stiffness is critical (no overshoot); below that it bounces.
 */
export class Spring {
  constructor(value = 0, stiffness = 170, damping = 22) {
    this.value = value;
    this.target = value;
    this.vel = 0;
    this.k = stiffness;
    this.d = damping;
  }

  step(dt) {
    // Sub-step for stability: a stiff spring integrated at a long dt explodes.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = this.k * (this.target - this.value) - this.d * this.vel;
      this.vel += a * h;
      this.value += this.vel * h;
    }
    return this.value;
  }

  /** Jump without motion — for scene resets only. */
  set(v) { this.value = this.target = v; this.vel = 0; }
}

/* ══ THE ELEPHANT ═════════════════════════════════════════════════════════ */

/**
 * Walk cycle timing.
 *
 * A real elephant walks in a "lateral sequence" gait, but for a side-on cartoon
 * what reads is the DIAGONAL pair — front-left with back-right, then the other
 * pair. Two steps per two beats, so one footfall per beat, so the walk is
 * visibly locked to the pulse without anyone having to think about it.
 *
 * Each leg's phase offset is baked in here; the body bob is derived FROM the
 * legs rather than authored separately, which is what keeps them consistent.
 */
const LEG_PHASE = [0, 0.5, 0.5, 0];   // [frontL, frontR, backL, backR]

/** Foot height above ground for a leg at a given cycle position. */
function footLift(u) {
  // Fast lift, slow reach, hard plant. Sine would be symmetric and read floaty.
  const t = (u % 1 + 1) % 1;
  if (t < 0.42) return Math.sin((t / 0.42) * Math.PI) * 1;
  return 0;
}

/**
 * @param {object} o
 * @param {number} o.phase     position inside the current beat, 0..1
 * @param {number} o.beat      absolute beat, for cycles longer than one beat
 * @param {number} o.stomp     0..1 impact envelope, 1 at the moment of contact
 * @param {number} o.trunkCurl 0 = hanging, 1 = curled to mouth (springy)
 * @param {number} o.chew      0..1, drives jaw
 * @param {number} o.headTilt  radians, springy
 * @param {number} o.walking   0..1 — fades the gait out when she stops
 */
export function elephant(c, P, {
  x, y, s = 1, phase = 0, beat = 0,
  stomp = 0, trunkCurl = 0, chew = 0, headTilt = 0, lean = 0,
  walking = 1, blink = 0, mood = 1, carrying = null, seed = 0,
}) {
  /* ── Body-level motion ─────────────────────────────────────────────────
     The bob comes from the gait: the body is lowest when a diagonal pair
     plants. Two plants per beat-pair means the bob runs at half the leg rate. */
  const gait = beat % 2;
  const bob = -Math.abs(Math.sin(gait * Math.PI)) * 4 * s * walking;

  // Impact squash. Extreme and brief — the shape of the curve is the weight.
  const sq = stomp > 0
    ? 1 + 0.30 * Math.pow(stomp, 0.55)
    : 1;
  const bodyDrop = stomp * 11 * s;

  const BW = 62 * s;      // body half-width
  const BH = 46 * s;      // body half-height
  const cy = y - 74 * s + bob + bodyDrop;

  layer(c, () => {
    // Contact shadow. Tightens and darkens on impact — cheap, and it does more
    // for "she has weight" than anything happening on the body itself.
    const shw = 1 - stomp * 0.18;
    ellipse(c, x, y + 4 * s, 62 * s * shw, 11 * s * shw,
      `rgba(29,21,38,${0.20 + stomp * 0.16})`, 0);

    c.translate(x, y);
    c.rotate(lean);
    c.translate(-x, -y);

    // Volume-preserving squash about the feet.
    c.translate(x, y);
    c.scale(1 / sq, sq);
    c.translate(-x, -y);

    /* ── Back legs (behind the body) ─────────────────────────────────── */
    drawLeg(c, P, x - 34 * s, y, s, beat, LEG_PHASE[2], walking, stomp * 0.3, true);
    drawLeg(c, P, x - 14 * s, y, s, beat, LEG_PHASE[3], walking, stomp * 0.3, true);

    /* ── Tail — the laggiest thing on the animal ─────────────────────── */
    const tailSwing = Math.sin((beat - 0.55) * Math.PI) * 7 * s * walking;
    stroke_(c, [
      [x - BW * 0.92, cy + 6 * s],
      [x - BW * 1.18, cy + 24 * s + tailSwing * 0.4],
      [x - BW * 1.24 + tailSwing, cy + 42 * s],
    ], 5 * s, P.hideDark);
    ellipse(c, x - BW * 1.24 + tailSwing, cy + 46 * s, 5 * s, 8 * s, P.hideDark, 0);

    /* ── Body ────────────────────────────────────────────────────────── */
    blob(c, [
      [x - BW, cy - 6 * s],
      [x - BW * 0.72, cy - BH * 0.92],
      [x + BW * 0.20, cy - BH],
      [x + BW * 0.88, cy - BH * 0.62],
      [x + BW, cy + BH * 0.10],
      [x + BW * 0.66, cy + BH * 0.86],
      [x - BW * 0.52, cy + BH * 0.92],
      [x - BW * 0.96, cy + BH * 0.42],
    ], P.hide, 5.5 * s);

    // Belly highlight — one soft shape, no gradient. Keeps the poster look.
    ellipse(c, x - 4 * s, cy + BH * 0.42, BW * 0.60, BH * 0.34, P.hideLight, 0);

    /* ── Front legs ──────────────────────────────────────────────────── */
    drawLeg(c, P, x + 16 * s, y, s, beat, LEG_PHASE[0], walking, stomp, false);
    drawLeg(c, P, x + 38 * s, y, s, beat, LEG_PHASE[1], walking, stomp * 0.45, false);

    /* ── Head ────────────────────────────────────────────────────────── */
    const hx = x + BW * 0.86;
    const hy = cy - BH * 0.52;
    layer(c, () => {
      c.translate(hx, hy);
      c.rotate(headTilt);
      c.translate(-hx, -hy);

      // Skull
      blob(c, [
        [hx - 26 * s, hy - 24 * s],
        [hx + 8 * s, hy - 32 * s],
        [hx + 30 * s, hy - 14 * s],
        [hx + 32 * s, hy + 14 * s],
        [hx + 6 * s, hy + 30 * s],
        [hx - 24 * s, hy + 22 * s],
      ], P.hide, 5.5 * s);

      /* Ear — the biggest, floppiest, laggiest shape. Its flap is driven by
         the beat with a large phase offset, plus an extra kick on the stomp,
         because a heavy footfall should visibly travel up the whole animal. */
      const flap = Math.sin((beat - 0.35) * Math.PI) * 0.16 * walking + stomp * 0.30;
      layer(c, () => {
        c.translate(hx - 12 * s, hy - 12 * s);
        c.rotate(flap);
        blob(c, [
          [-4 * s, -14 * s],
          [26 * s, -18 * s],
          [40 * s, 10 * s],
          [26 * s, 40 * s],
          [-2 * s, 34 * s],
          [-12 * s, 8 * s],
        ], P.ear, 5 * s);
        blob(c, [
          [2 * s, -6 * s], [20 * s, -8 * s], [28 * s, 10 * s],
          [18 * s, 28 * s], [2 * s, 24 * s],
        ], P.earInner, 0);
      });

      // Tusks — small, cute, not menacing.
      poly(c, [
        [hx + 18 * s, hy + 18 * s], [hx + 34 * s, hy + 26 * s], [hx + 20 * s, hy + 26 * s],
      ], '#fff4e0', 3.5 * s);

      eye(c, hx + 14 * s, hy - 6 * s, 6.2 * s, blink, [0.35, 0]);
      if (chew > 0.05) blush(c, hx + 2 * s, hy + 10 * s, 9 * s, 0.35 * chew);

      /* ── Trunk ───────────────────────────────────────────────────────
         Seven segments along a curve between "hanging" and "curled to mouth".
         Drawn as tapering circles rather than a stroked path so the taper is
         real geometry — a stroked line can't get thinner along its length. */
      drawTrunk(c, P, hx + 22 * s, hy + 16 * s, s, trunkCurl, beat, walking, chew, carrying);
    });
  });
}

/** One leg. `plant` is the extra push on a stomping foot. */
function drawLeg(c, P, x, y, s, beat, phaseOff, walking, plant, back) {
  const u = beat / 2 + phaseOff;
  const lift = footLift(u) * 13 * s * walking;
  // Forward/back travel, in antiphase with the lift.
  const swing = Math.cos(((u % 1) + 1) % 1 * TAU) * 9 * s * walking;
  const fy = y - lift + plant * 3 * s;
  const fx = x + swing;
  const col = back ? P.hideDark : P.hide;

  // Column leg with a slight taper; foot is a rounded pad.
  layer(c, () => {
    stroke_(c, [
      [x, y - 44 * s],
      [x + swing * 0.5, y - 24 * s],
      [fx, fy - 8 * s],
    ], 20 * s, col);
    ellipse(c, fx, fy - 3 * s, 13 * s, 8 * s, col, 4.5 * s);
    // Toenails — three dots. Reads as "elephant" instantly.
    for (const d of [-1, 0, 1]) {
      circle(c, fx + d * 5.5 * s + 2 * s, fy - 4 * s, 2.1 * s, P.nail, 0);
    }
  });
}

/**
 * The trunk.
 *
 * `curl` 0 → hanging down with a gentle S; 1 → curled up to the mouth.
 * The path is interpolated in CONTROL-POINT space rather than by rotating a
 * rigid shape, so partial curls are all valid poses and the motion between them
 * is continuous. Combined with the spring driving `curl`, the trunk never
 * teleports and never eases in a way that looks mechanical.
 */
function drawTrunk(c, P, bx, by, s, curl, beat, walking, chew, carrying) {
  const sway = Math.sin((beat - 0.2) * Math.PI) * 0.10 * walking;

  // Two poses, blended.
  const DOWN = [[0, 0], [6, 16], [4, 33], [-2, 48], [2, 62], [10, 72], [16, 76]];
  const UP = [[0, 0], [10, 12], [20, 18], [26, 8], [22, -6], [10, -12], [-2, -10]];

  const pts = [];
  for (let i = 0; i < DOWN.length; i++) {
    const t = i / (DOWN.length - 1);
    // Segments further from the base lag behind — the curl travels down the
    // trunk instead of the whole thing rotating at once.
    const local = clamp((curl - t * 0.22) / 0.78, 0, 1);
    const e = ease.outCubic(local);
    const px = lerp(DOWN[i][0], UP[i][0], e);
    const py = lerp(DOWN[i][1], UP[i][1], e);
    // Idle sway, strongest at the tip.
    const swayAmt = sway * (1 - curl) * t * 14;
    pts.push([bx + px * s + swayAmt, by + py * s]);
  }

  // Taper: thick at the base, thin at the tip.
  for (let i = 0; i < pts.length - 1; i++) {
    const t = i / (pts.length - 1);
    const w = lerp(17, 6.5, t) * s;
    stroke_(c, [pts[i], pts[i + 1]], w, P.hide);
  }
  for (let i = 0; i < pts.length; i++) {
    const t = i / (pts.length - 1);
    circle(c, pts[i][0], pts[i][1], lerp(8.5, 3.4, t) * s, P.hide, 0);
  }
  // Wrinkle rings — three, only on the upper half, so they read as detail
  // rather than noise.
  for (let i = 1; i <= 3; i++) {
    const p = pts[i];
    const n = pts[i + 1];
    const a = Math.atan2(n[1] - p[1], n[0] - p[0]) + Math.PI / 2;
    const w = lerp(8, 5, i / 4) * s;
    stroke_(c, [
      [p[0] + Math.cos(a) * w, p[1] + Math.sin(a) * w],
      [p[0] - Math.cos(a) * w, p[1] - Math.sin(a) * w],
    ], 2.2 * s, P.hideDark);
  }

  // A fruit held in the tip.
  if (carrying) {
    const tip = pts[pts.length - 1];
    drawFruit(c, P, tip[0], tip[1] - 2 * s, 12 * s * (1 - chew * 0.45), carrying.kind, carrying.spin || 0);
  }

  // Mouth, under the head — opens to receive.
  const my = by + 6 * s;
  if (chew > 0.05) {
    ellipse(c, bx - 12 * s, my, 9 * s, (3 + chew * 5) * s, '#5a2a34', 3 * s);
  }
}

/* ══ THE GROVE ════════════════════════════════════════════════════════════ */

const FRUIT_COLORS = {
  mango: ['#ff9f1c', '#ffbf69'],
  plum: ['#c05299', '#e58fc2'],
  lime: ['#7fb800', '#a8d84f'],
};

/** One piece of fruit. `spin` in radians. */
export function drawFruit(c, P, x, y, r, kind = 'mango', spin = 0, alpha = 1) {
  const [body, light] = FRUIT_COLORS[kind] || FRUIT_COLORS.mango;
  layer(c, () => {
    c.globalAlpha = alpha;
    c.translate(x, y);
    c.rotate(spin);
    ellipse(c, 0, 0, r, r * 0.92, body, r * 0.32);
    ellipse(c, -r * 0.30, -r * 0.30, r * 0.34, r * 0.24, light, 0);
    // Stalk + leaf
    stroke_(c, [[0, -r * 0.86], [r * 0.16, -r * 1.34]], r * 0.17, '#6b4f2a');
    ellipse(c, r * 0.52, -r * 1.30, r * 0.40, r * 0.20, '#5aa832', r * 0.13, -0.5);
  });
}

/**
 * The canopy strip.
 *
 * A continuous band of overlapping leaf blobs rather than discrete trees. That
 * choice is gameplay, not art: fruit positions are dictated by the RHYTHM, so
 * discrete trees would mean fruit regularly hanging in mid-air between them. A
 * continuous canopy guarantees every fruit has foliage behind it, whatever the
 * chart does.
 *
 * @param {number} scroll world scroll in px
 */
export function canopy(c, P, { scroll, w, top = 74, depth = 168, seedBase = 0, sway = 0 }) {
  const SP = 96;
  const first = Math.floor(scroll / SP) - 1;

  // Back layer, darker and offset — gives the foliage thickness.
  for (let pass = 0; pass < 2; pass++) {
    const col = pass === 0 ? P.leafDark : P.leaf;
    const yOff = pass === 0 ? 16 : 0;
    for (let i = first; i < first + Math.ceil(w / SP) + 3; i++) {
      const wx = i * SP - scroll;
      const n = hash(i + seedBase + pass * 31);
      const bx = wx + n * 30;
      const by = top + yOff + n * 26;
      const rx = 74 + n * 38;
      const ry = 44 + n * 22;
      const s2 = Math.sin(sway + i * 0.7) * 3;
      ellipse(c, bx + s2, by, rx, ry, col, 0);
    }
  }

  // Hanging vines, purely decorative, drifting.
  for (let i = first; i < first + Math.ceil(w / SP) + 3; i += 2) {
    const wx = i * SP - scroll;
    const n = hash(i + seedBase + 77);
    if (n < 0.45) continue;
    const len = 40 + n * 70;
    const s2 = Math.sin(sway * 1.3 + i) * 6;
    stroke_(c, [
      [wx, top + depth * 0.5],
      [wx + s2 * 0.5, top + depth * 0.5 + len * 0.6],
      [wx + s2, top + depth * 0.5 + len],
    ], 3.5, P.leafDark);
  }
}

/** Trunks of the trees the canopy belongs to. Drawn behind the elephant. */
export function groveTrunks(c, P, { scroll, w, groundY, sway = 0 }) {
  const SP = 268;
  const first = Math.floor(scroll / SP) - 1;
  for (let i = first; i < first + Math.ceil(w / SP) + 2; i++) {
    const wx = i * SP - scroll;
    const n = hash(i * 3 + 11);
    const tw = 17 + n * 10;
    const s2 = Math.sin(sway + i) * 2;
    layer(c, () => {
      c.globalAlpha = 0.95;
      stroke_(c, [
        [wx, groundY],
        [wx + s2 * 0.4, groundY - 90],
        [wx + s2, 190],
      ], tw, P.bark);
      // Root flare
      poly(c, [
        [wx - tw, groundY + 4], [wx, groundY - 26], [wx + tw, groundY + 4],
      ], P.bark, 0);
    });
  }
}

/** Deterministic 0..1 hash. Same grove every run. */
export function hash(i) {
  const v = Math.sin(i * 127.1 + 43.7) * 43758.5453;
  return v - Math.floor(v);
}

/* ── Ambience ─────────────────────────────────────────────────────────────── */

/** A dust ring kicked up by a stomp. Flat, wide, fast. */
export function dustRing(c, P, { x, y, t }) {
  if (t <= 0 || t >= 1) return;
  const r = ease.outQuint(t) * 96;
  layer(c, () => {
    c.globalAlpha = (1 - t) * (1 - t) * 0.75;
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const spread = 0.5 + i * 0.28;
        ellipse(c, x + dir * r * spread, y - i * 5 - t * 12,
          (16 - i * 3) * (1 - t * 0.4), (9 - i * 2) * (1 - t * 0.4), P.dust, 0);
      }
    }
  });
}

/** Little birds crossing the sky. Pure ambience, never beat-locked. */
export function birds(c, P, { t, w }) {
  layer(c, () => {
    c.globalAlpha = 0.4;
    c.strokeStyle = P.ink2 || INK;
    c.lineWidth = 2.4;
    for (let i = 0; i < 5; i++) {
      const n = hash(i * 13);
      const x = ((t * (26 + n * 20) + n * w * 2) % (w + 120)) - 60;
      const y = 46 + n * 60 + Math.sin(t * 1.4 + i) * 5;
      const flap = Math.sin(t * 6 + i * 2) * 4;
      c.beginPath();
      c.moveTo(x - 8, y + flap);
      c.quadraticCurveTo(x, y - 4, x + 8, y + flap);
      c.stroke();
    }
  });
}
