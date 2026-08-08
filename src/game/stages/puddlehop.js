/**
 * Stage — Puddle Hop.
 *
 * ── What the player actually sees ────────────────────────────────────────────
 *
 * A side-on view of a wet park path. Pip stands at a fixed screen position and
 * the WORLD scrolls past him, one stride per successful step. That inversion
 * matters: it means a missed step reads instantly as "the world stopped", which
 * is a much stronger failure signal than a character falling behind a scroll.
 *
 * ── Cue audit ────────────────────────────────────────────────────────────────
 *
 * Honest, per the rules in stage.js:
 *
 *   CROW CAWS       animate exactly when the caw sounds. This is a CALL — the
 *                   player is hearing it. Confirming audio is allowed.
 *   CROW POINTS     fires half a beat before the response bar. Marks the
 *                   handover, not any individual note's timing.
 *   PIP'S STEP      happens when the player taps. Pure reaction, zero
 *                   anticipation. Pip never leans toward a beat he owes.
 *   PUDDLES         visible ahead of time. They are scenery and a joke, and
 *                   they cannot be used for timing: the water tells you a
 *                   triplet is coming *somewhere*, which you already knew from
 *                   the crow. It does not tell you when.
 *   RAIN, TREES     continuous drift, never beat-locked.
 *
 * Nothing here reliably predicts a note the player still owes.
 */

import { Stage } from '../stage.js';
import { VW, VH } from '../../render/view.js';
import {
  circle, ellipse, roundRect, poly, blob, stroke_, star, boldText, layer,
  INK, ease, clamp, lerp,
} from '../../render/shapes.js';
import { pip, puddle, crow } from '../../render/folks.js';

const STRIDE = 62;        // world px per step
const PIP_X = 360;
const GROUND_Y = 430;

export class PuddleHopStage extends Stage {
  constructor(P, data) {
    super(P, data);

    // Precompute the world layout from the chart, so scenery and rhythm agree
    // by construction rather than by me eyeballing coordinates.
    this.stones = [];
    this.puddles = [];
    this.notes.forEach((n, i) => {
      const wx = i * STRIDE;
      this.stones.push({ wx, hop: !!n.hop });
      // A puddle sits in the gap BEFORE a hop step — that's the gap being
      // cleared. Merge consecutive hops into one wider pool.
      if (n.hop) {
        const last = this.puddles[this.puddles.length - 1];
        if (last && wx - last.end <= STRIDE * 1.2) last.end = wx;
        else this.puddles.push({ start: wx - STRIDE, end: wx });
      }
    });

    this.reset();
  }

  reset() {
    super.reset();
    this.stepIndex = 0;       // how many steps Pip has taken
    this.scroll = 0;          // smoothed world offset
    this.lastStepAt = -9;     // animTime of the most recent step
    this.lastStepDur = 0.5;
    this.footL = true;
    this.hopping = 0;
    this.splashAt = -9;
    this.rippleAt = -9;
    this.cawAt = -9;
    this.pointAt = -9;
    this.wet = 0;             // accumulates on misses, dries slowly
    this.animTime = 0;
    this.rainSeed = 0;
  }

  /* ── Reactions ─────────────────────────────────────────────────────────── */

  onCue(cue) {
    if (cue.kind === 'caw') this.cawAt = this.animTime;
    if (cue.kind === 'turn') this.pointAt = this.animTime;
  }

  onJudge(note, grade) {
    if (grade === 'miss') {
      // He stops dead and lands in the water. The world stops with him.
      this.splashAt = this.animTime;
      this.rippleAt = this.animTime;
      this.wet = Math.min(1, this.wet + 0.45);
      return;
    }
    if (grade === 'holdbreak') return;

    // A step. Duration is the gap to the NEXT note, so his stride animation
    // naturally speeds up during a triplet burst without any special case.
    const idx = this.stepIndex;
    const next = this.notes[idx + 1];
    const cur = this.notes[idx];
    this.lastStepDur = next && cur ? clamp(next.time - cur.time, 0.10, 0.9) : 0.5;

    this.stepIndex = Math.min(this.stepIndex + 1, this.notes.length);
    this.lastStepAt = this.animTime;
    this.footL = !this.footL;
    if (note.hop) { this.hopping = 1; this.rippleAt = this.animTime; }
  }

  focus() { return { x: PIP_X, y: GROUND_Y - 70 }; }

  /* ── Update ────────────────────────────────────────────────────────────── */

  update(dt, adt, t) {
    super.update(dt, adt, t);
    this.animTime += adt;

    // The world catches up to Pip's step count fast but not instantly — the
    // overshoot-free snap is what makes each step feel like it lands.
    const target = this.stepIndex * STRIDE;
    this.scroll += (target - this.scroll) * (1 - Math.pow(0.0002, adt));

    this.hopping = Math.max(0, this.hopping - adt * 2.6);
    this.wet = Math.max(0, this.wet - adt * 0.10);
    this.rainSeed += adt;
  }

  /* ── Draw ──────────────────────────────────────────────────────────────── */

