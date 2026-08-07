/**
 * Sequencer — turns a song definition into scheduled audio.
 *
 * ── The lookahead pattern ────────────────────────────────────────────────────
 *
 * The naive approach is to play notes from the render loop: "is it time for the
 * next note? then play it now." That fails badly, because rAF fires at display
 * granularity (~16.7ms) and stops entirely when the tab is backgrounded. Every
 * note would land up to 16ms late, unevenly. That is *audible* — the groove
 * would wobble.
 *
 * Instead we run a slow timer that looks a quarter second into the future and
 * schedules everything in that window at its exact time. Web Audio's scheduler
 * then fires those events on the audio thread with sample accuracy, completely
 * independent of frame rate, GC pauses, or tab focus.
 *
 *      now                          now + LOOKAHEAD
 *       │  ♪    ♪ ♪      ♪    ♪  ♪  │        ♪   ♪ ♪
 *       ├───────────────────────────┤
 *       └─ everything in here gets scheduled this tick, with exact timestamps
 *
 * The timer only has to fire *sometime* within the lookahead window. It can be
 * late by 100ms and the music is still perfect. That is the whole trick.
 */

import { Voices } from './synth.js';

const LOOKAHEAD_SEC = 0.28;   // how far ahead we schedule
const TICK_MS = 25;           // how often we check

/**
 * Compile a step string into beat offsets.
 *
 *   "x...x...x...x..."  with div=4  →  kick on every beat, 4 beats long
 *
 * Characters:
 *   x  hit at full velocity
 *   X  accent (velocity 1.35)
 *   o  ghost note (velocity 0.45)
 *   .  rest
 *   |  bar separator, ignored (purely for the author's eyes)
 *
 * @param {string} str
 * @param {number} div steps per beat (4 = sixteenths, 3 = triplets, 2 = eighths)
 * @returns {Array<{beat:number, vel:number}>}
 */
export function steps(str, div = 4) {
  const out = [];
  let i = 0;
  for (const ch of str) {
    if (ch === '|' || ch === ' ') continue;
    if (ch === 'x') out.push({ beat: i / div, vel: 1 });
    else if (ch === 'X') out.push({ beat: i / div, vel: 1.35 });
    else if (ch === 'o') out.push({ beat: i / div, vel: 0.45 });
    i++;
  }
  return out;
}

/**
 * Compile a melodic line.
 *
 *   mel("C4 E4 G4 - | C5 - . .", 2)
 *
 *   token   meaning
 *   C4      note starting on this step
 *   -       tie: extend the previous note by one step
 *   .       rest
 *   [C4,E4] chord
 *
 * @param {string} str
 * @param {number} div steps per beat
 * @returns {Array<{beat:number, notes:string[], beats:number}>}
 */
export function mel(str, div = 2) {
  const out = [];
  const tokens = str.split(/\s+/).filter((t) => t && t !== '|');
  let step = 0;
  for (const tk of tokens) {
    if (tk === '-') {
      if (out.length) out[out.length - 1].beats += 1 / div;
      step++;
      continue;
    }
    if (tk === '.') { step++; continue; }
    const notes = tk.startsWith('[')
      ? tk.slice(1, -1).split(',').map((s) => s.trim())
      : [tk];
    out.push({ beat: step / div, notes, beats: 1 / div });
    step++;
  }
  return out;
}

/** Transpose a compiled melodic line by semitones (used for key changes). */
export function transpose(line, semis) {
  if (!semis) return line;
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const shift = (n) => {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
    if (!m) return n;
    let v = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
    v += semis;
    return `${NAMES[((v % 12) + 12) % 12]}${Math.floor(v / 12) - 1}`;
  };
  return line.map((e) => ({ ...e, notes: e.notes.map(shift) }));
}

/**
 * A song is a list of EVENTS in absolute beats, produced by the song modules.
 * Each event: { beat, voice, opts }  where voice is a key of Voices.
 *
 * Building the whole event list up front (rather than generating it live) means
 * the chart, the visuals, and the audio can all read the same array — so a
 * character can be animated to "play" the exact note that is sounding.
 */
