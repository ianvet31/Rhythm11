/**
 * Stage — Mango Stomp.
 *
 * ── The one equation ─────────────────────────────────────────────────────────
 *
 *      fruitScreenX = FRUIT_LINE + (note.time − songTime) × SCROLL_PX_PER_SEC
 *
 * Constant pixels per SECOND, not per beat. Everything in the scene — canopy,
 * trunks, grass, fruit — moves by that same number, so the grove is rigid: fruit
 * never slides relative to the leaves behind it, and the horizontal gap between
 * two fruit is exactly proportional to the gap between two notes. That rigidity
 * is what lets the player read the trees as notation without ever being told to.
 *
 * ── How the feel is built ────────────────────────────────────────────────────
 *
 * Four techniques, in rough order of how much they contribute:
 *
 * 1. FIXED FALL TIME. A fruit hanging high and one hanging low take exactly the
 *    same 0.22s to reach the trunk, achieved by solving for the gravity each
 *    one needs. Physically that's a cheat. But hang height is randomised purely
 *    to look natural, and if it changed the fall time then the reward for a
 *    perfect stomp would arrive at a different moment every time. Consistency
 *    of feedback beats consistency of physics, every time.
 *
 * 2. SPRINGS ON EVERY POSE. Trunk curl, head tilt and body lean are damped
 *    springs (see render/beasts.js). They carry velocity, so they overshoot
 *    slightly and settle, and they can be re-targeted mid-flight without a
 *    discontinuity — which matters because sixteenth pairs re-target the trunk
 *    140ms apart and a tween would visibly restart.
 *
 * 3. STAGGERED IMPACT. On a stomp the dust, the shake, the squash and the
 *    fruit's release do not all fire on the same frame. The fruit is knocked
 *    loose ~30ms after contact, because the shockwave has to travel up the
 *    tree. That tiny delay is the difference between "two things happened" and
 *    "one thing caused another".
 *
 * 4. NOTHING SNAPS. No position in this file is ever assigned directly from an
 *    event; everything is an envelope or a spring evaluated from elapsed time,
 *    so a dropped frame degrades smoothly instead of teleporting.
 *
 * ── Cue audit ────────────────────────────────────────────────────────────────
 *
 *   FRUIT POSITION   a reliable spatial timing cue. This level deliberately
 *                    breaks the house rule; see the long note in
 *                    game/levels/grove.js for why that's a considered choice.
 *   FRUIT HEIGHT     random, seeded, meaningless. Scatter, not signal.
 *   MARIMBA CALL     sounds one bar before each cluster and plays its exact
 *                    figure. The level is playable with the screen off.
 *   WALK CYCLE       locked to beat phase. Shows the PULSE, not the notes.
 *   STOMP / CHEW     reaction only, never anticipation.
 */

import { Stage } from '../stage.js';
import { VW, VH } from '../../render/view.js';
import {
  circle, ellipse, roundRect, poly, stroke_, star, boldText, layer,
  INK, ease, clamp, lerp,
} from '../../render/shapes.js';
import {
  Spring, elephant, drawFruit, canopy, groveTrunks, dustRing, birds, hash,
} from '../../render/beasts.js';

const ELEPHANT_X = 240;
const GROUND_Y = 430;
/** Where a fruit sits at the exact instant its note is due. Above her head. */
const FRUIT_LINE = 310;

const CANOPY_TOP = 58;
/** Fruit hang inside this vertical band, at random-but-fixed heights. */
const HANG_MIN = 150;
const HANG_MAX = 246;

const FRUIT_R = 13;
/** See note 1 above. */
const FALL_TIME = 0.22;
/** The shockwave takes this long to travel up the tree. */
const KNOCK_DELAY = 0.03;

const TRUNK_TIP_DX = 74;
const TRUNK_TIP_DY = -96;