  draw(c, t) {
    const P = this.P;
    const now = this.animTime;
    const sc = this.scroll;

    this._sky(c, P, t);
    this._hills(c, P, sc, t);
    this._path(c, P, sc);
    this._water(c, P, sc, now);

    // Crow — parked to the right, on its post, at a fixed screen position.
    crow(c, P, {
      x: 830, y: 190, s: 1.05,
      caw: Stage.since(now, this.cawAt, 0.22),
      beat: t.beat,
      blink: this.blink,
    });
    if (Stage.since(now, this.pointAt, 0.9) > 0) {
      const a = Stage.since(now, this.pointAt, 0.9);
      layer(c, () => {
        c.globalAlpha = a;
        boldText(c, 'YOUR TURN', 830, 118, 22, P.callColor, INK);
      });
    }

    // Pip.
    const stride = clamp((now - this.lastStepAt) / this.lastStepDur, 0, 1);
    pip(c, P, {
      x: PIP_X, y: GROUND_Y, s: 1.1,
      stride,
      footL: this.footL,
      hop: ease.outCubic(clamp(this.hopping * 1.6, 0, 1)) * (this.hopping > 0 ? 1 : 0),
      splash: Stage.since(now, this.splashAt, 0.55),
      mood: this.wet > 0.5 ? -0.4 : 1,
      blink: this.blink,
      look: [0.35, 0],
    });

    this._rain(c, P);
    if (this.wet > 0.02) this._drips(c, P, now);
  }

  /* ── Scenery ───────────────────────────────────────────────────────────── */

  _sky(c, P) {
    const g = c.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, P.skyTop);
    g.addColorStop(1, P.skyBot);
    c.fillStyle = g;
    c.fillRect(0, 0, VW, VH);
    // Weak sun behind the cloud, so the scene has a light direction.
    circle(c, 720, 120, 62, 'rgba(255,240,208,0.35)', 0);
  }

  _hills(c, P, sc, t) {
    // Three parallax bands. Speeds are unrelated to the tempo on purpose.
    const bands = [[0.12, P.far, 300], [0.26, P.mid, 340], [0.45, P.near, 372]];
    for (const [k, col, base] of bands) {
      const off = (sc * k) % 320;
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(-40, VH);
      for (let x = -40; x <= VW + 60; x += 20) {
        const wx = x + off;
        const h = base - 30 * Math.sin(wx * 0.006) - 16 * Math.sin(wx * 0.017 + 1.1);
        c.lineTo(x, h);
      }
      c.lineTo(VW + 60, VH);
      c.closePath();
      c.fill();
    }

    // Bare trees, silhouetted.
    for (let i = -1; i < 7; i++) {
      const wx = i * 210 - ((sc * 0.45) % 210);
      const ty = 372;
      layer(c, () => {
        c.globalAlpha = 0.55;
        stroke_(c, [[wx, ty], [wx + 4, ty - 52], [wx + 2, ty - 84]], 8, P.near);
        for (const [dx, dy] of [[-24, -70], [22, -76], [-12, -92], [16, -96]]) {
          stroke_(c, [[wx + 2, ty - 70], [wx + dx, ty + dy]], 4, P.near);
        }
      });
    }
  }

  _path(c, P, sc) {
    // Wet ground.
    c.fillStyle = P.ground;
    c.fillRect(0, GROUND_Y - 6, VW, VH - GROUND_Y + 6);
    c.fillStyle = P.groundDark;
    c.fillRect(0, GROUND_Y + 44, VW, VH - GROUND_Y - 44);

    // Stepping stones — one per note, so the path IS the chart, laid out in
    // space. Spacing visibly tightens where a triplet burst is.
    for (const s of this.stones) {
      const x = PIP_X + s.wx - sc;
      if (x < -60 || x > VW + 60) continue;
      const done = s.wx < sc - 4;
      ellipse(c, x, GROUND_Y + 4, 21, 7.5, done ? P.stoneDark : P.stone, 3.5);
      if (!done) ellipse(c, x - 4, GROUND_Y + 2, 11, 3.4, 'rgba(255,255,255,0.30)', 0);
    }
  }

  _water(c, P, sc, now) {
    for (const p of this.puddles) {
      const cx = PIP_X + (p.start + p.end) / 2 - sc;
      const w = (p.end - p.start) + 54;
      if (cx < -120 || cx > VW + 120) continue;
      const near = Math.abs(cx - PIP_X) < 40;
      puddle(c, P, {
        x: cx, y: GROUND_Y + 9, w,
        ripple: near ? Stage.since(now, this.rippleAt, 0.7) : 0,
      });
    }
  }

  _rain(c, P) {
    // Continuous, seeded, never beat-locked. Drawn over everything so the whole
    // scene sits behind weather.
    layer(c, () => {
      c.strokeStyle = P.rain;
      c.lineWidth = 1.6;
      for (let i = 0; i < 90; i++) {
        const s = (Math.sin(i * 78.233) * 43758.5453) % 1;
        const sx = ((s * 1.3 + 1) % 1) * (VW + 200) - 100;
        const speed = 620 + s * 260;
        const y = ((this.rainSeed * speed + s * 900) % (VH + 90)) - 40;
        c.beginPath();
        c.moveTo(sx, y);
        c.lineTo(sx - 7, y + 22);
        c.stroke();
      }
    });
  }

  _drips(c, P, now) {
    // He is visibly damp for a while after a splash. Consequence with a memory.
    layer(c, () => {
      c.globalAlpha = this.wet * 0.8;
      for (let i = 0; i < 4; i++) {
        const ph = (now * 1.4 + i * 0.31) % 1;
        ellipse(c, PIP_X - 16 + i * 11, GROUND_Y - 74 + ph * 66, 2.4, 4.4, P.water, 0);
      }
    });
  }
}