export class Sequencer {
  /**
   * @param {import('./synth.js').AudioBus} bus
   * @param {import('../core/conductor.js').Conductor} conductor
   */
  constructor(bus, conductor) {
    this.bus = bus;
    this.conductor = conductor;
    this.events = [];
    this.cursor = 0;
    this.startCtx = 0;
    this._timer = null;
    /** Called for each scheduled event, so visuals can react. */
    this.onSchedule = null;
  }

  /** @param {Array<{beat:number, voice:string, opts?:object}>} events */
  load(events) {
    this.events = [...events].sort((a, b) => a.beat - b.beat);
    this.cursor = 0;
  }

  /** @param {number} startCtx absolute ctx time of beat 0 */
  start(startCtx, fromBeat = 0) {
    this.startCtx = startCtx;
    this.cursor = 0;
    while (this.cursor < this.events.length && this.events[this.cursor].beat < fromBeat) {
      this.cursor++;
    }
    this._tick();
    this._timer = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  /** True once every event has been handed to the audio thread. */
  get finished() { return this.cursor >= this.events.length; }

  /** Beat of the last event, i.e. where the song ends. */
  get lastBeat() {
    return this.events.length ? this.events[this.events.length - 1].beat : 0;
  }

  _tick() {
    const horizon = this.conductor.ctx.currentTime + LOOKAHEAD_SEC;
    while (this.cursor < this.events.length) {
      const ev = this.events[this.cursor];
      const when = this.startCtx + this.conductor.beatToTime(ev.beat);
      if (when > horizon) break;

      const fn = Voices[ev.voice];
      if (fn) {
        // Guard against a stall: never schedule in the past, that plays
        // instantly and clumps notes together audibly.
        fn(this.bus, Math.max(when, this.conductor.ctx.currentTime), ev.opts || {});
      }
      this.onSchedule?.(ev, when);
      this.cursor++;
    }
  }
}

/* ── Authoring helpers ─────────────────────────────────────────────────────── */

/**
 * Place a drum pattern into the event stream.
 * @param {Array} out       event array to append to
 * @param {string} voice    a key of Voices
 * @param {Array} pattern   result of steps()
 * @param {number} atBeat   where the pattern starts
 * @param {number} lengthBeats  pattern length, for repeats
 * @param {number} repeats
 * @param {object} opts     base voice opts; `gain` is scaled by step velocity
 */
export function drums(out, voice, pattern, atBeat, lengthBeats, repeats = 1, opts = {}, swing = 0) {
  const baseGain = opts.gain ?? 1;
  for (let r = 0; r < repeats; r++) {
    for (const s of pattern) {
      out.push({
        beat: atBeat + r * lengthBeats + swingBeat(s.beat, swing),
        voice,
        opts: { ...opts, gain: baseGain * s.vel },
      });
    }
  }
  return out;
}

/**
 * Swing: push the second eighth of each beat later.
 *
 *   straight  |♪  ♪  |♪  ♪  |     even halves
 *   swung     |♪   ♪ |♪   ♪ |     long-short, ~2:1 at swing=0.33
 *
 * Applied to the audio AND to the chart, from the same function, so a swung
 * note's visual cue and its judgment target move together. Swinging only the
 * music (a classic bug) makes a level feel subtly, maddeningly wrong.
 */
export function swingBeat(beat, swing = 0) {
  if (!swing) return beat;
  const whole = Math.floor(beat);
  const frac = beat - whole;
  // Only the off-eighth moves; 16ths inside each half are scaled with it.
  if (frac < 0.5) return whole + frac * (1 + swing);
  return whole + 0.5 * (1 + swing) + (frac - 0.5) * (1 - swing);
}

/**
 * Place a melodic line into the event stream.
 * @param {number} swing  0..1, delays every off-beat step. 0.33 ≈ triplet swing.
 */
export function melody(out, voice, line, atBeat, lengthBeats, repeats = 1, opts = {}, swing = 0) {
  for (let r = 0; r < repeats; r++) {
    for (const e of line) {
      const b = atBeat + r * lengthBeats + swingBeat(e.beat, swing);
      if (voice === 'stab' || voice === 'pad') {
        out.push({ beat: b, voice, opts: { ...opts, notes: e.notes, dur: e.beats * (opts.durScale ?? 1) } });
      } else {
        for (const n of e.notes) {
          out.push({ beat: b, voice, opts: { ...opts, note: n, dur: e.beats * (opts.durScale ?? 1) } });
        }
      }
    }
  }
  return out;
}
