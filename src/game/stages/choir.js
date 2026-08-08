/**
 * Stage — Choir Sprout.
 *
 * A wooden recital hall. The choirmaster stands stage left, your sprout in a
 * stall stage right, four more sprouts behind as the chorus.
 *
 * ── Cue audit ────────────────────────────────────────────────────────────────
 *
 *   MASTER SINGS    mouth opens exactly when his note sounds, and a wisp rises
 *                   carrying the pitch as HEIGHT. This is a CALL, so showing it
 *                   is not just allowed but the point — the wisp trail is a
 *                   picture of the phrase you're about to repeat, drawn while
 *                   you hear it.
 *   MASTER POINTS   half a beat before your bar. Marks the handover only.
 *   BATON           swings continuously on the beat. Marks the PULSE. Legal:
 *                   knowing where the beat is was never the hard part here;
 *                   knowing which beats carry notes is.
 *   YOUR SPROUT     opens its mouth when YOU tap. Reaction only. It has no
 *                   anticipation pose anywhere in this file.
 *   CHORUS SPROUTS  sway at half time, permanently, ignoring the chart.
 *
 * The one thing deliberately NOT drawn: any indication of when your next note
 * is due. The phrase you just heard is the only source, which is exactly the
 * intended difficulty.
 */

import { Stage } from '../stage.js';
import { VW, VH } from '../../render/view.js';
import {
  circle, ellipse, roundRect, poly, stroke_, star, boldText, layer,
  INK, ease, clamp, lerp,
} from '../../render/shapes.js';
import { sprout, choirmaster, noteWisp } from '../../render/folks.js';

const MASTER_X = 232;
const SPROUT_X = 660;
const FLOOR_Y = 452;

/** Map a scale degree to a height, so pitch is visible as position. */
const degY = (deg) => FLOOR_Y - 190 - deg * 22;

export class ChoirStage extends Stage {
  constructor(P, data) {
    super(P, data);
    this.reset();
  }

  reset() {
    super.reset();
    this.animTime = 0;
    this.masterSingAt = -9;
    this.masterDeg = 0;
    this.pointAt = -9;
    this.singAt = -9;
    this.singDeg = 0;
    this.wiltAt = -9;
    this.wisps = [];
    this.sungCount = 0;
    this.chorusHype = 0;
  }

  /* ── Reactions ─────────────────────────────────────────────────────────── */

  onCue(cue) {
    if (cue.kind === 'master') {
      this.masterSingAt = this.animTime;
      this.masterDeg = cue.deg ?? 0;
      this._wisp(MASTER_X + 46, degY(cue.deg ?? 0), this.P.callColor, 20);
    }
    if (cue.kind === 'point') this.pointAt = this.animTime;
  }

  onJudge(note, grade) {
    if (grade === 'miss' || grade === 'holdbreak') {
      this.wiltAt = this.animTime;
      return;
    }
    this.singAt = this.animTime;
    this.singDeg = note.deg ?? 0;
    this.sungCount++;
    const col = grade === 'perfect' ? this.P.cue : this.P.hot;
    this._wisp(SPROUT_X + 28, degY(note.deg ?? 0), col, grade === 'perfect' ? 30 : 24);
  }

  _wisp(x, y, color, size) {
    this.wisps.push({ x, y, life: 1, color, size, glyph: Math.random() < 0.3 ? '♫' : '♪' });
    if (this.wisps.length > 40) this.wisps.shift();
  }

  focus() { return { x: SPROUT_X, y: FLOOR_Y - 96 }; }

  /* ── Update ────────────────────────────────────────────────────────────── */

  update(dt, adt, t) {
    super.update(dt, adt, t);
    this.animTime += adt;

    for (let i = this.wisps.length - 1; i >= 0; i--) {
      this.wisps[i].life -= adt * 0.85;
      if (this.wisps[i].life <= 0) this.wisps.splice(i, 1);
    }
    this.chorusHype += (t.hype - this.chorusHype) * (1 - Math.pow(0.05, adt));
  }

  /* ── Draw ──────────────────────────────────────────────────────────────── */

