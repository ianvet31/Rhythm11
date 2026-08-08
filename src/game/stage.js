/**
 * Stage — the base class every minigame extends.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The first build of this game had ONE presentation — a scrolling lane — and
 * three levels that differed only in art and chart. That is a Guitar Hero, not
 * a Rhythm Heaven. The defining property of Rhythm Heaven is that each minigame
 * is its own tiny self-contained world with its own verb, its own cue language,
 * and its own joke.
 *
 * So presentation is now the level's job, not the engine's. The engine owns
 * time, input, and judgment; the Stage owns absolutely everything the player
 * sees. Two stages can share nothing but the Judge and still both be correct.
 *
 * ── What a Stage may and may not do ──────────────────────────────────────────
 *
 * A Stage is handed the full note list and cue list up front, and may look as
 * far ahead in them as it likes. Knowing the future is fine — DISPLAYING it is
 * the thing under restriction:
 *
 *   ALLOWED   showing the pulse (a swinging baton, a bobbing head)
 *   ALLOWED   animating a CALL as it sounds — that's confirming audio the
 *             player is hearing right now
 *   ALLOWED   reacting to the player after the fact, as loudly as you like
 *   ALLOWED   deliberately misleading visuals, if the audio stays honest
 *
 *   FORBIDDEN any animation that reliably predicts the timing of a note the
 *             player still owes. The moment a lean, a glow, or an approaching
 *             object becomes a dependable countdown, players will use it, the
 *             music becomes decorative, and the game stops being this genre.
 *
 * Each concrete stage documents which of its animations are cues and which are
 * decoration, so the distinction survives future edits.
 */

import { clamp, lerp, ease } from '../render/shapes.js';

export class Stage {
  /**
   * @param {object} P palette for this world
   * @param {object} data { notes, cues, conductor, level }
   */
  constructor(P, data) {
    this.P = P;
    this.notes = data.notes;
    this.cues = data.cues || [];
    this.conductor = data.conductor;
    this.level = data.level;

    /** Cursor into `cues`, advanced by _pumpCues(). */
    this._cueAt = 0;
    /** Rolling animation state most stages want. */
    this.blink = 0;
    this._blinkT = Math.random() * 3;
    this.hype = 0;
  }

  /* ── Lifecycle ─────────────────────────────────────────────────────────── */

  reset() {
    this._cueAt = 0;
    this.blink = 0;
    this._blinkT = 1.5;
  }

  /**
   * @param {number} dt  real seconds
   * @param {number} adt decorative seconds — zero during hitstop
   * @param {object} t   { songTime, beat, phase, hype }
   */
  update(dt, adt, t) {
    this.hype = t.hype;
    this._pumpCues(t.songTime);

    this._blinkT -= adt;
    if (this._blinkT <= 0) { this._blinkT = 2.4 + Math.random() * 3.6; this.blink = 1; }
    this.blink = Math.max(0, this.blink - adt * 7);
  }

  /** Fire onCue() for every cue whose moment has arrived. */
  _pumpCues(songTime) {
    while (this._cueAt < this.cues.length && this.cues[this._cueAt].time <= songTime) {
      this.onCue(this.cues[this._cueAt], songTime);
      this._cueAt++;
    }
    // Seeking backwards (a retry) needs the cursor rewound.
    while (this._cueAt > 0 && this.cues[this._cueAt - 1].time > songTime + 0.5) {
      this._cueAt--;
    }
  }

  /** A game-played call/telegraph just sounded. Override. */
  onCue(_cue, _songTime) {}

  /** The player was judged. Override. */
  onJudge(_note, _grade, _delta) {}

  /** Draw everything. Override. */
  draw(_c, _t) {}

  /**
   * Where judgment feedback (particles, popups) should appear, in virtual
   * coords. Feedback belongs ON the character, not on a fixed HUD position —
   * that's what makes the character feel like the thing you're controlling.
   */
  focus() { return { x: 480, y: 300 }; }

  /* ── Helpers most stages want ──────────────────────────────────────────── */

  /**
   * A decaying impulse: returns 1 at the moment of an event, falling to 0 over
   * `dur` seconds. The standard way to turn "this happened at time T" into an
   * animation value without storing per-frame state.
   */
  static since(now, when, dur) {
    if (when == null || now < when) return 0;
    return clamp(1 - (now - when) / dur, 0, 1);
  }

  /** Same, but with a snappy attack then a slow release — good for sung notes. */
  static envelope(now, when, attack, release) {
    if (when == null || now < when) return 0;
    const t = now - when;
    if (t < attack) return ease.outCubic(t / attack);
    const r = (t - attack) / release;
    return r >= 1 ? 0 : 1 - ease.inQuad(r);
  }
}

/**
 * Build the note list the Judge consumes, resolving beats to seconds.
 * Shared by every level so the conversion happens in exactly one place.
 */
export function compileNotes(chart, conductor) {
  return chart.map((n) => ({
    ...n,
    time: conductor.beatToTime(n.beat),
    holdEnd: n.type === 'hold'
      ? conductor.beatToTime(n.beat + (n.holdBeats || 0))
      : undefined,
    judgedAt: 0,
  })).sort((a, b) => a.time - b.time);
}

/** Same, for the presentation cue list. */
export function compileCues(cues, conductor) {
  return cues.map((q) => ({
    ...q,
    time: conductor.beatToTime(q.beat),
  })).sort((a, b) => a.time - b.time);
}
