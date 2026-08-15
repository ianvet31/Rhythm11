/**
 * Analysis — measuring an audio file so the game can trust it.
 *
 * ── The problem this file exists to solve ────────────────────────────────────
 *
 * When you load a compressed audio file, you do not know where the music
 * actually starts.
 *
 * Lossy codecs work in fixed-size blocks, so an encoder has to pad the front of
 * the file with silence to fill the first block, and the decoder is supposed to
 * strip it back off. Whether it does — and how much it strips — varies by codec,
 * by encoder, and by browser. MP3 has no standard field for it at all; the
 * Xing/Info header that carries the delay is an after-the-fact extension that
 * not every decoder honours. AAC clips that are gapless by construction can
 * still come out ~45ms late in Chrome, Firefox and Edge while Safari plays them
 * correctly.
 *
 * 45ms is larger than this game's entire ±32ms perfect window. A chart authored
 * on one browser would be unplayable on another.
 *
 * ── The fix ──────────────────────────────────────────────────────────────────
 *
 * Don't trust the file. Measure the SAMPLES.
 *
 * We decode to an AudioBuffer ourselves, and everything below operates on the
 * decoded PCM. At that point the codec, the container and the browser's padding
 * behaviour have all already happened and been baked into the samples we can
 * see. Finding where the audio really begins is then just arithmetic, and it
 * gives the same answer everywhere.
 *
 * Every function here is pure and takes plain Float32Arrays, so they run in
 * Node and are unit-tested in tools/check.mjs. That matters: this is the code
 * most likely to be quietly wrong.
 */

/** dB → linear amplitude. -60dB ≈ 0.001, a reasonable "silence" floor. */
export const dbToAmp = (db) => Math.pow(10, db / 20);
export const ampToDb = (a) => 20 * Math.log10(Math.max(a, 1e-9));

/**
 * Downmix an AudioBuffer to a single Float32Array.
 * Analysis is mono; stereo information is irrelevant to timing and doubles the
 * work.
 */
export function toMono(buffer) {
  const n = buffer.length;
  const ch = buffer.numberOfChannels;
  if (ch === 1) return buffer.getChannelData(0);
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i];
  }
  for (let i = 0; i < n; i++) out[i] /= ch;
  return out;
}

/**
 * Seconds of silence at the head of the file.
 *
 * This is the number that cancels out codec padding. Subtracting it aligns the
 * first audible sample to a known point, identically on every browser.
 *
 * Uses a short lookahead so a single stray sample of dither doesn't count as
 * the start: we require the signal to STAY above the threshold for `holdMs`.
 *
 * @param {Float32Array} mono
 * @param {number} sampleRate
 * @param {number} thresholdDb  -60 is safely below any real musical content
 * @param {number} holdMs       how long it must stay loud to count
 */
export function detectLeadingSilence(mono, sampleRate, thresholdDb = -55, holdMs = 8) {
  const thr = dbToAmp(thresholdDb);
  const hold = Math.max(1, Math.floor((holdMs / 1000) * sampleRate));

  for (let i = 0; i < mono.length; i++) {
    if (Math.abs(mono[i]) < thr) continue;
    // Candidate. Confirm it sustains.
    let loud = 0;
    for (let j = i; j < Math.min(i + hold, mono.length); j++) {
      if (Math.abs(mono[j]) >= thr) loud++;
    }
    if (loud > hold * 0.4) return i / sampleRate;
  }
  return 0;
}

/** Same, from the tail — useful for knowing the real musical length. */
export function detectTrailingSilence(mono, sampleRate, thresholdDb = -55) {
  const thr = dbToAmp(thresholdDb);
  for (let i = mono.length - 1; i >= 0; i--) {
    if (Math.abs(mono[i]) >= thr) return (mono.length - 1 - i) / sampleRate;
  }
  return mono.length / sampleRate;
}

/**
 * Min/max peak envelope for drawing a waveform.
 *
 * Peaks, not averages: RMS over a bucket smears transients into mush, and
 * transients are the entire point of a waveform in a rhythm tool — you're
 * looking for the drum hits.
 *
 * @returns {{min:Float32Array, max:Float32Array}}
 */
