/**
 * Folks — the little humanoids.
 *
 * ── The design brief ─────────────────────────────────────────────────────────
 *
 * Rhythm Heaven characters are almost aggressively simple: a bean, two dots, and
 * whatever single prop identifies the job. They read at any size, they're
 * instantly readable in silhouette, and — crucially — they can be *deformed*
 * without breaking, because there's no anatomy to violate.
 *
 * That last point is the whole reason for drawing them this way. A character
 * that can squash to 70% height and stretch to 130% on a single beat has an
 * enormous amount of expressive bandwidth for free. A carefully proportioned
 * character can't do that without looking broken.
 *
 * ── The one rule that governs every function here ────────────────────────────
 *
 * A character's animation is allowed to be EXPRESSIVE but is never allowed to
 * be the player's PRIMARY TIMING SOURCE.
 *
 * This is the single most misunderstood thing about Rhythm Heaven, and it's
 * deliberate: the animations are often slightly out of sync with the beat, so
 * players who try to watch instead of listen do measurably worse. The audio is
 * the instruction set. Visuals confirm and reward, they don't instruct.
 *
 * So: characters here react ON or AFTER the beat, never in anticipation of a
 * note the player is about to be asked for. Where you see an anticipation pose
 * below, it belongs to a CALL (something the game is playing at you, which the
 * player is meant to hear), never to a RESPONSE (something the player owes).
 */

import {
  circle, ellipse, roundRect, poly, blob, stroke_, star, eye, mouth, blush,
  layer, INK, ease, clamp, lerp,
} from './shapes.js';

const TAU = Math.PI * 2;

/**
 * Squash-and-stretch around the feet, volume-preserving.
 * Widening by k narrows by 1/k — otherwise "squash" just reads as "bigger".
 */
export function squashAt(c, x, groundY, squash) {
  c.translate(x, groundY);
  c.scale(squash, 1 / squash);
  c.translate(-x, -groundY);
}

/**
 * The house body. Everything else in this file is this plus a hat.
 *
 * @param {object} o
 * @param {number} o.squash   1 = neutral, >1 squat, <1 stretched
 * @param {number} o.lean     radians, pivots at the feet
 * @param {number} o.armL/armR arm angle, 0 = down at side, -1.4 ≈ straight up
 * @param {number} o.legSplit how far the feet are apart (mid-stride)
 * @param {number} o.mood     -1 miserable … 1 delighted
 */
export function folk(c, {
  x, y, s = 1, squash = 1, lean = 0,
  body = '#ffd9a0', trim = '#ff8fa3', skin = '#ffe7cd',
  armL = 0.35, armR = 0.35, legSplit = 0, lift = [0, 0],
  mood = 1, open = 0, blink = 0, look = [0, 0],
  hat = null, hatColor = '#4ec9a5',
}) {
  const H = 46 * s;      // body height
  const W = 20 * s;      // body half-width

  layer(c, () => {
    c.translate(x, y);
    c.rotate(lean);
    c.translate(-x, -y);
    squashAt(c, x, y, squash);

    // ── Legs. Stubby, no knees; the foot position does all the work.
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const fx = x + side * (5 * s + legSplit * 0.5);
      const fy = y - lift[i] * s;
      stroke_(c, [[x + side * 4 * s, y - 16 * s], [fx, fy - 4 * s]], 7 * s, skin);
      // Boot
      ellipse(c, fx, fy - 1.5 * s, 8 * s, 5 * s, trim, 3.5 * s);
    }

    // ── Body: a bean.
    ellipse(c, x, y - H * 0.62, W, H * 0.46, body, 5 * s);

    // ── Arms.
    for (const [side, ang] of [[-1, armL], [1, armR]]) {
      const sx = x + side * W * 0.85;
      const sy = y - H * 0.72;
      const a = -Math.PI / 2 + side * (Math.PI / 2 - ang);
      const ex = sx + Math.cos(a) * 17 * s;
      const ey = sy + Math.sin(a) * 17 * s;
      stroke_(c, [[sx, sy], [(sx + ex) / 2 + side * 3 * s, (sy + ey) / 2], [ex, ey]], 6 * s, skin);
      circle(c, ex, ey, 4.2 * s, skin, 0);
    }

    // ── Head: big, round, most of the character.
    const hy = y - H - 12 * s;
    circle(c, x, hy, 20 * s, skin, 5 * s);

    // Face. Two dots and a line — that's the entire emotional range needed.
    eye(c, x - 7.5 * s, hy - 1 * s, 4.6 * s, blink, look);
    eye(c, x + 7.5 * s, hy - 1 * s, 4.6 * s, blink, look);
    mouth(c, x, hy + 9 * s, 10 * s, mood, open, 3 * s);
    blush(c, x - 14 * s, hy + 4 * s, 5 * s, 0.4);
    blush(c, x + 14 * s, hy + 4 * s, 5 * s, 0.4);

    if (hat) hats[hat]?.(c, x, hy - 18 * s, s, hatColor);
  });
}

