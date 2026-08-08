/**
 * Stage — Rocket Courier.
 *
 * A neon launchpad at night. The courier stands right of centre; parcels come
 * out of the dark on the left.
 *
 * ── Cue audit ────────────────────────────────────────────────────────────────
 *
 *   PARCELS IN FLIGHT   deliberately UNRELIABLE. Flight time (1.6–3.2 beats),
 *                       arc height and spin all vary per parcel, seeded. Every
 *                       parcel still arrives exactly on its beat — the physics
 *                       are honest, the readability is not. Watching them will
 *                       make you inconsistent; that is the intended lesson.
 *   PARCEL COLOUR       reliable, and reliable on purpose. Colour is a WHAT
 *                       (which button), never a WHEN. Making the player guess
 *                       which button would just be noise.
 *   WHISTLE FLASH       a ring at the launch mouth when a telegraph sounds.
 *                       Confirms audio the player is hearing right now.
 *   COURIER             reacts to the player only. No anticipation pose exists
 *                       in this file — if she leaned toward an incoming parcel,
 *                       that lean would become the cue and the whistle would
 *                       stop mattering, which would undo the whole level.
 *   GRID, SEARCHLIGHTS  continuous scroll, never beat-locked.
 */

import { Stage } from '../stage.js';
import { VW, VH } from '../../render/view.js';
import {
  circle, ellipse, roundRect, poly, stroke_, star, boldText, layer,
  INK, ease, clamp, lerp,
} from '../../render/shapes.js';
import { courier, parcel } from '../../render/folks.js';

const COURIER_X = 690;
const PAD_Y = 430;
const LAUNCH_X = -50;
const LAUNCH_Y = 300;
const CATCH_Y = PAD_Y - 96;

export class CourierStage extends Stage {
  constructor(P, data) {
    super(P, data);
    // Pre-resolve every launch to seconds so drawing is a pure lookup.
    this.launches = this.cues
      .filter((q) => q.kind === 'launch')
      .map((q) => ({
        ...q,
        launchTime: q.time,
        arriveTime: this.conductor.beatToTime(q.arrive),
      }));
    this.reset();
  }

  reset() {
    super.reset();
    this.animTime = 0;
    this.songTime = 0;
    this.caughtAt = -9;
    this.fumbleAt = -9;
    this.telegraphAt = -9;
    this.stack = 0;
    this.scroll = 0;
    /** Parcels the player successfully caught — removed from the sky. */
    this.consumed = new Set();
  }

  /* ── Reactions ─────────────────────────────────────────────────────────── */

  onCue(cue) {
    if (cue.kind === 'telegraph') this.telegraphAt = this.animTime;
  }

  onJudge(note, grade) {
    if (grade === 'miss' || grade === 'holdbreak') {
      this.fumbleAt = this.animTime;
      return;
    }
    this.caughtAt = this.animTime;
    this.stack = Math.min(this.stack + 1, 6);
    if (note.seed != null) this.consumed.add(note.seed);
  }

  focus() { return { x: COURIER_X - 30, y: CATCH_Y }; }

  /* ── Update ────────────────────────────────────────────────────────────── */

  update(dt, adt, t) {
    super.update(dt, adt, t);
    this.animTime += adt;
    this.songTime = t.songTime;
    this.scroll += adt * (0.5 + t.hype * 0.7);
    // The stack tips over now and then so it never just accumulates forever.
    if (this.stack >= 6 && Stage.since(this.animTime, this.caughtAt, 0.4) > 0.9) this.stack = 0;
  }

  /* ── Draw ──────────────────────────────────────────────────────────────── */

  draw(c, t) {
    const P = this.P;
    const now = this.animTime;

    this._sky(c, P, t);
    this._city(c, P);
    this._grid(c, P);
    this._pad(c, P, t);

    // Parcels in flight.
    for (const L of this.launches) {
      if (this.consumed.has(L.seed)) continue;
      const span = L.arriveTime - L.launchTime;
      const u = (this.songTime - L.launchTime) / span;
      if (u < -0.02 || u > 1.5) continue;
      parcel(c, P, {
        x0: LAUNCH_X, y0: LAUNCH_Y,
        x1: COURIER_X - 26, y1: CATCH_Y,
        t: u, seed: L.seed, kind: L.parcel,
      });
    }

    // Launch-mouth flash on each telegraph.
    const tg = Stage.since(now, this.telegraphAt, 0.3);
    if (tg > 0) {
      layer(c, () => {
        c.globalAlpha = tg * 0.8;
        c.strokeStyle = P.callColor;
        c.lineWidth = 5 * tg + 1;
        for (const k of [1, 1.7]) {
          c.beginPath();
          c.arc(20, LAUNCH_Y, (1 - tg) * 70 * k + 18, -Math.PI * 0.45, Math.PI * 0.45);
          c.stroke();
        }
      });
    }

    courier(c, P, {
      x: COURIER_X, y: PAD_Y, s: 1.15,
      phase: t.phase,
      brace: 0,
      caught: Stage.since(now, this.caughtAt, 0.26),
      fumble: Stage.since(now, this.fumbleAt, 0.55),
      blink: this.blink,
      stack: this.stack,
    });

    if (t.hype > 0.25) this._speedLines(c, P, t.hype);
  }

