/**
 * Play — the gameplay scene.
 *
 * ── What changed, and why ────────────────────────────────────────────────────
 *
 * This used to draw a scrolling note lane. It doesn't any more. The engine now
 * owns time, input, judgment and feedback; a per-level Stage owns everything
 * visible. See stage.js for the rules a Stage plays by.
 *
 * The practical consequence is that this file no longer knows what a "note"
 * looks like. It knows when notes are due and whether the player hit them, and
 * it hands both facts to the Stage. That's the whole reason three minigames
 * with nothing visual in common can share one engine.
 *
 * ── The one rule that governs this file ──────────────────────────────────────
 *
 * There are two clocks in here and they must never be confused:
 *
 *   JUDGMENT TIME   `conductor.songTimeNow()` / `songTimeAt(event.timeStamp)`
 *                   Unsmoothed, unfrozen, authoritative. Decides hits, misses,
 *                   and when notes retire. Nothing cosmetic may touch it.
 *
 *   VISUAL TIME     `conductor.visualSongTime(rafTimestamp)`
 *                   Smoothed, display-calibrated, stalled during hitstop.
 *                   Decides only what gets drawn.
 *
 * Every bug that makes a rhythm game feel unfair is some version of leaking one
 * into the other. Screen shake must not move the judgment line. Hitstop must
 * not pause the music. A dropped frame must not delay a miss.
 */

import { Grade } from '../core/judge.js';
import { Judge } from '../core/judge.js';
import { Sequencer } from '../audio/sequencer.js';
import { Voices } from '../audio/synth.js';
import { VW, VH } from '../render/view.js';
import { PALETTES } from '../render/palette.js';
import { compileNotes, compileCues } from './stage.js';
import { STAGES } from './stages/index.js';
import {
  drawCountIn, drawBanner, drawComboBadge, drawVerb, drawPauseCard, drawTimingMeter,
} from '../render/hud.js';
import { clamp } from '../render/shapes.js';

export class Play {
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

    // ── Build the timeline ────────────────────────────────────────────────
    this.conductor.setTempoMap(level.tempoMap);
    this.notes = compileNotes(level.chart(), this.conductor);
    this.cues = compileCues(level.cues ? level.cues() : [], this.conductor);

    this.judge = new Judge(this.notes);

    /**
     * A level's music can come from either source, or BOTH:
     *
     *   music()   synthesized events, scheduled by the lookahead sequencer
     *   deps.track  a decoded recorded song (see audio/track.js)
     *
     * Both are legitimate and layering them is genuinely useful: you can run a
     * real produced track underneath while the game still synthesizes its
     * telegraphs — the crow's caw, the whistle — so cues stay perfectly aligned
     * and stay audible over a busy mix, without having to bake them into the
     * export and re-render every time you tweak a chart.
     */
    this.sequencer = new Sequencer(this.bus, this.conductor);
    this.sequencer.load(level.music ? level.music() : []);
    this.track = deps.track || null;

    const StageClass = STAGES[level.stage];
    if (!StageClass) throw new Error(`Unknown stage: ${level.stage}`);
    this.stage = new StageClass(this.P, {
      notes: this.notes,
      cues: this.cues,
      conductor: this.conductor,
      level,
    });

    this.endTime = this.conductor.beatToTime(level.endBeat) + 2.6;

    // ── Presentation state ────────────────────────────────────────────────
    this.comboPop = 1;
    this.ticks = [];
    this.banner = null;
    this.bannerAge = 99;
    this.sectionIdx = -1;
    this.hype = 0;
    this.finished = false;
    this.started = false;
    this.paused = false;
    this.verbAge = 0;