/** Props that identify the job. Deliberately one silhouette each. */
const hats = {
  /** Rain hat with a floppy brim — Puddle Hop. */
  sou(c, x, y, s, col) {
    ellipse(c, x, y + 8 * s, 26 * s, 7 * s, col, 4.5 * s);
    blob(c, [
      [x - 15 * s, y + 8 * s], [x - 13 * s, y - 6 * s],
      [x, y - 13 * s], [x + 13 * s, y - 6 * s], [x + 15 * s, y + 8 * s],
    ], col, 4.5 * s);
    stroke_(c, [[x - 10 * s, y + 10 * s], [x - 8 * s, y + 22 * s]], 3 * s, col);
  },
  /** Leaf sprout — Choir. */
  sprout(c, x, y, s, col) {
    stroke_(c, [[x, y + 8 * s], [x, y - 4 * s]], 4 * s, '#5aa832');
    for (const side of [-1, 1]) {
      layer(c, () => {
        c.translate(x, y - 2 * s);
        c.rotate(side * 0.7);
        ellipse(c, side * 10 * s, 0, 11 * s, 6 * s, col, 3.5 * s);
      });
    }
  },
  /** Courier's crash helmet with a visor. */
  helmet(c, x, y, s, col) {
    c.save();
    c.beginPath();
    c.arc(x, y + 14 * s, 21 * s, Math.PI, TAU);
    c.fillStyle = col; c.fill();
    c.lineWidth = 5 * s; c.strokeStyle = INK; c.stroke();
    c.restore();
    roundRect(c, x - 21 * s, y + 12 * s, 42 * s, 6 * s, 3 * s, col, 4 * s);
    // Antenna with a bobble — sells "courier", and it wobbles.
    stroke_(c, [[x + 12 * s, y], [x + 18 * s, y - 14 * s]], 3 * s, INK);
    circle(c, x + 18 * s, y - 16 * s, 4 * s, '#ff2e88', 3 * s);
  },
  /** Conductor's tall cap. */
  cap(c, x, y, s, col) {
    roundRect(c, x - 15 * s, y - 2 * s, 30 * s, 18 * s, 4 * s, col, 4.5 * s);
    ellipse(c, x + 6 * s, y + 16 * s, 20 * s, 5 * s, col, 4 * s);
  },
};

/* ══ PUDDLE HOP ═══════════════════════════════════════════════════════════ */

/**
 * Pip — the stepping guy.
 *
 * `stride` is 0..1 through a single step: 0 is the instant of the footfall,
 * 1 is just before the next one. The arc is front-loaded — the foot travels
 * fast and *arrives*, rather than gliding. Gliding motion reads as floaty and
 * makes the landing moment ambiguous, which is fatal when the landing IS the
 * beat.
 */