export function peakEnvelope(mono, buckets) {
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const per = mono.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * per);
    const e = Math.min(Math.floor((b + 1) * per), mono.length);
    let lo = 0, hi = 0;
    for (let i = s; i < e; i++) {
      const v = mono[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/**
 * Onset strength envelope — "how much did the sound just get louder".
 *
 * Proper onset detection uses spectral flux (an FFT per frame, summing only
 * the bins that got louder). This is the time-domain cousin: half-wave
 * rectified difference of frame energy. It's meaningfully worse at picking out
 * a soft melodic note under a sustained pad, and entirely good enough for what
 * it's used for here — finding drum transients to fit a tempo grid to.
 *
 * Choosing the simpler algorithm is deliberate. It has no parameters to tune
 * wrong, runs in a few ms on a 4-minute track, and is easy to verify by eye
 * against the waveform in Chart Lab.
 *
 * @param {number} hop samples between frames (512 ≈ 11.6ms at 44.1k)
 * @returns {{env:Float32Array, hop:number, sampleRate:number}}
 */
export function onsetEnvelope(mono, sampleRate, hop = 512) {
  const frames = Math.floor(mono.length / hop);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const s = f * hop;
    for (let i = s; i < s + hop; i++) sum += mono[i] * mono[i];
    // Log domain: matches perception, and stops a loud chorus from swamping a
    // quiet intro in the grid fit below.
    energy[f] = Math.log1p(Math.sqrt(sum / hop) * 800);
  }

  const env = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = energy[f] - energy[f - 1];
    env[f] = d > 0 ? d : 0;      // half-wave rectify: only rises are onsets
  }

  // Normalise to 0..1 so downstream scoring is scale-free.
  let peak = 0;
  for (let i = 0; i < frames; i++) if (env[i] > peak) peak = env[i];
  if (peak > 0) for (let i = 0; i < frames; i++) env[i] /= peak;

  return { env, hop, sampleRate };
}

/** Discrete onset times (seconds) — local maxima above a threshold. */
export function pickOnsets({ env, hop, sampleRate }, threshold = 0.18, minGapMs = 60) {
  const out = [];
  const minGap = (minGapMs / 1000) * (sampleRate / hop);
  let last = -1e9;
  for (let f = 1; f < env.length - 1; f++) {
    if (env[f] < threshold) continue;
    if (env[f] < env[f - 1] || env[f] < env[f + 1]) continue;
    if (f - last < minGap) continue;
    out.push((f * hop) / sampleRate);
    last = f;
  }
  return out;
}

/**
 * How well does a beat grid at (bpm, offset) explain this onset envelope?
 *
 * Sums the envelope at every grid line. A grid that lands on the drum hits
 * scores high; one that lands between them scores low. Sampling with a small
 * triangular window rather than a single frame makes the score smooth in
 * `offset`, which is what lets the search below actually converge.
 *
 * @returns {number} mean strength per grid line — comparable across BPMs,
 *   which a raw sum is NOT (a faster grid has more lines and would always win).
 */
export function scoreGrid({ env, hop, sampleRate }, bpm, offsetSec, subdivision = 1) {
  const framesPerSec = sampleRate / hop;
  const stepSec = 60 / bpm / subdivision;
  const dur = env.length / framesPerSec;
  if (stepSec <= 0 || offsetSec > dur) return 0;

  let sum = 0;
  let n = 0;
  for (let t = offsetSec; t < dur; t += stepSec) {
    const f = t * framesPerSec;
    const i = Math.floor(f);
    const frac = f - i;
    // Triangular interpolation over ±1 frame.
    let v = 0;
    if (i >= 0 && i < env.length) v += env[i] * (1 - frac);
    if (i + 1 < env.length) v += env[i + 1] * frac;
    if (i - 1 >= 0) v = Math.max(v, env[i - 1] * 0.5);
    if (i + 2 < env.length) v = Math.max(v, env[i + 2] * 0.5);
    sum += v;
    n++;
  }
  return n ? sum / n : 0;
}

