/**
 * Conductor — the single source of musical time.
 *
 * ── Why this file is the most important one in the repo ──────────────────────
 *
 * A rhythm game has THREE clocks that do not agree, and the entire "feel" of the
 * game is the job of reconciling them:
 *
 *   1. AudioContext.currentTime  — the only clock the sound card obeys. It is
 *      the truth, but it advances in chunks (one render quantum, 128 samples
 *      ≈ 2.7ms at 48kHz) and it is NOT the same epoch as anything else.
 *
 *   2. performance.now()         — smooth, sub-millisecond, and the epoch that
 *      keyboard/pointer events are stamped with. This is what the *player*
 *      lives in.
 *
 *   3. requestAnimationFrame     — when pixels get presented. Locked to the
 *      display, ~16.7ms granularity, and always a little behind reality.
 *
 * Naive rhythm games read `audioCtx.currentTime` inside their render loop and
 * compare it to `Date.now()` on keypress. That mixes all three clocks and you
 * get a game that feels "off" in a way players can sense but not name.
 *
 * The Conductor instead keeps an explicit, continuously-corrected affine map
 * between clock 2 and clock 1, then expresses everything in ONE unit:
 *
 *      songTime — seconds since the player HEARD beat 0.
 *
 * "Heard", not "scheduled". Those differ by the output latency of the audio
 * stack (buffer + OS mixer + Bluetooth, anywhere from 5ms to 300ms). Every
 * public method below returns heard-time, so gameplay code never has to think
 * about it.
 *
 * ── The mental model ─────────────────────────────────────────────────────────
 *
 * Think of the song as a train on a track, moving at a constant, known speed.
 *   • The audio hardware is the train — it cannot be sped up or slowed down.
 *   • perf→ctx mapping is us watching the train through a telescope and
 *     figuring out exactly where it is right now.
 *   • Rendering is us painting a picture of where the train will be when the
 *     paint dries (one frame from now).
 * We never move the train to match our picture. We repaint the picture.
 */

// Exponential smoothing factor for the perf→ctx clock correlation.
// Low = trusts history, rejects jitter, but adapts slowly to real drift.
// 0.02 settles in ~2s of frames and rejects the ±1ms noise in getOutputTimestamp.
const CLOCK_SMOOTHING = 0.02;

// How often (ms) to resample the hardware clock correlation.
const RESYNC_INTERVAL_MS = 250;

export class Conductor {
  /** @param {AudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;

    /** ctx.currentTime at which beat 0 was *scheduled*. null when stopped. */
    this.startCtx = null;

    /** Tempo map: array of {beat, bpm, secPerBeat} sorted by beat.
     *  Precomputed cumulative seconds let us do beat↔time in O(log n). */
    this.tempoMap = [];
    /** Cumulative seconds at the start of each tempo segment. */
    this._segTime = [];

    /**
     * perfSeconds → ctxSeconds offset.  ctxTime ≈ perfSeconds + clockOffset
     * Continuously corrected; see _resyncClock().
     */
    this.clockOffset = 0;
    this._clockPrimed = false;
    this._lastResync = -Infinity;

    /**
     * How long after we hand a sample to the audio graph it actually leaves the
     * speaker. We prefer the browser's own measurement; baseLatency alone
     * undercounts (it's only the graph's internal buffer, not the OS mixer).
     */
    this.outputLatency = 0;

    /**
     * Player-tunable calibration, in seconds.
     *   audioOffset  — shifts JUDGMENT. Positive = player is hitting late, so we
     *                  forgive lateness. Set by the calibration minigame.
     *   visualOffset — shifts RENDERING only. For displays that lag the audio.
     * These are deliberately separate: conflating them is why "calibration" in
     * a lot of games fixes the score but makes the animation look wrong.
     */
    this.audioOffset = 0;
    this.visualOffset = 0;

    /** Smoothed song time used by the renderer, so visuals never stutter even
     *  if a frame is late or the clock correlation nudges. */
    this._visualSong = 0;
    this._visualPrimed = false;

    this.playing = false;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Tempo map
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {Array<{beat:number, bpm:number}>} changes
   *   Must include a change at beat 0. Tempo is constant within a segment, so
   *   beat↔time inside a segment is a straight line and we only integrate at
   *   the boundaries — this keeps charts authored in BEATS (musically sane)
   *   while the engine runs on SECONDS (physically sane).
   */
  setTempoMap(changes) {
    const sorted = [...changes].sort((a, b) => a.beat - b.beat);
    if (!sorted.length || sorted[0].beat !== 0) {
      throw new Error('Tempo map must start with a change at beat 0.');
    }
    this.tempoMap = sorted.map((c) => ({
      beat: c.beat,
      bpm: c.bpm,
      secPerBeat: 60 / c.bpm,
    }));

    this._segTime = [0];
    for (let i = 1; i < this.tempoMap.length; i++) {
      const prev = this.tempoMap[i - 1];
      const beats = this.tempoMap[i].beat - prev.beat;
      this._segTime[i] = this._segTime[i - 1] + beats * prev.secPerBeat;
    }
  }

  /** Musical beat → seconds from beat 0. */
  beatToTime(beat) {
    let i = this.tempoMap.length - 1;
    while (i > 0 && this.tempoMap[i].beat > beat) i--;
    const seg = this.tempoMap[i];
    return this._segTime[i] + (beat - seg.beat) * seg.secPerBeat;
  }