export function pip(c, P, { x, y, s = 1, stride = 1, footL = true, splash = 0, hop = 0, mood = 1, blink = 0, look = [0, 0], carry = 0 }) {
  const t = clamp(stride, 0, 1);
  // Landing impact: hard squash for the first ~12% of the step, then recover.
  const squash = t < 0.12 ? lerp(1.30, 1, t / 0.12) : 1 - 0.06 * Math.sin((t - 0.12) * 3.1);
  // Swing leg lifts and plants.
  const swing = Math.sin(Math.min(t * 1.15, 1) * Math.PI) * 13;
  const hopUp = hop * 26 * s;

  const lift = footL ? [0, swing] : [swing, 0];

  layer(c, () => {
    c.translate(0, -hopUp);

    // Shadow shrinks as he leaves the ground — the only depth cue he needs.
    ellipse(c, x, y + 3 * s, 16 * s * (1 - hop * 0.35), 5 * s * (1 - hop * 0.5),
      'rgba(29,21,38,0.22)', 0);

    folk(c, {
      x, y, s,
      squash,
      lean: 0.06 + hop * 0.10,
      body: P.body, trim: P.trim, skin: P.skin,
      hat: 'sou', hatColor: P.hatColor,
      armL: 0.5 + swing * 0.02 + hop * 0.8,
      armR: 0.5 - swing * 0.02 + hop * 0.8,
      legSplit: 8 * (1 - Math.abs(t - 0.5) * 2) * s,
      lift,
      mood: hop > 0.05 ? 1 : mood,
      blink, look,
      open: hop > 0.4 ? 0.6 : 0,
    });
  });

  // Splash — the failure state, and the level's whole comedy engine.
  if (splash > 0.01) {
    const st = 1 - splash;
    layer(c, () => {
      c.globalAlpha = splash;
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI + (i / 8) * Math.PI;
        const d = st * 44 * s;
        const dx = x + Math.cos(a) * d;
        const dy = y - Math.abs(Math.sin(a)) * d * 0.7 + st * st * 30 * s;
        ellipse(c, dx, dy, (5 - st * 3) * s, (7 - st * 4) * s, P.water, 0);
      }
    });
  }
}

/** A puddle on the path. `depth` is cosmetic; `w` sets how far Pip must clear. */
export function puddle(c, P, { x, y, w, ripple = 0 }) {
  ellipse(c, x, y, w / 2, w * 0.16, P.water, 4);
  ellipse(c, x, y - 2, w / 2 - 6, w * 0.10, P.waterLight, 0);
  if (ripple > 0.01) {
    layer(c, () => {
      c.globalAlpha = ripple;
      c.strokeStyle = P.waterLight;
      c.lineWidth = 3;
      for (const k of [0.5, 0.85]) {
        const r = (1 - ripple) * w * k;
        c.beginPath();
        c.ellipse(x, y, r, r * 0.3, 0, 0, TAU);
        c.stroke();
      }
    });
  }
}

/**
 * The crow — the CALL. This character is allowed to telegraph, because
 * telegraphing is its entire job: it caws the rhythm the player will repeat.
 * Its beak opens ON each caw, which is a confirmation of a sound the player is
 * already hearing, not a prediction of one they must produce.
 */