  draw(c, t) {
    const P = this.P;
    const now = this.animTime;

    this._hall(c, P, t);

    // Chorus, behind and raised.
    for (let i = 0; i < 4; i++) {
      const x = 400 + i * 84;
      const ph = (t.beat * 0.5 + i * 0.17) % 1;
      sprout(c, P, {
        x, y: FLOOR_Y - 54, s: 0.62,
        sing: 0,
        sway: Math.sin(ph * Math.PI * 2),
        blink: i % 2 ? this.blink : 0,
        mood: 1,
      });
    }

    this._stalls(c, P);

    // The choirmaster.
    choirmaster(c, P, {
      x: MASTER_X, y: FLOOR_Y, s: 1.0,
      phase: t.phase,
      sing: Stage.envelope(now, this.masterSingAt, 0.035, 0.30),
      point: Stage.since(now, this.pointAt, 0.8),
      blink: this.blink,
    });

    // Your sprout.
    const wilt = Stage.since(now, this.wiltAt, 0.7);
    sprout(c, P, {
      x: SPROUT_X, y: FLOOR_Y, s: 1.15,
      sing: Stage.envelope(now, this.singAt, 0.03, 0.34),
      wilt,
      sway: Math.sin(t.beat * Math.PI) * 0.5,
      blink: this.blink,
      mood: 1,
    });

    // Wisps last, over everything — they're the music made visible.
    for (const w of this.wisps) noteWisp(c, w);

    if (Stage.since(now, this.pointAt, 0.9) > 0) {
      const a = Stage.since(now, this.pointAt, 0.9);
      layer(c, () => {
        c.globalAlpha = a;
        boldText(c, 'YOUR TURN', SPROUT_X, FLOOR_Y - 236, 24, P.callColor, INK);
      });
    }
  }

  /* ── Scenery ───────────────────────────────────────────────────────────── */

  _hall(c, P, t) {
    const g = c.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, P.skyTop);
    g.addColorStop(1, P.skyBot);
    c.fillStyle = g;
    c.fillRect(0, 0, VW, VH);

    // Two spotlights, one per performer. They breathe on a four-bar cycle —
    // slow enough that no one could mistake them for a beat.
    for (const [sx, w] of [[MASTER_X, 150], [SPROUT_X, 130]]) {
      const swell = 1 + Math.sin(t.beat / 16 * Math.PI * 2) * 0.04;
      layer(c, () => {
        c.globalAlpha = 0.13;
        c.fillStyle = P.sun;
        c.beginPath();
        c.moveTo(sx - 30, 0); c.lineTo(sx + 30, 0);
        c.lineTo(sx + w * swell, FLOOR_Y + 20); c.lineTo(sx - w * swell, FLOOR_Y + 20);
        c.closePath(); c.fill();
      });
    }

    // Curtains
    for (const side of [0, 1]) {
      const x = side ? VW : 0;
      const dir = side ? -1 : 1;
      c.fillStyle = P.curtain;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + dir * 118, 0);
      for (let y = 0; y <= VH; y += 40) {
        c.lineTo(x + dir * (92 + Math.sin(y * 0.02) * 22), y);
      }
      c.lineTo(x, VH);
      c.closePath(); c.fill();
      // Folds
      c.strokeStyle = P.curtainDark;
      c.lineWidth = 5;
      for (let i = 1; i < 4; i++) {
        const fx = x + dir * (20 + i * 22);
        c.beginPath();
        c.moveTo(fx, 0);
        for (let y = 0; y <= VH; y += 40) c.lineTo(fx + Math.sin(y * 0.02 + i) * 7, y);
        c.stroke();
      }
    }

    // Back wall panelling
    c.fillStyle = P.woodDark;
    c.fillRect(0, 300, VW, 60);
    c.fillStyle = P.wood;
    for (let i = 0; i < 12; i++) roundRect(c, 60 + i * 72, 306, 58, 48, 5, P.wood, 3);

    // Floor
    c.fillStyle = P.ground;
    c.fillRect(0, FLOOR_Y, VW, VH - FLOOR_Y);
    c.fillStyle = P.groundDark;
    for (let i = 0; i < 14; i++) c.fillRect(i * 70, FLOOR_Y, 3, VH - FLOOR_Y);
  }

  _stalls(c, P) {
    // The chorus stand behind a low rail; your sprout has its own stall so the
    // player can never lose track of which one they control.
    roundRect(c, 372, FLOOR_Y - 46, 372, 18, 6, P.wood, 4);
    roundRect(c, SPROUT_X - 78, FLOOR_Y - 30, 156, 22, 7, P.woodDark, 4.5);
    layer(c, () => {
      c.globalAlpha = 0.6;
      boldText(c, 'YOU', SPROUT_X, FLOOR_Y - 19, 13, P.leaf, INK);
    });
  }
}