  /* ── Scenery ───────────────────────────────────────────────────────────── */

  _sky(c, P, t) {
    const g = c.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, P.skyTop);
    g.addColorStop(1, P.skyBot);
    c.fillStyle = g;
    c.fillRect(0, 0, VW, VH);

    // Searchlights, sweeping on a long irrational period so they never sync.
    for (let i = 0; i < 3; i++) {
      const a = Math.sin(this.animTime * (0.21 + i * 0.07) + i * 2.1) * 0.5 - Math.PI / 2;
      const bx = 120 + i * 340;
      layer(c, () => {
        c.globalAlpha = 0.07;
        c.fillStyle = P.accent;
        c.beginPath();
        c.moveTo(bx, VH);
        c.lineTo(bx + Math.cos(a - 0.05) * 900, VH + Math.sin(a - 0.05) * 900);
        c.lineTo(bx + Math.cos(a + 0.05) * 900, VH + Math.sin(a + 0.05) * 900);
        c.closePath(); c.fill();
      });
    }

    // Hype vignette — the world gets hotter as the combo climbs.
    if (t.hype > 0.05) {
      const rg = c.createRadialGradient(480, 300, 140, 480, 300, 640);
      rg.addColorStop(0, 'rgba(0,0,0,0)');
      rg.addColorStop(1, `rgba(255,46,136,${0.20 * t.hype})`);
      c.fillStyle = rg;
      c.fillRect(0, 0, VW, VH);
    }
  }

  _city(c, P) {
    for (const [depth, col] of [[0.2, P.far], [0.45, P.mid], [0.8, P.near]]) {
      const off = (this.scroll * depth * 90) % 260;
      layer(c, () => {
        c.fillStyle = col;
        for (let i = -1; i < 6; i++) {
          const bx = i * 260 - off;
          for (let j = 0; j < 4; j++) {
            const w = 40 + ((i * 7 + j * 13) % 5) * 12;
            const h = 60 + ((i * 11 + j * 5) % 7) * 22 + depth * 40;
            c.fillRect(bx + j * 66, 360 - h, w, h);
          }
        }
      });
    }
    // Window lights
    layer(c, () => {
      c.globalAlpha = 0.35;
      c.fillStyle = P.parcelA;
      for (let i = 0; i < 46; i++) {
        const s = (Math.sin(i * 41.3) * 43758.5453) % 1;
        const x = ((s + 1) % 1) * VW;
        const y = 230 + (((s * 7) % 1)) * 120;
        c.fillRect(x, y, 4, 6);
      }
    });
  }

  _grid(c, P) {
    const horizon = 360;
    c.strokeStyle = 'rgba(255,46,136,0.45)';
    c.lineWidth = 2;
    for (let i = -12; i <= 12; i++) {
      c.beginPath();
      c.moveTo(480 + i * 26, horizon);
      c.lineTo(480 + i * 200, VH + 40);
      c.stroke();
    }
    const gs = (this.scroll * 1.1) % 1;
    for (let i = 0; i < 12; i++) {
      const u = (i + gs) / 12;
      const y = horizon + Math.pow(u, 2.6) * (VH + 40 - horizon);
      layer(c, () => {
        c.globalAlpha = clamp(u * 1.6, 0, 1) * 0.5;
        c.beginPath(); c.moveTo(0, y); c.lineTo(VW, y); c.stroke();
      });
    }
  }

  _pad(c, P, t) {
    // The launch tube on the left — where parcels come from.
    roundRect(c, -70, LAUNCH_Y - 46, 92, 92, 14, P.metalDark, 5);
    roundRect(c, -40, LAUNCH_Y - 30, 56, 60, 10, P.metal, 4);
    ellipse(c, 20, LAUNCH_Y, 14, 30, '#0a0614', 4);

    // The courier's platform.
    roundRect(c, COURIER_X - 96, PAD_Y - 4, 192, 26, 8, P.metal, 5);
    roundRect(c, COURIER_X - 78, PAD_Y + 2, 156, 10, 5, P.metalDark, 0);
    // Warning stripes, static.
    layer(c, () => {
      c.globalAlpha = 0.5;
      for (let i = 0; i < 7; i++) {
        poly(c, [
          [COURIER_X - 84 + i * 24, PAD_Y + 14],
          [COURIER_X - 76 + i * 24, PAD_Y + 14],
          [COURIER_X - 84 + i * 24, PAD_Y + 22],
        ], P.parcelA, 0);
      }
    });
    // Support legs
    for (const dx of [-70, 70]) {
      stroke_(c, [[COURIER_X + dx, PAD_Y + 22], [COURIER_X + dx * 1.25, VH]], 8, P.metalDark);
    }
  }

  _speedLines(c, P, hype) {
    layer(c, () => {
      c.globalAlpha = (hype - 0.25) * 0.35;
      for (let i = 0; i < 14; i++) {
        const s = (Math.sin(i * 33.7) * 43758.5453) % 1;
        const y = 110 + ((s + 1) % 1) * 300;
        const x = VW - ((this.scroll * (600 + s * 800) + s * VW) % (VW + 260));
        stroke_(c, [[x, y], [x + 70 + s * 130, y]], 2 + s * 2, P.accent);
      }
    });
  }
}