export class GroveStage extends Stage {
  constructor(P, data) {
    super(P, data);
    this.pxPerSec = data.level.scrollPxPerSec;

    // Pre-resolve hang heights so they're stable and cheap.
    for (const n of this.notes) {
      n._hangY = lerp(HANG_MIN, HANG_MAX, hash(n.hangSeed ?? 0));
      n._spin = (hash((n.hangSeed ?? 0) + 91) - 0.5) * 0.7;
    }

    this.trunk = new Spring(0, 210, 26);
    this.head = new Spring(0, 190, 20);
    this.lean = new Spring(0, 150, 19);
    this.reset();
  }

  reset() {
    super.reset();
    this.animTime = 0;
    this.songTime = 0;
    this.stompAt = -9;
    this.eatAt = -9;
    this.callAt = -9;
    this.missAt = -9;
    this.fallers = [];
    this.eaten = 0;
    this.carrying = null;
    this.trunk?.set(0);
    this.head?.set(0);
    this.lean?.set(0);
  }

  /* ── Reactions ─────────────────────────────────────────────────────────── */

  onCue(cue) {
    if (cue.kind === 'call') this.callAt = this.animTime;
  }

  onJudge(note, grade) {
    this.stompAt = this.animTime;

    if (grade === 'miss' || grade === 'holdbreak') {
      // She stomps nothing, the fruit stays put and sails past. A beat later it
      // drops behind her and splats — the consequence arrives late, which reads
      // as "you missed it" rather than "the game buzzed at you".
      this.missAt = this.animTime;
      this.lean.target = -0.05;
      this.fallers.push({
        t0: this.animTime + 0.30,
        x0: FRUIT_LINE, y0: note._hangY,
        x1: FRUIT_LINE - 120, y1: GROUND_Y - 6,
        kind: note.kind, spin: note._spin, miss: true, dur: 0.42,
      });
      return;
    }

    // Knock it loose, slightly after the foot lands.
    this.fallers.push({
      t0: this.animTime + KNOCK_DELAY,
      x0: FRUIT_LINE, y0: note._hangY,
      x1: ELEPHANT_X + TRUNK_TIP_DX, y1: GROUND_Y + TRUNK_TIP_DY,
      kind: note.kind, spin: note._spin, miss: false, dur: FALL_TIME,
      finale: !!note.finale,
    });

    // Reach up to meet it. Retargeting a spring mid-flight is safe, which is
    // what makes overlapping sixteenth pairs look deliberate rather than jittery.
    this.trunk.target = 1;
    this.head.target = -0.10;
    this.lean.target = 0.03;
  }

  focus() { return { x: ELEPHANT_X + 40, y: GROUND_Y - 110 }; }

  /* ── Update ────────────────────────────────────────────────────────────── */

  update(dt, adt, t) {
    super.update(dt, adt, t);
    this.animTime += adt;
    this.songTime = t.songTime;

    // Land any fruit that has arrived.
    for (let i = this.fallers.length - 1; i >= 0; i--) {
      const f = this.fallers[i];
      const u = (this.animTime - f.t0) / f.dur;
      if (u < 1) continue;
      if (!f.miss) {
        this.eatAt = this.animTime;
        this.eaten++;
        this.carrying = { kind: f.kind, spin: f.spin };
      }
      this.fallers.splice(i, 1);
    }

    // Release the pose once she's chewed. Targets, not assignments — the spring
    // does the travelling.
    const chewing = Stage.since(this.animTime, this.eatAt, 0.34);
    if (chewing <= 0) {
      this.trunk.target = 0;
      this.head.target = 0;
      this.lean.target = 0;
      this.carrying = null;
    }

    this.trunk.step(adt);
    this.head.step(adt);
    this.lean.step(adt);
  }

  /* ── Draw ──────────────────────────────────────────────────────────────── */

