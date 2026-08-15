/**
 * AudioTrack — playing a real recorded song in perfect sync with the chart.
 *
 * ── Rule one: never use an <audio> element ───────────────────────────────────
 *
 * `new Audio(url).play()` is the obvious way to play a song and it is
 * unusable here. You cannot start it at a precise moment (play() resolves
 * whenever it feels like it), its `currentTime` is only loosely related to what
 * the speaker is doing, and it lives on a different clock from the AudioContext
 * — so it drifts against anything you schedule.
 *
 * The right primitive is AudioBufferSourceNode. Decode the whole file into
 * memory, then `start(when)` with an absolute AudioContext time. The audio
 * thread begins playback at that exact sample. And because both the buffer and
 * `ctx.currentTime` advance at the context's sample rate, they cannot drift
 * apart — a four-minute track ends exactly as many samples after it started as
 * arithmetic says it should.
 *
 * The cost is memory: a decoded buffer is 4 bytes per sample per channel, so a
 * 3-minute stereo track at 48kHz is ~69MB resident. That's fine for a handful
 * of songs and would not be fine for fifty.
 *
 * ── Rule two: never trust where the file says it starts ──────────────────────
 *
 * See the long note at the top of analysis.js. Codec padding means the first
 * audible sample can land tens of milliseconds later than it should, differently
 * on different browsers. So this class decodes first, then MEASURES the decoded
 * samples, and aligns to what it finds. The result is identical everywhere.
 *
 * ── How alignment works ──────────────────────────────────────────────────────
 *
 *      file:  [padding][silence][ music.......................... ]
 *                               ^ detected                ^
 *                               |<-- firstBeat -->|
 *                                                 ^ beat 0 of the chart
 *
 *   audioStart = detectedLeadingSilence   (kills codec padding + any silence
 *                                          you left in the export)
 *   beatZero   = audioStart + firstBeat   (where the chart's beat 0 lives,
 *                                          in file time)
 *
 * At play time we schedule the buffer so that `beatZero` in file time coincides
 * with the Conductor's beat 0 in context time.
 */

import { toMono, detectLeadingSilence, detectTrailingSilence } from './analysis.js';

