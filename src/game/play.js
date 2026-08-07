/**
 * Play — the gameplay scene.
 *
 * ── The one rule that governs this whole file ────────────────────────────────
 *
 * There are two clocks in here and they must never be confused:
 *
 *   JUDGMENT TIME   `conductor.songTimeNow()` / `songTimeAt(event.timeStamp)`
 *                   Unsmoothed, unfrozen, authoritative. Decides hits, misses,
 *                   and when notes retire. Nothing cosmetic may touch it.
 *
 *   VISUAL TIME     `conductor.visualSongTime(rafTimestamp)`
 *                   Smoothed, offset by the display calibration, and stalled
 *                   during hitstop. Decides where things are drawn.
 *
 * Every bug that makes a rhythm game feel unfair is some version of leaking one
 * into the other. Screen shake must not move the judgment line. Hitstop must
 * not pause the music. A dropped frame must not delay a miss.
 *
 * ── Order of operations per frame ────────────────────────────────────────────
 *
 *   1. conductor.tickClock()      keep the perf↔audio correlation fresh
 *   2. judge.update(judgeTime)    retire missed notes — BEFORE drawing, so a
 *                                 miss is never rendered a frame late
 *   3. juice.update(dt) → adt     decorative dt (0 during hitstop)
 *   4. draw with visual time
 *
 * Input is NOT in this list. It is handled synchronously in the event callback,
 * which is the entire point of core/input.js.
 */

import { Conductor } from '../core/conductor.js';
import { InputRouter, Action } from '../core/input.js';
import { Judge, Grade, MISS_AFTER } from '../core/judge.js';
import { Sequencer } from '../audio/sequencer.js';
import { Voices } from '../audio/synth.js';
import { View, VW, VH } from '../render/view.js';
import { Juice } from '../render/juice.js';
import { PALETTES, GRADE_COLOR } from '../render/palette.js';
import { SCENES, CUE_Y } from '../render/scenes.js';
import * as Critters from '../render/critters.js';
import {
  RING, drawRing, drawLane, drawCue, drawScore, drawProgress,
  drawTimingMeter, drawCountIn, drawBanner,
} from '../render/hud.js';
import { boldText, layer, circle, ellipse, stroke_, roundRect, INK, ease, clamp, lerp } from '../render/shapes.js';

/** How far off-screen a cue starts. */
const LANE_LEN = VW - RING.x + 70;

export class Play {
  /**
   * @param {object} deps { view, bus, conductor, input, juice, settings }
   * @param {object} level a module from ./levels/
   */
  constructor(deps, level, onFinish) {
    this.view = deps.view;
    this.bus = deps.bus;
    this.conductor = deps.conductor;
    this.input = deps.input;
    this.juice = deps.juice;
    this.settings = deps.settings;
    this.level = level;
    this.onFinish = onFinish;

    this.P = PALETTES[level.palette];
    this.scene = SCENES[level.scene];

    // ── Build the timeline ────────────────────────────────────────────────
    this.conductor.setTempoMap(level.tempoMap);

    /** @type {import('../core/judge.js').Note[]} */
    this.notes = level.chart().map((n) => ({
      ...n,
      time: this.conductor.beatToTime(n.beat),
      holdEnd: n.type === 'hold'
        ? this.conductor.beatToTime(n.beat + (n.holdBeats || 0))
        : undefined,
      judgedAt: 0,
      spin: 0,
    }));

    this.judge = new Judge(this.notes);
    this.sequencer = new Sequencer(this.bus, this.conductor);
    this.sequencer.load(level.music());

    // Constant pixels-per-SECOND, not per-beat. This means a fixed timing error
    // is always the same distance on screen, at any tempo, which is what lets a
    // player build a visual sense of "how far off am I". Through level 3's
    // modulation the note spacing changes but the travel speed does not.
    const approachSec = level.approachBeats * (60 / level.bpm);
    this.pxPerSec = LANE_LEN / approachSec;
    this.approachSec = approachSec;

    this.endTime = this.conductor.beatToTime(level.endBeat) + 2.4;

    // ── Presentation state ────────────────────────────────────────────────
    this.displayScore = 0;
    this.comboPop = 1;
    this.ticks = [];              // timing-meter marks
    this.pressGlow = { A: 0, B: 0 };
    this.lastGrade = null;
    this.gradeAge = 1;
    this.banner = null;
    this.bannerAge = 99;
    this.sectionIdx = -1;
    this.hype = 0;
    this.castHit = 0;             // 0..1, drives the cast's reaction pose
    this.blinkT = Math.random() * 4;
    this.blink = 0;
    this.scroll = 0;
    this.finished = false;
    this.started = false;
    this.paused = false;

    this._wire();
  }