export function crow(c, P, { x, y, s = 1, caw = 0, beat = 0, blink = 0 }) {
  const bob = Math.sin(beat * Math.PI) * 2 * s;
  const puff = 1 + caw * 0.16;
  layer(c, () => {
    c.translate(0, bob);
    // Perch
    stroke_(c, [[x, y + 10 * s], [x, y + 74 * s]], 7 * s, P.post);
    ellipse(c, x, y + 76 * s, 14 * s, 5 * s, P.post, 0);

    // Body
    ellipse(c, x, y - 12 * s * puff, 17 * s * puff, 19 * s * puff, '#2c2438', 4.5 * s);
    // Tail
    poly(c, [[x + 12 * s, y - 8 * s], [x + 34 * s, y + 4 * s], [x + 13 * s, y + 2 * s]], '#2c2438', 4 * s);
    // Head
    const hy = y - 34 * s * puff;
    circle(c, x - 3 * s, hy, 12 * s, '#2c2438', 4.5 * s);
    // Beak — opens on the caw
    const gape = caw * 7 * s;
    poly(c, [[x - 13 * s, hy - 1 * s], [x - 30 * s, hy - 2 * s - gape * 0.4], [x - 13 * s, hy + 3 * s]], '#ffb03a', 3.5 * s);
    if (caw > 0.1) {
      poly(c, [[x - 13 * s, hy + 2 * s], [x - 28 * s, hy + 3 * s + gape], [x - 13 * s, hy + 6 * s]], '#ffb03a', 3.5 * s);
    }
    eye(c, x - 5 * s, hy - 2 * s, 4 * s, blink, [-0.4, 0], '#ffd23f');

    // Sound rings, so the caw has a visible footprint at the moment it sounds.
    if (caw > 0.02) {
      layer(c, () => {
        c.globalAlpha = caw * 0.55;
        c.strokeStyle = P.callColor;
        c.lineWidth = 3.5;
        for (const k of [1, 1.6]) {
          const r = (1 - caw) * 40 * k * s + 14 * s;
          c.beginPath();
          c.arc(x - 26 * s, hy, r, Math.PI * 0.72, Math.PI * 1.28);
          c.stroke();
        }
      });
    }
  });
}

/* ══ CHOIR ════════════════════════════════════════════════════════════════ */

/**
 * A choir sprout. `sing` 0..1 is the envelope of a sung note — it opens fast and
 * closes slowly, matching the sound.
 */
export function sprout(c, P, { x, y, s = 1, sing = 0, wilt = 0, blink = 0, sway = 0, mood = 1 }) {
  const stretch = 1 - sing * 0.14 + wilt * 0.10;
  layer(c, () => {
    folk(c, {
      x, y, s,
      squash: stretch,
      lean: sway * 0.05 - wilt * 0.18,
      body: P.body, trim: P.trim, skin: P.skin,
      hat: 'sprout', hatColor: P.leaf,
      armL: 0.3 + sing * 0.5, armR: 0.3 + sing * 0.5,
      mood: wilt > 0.3 ? -0.6 : mood,
      open: sing,
      blink: wilt > 0.3 ? 0.9 : blink,
      look: [0, -sing * 0.3],
    });
  });
}

/** A sung note drifting upward. Rendered by the stage, one per successful tap. */
export function noteWisp(c, { x, y, life, color, glyph = '♪', size = 22 }) {
  const t = 1 - life;
  layer(c, () => {
    c.globalAlpha = clamp((1 - t) * 1.6, 0, 1);
    c.translate(x + Math.sin(t * 5) * 12, y - t * 70);
    c.rotate(Math.sin(t * 4) * 0.25);
    c.font = `bold ${size * (1 + t * 0.3)}px "Trebuchet MS", Verdana, sans-serif`;
    c.textAlign = 'center';
    c.lineWidth = 4;
    c.strokeStyle = INK;
    c.strokeText(glyph, 0, 0);
    c.fillStyle = color;
    c.fillText(glyph, 0, 0);
  });
}

/**
 * The choirmaster — round, imperious, and the source of every CALL phrase.
 * His baton swings on the beat as a metronome the player can use, which is
 * legitimate: it marks the PULSE, not the notes. Knowing where the beat is has
 * never been the hard part; knowing which beats to play is.
 */