/**
 * Search for the tempo and offset that best explain the audio.
 *
 * Two-stage: a coarse sweep over the BPM range, then a fine refinement around
 * the winner. Offset is searched over one full beat, because any offset larger
 * than that is the same grid shifted by a whole beat.
 *
 * IMPORTANT — this is a STARTING POINT, not an answer. Tempo estimation from
 * audio is genuinely hard: it routinely locks onto half or double the true
 * tempo, and a track with a strong off-beat can fit a grid that's half a beat
 * out. Chart Lab shows the result against the waveform and expects you to
 * correct it. You already know your song's BPM from your DAW; this exists to
 * find the OFFSET, and to catch the case where the exported tempo isn't quite
 * what you thought.
 *
 * @param {number[]} bpmRange [min, max]
 * @returns {{bpm:number, offset:number, score:number, runnersUp:Array}}
 */
export function fitGrid(onsetData, bpmRange = [70, 190], knownBpm = null) {
  const results = [];

  const tryBpm = (bpm, offsetStep) => {
    const beat = 60 / bpm;
    let best = { bpm, offset: 0, score: -1 };
    for (let off = 0; off < beat; off += offsetStep) {
      const s = scoreGrid(onsetData, bpm, off);
      if (s > best.score) best = { bpm, offset: off, score: s };
    }
    return best;
  };

  if (knownBpm) {
    // Trust the DAW for tempo; only solve for offset, finely.
    const coarse = tryBpm(knownBpm, 0.005);
    const beat = 60 / knownBpm;
    let best = coarse;
    for (let off = Math.max(0, coarse.offset - 0.01); off < coarse.offset + 0.01; off += 0.0005) {
      const s = scoreGrid(onsetData, knownBpm, ((off % beat) + beat) % beat);
      if (s > best.score) best = { bpm: knownBpm, offset: off, score: s };
    }
    return { ...best, runnersUp: [] };
  }

  for (let bpm = bpmRange[0]; bpm <= bpmRange[1]; bpm += 0.5) {
    results.push(tryBpm(bpm, 0.01));
  }
  results.sort((a, b) => b.score - a.score);
  const top = results[0];

  let best = top;
  for (let bpm = top.bpm - 0.5; bpm <= top.bpm + 0.5; bpm += 0.02) {
    const r = tryBpm(bpm, 0.002);
    if (r.score > best.score) best = r;
  }

  return { ...best, runnersUp: results.slice(1, 4) };
}

/**
 * Drift check: does a constant-tempo grid still line up at the END of the song?
 *
 * The failure this catches is brutal and easy to miss. If the declared BPM is
 * off by even 0.05, a chart drifts ~0.6ms per beat — imperceptible in the first
 * bar, and a full 100ms+ by the end of a three-minute track. Charts authored
 * against the intro become unplayable in the outro.
 *
 * Comparing the grid fit over the first eighth of the song against the last
 * eighth surfaces it immediately.
 *
 * @returns {{headScore:number, tailScore:number, ratio:number, ok:boolean}}
 */
export function checkDrift(onsetData, bpm, offset) {
  const { env, hop, sampleRate } = onsetData;
  const framesPerSec = sampleRate / hop;
  const total = env.length;
  const eighth = Math.floor(total / 8);

  const slice = (from, to) => ({
    env: env.subarray(from, to), hop, sampleRate,
  });

  // The tail's grid must be phase-corrected for where the slice begins.
  const tailStartSec = (total - eighth) / framesPerSec;
  const beat = 60 / bpm;
  const tailOffset = (((offset - tailStartSec) % beat) + beat) % beat;

  const headScore = scoreGrid(slice(0, eighth), bpm, offset);
  const tailScore = scoreGrid(slice(total - eighth, total), bpm, tailOffset);
  const ratio = headScore > 0 ? tailScore / headScore : 0;

  return { headScore, tailScore, ratio, ok: ratio > 0.6 };
}

/**
 * Snap a time to the nearest grid position — used by Chart Lab's quantiser.
 * @param {number} strength 0 = leave alone, 1 = snap hard
 */
export function quantise(timeSec, bpm, offsetSec, subdivision = 4, strength = 1) {
  const step = 60 / bpm / subdivision;
  const rel = timeSec - offsetSec;
  const snapped = Math.round(rel / step) * step + offsetSec;
  return timeSec + (snapped - timeSec) * strength;
}