  draw(c, t) {
    const P = this.P;
    const now = this.animTime;
    const scroll = this.songTime * this.pxPerSec;
    const sway = now * 0.6;

    this._sky(c, P, now);
    birds(c, P, { t: now, w: VW });
    this._hills(c, P, scroll);

    groveTrunks(c, P, { scroll, w: VW, groundY: GROUND_Y - 10, sway });
    this._ground(c, P, scroll);

    // Canopy behind the fruit, so fruit always reads as hanging IN it.
    canopy(c, P, { scroll, w: VW, top: CANOPY_TOP, sway });

    this._fruitOnTrees(c, P);

    const stomp = Stage.since(now, this.stompAt, 0.26);
    const chew = Stage.since(now, this.eatAt, 0.34);

    dustRing(c, P, { x: ELEPHANT_X + 30, y: GROUND_Y + 2, t: 1 - stomp });

    elephant(c, P, {
      x: ELEPHANT_X, y: GROUND_Y, s: 1.0,
      phase: t.phase, beat: t.beat,
      stomp,
      trunkCurl: clamp(this.trunk.value, 0, 1.15),
      chew,
      headTilt: this.head.value,
      lean: this.lean.value,
      walking: 1,
      blink: this.blink,
      carrying: this.carrying,
    });

    this._fallers(c, P);
    this._grassFore(c, P, scroll);

    // Tally, bottom-left, deliberately tiny.
    if (this.eaten > 0) {
      layer(c, () => {
        c.globalAlpha = 0.75;
        drawFruit(c, P, 34, VH - 34, 11, 'mango', -0.2);
        boldText(c, `×${this.eaten}`, 58, VH - 33, 20, P.cue, INK, 'left');
      });
    }
  }

  /* ── Scenery ───────────────────────────────────────────────────────────── */

  _sky(c, P, now) {
    const g = c.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, P.skyTop);
    g.addColorStop(1, P.skyBot);
    c.fillStyle = g;
    c.fillRect(0, 0, VW, VH);