  _wire() {
    this.judge.onJudge = (note, grade, delta) => this._onJudge(note, grade, delta);
    this.judge.onStray = () => {
      this.juice.stray(RING.x, RING.y);
      Voices.hit(this.bus, this.bus.ctx.currentTime, { grade: 'miss', pitch: -7 });
    };
    this.judge.onMilestone = (value, tier) => {
      this.juice.milestone(RING.x + 150, RING.y - 90, value, this.P);
      Voices.chime(this.bus, this.bus.ctx.currentTime, { tier });
    };
  }

  start() {
    this.judge.reset();
    this.juice.clear();
    this.displayScore = 0;
    this.finished = false;

    const startCtx = this.conductor.start(1.4);
    this.sequencer.start(startCtx);
    this.started = true;

    this.input.enabled = true;
    this.input.onPress = (action, perfMs) => this._press(action, perfMs);
    this.input.onRelease = (action, perfMs) => this._release(action, perfMs);
  }

  stop() {
    this.sequencer.stop();
    this.conductor.stop();
    this.input.onPress = null;
    this.input.onRelease = null;
  }

  /* ── Input ──────────────────────────────────────────────────────────────── */

  /**
   * Runs INSIDE the keydown handler. Everything here is deliberately cheap and
   * synchronous, because the audio scheduled at the bottom is the player's
   * primary feedback and every microsecond of delay is felt.
   */
  _press(action, perfMs) {
    if (!this.started || this.finished || this.paused) return;
    const t = this.conductor.songTimeAt(perfMs);
    this.pressGlow[action] = 1;

    const res = this.judge.press(action, t);

    // Fire the note's musical sound immediately. `currentTime` (not a future
    // time) so it's as close to instant as the audio graph allows.
    if (res && res.grade !== Grade.MISS && res.note.sound) {
      const fn = Voices[res.note.sound.voice];
      fn?.(this.bus, this.bus.ctx.currentTime, res.note.sound.opts);
    }
    if (res) {
      // Hit SFX pitch tracks accuracy — a subtle, learnable "you're early/late"
      // channel that doesn't require looking away from the action.
      const err = clamp(-res.delta / 0.06, -1, 1);
      Voices.hit(this.bus, this.bus.ctx.currentTime, {
        grade: res.grade === Grade.MISS ? 'good' : res.grade,
        pitch: res.grade === Grade.PERFECT ? 0 : err * 2,
      });
    }
  }

  _release(action, perfMs) {
    if (!this.started || this.finished || this.paused) return;
    this.judge.release(action, this.conductor.songTimeAt(perfMs));
  }

  _onJudge(note, grade, delta) {
    note.judgedAt = this.juice.animTime;
    this.lastGrade = grade === 'holdend' ? 'great' : grade;
    this.gradeAge = 0;

    const x = RING.x, y = RING.y;
    this.juice.hit(x, y, grade, this.P);

    if (grade !== Grade.MISS && grade !== 'holdbreak') {
      this.castHit = 1;
      this.comboPop = 0;
      this.ticks.push({ ms: delta * 1000, grade: grade === 'holdend' ? 'great' : grade, a: 1 });
      if (this.ticks.length > 40) this.ticks.shift();
    }
    if (grade === Grade.MISS) {
      Voices.hit(this.bus, this.bus.ctx.currentTime, { grade: 'miss' });
    }
  }

  /* ── Frame ──────────────────────────────────────────────────────────────── */