  /** Seconds from beat 0 → musical beat. */
  timeToBeat(time) {
    let i = this._segTime.length - 1;
    while (i > 0 && this._segTime[i] > time) i--;
    const seg = this.tempoMap[i];
    return seg.beat + (time - this._segTime[i]) / seg.secPerBeat;
  }

  /** BPM in effect at a given song time. */
  bpmAt(time) {
    let i = this._segTime.length - 1;
    while (i > 0 && this._segTime[i] > time) i--;
    return this.tempoMap[i].bpm;
  }

  secPerBeatAt(time) {
    return 60 / this.bpmAt(time);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Clock correlation
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Re-measure the relationship between performance.now() and ctx.currentTime.
   *
   * getOutputTimestamp() is the good path: it reports a (contextTime,
   * performanceTime) pair describing the same physical instant — specifically
   * the frame currently being *presented by the audio hardware*. That is
   * exactly the correspondence we want.
   *
   * The fallback (currentTime sampled next to performance.now()) is off by up
   * to one render quantum and by the output buffer, which is why we correct it
   * with outputLatency below.
   */
  _resyncClock(perfMs) {
    let sample = null;

    const ots = this.ctx.getOutputTimestamp?.();
    if (ots && ots.contextTime > 0 && ots.performanceTime > 0) {
      // contextTime is the ctx time of audio LEAVING the device at
      // performanceTime. Add outputLatency back to express it as "ctx time we
      // would have been scheduling for", keeping one consistent frame of
      // reference throughout.
      sample = ots.contextTime + this.outputLatency - ots.performanceTime / 1000;
    } else {
      sample = this.ctx.currentTime - performance.now() / 1000;
    }

    if (!this._clockPrimed) {
      this.clockOffset = sample;
      this._clockPrimed = true;
    } else {
      // Exponential filter. A hard jump here would teleport the judgment line
      // mid-song, which reads to the player as a random miss.
      this.clockOffset += (sample - this.clockOffset) * CLOCK_SMOOTHING;
    }
    this._lastResync = perfMs;
  }

  /** Refresh latency + clock estimates. Call once per frame; it self-throttles. */
  tickClock(perfMs = performance.now()) {
    // outputLatency can change mid-session (user plugs in headphones / BT).
    const reported = this.ctx.outputLatency;
    const measured = Number.isFinite(reported) && reported > 0
      ? reported
      : (this.ctx.baseLatency || 0);
    if (measured > 0) {
      this.outputLatency = this.outputLatency === 0
        ? measured
        : this.outputLatency + (measured - this.outputLatency) * 0.1;
    }

    if (perfMs - this._lastResync >= RESYNC_INTERVAL_MS) this._resyncClock(perfMs);
  }

  /** performance.now() milliseconds → AudioContext seconds. */
  perfToCtx(perfMs) {
    return perfMs / 1000 + this.clockOffset;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Transport
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * @param {number} leadIn seconds of silence before beat 0. Gives the
   *   scheduler runway and gives the player a countdown.
   * @returns {number} the ctx time beat 0 is scheduled at (for the sequencer).
   */
  start(leadIn = 1.2) {
    this._resyncClock(performance.now());
    this.startCtx = this.ctx.currentTime + leadIn;
    this._visualPrimed = false;
    this.playing = true;
    return this.startCtx;
  }

  stop() {
    this.playing = false;
    this.startCtx = null;
  }

  /**
   * Raw, un-smoothed song time right now, in HEARD time.
   *
   * Derivation: at ctx time C the speaker is emitting audio that was scheduled
   * for C − outputLatency. So the musical position the player is hearing is
   * (C − outputLatency) − startCtx.
   */
  songTimeNow() {
    if (this.startCtx === null) return 0;
    return this.ctx.currentTime - this.outputLatency - this.startCtx;
  }

  /**
   * Song time to attribute to a real-world instant, used for INPUT.
   * @param {number} perfMs an event's `timeStamp` (same epoch as performance.now)
   *
   * audioOffset is subtracted here and nowhere else: calibration is a property
   * of judgment, not of the music.
   */
  songTimeAt(perfMs) {
    if (this.startCtx === null) return 0;
    return this.perfToCtx(perfMs) - this.outputLatency - this.startCtx - this.audioOffset;
  }

  /**
   * Song time to RENDER at, given the rAF timestamp.
   *
   * Two corrections beyond songTimeAt():
   *   • +visualOffset for display lag.
   *   • Light smoothing. The clock correlation wobbles by a fraction of a ms;
   *     invisible in audio, but a note lane scrolling at 600px/sec turns that
   *     wobble into visible shimmer. We low-pass it, and snap if we're way off
   *     (tab was backgrounded, or a seek happened).
   */
  visualSongTime(perfMs) {
    if (this.startCtx === null) return 0;
    const target = this.perfToCtx(perfMs) - this.outputLatency - this.startCtx + this.visualOffset;

    if (!this._visualPrimed || Math.abs(target - this._visualSong) > 0.08) {
      this._visualSong = target;
      this._visualPrimed = true;
    } else {
      this._visualSong += (target - this._visualSong) * 0.35;
    }
    return this._visualSong;
  }

  /** Convenience: current musical beat, smoothed, for visuals. */
  visualBeat(perfMs) {
    return this.timeToBeat(this.visualSongTime(perfMs));
  }

  /**
   * Where we are inside the current beat, 0..1. The workhorse for bounce,
   * squash-and-stretch, and any "pulse on the beat" animation.
   */
  beatPhase(perfMs) {
    const b = this.visualBeat(perfMs);
    return b - Math.floor(b);
  }
}