    // Big retro sun with concentric rings. Static — it's the one thing in the
    // scene that doesn't move, which is what makes everything else feel like
    // it's moving.
    const sx = 760, sy = 210;
    circle(c, sx, sy, 96, P.sun, 0);
    layer(c, () => {
      c.globalAlpha = 0.30;
      c.strokeStyle = P.sunRing;
      for (let i = 1; i <= 4; i++) {
        c.lineWidth = 7 - i;
        c.beginPath();
        c.arc(sx, sy, 96 + i * 26, 0, Math.PI * 2);
        c.stroke();
      }
    });
    // Halftone-ish bands across the sun's lower half.
    layer(c, () => {
      c.beginPath(); c.arc(sx, sy, 96, 0, Math.PI * 2); c.clip();
      c.fillStyle = P.skyBot;
      for (let i = 0; i < 7; i++) c.fillRect(sx - 96, sy + 14 + i * 12, 192, 2 + i * 0.8);
    });
  }

  _hills(c, P, scroll) {
    for (const [k, col, base] of [[0.10, P.far, 320], [0.20, P.mid, 352], [0.34, P.near, 380]]) {
      const off = (scroll * k) % 340;
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(-40, VH);
      for (let x = -40; x <= VW + 60; x += 20) {
        const wx = x + off;
        c.lineTo(x, base - 34 * Math.sin(wx * 0.0055) - 16 * Math.sin(wx * 0.016 + 1.4));
      }
      c.lineTo(VW + 60, VH);
      c.closePath();
      c.fill();
    }
  }

  _ground(c, P, scroll) {
    c.fillStyle = P.ground;
    c.fillRect(0, GROUND_Y - 8, VW, VH - GROUND_Y + 8);
    c.fillStyle = P.groundDark;
    c.fillRect(0, GROUND_Y + 40, VW, VH - GROUND_Y - 40);
    stroke_(c, [[0, GROUND_Y - 8], [VW, GROUND_Y - 8]], 4, P.ink2);

    // Mid-distance grass, scrolling with the world.
    const SP = 34;
    const first = Math.floor(scroll / SP) - 1;
    for (let i = first; i < first + Math.ceil(VW / SP) + 3; i++) {
      const x = i * SP - scroll;
      const n = hash(i * 5 + 3);
      if (n < 0.35) continue;
      const h = 8 + n * 12;
      layer(c, () => {
        c.globalAlpha = 0.75;
        for (const d of [-1, 0, 1]) {
          stroke_(c, [[x + d * 4, GROUND_Y - 6], [x + d * 7, GROUND_Y - 6 - h]], 2.6, P.grass);
        }
      });
    }
  }

  /** Foreground grass — scrolls faster, sells depth, and hides her feet a bit. */
  _grassFore(c, P, scroll) {
    const SP = 58;
    const s2 = scroll * 1.5;
    const first = Math.floor(s2 / SP) - 1;
    for (let i = first; i < first + Math.ceil(VW / SP) + 3; i++) {
      const x = i * SP - s2;
      const n = hash(i * 7 + 19);
      const h = 20 + n * 26;
      layer(c, () => {
        c.globalAlpha = 0.9;
        for (const d of [-1, 0, 1, 2]) {
          stroke_(c, [
            [x + d * 7, VH],
            [x + d * 7 + (d - 0.5) * 4, VH - h * 0.6],
            [x + d * 9 + (d - 0.5) * 7, VH - h],
          ], 4, P.near);
        }
      });
    }
  }

  /* ── Fruit ─────────────────────────────────────────────────────────────── */

  _fruitOnTrees(c, P) {
    const now = this.animTime;
    // The canopy shivers briefly when the marimba calls — a visual echo of the
    // audio telegraph, on the leaves rather than on any individual fruit.
    const shiver = Stage.since(now, this.callAt, 0.30);

    for (const n of this.notes) {
      if (n.judged) continue;
      const dt = n.time - this.songTime;
      const x = FRUIT_LINE + dt * this.pxPerSec;
      if (x < -40 || x > VW + 60) continue;

      // Gentle idle bob so the fruit feels hung rather than pasted on. Small
      // enough that it can never be mistaken for a timing signal.
      const bob = Math.sin(now * 1.6 + n.hangSeed) * 1.8 + shiver * Math.sin(now * 40) * 2.2;
      const y = n._hangY + bob;

      // Stalk up into the leaves.
      stroke_(c, [[x, y - FRUIT_R], [x - 2, y - FRUIT_R - 14]], 2.6, P.leafDark);
      drawFruit(c, P, x, y, FRUIT_R, n.kind, n._spin);
    }
  }

  _fallers(c, P) {
    const now = this.animTime;
    for (const f of this.fallers) {
      const u = (now - f.t0) / f.dur;
      if (u < 0 || u > 1) continue;

      // Horizontal: linear. Vertical: quadratic, i.e. constant acceleration —
      // gravity solved so that the fall lands in exactly `dur` regardless of
      // how high the fruit hung. See note 1 at the top of this file.
      const x = lerp(f.x0, f.x1, u);
      const y = lerp(f.y0, f.y1, u * u);
      const spin = f.spin + u * (f.miss ? 7 : 4.5);

      drawFruit(c, P, x, y, FRUIT_R * (f.finale ? 1.5 : 1), f.kind, spin);

      // A short motion trail. Two ghosts is enough to read as speed; more
      // starts to look like a bug.
      for (const lag of [0.12, 0.24]) {
        const lu = u - lag;
        if (lu <= 0) continue;
        drawFruit(
          c, P,
          lerp(f.x0, f.x1, lu), lerp(f.y0, f.y1, lu * lu),
          FRUIT_R * (1 - lag * 1.6), f.kind, spin - lag * 4,
          0.30 - lag,
        );
      }
    }

    // Splat for fruit that hit the dirt.
    const splat = Stage.since(now, this.missAt + 0.72, 0.4);
    if (splat > 0) {
      layer(c, () => {
        c.globalAlpha = splat * 0.8;
        const r = (1 - splat) * 26;
        for (let i = 0; i < 6; i++) {
          const a = Math.PI + (i / 5) * Math.PI;
          ellipse(c, FRUIT_LINE - 120 + Math.cos(a) * r, GROUND_Y - 4 + Math.sin(a) * r * 0.3,
            4 - splat * 2, 3, P.hot, 0);
        }
      });
    }
  }
}