  /**
   * @param {number} dt   real seconds since last frame
   * @param {number} perfMs the rAF timestamp
   */
  update(dt, perfMs) {
    this.conductor.tickClock(perfMs);

    // AUTHORITATIVE time. Note this is deliberately not the smoothed one.
    const jt = this.conductor.songTimeNow();
    if (!this.paused) this.judge.update(jt);

    // Decorative dt — zero during hitstop.
    const adt = this.juice.update(dt);
    this.view.update(dt);

    // Smoothed score counter. Chasing the target rather than snapping makes a
    // big combo feel like it's *pouring* in.
    this.displayScore += (this.judge.score - this.displayScore) * (1 - Math.pow(0.001, dt));
    if (Math.abs(this.judge.score - this.displayScore) < 1) this.displayScore = this.judge.score;

    this.comboPop = Math.min(1, this.comboPop + dt * 5.5);
    this.gradeAge = Math.min(1, this.gradeAge + dt * 2.2);
    this.castHit = Math.max(0, this.castHit - dt * 4);
    for (const k of ['A', 'B']) this.pressGlow[k] = Math.max(0, this.pressGlow[k] - dt * 6.5);
    for (const t of this.ticks) t.a = Math.max(0, t.a - dt * 0.28);

    // Hype: how excited the world is. Drives crowd, vignette, thruster.
    const targetHype = clamp(this.judge.combo / 40, 0, 1);
    this.hype += (targetHype - this.hype) * (1 - Math.pow(0.02, dt));

    this.scroll += adt * (0.6 + this.hype * 0.5);

    // Blink — small thing, big difference between "puppet" and "character".
    this.blinkT -= adt;
    if (this.blinkT <= 0) { this.blinkT = 2.2 + Math.random() * 3.4; this.blink = 1; }
    this.blink = Math.max(0, this.blink - adt * 7);

    this.bannerAge += dt;
    this._checkSection(jt);

    if (!this.finished && jt > this.endTime) {
      this.finished = true;
      this.stop();
      this.onFinish?.(this._results());
    }
  }

  _checkSection(songTime) {
    const beat = this.conductor.timeToBeat(songTime);
    const S = this.level.sections;
    let idx = -1;
    for (let i = 0; i < S.length; i++) if (beat >= S[i].beat) idx = i;
    if (idx !== this.sectionIdx) {
      this.sectionIdx = idx;
      const label = S[idx]?.label;
      if (label) { this.banner = label; this.bannerAge = 0; }
    }
  }

  _results() {
    return {
      level: this.level,
      score: this.judge.score,
      accuracy: this.judge.accuracy,
      counts: { ...this.judge.counts },
      maxCombo: this.judge.maxCombo,
      strays: this.judge.strays,
      rank: this.judge.rank(),
      verdict: this.judge.verdict(),
      meanErrorMs: this.judge.meanErrorMs,
      jitterMs: this.judge.jitterMs,
      total: this.judge.total,
    };
  }

  /* ── Draw ───────────────────────────────────────────────────────────────── */

  draw(perfMs) {
    const c = this.view.ctx;
    const vt = this.conductor.visualSongTime(perfMs);
    const beat = this.conductor.timeToBeat(vt);
    const phase = beat - Math.floor(beat);
    const P = this.P;

    this.view.begin();

    this.scene(c, P, { beat, hype: this.hype, time: this.juice.animTime, scroll: this.scroll });
    this._drawCast(c, beat, phase);

    drawLane(c, P, { conductor: this.conductor, songTime: vt, pxPerSec: this.pxPerSec });
    this._drawCues(c, vt);
    drawRing(c, P, {
      phase,
      pressed: Math.max(this.pressGlow.A, this.pressGlow.B),
      glow: this.hype * 0.4,
      lastGrade: this.lastGrade,
      gradeAge: this.gradeAge,
    });

    this.juice.draw(c);

    // HUD
    drawScore(c, P, {
      score: this.judge.score,
      displayScore: this.displayScore,
      combo: this.judge.combo,
      comboPop: this.comboPop,
      accuracy: this.judge.accuracy,
    });
    drawProgress(c, P, {
      t01: vt / this.conductor.beatToTime(this.level.endBeat),
      sections: this.level.sections
        .filter((s) => s.label)
        .map((s) => s.beat / this.level.endBeat),
    });
    if (this.settings.showMeter) {
      drawTimingMeter(c, P, { ticks: this.ticks, meanMs: this.judge.meanErrorMs });
    }

    // Count-in before the first note.
    const firstT = this.notes.length ? this.notes[0].time : 0;
    if (vt < firstT) {
      const beatsLeft = this.conductor.timeToBeat(firstT) - beat;
      drawCountIn(c, P, { beatsLeft });
    }

    drawBanner(c, P, { text: this.banner, age: this.bannerAge });
    this.juice.drawFlash(c);

    if (this.paused) this._drawPause(c);
  }

