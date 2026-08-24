/**
 * Calibration.
 *
 * ── Why a rhythm game must ship with this ────────────────────────────────────
 *
 * Between "the sound card was told to play a click" and "the player's finger
 * moves" there is a chain of delays nobody in the browser can measure directly:
 *
 *     audio buffer → OS mixer → DAC → speaker → air → ear
 *     eye/ear → brain → muscle → key travel → USB poll → OS → JS event
 *
 * That chain is 20ms on a wired desktop setup and can exceed 250ms on Bluetooth
 * headphones. `AudioContext.outputLatency` covers only the first half of the
 * first line. Everything else has to be MEASURED, and the only instrument
 * available is the player themselves.
 *
 * ── The method ───────────────────────────────────────────────────────────────
 *
 * Play a steady click. Ask the player to tap along. Their taps will cluster
 * around the click with some systematic offset — that offset is the whole
 * latency chain plus their personal bias, and subtracting it makes the game
 * fair for them specifically.
 *
 * Two details that matter:
 *
 *   • Use the MEDIAN, not the mean. One tap where the player sneezed would drag
 *     a mean by tens of milliseconds. The median ignores it entirely.
 *
 *   • Fold each tap to the NEAREST click, not the previous one. A player who is
 *     40ms early on a 500ms interval is 40ms early — not 460ms late. Without
 *     the fold, a slightly-early player calibrates to nearly a full beat off.
 *
 * The first few taps are discarded: people take a moment to lock on, and those
 * taps are noise.
 */

import { Voices } from '../audio/synth.js';
import { Sequencer } from '../audio/sequencer.js';
import { calibrationSong } from '../audio/song.js';

const WARMUP_TAPS = 4;
const NEEDED_TAPS = 16;
const CAL_BPM = 100;

export class Calibrator {
  /**
   * @param {import('../audio/synth.js').AudioBus} bus
   * @param {import('../core/conductor.js').Conductor} conductor
   */
  constructor(bus, conductor) {
    this.bus = bus;
    this.conductor = conductor;
    this.secPerBeat = 60 / CAL_BPM;
    this.taps = [];
    this.running = false;
    this.onUpdate = null;

    /**
     * The click track is an ordinary Song played by the ordinary Sequencer.
     *
     * This used to be a bespoke setInterval loop scheduling its own clicks —
     * which meant the code MEASURING your latency was not the code that would
     * later USE that measurement. Two implementations of the same idea can
     * disagree, and if they do, calibration silently makes gameplay worse
     * instead of better.
     *
     * Sharing the machinery makes that class of bug impossible: if the click is
     * where the player expects, so is every note in every level.
     */
    this.song = calibrationSong(CAL_BPM);
    this.sequencer = new Sequencer(bus, conductor);
    this.sequencer.load(this.song.synthEvents());
  }

  start() {
    this.taps = [];
    this.running = true;
    this.conductor.setTempoMap(this.song.tempoMap);
    this.startCtx = this.conductor.start(0.7);
    this.sequencer.start(this.startCtx);
  }

  stop() {
    this.running = false;
    this.sequencer.stop();
    this.conductor.stop();
  }

  /** @param {number} perfMs event.timeStamp */
  tap(perfMs) {
    if (!this.running) return null;

    // Deliberately does NOT apply the existing audioOffset — we are measuring
    // raw error, not error-after-correction.
    const raw = this.conductor.perfToCtx(perfMs) - this.conductor.outputLatency - this.startCtx;

    // Fold to nearest click.
    const beats = raw / this.secPerBeat;
    const nearest = Math.round(beats);
    if (nearest < 0) return null;
    const delta = (beats - nearest) * this.secPerBeat;

    // Reject anything more than a third of a beat out — that's not a tap at
    // this click, it's a mistake, and including it corrupts the sample.
    if (Math.abs(delta) > this.secPerBeat / 3) {
      this.onUpdate?.(this.state());
      return null;
    }

    this.taps.push(delta);
    this.onUpdate?.(this.state());
    return delta;
  }

  state() {
    const usable = this.taps.slice(WARMUP_TAPS);
    return {
      count: this.taps.length,
      warmup: Math.min(this.taps.length, WARMUP_TAPS),
      needed: NEEDED_TAPS + WARMUP_TAPS,
      ready: this.taps.length >= NEEDED_TAPS + WARMUP_TAPS,
      offsetMs: usable.length ? median(usable) * 1000 : 0,
      spreadMs: usable.length > 2 ? iqr(usable) * 1000 : 0,
      recent: this.taps.slice(-24),
    };
  }

  /** Apply the measured offset to the conductor and return it in ms. */
  apply() {
    const s = this.state();
    this.conductor.audioOffset = s.offsetMs / 1000;
    return s.offsetMs;
  }
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Interquartile range — a robust "how consistent were you" figure. */
function iqr(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  return q(0.75) - q(0.25);
}