export function choirmaster(c, P, { x, y, s = 1, phase = 0, sing = 0, blink = 0, point = 0 }) {
  const bob = Math.pow(1 - phase, 3) * 5 * s;
  const baton = -0.9 + Math.sin(phase * TAU) * 1.0;

  layer(c, () => {
    c.translate(0, -bob);
    folk(c, {
      x, y, s: s * 1.35,
      squash: 1 + sing * 0.06,
      body: P.masterBody, trim: P.masterTrim, skin: P.skin,
      hat: 'cap', hatColor: P.masterTrim,
      armL: 0.2 + point * 1.1,
      armR: 1.1,
      mood: 1, open: sing, blink,
      look: [-0.4, 0],
    });
    // Baton
    const sx = x - 30 * s, sy = y - 76 * s;
    stroke_(c, [[sx, sy], [sx + Math.cos(baton) * 40 * s, sy + Math.sin(baton) * 40 * s]], 4 * s, '#fff6e0');
  });
}

/* ══ ROCKET COURIER ═══════════════════════════════════════════════════════ */

/**
 * The courier. `brace` is the catch pose, `caught` the follow-through.
 *
 * Note there is NO anticipation animation. She reacts to the player, never
 * ahead of them — because if she leaned toward an incoming parcel before it was
 * catchable, that lean would become the cue, and the whistle would stop
 * mattering. That is precisely the failure this whole rebuild is avoiding.
 */
export function courier(c, P, { x, y, s = 1, brace = 0, caught = 0, fumble = 0, phase = 0, blink = 0, stack = 0 }) {
  const bob = Math.pow(1 - phase, 4) * 4 * s;
  layer(c, () => {
    c.translate(0, -bob);

    // Parcels already caught, stacked on her back. Visible progress.
    for (let i = 0; i < Math.min(stack, 6); i++) {
      roundRect(c, x - 34 * s, y - 26 * s - i * 11 * s, 22 * s, 11 * s, 3 * s,
        i % 2 ? P.parcelB : P.parcelA, 3.5 * s);
    }

    folk(c, {
      x, y, s,
      squash: 1 + brace * 0.16 - caught * 0.10,
      lean: -brace * 0.12 + fumble * 0.3,
      body: P.body, trim: P.trim, skin: P.skin,
      hat: 'helmet', hatColor: P.hatColor,
      // Arms come UP on the catch, and only on the catch.
      armL: 0.4 + caught * 1.0,
      armR: 0.4 + caught * 1.15,
      mood: fumble > 0.3 ? -0.8 : 1,
      open: caught > 0.4 ? 0.7 : 0,
      blink: fumble > 0.3 ? 0.9 : blink,
      look: [0.5, -0.2],
    });
  });
}

/**
 * A parcel in flight.
 *
 * DELIBERATELY UNRELIABLE. Each parcel gets a randomised-but-deterministic arc
 * height and spin from its seed, so two parcels arriving on the same beat look
 * completely different in the air. The whistle that accompanies it is always
 * exactly one beat early, at a fixed pitch.
 *
 * A player who watches the arc will be inconsistent. A player who listens will
 * be perfect. That is the entire thesis of the level, implemented right here.
 *
 * @param {number} t 0 = launch, 1 = arrival at the courier
 */
export function parcel(c, P, { x0, y0, x1, y1, t, seed = 0, kind = 'A' }) {
  if (t < 0 || t > 1.25) return;
  const k = ((Math.sin(seed * 91.7) + 1) / 2);
  const arc = 120 + k * 190;                    // varies a LOT, on purpose
  const x = lerp(x0, x1, t);
  const y = lerp(y0, y1, t) - Math.sin(Math.PI * clamp(t, 0, 1)) * arc;
  const spin = (seed * 1.7 + t * (3 + k * 5)) * TAU;
  const sz = 15 + k * 5;

  layer(c, () => {
    c.translate(x, y);
    c.rotate(spin);
    roundRect(c, -sz, -sz * 0.72, sz * 2, sz * 1.44, 4,
      kind === 'A' ? P.parcelA : P.parcelB, 4.5);
    // String cross
    stroke_(c, [[-sz, 0], [sz, 0]], 3.5, INK);
    stroke_(c, [[0, -sz * 0.72], [0, sz * 0.72]], 3.5, INK);
  });
}