  _drawCues(c, vt) {
    // Draw far→near so nearer cues overlap farther ones; the one you're about
    // to hit is always on top.
    const first = Math.max(0, this.judge._searchFrom - 8);
    const pending = [];
    for (let i = first; i < this.notes.length; i++) {
      const n = this.notes[i];
      const dt = n.time - vt;
      if (dt > this.approachSec + 0.4) break;
      if (dt < -0.6) continue;
      if (n.judged && this.juice.animTime - n.judgedAt > 0.45) continue;
      pending.push(n);
    }

    for (let i = pending.length - 1; i >= 0; i--) {
      const n = pending[i];
      const dt = n.time - vt;
      const x = RING.x + dt * this.pxPerSec;
      const holdPx = n.type === 'hold' ? (n.holdEnd - n.time) * this.pxPerSec : 0;
      drawCue(c, this.P, {
        x, y: RING.y,
        tToHit: dt,
        action: n.action,
        type: n.type,
        held: !!n.holding,
        holdPx,
        judged: n.judged,
        grade: n.grade,
        age: this.juice.animTime - n.judgedAt,
        // Spin is driven by musical position, so cues in a stream stay in
        // rotational lockstep — a small thing that reads as "tight".
        spin: this.conductor.timeToBeat(vt) * 0.9 + n.beat * 0.6,
      });
    }
  }

  /* ── Per-level cast staging ─────────────────────────────────────────────── */

  _drawCast(c, beat, phase) {
    const P = this.P;
    const hit = this.castHit;
    const blink = this.blink;

    if (this.level.scene === 'savanna') {
      Critters.crowd(c, P, { x: 40, y: 322, w: 880, count: 12, beat, hype: this.hype, s: 0.8 });
      Critters.giraffe(c, P, { x: 762, y: CUE_Y + 96, s: 1.0, phase, beat, baton: 1, blink });

      // Meerkats pop in time with the CALL phrases, and on the player's hits.
      const xs = [300, 400, 500, 600];
      xs.forEach((x, i) => {
        Critters.burrow(c, P, { x, y: CUE_Y + 96, s: 0.95, glow: i === 0 ? hit : 0 });
      });
      xs.forEach((x, i) => {
        // Each burrow answers a different sixteenth of the bar, so the row
        // reads as a drum kit rather than four copies of one animation.
        const off = i * 0.25;
        const local = ((beat + off) % 1);
        const active = clamp(1 - Math.abs(((beat % 4) / 4) - i / 4) * 6, 0, 1);
        const pop = clamp(0.35 + active * 0.65 + hit * 0.4, 0, 1);
        Critters.meerkat(c, P, {
          x, y: CUE_Y + 96, s: 0.95, pop, phase: local,
          mood: 1, blink, arms: hit, seed: i,
          look: [clamp((RING.x - x) / 400, -1, 1) * 0.6, 0.2],
        });
      });

    } else if (this.level.scene === 'tidepool') {
      for (let i = 0; i < 7; i++) {
        Critters.jelly(c, P, {
          x: 90 + i * 132, y: 150 + (i % 3) * 46, s: 0.9 + (i % 3) * 0.25,
          beat, seed: i * 2.7, hue: i % 2 ? P.hot : P.cue,
        });
      }
      Critters.crowd(c, P, { x: 60, y: VH - 14, w: 840, count: 9, beat, hype: this.hype, s: 0.7 });
      Critters.octopus(c, P, {
        x: 748, y: CUE_Y + 110, s: 1.05, phase, beat, blink,
        throwT: hit, mood: 1,
      });

    } else {
      // Overdrive — the fox rides at the left, near the ring, because at this
      // speed the player's eye can't afford to travel.
      Critters.crowd(c, P, { x: 30, y: 344, w: 900, count: 14, beat, hype: this.hype, s: 0.6 });
      Critters.fox(c, P, {
        x: 300, y: CUE_Y + 20, s: 1.05, phase, beat,
        crouch: hit, lean: -0.25 - this.hype * 0.25 + hit * 0.4,
        blink, boost: this.hype,
      });
      // Speed lines scale with hype.
      layer(c, () => {
        c.globalAlpha = 0.10 + this.hype * 0.2;
        for (let i = 0; i < 16; i++) {
          const s = Critters.seedOffset(i * 3.1);
          const y = 120 + s * 300;
          const x = VW - ((this.scroll * (500 + s * 700) + s * VW) % (VW + 300));
          stroke_(c, [[x, y], [x + 60 + s * 120, y]], 2 + s * 2, '#00e5ff');
        }
      });
    }
  }

  _drawPause(c) {
    c.fillStyle = 'rgba(10,7,18,0.72)';
    c.fillRect(0, 0, VW, VH);
    boldText(c, 'PAUSED', VW / 2, VH / 2 - 20, 56, this.P.cue, INK);
    boldText(c, 'ESC to resume  ·  BACKSPACE to quit', VW / 2, VH / 2 + 40, 18, '#fffaf0', INK);
  }
}
