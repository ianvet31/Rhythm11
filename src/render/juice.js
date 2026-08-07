/**
 * Juice — the feedback that makes hitting a beat feel good.
 *
 * ── The thesis ───────────────────────────────────────────────────────────────
 *
 * Judgment accuracy is a spreadsheet. *Feel* is what the player actually
 * experiences, and it is made almost entirely of things that have no mechanical
 * effect whatsoever. A perfect hit in this game triggers, within ~30ms:
 *
 *     0ms   hit sound (scheduled from the input handler, not the frame loop)
 *     0ms   ring flash + expanding shockwave
 *     0ms   character squash
 *     0ms   16 particles at randomised velocities
 *     0ms   score number pops with an overshoot ease
 *     0–2f  hitstop: the world freezes for ~35ms
 *     0ms   camera punch (zoom) + small shake
 *
 * None of that changes the score. All of it changes whether the player wants to
 * press the button again.
 *
 * ── Hitstop deserves special mention ─────────────────────────────────────────
 *
 * Freezing the *animation* for two frames on impact is the single highest-value
 * trick in the file. It gives the brain a moment to register the collision, and
 * it makes a light input feel heavy. Critically, it must NEVER freeze the audio
 * clock or the judgment clock — those keep running at full speed. Only the
 * decorative animation time stalls. Pause the music for 35ms and you have
 * destroyed the thing the entire game is built on.
 *
 * ── Feedback scales with quality ─────────────────────────────────────────────
 *
 * A "good" hit gets a small, dull, quiet response; a "perfect" gets a big, gold,
 * bright one. The gap between them is what makes players chase precision. If
 * every hit felt identical there'd be no felt reason to aim for the centre of
 * the window.
 */

import {
  circle, ellipse, star, poly, stroke_, boldText, layer, INK, ease, clamp, lerp,
} from './shapes.js';
import { GRADE_COLOR, GRADE_LABEL } from './palette.js';
import { VW, VH } from './view.js';

const TAU = Math.PI * 2;

/** Per-grade feedback intensity. Everything below scales off this one table. */
const INTENSITY = {
  perfect:   { particles: 18, shake: 4.5, punch: 0.022, ring: 1.0, stop: 0.038, sparkle: true },
  great:     { particles: 10, shake: 2.2, punch: 0.012, ring: 0.7, stop: 0.020, sparkle: false },
  good:      { particles: 5,  shake: 1.0, punch: 0.005, ring: 0.45, stop: 0.010, sparkle: false },
  miss:      { particles: 7,  shake: 6.0, punch: 0.0,   ring: 0.3, stop: 0.0,   sparkle: false },
  holdbreak: { particles: 6,  shake: 5.0, punch: 0.0,   ring: 0.3, stop: 0.0,   sparkle: false },
  holdend:   { particles: 6,  shake: 1.2, punch: 0.008, ring: 0.5, stop: 0.012, sparkle: false },
};

export class Juice {
  /** @param {import('./view.js').View} view */
  constructor(view) {
    this.view = view;
    this.particles = [];
    this.popups = [];
    this.rings = [];
    this.streaks = [];

    /** Decorative-time freeze remaining, in seconds. Never touches audio. */
    this.hitstop = 0;
    /** Full-screen flash, 0..1. */
    this.flash = 0;
    this.flashColor = '255,255,255';

    /** Animation clock. Advances slower than real time during hitstop. */
    this.animTime = 0;
  }

  /**
   * @param {number} dt real seconds elapsed
   * @returns {number} decorative dt (0 while frozen) — pass this to animations
   */
  update(dt) {
    let adt = dt;
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      adt = 0;                 // decorative time stops...
    }
    this.animTime += adt;      // ...but audio/judgment clocks elsewhere do not.