    this._wire();
  }

  _wire() {
    this.judge.onJudge = (note, grade, delta) => this._onJudge(note, grade, delta);
    this.judge.onStray = () => {
      // A stray tap during a rest is the characteristic mistake of this genre.
      // It gets a small, dull, unmistakable "no" — never a big punishment,
      // because the player already knows.
      const f = this.stage.focus();
      this.juice.stray(f.x, f.y);
      Voices.hit(this.bus, this.bus.ctx.currentTime, { grade: 'miss', pitch: -9 });
    };
    this.judge.onMilestone = (value, tier) => {
      const f = this.stage.focus();
      this.juice.milestone(f.x, f.y - 90, value, this.P);
      Voices.chime(this.bus, this.bus.ctx.currentTime, { tier });
    };
  }

  start() {
    this.judge.reset();
    this.juice.clear();
    this.stage.reset();
    this.finished = false;
    this.verbAge = 0;

    // One `startCtx` drives everything: the synth sequencer and the recorded
    // track are both aligned to the same absolute instant of beat 0, so they
    // are sample-accurate against each other and against judgment.
    const startCtx = this.conductor.start(1.6);
    this.sequencer.start(startCtx);
    if (this.track) {
      this.track.connect(this.bus.music);
      this.track.start(startCtx);
    }
    this.started = true;

    this.input.enabled = true;
    this.input.onPress = (action, perfMs) => this._press(action, perfMs);
    this.input.onRelease = (action, perfMs) => this._release(action, perfMs);
  }

  stop() {
    this.sequencer.stop();
    this.track?.stop();
    this.conductor.stop();
    this.input.onPress = null;
    this.input.onRelease = null;
  }

  /* ── Input ──────────────────────────────────────────────────────────────── */

  /**
   * Runs INSIDE the keydown handler. Everything here is deliberately cheap and
   * synchronous: the audio scheduled at the bottom is the player's primary
   * feedback, and delaying it by even one frame is felt as input lag even when
   * the judgment was perfect.
   */
  _press(action, perfMs) {
    if (!this.started || this.finished || this.paused) return;
    const t = this.conductor.songTimeAt(perfMs);
    const res = this.judge.press(action, t);

    if (res && res.grade !== Grade.MISS && res.note.sound) {
      // The note's musical payload — the sung note, the footstep, the catch.
      // `currentTime`, not a scheduled future time, so it's as immediate as the
      // audio graph allows.
      const fn = Voices[res.note.sound.voice];
      fn?.(this.bus, this.bus.ctx.currentTime, res.note.sound.opts);
    }
    if (res) {
      // Hit SFX pitch tracks accuracy: a learnable early/late channel that
      // doesn't require looking away from the action. Quiet, because in this
      // genre the *music* should be the loudest feedback.
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
    this.stage.onJudge(note, grade, delta);

    // Feedback lands ON the character, wherever the stage says that is. This is
    // what makes the little guy feel like the thing you're controlling rather
    // than a decoration next to a scoreboard.
    const f = this.stage.focus();
    this.juice.hit(f.x, f.y, grade, this.P);

    if (grade !== Grade.MISS && grade !== 'holdbreak') {
      this.comboPop = 0;
      this.ticks.push({ ms: delta * 1000, grade: grade === 'holdend' ? 'great' : grade, a: 1 });
      if (this.ticks.length > 40) this.ticks.shift();
    }
    if (grade === Grade.MISS) {
      Voices.hit(this.bus, this.bus.ctx.currentTime, { grade: 'miss' });
      if (this.level.stage === 'choir') {
        Voices.croak(this.bus, this.bus.ctx.currentTime, { gain: 0.2 });
      }
    }
  }

  /* ── Frame ──────────────────────────────────────────────────────────────── */

  update(dt, perfMs) {
    this.conductor.tickClock(perfMs);

    // AUTHORITATIVE time — deliberately not the smoothed one.
    const jt = this.conductor.songTimeNow();
    if (!this.paused) this.judge.update(jt);

    // Decorative dt — zero during hitstop.
    const adt = this.juice.update(dt);
    this.view.update(dt);

    this.comboPop = Math.min(1, this.comboPop + dt * 5.5);
    for (const k of this.ticks) k.a = Math.max(0, k.a - dt * 0.28);
    this.verbAge += dt;
    this.bannerAge += dt;

    const targetHype = clamp(this.judge.combo / 30, 0, 1);
    this.hype += (targetHype - this.hype) * (1 - Math.pow(0.02, dt));

    const vt = this.conductor.visualSongTime(perfMs);
    const beat = this.conductor.timeToBeat(vt);
    this.stage.update(dt, adt, {
      songTime: vt,
      beat,
      phase: beat - Math.floor(beat),
      hype: this.hype,
    });

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

    this.view.begin();

    // The Stage draws the entire world. The engine adds only judgment feedback
    // and the few pieces of chrome below.
    this.stage.draw(c, { songTime: vt, beat, phase, hype: this.hype });

    this.juice.draw(c);

    /* ── Chrome ──────────────────────────────────────────────────────────
       Rhythm Heaven shows essentially nothing during play — no running score,
       no progress bar, no PERFECT/GREAT confetti on every note. A clean screen
       is not an aesthetic preference here, it's mechanical: every pixel of UI
       is a pixel the player might try to read timing from instead of listening.
       So the only persistent element is a combo badge, and even that is small
       and lives in a corner. The numbers all arrive at the results screen. */
    if (this.judge.combo >= 5) {
      drawComboBadge(c, this.P, { combo: this.judge.combo, pop: this.comboPop });
    }

    // The verb, for the first few seconds only.
    if (this.verbAge < 5.5) {
      drawVerb(c, this.P, { text: this.level.verb, age: this.verbAge, dur: 5.5 });
    }

    const firstT = this.notes.length ? this.notes[0].time : 0;
    if (vt < firstT) {
      drawCountIn(c, this.P, { beatsLeft: this.conductor.timeToBeat(firstT) - beat });
    }

    // Opt-in practice tool. See render/hud.js for why it is not on by default.
    if (this.settings.showMeter) {
      drawTimingMeter(c, this.P, { ticks: this.ticks, meanMs: this.judge.meanErrorMs });
    }

    drawBanner(c, this.P, { text: this.banner, age: this.bannerAge });
    this.juice.drawFlash(c);

    if (this.paused) drawPauseCard(c, this.P);
  }
}