/**
 * Load and decode an audio file.
 *
 * @param {AudioContext} ctx
 * @param {string|string[]} src  one URL, or several to try in order — put your
 *   best-supported format first. See docs/AUDIO.md.
 * @param {(loaded:number, total:number)=>void} [onProgress]
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeTrack(ctx, src, onProgress) {
  const sources = Array.isArray(src) ? src : [src];
  const errors = [];

  for (const url of sources) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      let bytes;
      const total = Number(res.headers.get('content-length')) || 0;
      if (onProgress && res.body && total) {
        // Stream so a big file can show a real progress bar rather than
        // freezing on "loading".
        const reader = res.body.getReader();
        const chunks = [];
        let loaded = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          onProgress(loaded, total);
        }
        bytes = new Uint8Array(loaded);
        let at = 0;
        for (const c of chunks) { bytes.set(c, at); at += c.length; }
        bytes = bytes.buffer;
      } else {
        bytes = await res.arrayBuffer();
      }

      // decodeAudioData resamples to the context's rate, which is what we want:
      // everything downstream can then assume one sample rate.
      return await ctx.decodeAudioData(bytes);
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  throw new Error(`Could not load any source.\n  ${errors.join('\n  ')}`);
}

export class AudioTrack {
  /**
   * @param {AudioContext} ctx
   * @param {AudioBuffer} buffer
   * @param {object} spec
   * @param {number} [spec.firstBeat=0]
   *   Seconds from the first AUDIBLE sample to beat 0 of the chart. Zero means
   *   the music starts right on the downbeat. Use a positive value if you
   *   exported a count-in or a pickup you don't want charted.
   * @param {boolean} [spec.trimSilence=true]
   *   Measure and remove leading silence. Turn this OFF only if your track
   *   deliberately fades in from nothing, in which case the detector has no
   *   transient to find and you must supply `audioStart` yourself.
   * @param {number} [spec.audioStart]
   *   Override the detected silence, in seconds. Escape hatch.
   * @param {number} [spec.gain=1]
   */
  constructor(ctx, buffer, spec = {}) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.spec = spec;

    const mono = toMono(buffer);
    this.detectedSilence = detectLeadingSilence(mono, buffer.sampleRate);
    this.trailingSilence = detectTrailingSilence(mono, buffer.sampleRate);

    this.audioStart = spec.audioStart != null
      ? spec.audioStart
      : (spec.trimSilence === false ? 0 : this.detectedSilence);

    this.firstBeat = spec.firstBeat || 0;

    /** File-time position of the chart's beat 0. */
    this.beatZero = this.audioStart + this.firstBeat;

    /** Musical length available after beat 0. */
    this.playableDuration = buffer.duration - this.trailingSilence - this.beatZero;

    this.source = null;
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = spec.gain ?? 1;
    this.playing = false;
  }

  /** @param {AudioNode} dest usually bus.music */
  connect(dest) {
    this.gainNode.connect(dest);
    return this;
  }

  /**
   * Start so that the chart's beat 0 is heard at `startCtx`.
   *
   * @param {number} startCtx  absolute AudioContext time of beat 0 — exactly
   *   the value Conductor.start() returns.
   * @param {number} [fromSongTime=0] seek into the song, in SONG seconds
   *   (i.e. seconds after beat 0). For practice mode and retries.
   *
   * Handles both cases correctly:
   *   • startCtx is far enough ahead that the whole pre-roll fits → schedule the
   *     buffer from its very beginning and let it run in.
   *   • startCtx is soon (or in the past) → start immediately, seeking into the
   *     buffer by however much we've "missed".
   */
  start(startCtx, fromSongTime = 0) {
    this.stop();

    const now = this.ctx.currentTime;
    // Where in the FILE we want to be when song time = fromSongTime.
    const fileOffset = this.beatZero + fromSongTime;
    // Absolute context time at which that file position should sound.
    const when = startCtx + fromSongTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gainNode);

    let playAt = when;
    let offset = fileOffset;

    // Pre-roll: if there's room, start the buffer earlier so any lead-in audio
    // before beat 0 is heard rather than clipped off.
    const preroll = Math.min(fileOffset, when - now);
    if (preroll > 0) {
      playAt = when - preroll;
      offset = fileOffset - preroll;
    } else if (when < now) {
      // We're late (a stall, or a mid-song seek). Skip forward rather than
      // playing the whole thing shifted — the music must stay aligned to the
      // clock even at the cost of dropping audio.
      offset = fileOffset + (now - when);
      playAt = now;
    }

    if (offset >= this.buffer.duration) return;

    src.start(playAt, Math.max(0, offset));
    this.source = src;
    this.playing = true;
    this.startCtx = startCtx;
  }

  stop() {
    if (this.source) {
      try { this.source.stop(); } catch { /* already stopped */ }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
  }

  setGain(v, rampSec = 0) {
    const p = this.gainNode.gain;
    if (rampSec > 0) {
      p.cancelScheduledValues(this.ctx.currentTime);
      p.setValueAtTime(p.value, this.ctx.currentTime);
      p.linearRampToValueAtTime(v, this.ctx.currentTime + rampSec);
    } else {
      p.value = v;
    }
  }

  /** Human-readable summary, for the loading screen and Chart Lab. */
  describe() {
    return {
      duration: this.buffer.duration,
      sampleRate: this.buffer.sampleRate,
      channels: this.buffer.numberOfChannels,
      detectedSilenceMs: this.detectedSilence * 1000,
      beatZeroSec: this.beatZero,
      playableDuration: this.playableDuration,
      megabytes: (this.buffer.length * this.buffer.numberOfChannels * 4) / 1048576,
    };
  }
}

/**
 * Simple decoded-buffer cache, keyed by URL.
 *
 * Retrying a level should not re-download and re-decode 60MB. Decode is the
 * expensive half — it's synchronous work on a background thread and can take
 * over a second for a long track.
 */
const CACHE = new Map();

export async function loadTrack(ctx, spec, onProgress) {
  const key = Array.isArray(spec.src) ? spec.src.join('|') : spec.src;
  if (!CACHE.has(key)) {
    CACHE.set(key, await decodeTrack(ctx, spec.src, onProgress));
  }
  return new AudioTrack(ctx, CACHE.get(key), spec);
}

export function clearTrackCache() { CACHE.clear(); }