    this.flash *= Math.exp(-9 * dt);
    if (this.flash < 0.004) this.flash = 0;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      p.vx *= Math.pow(p.drag, dt * 60);
      p.vy *= Math.pow(p.drag, dt * 60);
      p.rot += p.spin * dt;
    }

    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.life -= dt;
      if (p.life <= 0) { this.popups.splice(i, 1); continue; }
      p.y += p.vy * dt;
      p.vy *= Math.pow(0.90, dt * 60);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }

    for (let i = this.streaks.length - 1; i >= 0; i--) {
      const s = this.streaks[i];
      s.life -= dt;
      if (s.life <= 0) this.streaks.splice(i, 1);
    }

    return adt;
  }

  /* ── Emitters ───────────────────────────────────────────────────────────── */

  /**
   * The main event: react to a judged note.
   * @param {number} x,y  where it happened, in virtual coords
   * @param {string} grade
   * @param {object} P palette
   */
  hit(x, y, grade, P) {
    const I = INTENSITY[grade] || INTENSITY.good;
    const color = GRADE_COLOR[grade] || '#fff';
    const bad = grade === 'miss' || grade === 'holdbreak';

    this.hitstop = Math.max(this.hitstop, I.stop);
    this.view.shake(I.shake);
    this.view.kick(I.punch);

    // Shockwave ring
    this.rings.push({
      x, y, life: bad ? 0.30 : 0.42, max: bad ? 0.30 : 0.42,
      r0: 14, r1: 26 + 92 * I.ring, color, lw: 7 * I.ring + 2,
    });

    if (grade === 'perfect') {
      // Second, slower ring gives the perfect a distinct double-pulse read.
      this.rings.push({ x, y, life: 0.62, max: 0.62, r0: 8, r1: 168, color: '#fff6c2', lw: 3 });
      this.flash = Math.max(this.flash, 0.13);
      this.flashColor = '255,235,160';
      // Radiating spokes — pure celebration.
      for (let i = 0; i < 8; i++) {
        this.streaks.push({
          x, y, ang: (i / 8) * TAU + 0.2, life: 0.26, max: 0.26,
          len: 78, color: '#fff6c2',
        });
      }
    }

    // Particles
    const n = I.particles;
    for (let i = 0; i < n; i++) {
      const a = bad
        ? Math.PI + (Math.random() - 0.5) * 1.4      // misses spray downward
        : (i / n) * TAU + Math.random() * 0.4;
      const spd = bad ? 90 + Math.random() * 120 : 150 + Math.random() * 320 * I.ring;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - (bad ? 0 : 60),
        g: bad ? 1500 : 900,
        drag: 0.94,
        life: 0.30 + Math.random() * 0.38,
        max: 0.68,
        size: 3 + Math.random() * (bad ? 4 : 7),
        rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 22,
        color: i % 3 === 0 ? (P?.cue ?? color) : color,
        shape: I.sparkle && i % 4 === 0 ? 'star' : 'chip',
      });
    }

    // Popup
    const label = GRADE_LABEL[grade];
    if (label) {
      this.popups.push({
        x, y: y - 58, text: label, color,
        life: bad ? 0.75 : 0.6, max: bad ? 0.75 : 0.6,
        vy: -70, size: grade === 'perfect' ? 34 : 26,
        wobble: grade === 'perfect',
      });
    }
  }

  /** Timing-bias tick on the accuracy meter. */
  bias(x, y, deltaMs) { this.popups.push({
    x, y, text: `${deltaMs > 0 ? '+' : ''}${deltaMs.toFixed(0)}`,
    color: 'rgba(255,255,255,0.55)', life: 0.5, max: 0.5, vy: -30, size: 13, small: true,
  }); }

  /** Stray press — a small wince so mashing has a visible cost. */
  stray(x, y) {
    this.view.shake(1.6);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI + (Math.random() - 0.5) * 2;
      this.particles.push({
        x, y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80,
        g: 1200, drag: 0.92, life: 0.22, max: 0.22, size: 3,
        rot: 0, spin: 6, color: 'rgba(255,255,255,0.5)', shape: 'chip',
      });
    }
  }

  /** Combo milestone burst. */
  milestone(x, y, value, P) {
    this.flash = Math.max(this.flash, 0.10);
    this.flashColor = '255,255,255';
    this.view.kick(0.016);
    this.popups.push({
      x, y, text: `${value} COMBO!`, color: P?.cue ?? '#ffd23f',
      life: 0.95, max: 0.95, vy: -46, size: 30, wobble: true,
    });
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TAU;
      this.particles.push({
        x, y, vx: Math.cos(a) * (220 + Math.random() * 160),
        vy: Math.sin(a) * (220 + Math.random() * 160) - 80,
        g: 850, drag: 0.95, life: 0.6 + Math.random() * 0.4, max: 1,
        size: 4 + Math.random() * 6, rot: Math.random() * TAU,
        spin: (Math.random() - 0.5) * 18,
        color: i % 2 ? (P?.cue ?? '#ffd23f') : (P?.hot ?? '#ff4d6d'),
        shape: 'star',
      });
    }
  }

  clear() {
    this.particles.length = 0;
    this.popups.length = 0;
    this.rings.length = 0;
    this.streaks.length = 0;
    this.hitstop = 0;
    this.flash = 0;
  }

  /* ── Rendering ──────────────────────────────────────────────────────────── */

  draw(c) {
    // Streaks (behind everything else in the juice layer)
    for (const s of this.streaks) {
      const t = 1 - s.life / s.max;
      const inner = ease.outCubic(t) * s.len;
      const outer = inner + 30 * (1 - t);
      layer(c, () => {
        c.globalAlpha = (1 - t) * 0.85;
        stroke_(c, [
          [s.x + Math.cos(s.ang) * inner, s.y + Math.sin(s.ang) * inner],
          [s.x + Math.cos(s.ang) * outer, s.y + Math.sin(s.ang) * outer],
        ], 6 * (1 - t) + 1, s.color);
      });
    }

    // Rings — expand fast then hold, which reads as an impact rather than a
    // balloon inflating. Linear expansion looks weirdly slow.
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const rad = lerp(r.r0, r.r1, ease.outQuint(t));
      layer(c, () => {
        c.globalAlpha = (1 - t) * (1 - t);
        c.lineWidth = Math.max(r.lw * (1 - t), 0.6);
        c.strokeStyle = r.color;
        c.beginPath();
        c.arc(r.x, r.y, rad, 0, TAU);
        c.stroke();
      });
    }

    // Particles
    for (const p of this.particles) {
      const t = 1 - p.life / p.max;
      layer(c, () => {
        c.globalAlpha = clamp(1 - t * t, 0, 1);
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        const sz = p.size * (1 - t * 0.55);
        if (p.shape === 'star') {
          star(c, 0, 0, 4, sz * 1.7, sz * 0.55, p.color, 0);
        } else {
          c.fillStyle = p.color;
          c.fillRect(-sz / 2, -sz / 2, sz, sz * 0.72);
        }
      });
    }

    // Popups
    for (const p of this.popups) {
      const t = 1 - p.life / p.max;
      // Overshoot scale-in: the pop is the point.
      const s = t < 0.22 ? ease.outBack(t / 0.22, 2.6) : 1;
      const wob = p.wobble ? Math.sin(t * 34) * 0.045 * (1 - t) : 0;
      layer(c, () => {
        c.globalAlpha = clamp((1 - t) * 2.2, 0, 1);
        c.translate(p.x, p.y);
        c.scale(s * (1 + wob), s * (1 - wob));
        if (p.small) {
          c.font = `bold ${p.size}px "Trebuchet MS", Verdana, sans-serif`;
          c.textAlign = 'center';
          c.fillStyle = p.color;
          c.fillText(p.text, 0, 0);
        } else {
          boldText(c, p.text, 0, 0, p.size, p.color, INK);
        }
      });
    }
  }

  /** Full-screen flash. Drawn last, over the HUD. */
  drawFlash(c) {
    if (this.flash <= 0) return;
    c.fillStyle = `rgba(${this.flashColor},${this.flash})`;
    c.fillRect(0, 0, VW, VH);
  }
}
