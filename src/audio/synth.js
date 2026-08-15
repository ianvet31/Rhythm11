/**
 * Synth — every sound in the game, generated from oscillators and noise.
 *
 * Why synthesize instead of shipping .ogg files?
 *   • Zero load time and zero decode hitch, so the first beat is never late.
 *   • Sample-accurate scheduling. A note scheduled for ctx time T fires at T,
 *     not "the next frame after T" — which is the best a <audio> tag can do.
 *   • Charts and music share one clock and one source of truth. If the tempo
 *     map says beat 32 is at 14.4s, the kick drum is *at* 14.4s, exactly.
 *   • The whole soundtrack is a few kB of note data, editable in a text file.
 *
 * Everything here schedules into the future and then forgets about it. No voice
 * ever needs polling, and nothing depends on the frame rate.
 */

const TAU = Math.PI * 2;

/** Note name → frequency. "A4" = 440. Accepts sharps ("F#3") and flats ("Bb3"). */
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function noteToFreq(note) {
  if (typeof note === 'number') return note;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(note.trim());
  if (!m) throw new Error(`Bad note: ${note}`);
  const [, letter, accidental, octave] = m;
  let semis = SEMITONE[letter];
  if (accidental === '#') semis += 1;
  if (accidental === 'b') semis -= 1;
  // MIDI: C4 = 60, A4 = 69 = 440Hz
  const midi = (Number(octave) + 1) * 12 + semis;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/* ── Cached noise buffers ──────────────────────────────────────────────────── */
let _noiseBuf = null;
function noiseBuffer(ctx) {
  if (_noiseBuf && _noiseBuf.sampleRate === ctx.sampleRate) return _noiseBuf;
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  _noiseBuf = buf;
  return buf;
}

/* ── Custom waveshapes ─────────────────────────────────────────────────────── */
const _waveCache = new Map();
/**
 * Build a PeriodicWave from a harmonic recipe. Band-limited by construction,
 * so no aliasing scream in the high register the way a naive saw would.
 */
function harmonicWave(ctx, key, buildAmp, partials = 24) {
  const cacheKey = `${key}:${partials}`;
  if (_waveCache.has(cacheKey)) return _waveCache.get(cacheKey);
  const real = new Float32Array(partials + 1);
  const imag = new Float32Array(partials + 1);
  for (let n = 1; n <= partials; n++) imag[n] = buildAmp(n);
  const w = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  _waveCache.set(cacheKey, w);
  return w;
}

/** Hollow, woody — great for marimba/kalimba plucks. Odd harmonics, fast rolloff. */
const woodWave = (ctx) => harmonicWave(ctx, 'wood', (n) => (n % 2 ? 1 / (n * n) : 0.12 / (n * n)), 16);
/** Bright supersaw-ish lead without the CPU cost of stacked oscillators. */
const brightWave = (ctx) => harmonicWave(ctx, 'bright', (n) => 1 / Math.pow(n, 1.15), 28);
/** Round, thick bass. Strong fundamental, gentle upper structure. */
const fatWave = (ctx) => harmonicWave(ctx, 'fat', (n) => (n === 1 ? 1 : 0.55 / Math.pow(n, 1.6)), 12);

/* ── Reverb impulse (generated, not loaded) ────────────────────────────────── */
function makeImpulse(ctx, seconds = 1.8, decay = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Exponentially decaying noise = a serviceable, cheap room.
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

/**
 * Master bus.
 *
 *   voices ──┬─────────────────────────────► compressor ─► master ─► out
 *            └─► reverbSend ─► convolver ───┘
 *
 * The compressor is doing real work: it glues a wall of square waves into
 * something that reads as one piece of music instead of a pile of beeps, and it
 * stops a dense 16th-note section from clipping.
 */
export class AudioBus {
  constructor(ctx) {
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 22;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.16;

    this.music = ctx.createGain();      // song
    this.sfx = ctx.createGain();        // hit sounds, UI
    this.sfx.gain.value = 0.9;

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.25;
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.55;

    this.music.connect(this.comp);
    this.sfx.connect(this.comp);
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.comp);
    this.comp.connect(this.master);
    this.master.connect(ctx.destination);
  }

  setMusicVolume(v) { this.music.gain.value = v; }
  setSfxVolume(v) { this.sfx.gain.value = v; }
  setReverb(v) { this.reverbSend.gain.value = v; }
}

/**
 * All instrument voices. Each is `(bus, time, opts) => void` and schedules a
 * self-cleaning graph. `time` is absolute AudioContext time.
 */
export const Voices = {
  /* ── Drums ─────────────────────────────────────────────────────────────── */

  /**
   * Kick: pitch-swept sine. The sweep from ~150Hz to ~45Hz in 60ms is what your
   * ear reads as "punch" — a static sine at 50Hz is just a hum.
   */
  kick(bus, t, { gain = 1, tune = 1, decay = 0.32, click = 0.6 } = {}) {
    const ctx = bus.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(158 * tune, t);
    osc.frequency.exponentialRampToValueAtTime(44 * tune, t + 0.06);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(g).connect(bus.music);
    osc.start(t);
    osc.stop(t + decay + 0.05);

    if (click > 0) {
      const n = ctx.createBufferSource();
      const ng = ctx.createGain();
      const hp = ctx.createBiquadFilter();
      n.buffer = noiseBuffer(ctx);
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      ng.gain.setValueAtTime(0.28 * click * gain, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.02);
      n.connect(hp).connect(ng).connect(bus.music);
      n.start(t);
      n.stop(t + 0.05);
    }
  },

  /** Snare: band-passed noise burst + a tuned body tone for pitch. */
  snare(bus, t, { gain = 0.8, decay = 0.19, tone = 190, bright = 1 } = {}) {
    const ctx = bus.ctx;
    const n = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    n.buffer = noiseBuffer(ctx);
    n.playbackRate.value = 0.9 + Math.random() * 0.2; // avoids machine-gun sameness
    bp.type = 'bandpass';
    bp.frequency.value = 1900 * bright;
    bp.Q.value = 0.7;
    ng.gain.setValueAtTime(gain, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    n.connect(bp).connect(ng).connect(bus.music);
    ng.connect(bus.reverbSend);
    n.start(t);
    n.stop(t + decay + 0.05);

    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(tone, t);
    o.frequency.exponentialRampToValueAtTime(tone * 0.6, t + 0.07);
    og.gain.setValueAtTime(gain * 0.5, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + decay * 0.6);
    o.connect(og).connect(bus.music);
    o.start(t);
    o.stop(t + decay + 0.05);
  },

  /** Hat: high-passed noise. `open` stretches the decay. */
  hat(bus, t, { gain = 0.3, open = false, cut = 7200 } = {}) {
    const ctx = bus.ctx;
    const decay = open ? 0.22 : 0.045;
    const n = ctx.createBufferSource();
    const hp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    n.buffer = noiseBuffer(ctx);
    n.playbackRate.value = 1 + Math.random() * 0.3;
    hp.type = 'highpass';
    hp.frequency.value = cut;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    n.connect(hp).connect(g).connect(bus.music);
    n.start(t);
    n.stop(t + decay + 0.05);
  },

  /** Tom: pitched sine sweep, wider and slower than the kick. */
  tom(bus, t, { gain = 0.6, freq = 200, decay = 0.34 } = {}) {
    const ctx = bus.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.52, t + decay * 0.8);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(bus.music);
    g.connect(bus.reverbSend);
    o.start(t);
    o.stop(t + decay + 0.05);
  },

  /** Clap: four fast noise slaps. The stagger is the entire trick. */
  clap(bus, t, { gain = 0.5 } = {}) {
    const ctx = bus.ctx;
    const offsets = [0, 0.011, 0.021, 0.032];
    offsets.forEach((off, i) => {
      const n = ctx.createBufferSource();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      n.buffer = noiseBuffer(ctx);
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 1.4;
      const last = i === offsets.length - 1;
      g.gain.setValueAtTime(gain * (last ? 1 : 0.6), t + off);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + (last ? 0.16 : 0.03));
      n.connect(bp).connect(g).connect(bus.music);
      g.connect(bus.reverbSend);
      n.start(t + off);
      n.stop(t + off + 0.22);
    });
  },

  /* ── Pitched voices ────────────────────────────────────────────────────── */

  /**
   * Pluck: wooden, marimba-like. The staple Rhythm Heaven timbre — short,
   * unambiguous attack so the player can lock onto the exact onset.
   */
  pluck(bus, t, { note = 'C4', gain = 0.32, decay = 0.42, detune = 0 } = {}) {
    const ctx = bus.ctx;
    const f = noteToFreq(note);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    o.setPeriodicWave(woodWave(ctx));
    o.frequency.value = f;
    o.detune.value = detune;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 8, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.4, 200), t + decay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(lp).connect(g).connect(bus.music);
    g.connect(bus.reverbSend);
    o.start(t);
    o.stop(t + decay + 0.05);
  },

  /** Bass: filtered saw-ish with a snappy filter envelope. */
  bass(bus, t, { note = 'C2', gain = 0.4, dur = 0.22, cutoff = 5, glide = 0 } = {}) {
    const ctx = bus.ctx;
    const f = noteToFreq(note);
    const o = ctx.createOscillator();
    const sub = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    o.setPeriodicWave(fatWave(ctx));
    if (glide) {
      o.frequency.setValueAtTime(f * Math.pow(2, glide / 12), t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    } else {
      o.frequency.value = f;
    }
    sub.type = 'sine';
    sub.frequency.value = f / 2;
    lp.type = 'lowpass';
    lp.Q.value = 7;
    lp.frequency.setValueAtTime(f * cutoff * 2.2, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.1, 90), t + dur * 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.setValueAtTime(gain, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    sub.connect(lp);
    lp.connect(g).connect(bus.music);
    o.start(t); sub.start(t);
    o.stop(t + dur + 0.05); sub.stop(t + dur + 0.05);
  },

  /** Lead: bright and cutting, sits on top of everything. */
  lead(bus, t, { note = 'C5', gain = 0.22, dur = 0.24, vib = 0, wave = 'bright' } = {}) {
    const ctx = bus.ctx;
    const f = noteToFreq(note);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    if (wave === 'bright') o.setPeriodicWave(brightWave(ctx));
    else o.type = wave;
    o.frequency.value = f;
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(f * 6, 12000);
    lp.Q.value = 1.2;

    if (vib > 0) {
      const lfo = ctx.createOscillator();
      const lfoG = ctx.createGain();
      lfo.frequency.value = 5.6;
      lfoG.gain.value = vib;               // cents
      lfo.connect(lfoG).connect(o.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.1);
    }

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.setValueAtTime(gain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
    o.connect(lp).connect(g).connect(bus.music);
    g.connect(bus.reverbSend);
    o.start(t);
    o.stop(t + dur + 0.1);
  },

  /** Chord stab: several detuned voices at once. Chunky and rhythmic. */
  stab(bus, t, { notes = ['C4', 'E4', 'G4'], gain = 0.14, dur = 0.18, wave = 'square' } = {}) {
    for (const n of notes) {
      Voices.lead(bus, t, { note: n, gain, dur, wave });
    }
  },

  /** Soft sustained pad, for scene atmosphere under the groove. */
  pad(bus, t, { notes = ['C3', 'G3'], gain = 0.07, dur = 2, } = {}) {
    const ctx = bus.ctx;
    for (const n of notes) {
      const f = noteToFreq(n);
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        lp.type = 'lowpass';
        lp.frequency.value = f * 3.2;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(gain, t + dur * 0.25);
        g.gain.setValueAtTime(gain, t + dur * 0.6);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp).connect(g).connect(bus.music);
        g.connect(bus.reverbSend);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  },

  /** Riser — tension before a drop or a hard section. */
  riser(bus, t, { dur = 2, gain = 0.16, from = 200, to = 3000 } = {}) {
    const ctx = bus.ctx;
    const n = ctx.createBufferSource();
    const bp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    n.buffer = noiseBuffer(ctx);
    n.loop = true;
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
    n.connect(bp).connect(g).connect(bus.music);
    g.connect(bus.reverbSend);
    n.start(t);
    n.stop(t + dur + 0.1);
  },

  /**
   * A sung vowel.
   *
   * Real voices are a buzzy source shaped by resonances (formants) whose
   * frequencies are what your ear decodes as "ah" or "oo" — and, critically,
   * those resonances stay put when the pitch changes. So this is a sawtooth
   * through two fixed bandpass filters, not a filter that tracks the note. Let
   * the formants follow the pitch and it stops sounding like a voice and starts
   * sounding like a synth pad.
   *
   * The pitch scoop into the note is the other half: singers approach a note
   * from below. A ~40ms scoop is the difference between "sung" and "beeped".
   */
  sing(bus, t, { note = 'C4', gain = 0.26, dur = 0.4, vowel = 'ah', scoop = 0.45, vib = 14 } = {}) {
    const ctx = bus.ctx;
    const f = noteToFreq(note);
    const FORMANTS = {
      ah: [730, 1090], ee: [270, 2290], oo: [300, 870], oh: [570, 840],
    }[vowel] || [730, 1090];

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f * Math.pow(2, -scoop / 12), t);
    osc.frequency.exponentialRampToValueAtTime(f, t + 0.045);

    if (vib > 0) {
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5.2;
      lg.gain.value = vib;
      // Vibrato fades IN — singers don't start a note with wobble on it.
      lg.gain.setValueAtTime(0, t);
      lg.gain.linearRampToValueAtTime(vib, t + dur * 0.55);
      lfo.connect(lg).connect(osc.detune);
      lfo.start(t); lfo.stop(t + dur + 0.1);
    }

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.03);
    env.gain.setValueAtTime(gain, t + dur * 0.72);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);

    const sum = ctx.createGain();
    sum.gain.value = 0.5;
    for (const [i, ff] of FORMANTS.entries()) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = ff;
      bp.Q.value = 7 - i * 2;
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0.55;
      osc.connect(bp).connect(g).connect(sum);
    }
    // A little dry signal keeps the fundamental audible on small speakers.
    const dry = ctx.createGain();
    dry.gain.value = 0.18;
    osc.connect(dry).connect(sum);

    sum.connect(env).connect(bus.music);
    env.connect(bus.reverbSend);
    osc.start(t);
    osc.stop(t + dur + 0.15);
  },

  /** A sour, deflating croak. The sound of a sprout getting it wrong. */
  croak(bus, t, { gain = 0.22, note = 'C3' } = {}) {
    const ctx = bus.ctx;
    const f = noteToFreq(note);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    o.type = 'square';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.26);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, t);
    lp.frequency.exponentialRampToValueAtTime(320, t + 0.26);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(lp).connect(g).connect(bus.music);
    o.start(t);
    o.stop(t + 0.36);
  },

  /**
   * The courier's incoming whistle.
   *
   * This is a TELEGRAPH: it sounds a fixed interval before a parcel arrives and
   * its pitch sweep is always identical, so the player can learn "whistle →
   * one beat → catch" as a single unit. Everything visual about that parcel is
   * randomised; this sound is the only honest thing in the level.
   */
  whistle(bus, t, { dur = 0.5, gain = 0.2, from = 500, to = 1500 } = {}) {
    const ctx = bus.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.setValueAtTime(gain * 0.9, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03);
    o.connect(g).connect(bus.music);
    g.connect(bus.reverbSend);
    o.start(t);
    o.stop(t + dur + 0.1);
  },

  /**
   * The elephant's stomp — one voice that is two sounds at once.
   *
   * A foot the size of a dinner plate hitting dry earth is a broadband THUD,
   * but a thud alone is unpitched and would sit outside the music. So this
   * layers a pitched marimba tone on top: the low end sells the weight, the
   * marimba puts the stomp *in the tune*, and because the player triggers it,
   * the player is playing the melody.
   *
   * They're one voice rather than two scheduled calls because the engine fires
   * exactly one sound per note, and splitting them risked the two halves
   * drifting apart by a scheduling quantum — which on a percussive attack is
   * audible as a flam.
   */
  stomp(bus, t, { note = 'C4', gain = 0.34, weight = 1 } = {}) {
    const ctx = bus.ctx;

    // ── Low thud: a fast pitch drop is what the ear reads as impact.
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120 * weight, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.08);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.85 * weight, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
    o.connect(g).connect(bus.music);
    o.start(t); o.stop(t + 0.36);

    // ── Earth: a short burst of low-passed noise. Dry dirt, not a drum skin.
    const n = ctx.createBufferSource();
    const lp = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    n.buffer = noiseBuffer(ctx);
    n.playbackRate.value = 0.6 + Math.random() * 0.2;
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.14);
    ng.gain.setValueAtTime(0.34 * weight, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(lp).connect(ng).connect(bus.music);
    n.start(t); n.stop(t + 0.22);

    // ── Marimba on top, so the stomp is a note.
    Voices.pluck(bus, t, { note, gain, decay: 0.5 });
  },

  /* ── Feedback SFX ──────────────────────────────────────────────────────── */

  /**
   * The hit sound. This is the single most important sound in the game.
   *
   * Design rules it follows:
   *   • Attack under 5ms. Anything slower and the player perceives their own
   *     input as laggy even when the judgment was frame-perfect.
   *   • Rises in pitch with accuracy, so quality is audible without reading the
   *     screen — you can play a hard section by ear alone.
   *   • Total length under 120ms, so consecutive 16ths don't smear together.
   *   • Routed to the sfx bus with no reverb send: dry sounds read as closer and
   *     more immediate.
   */
  hit(bus, t, { grade = 'perfect', pitch = 0 } = {}) {
    const ctx = bus.ctx;
    const cfg = {
      perfect: { base: 1320, gain: 0.30, decay: 0.10, harm: true },
      great:   { base: 990,  gain: 0.24, decay: 0.08, harm: false },
      good:    { base: 700,  gain: 0.19, decay: 0.07, harm: false },
      miss:    { base: 150,  gain: 0.22, decay: 0.16, harm: false },
    }[grade];

    const f = cfg.base * Math.pow(2, pitch / 12);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = grade === 'miss' ? 'sawtooth' : 'triangle';
    o.frequency.setValueAtTime(f, t);
    if (grade === 'miss') {
      o.frequency.exponentialRampToValueAtTime(f * 0.45, t + cfg.decay);
    } else {
      // Tiny upward blip. Reads as "clean", like a coin pickup.
      o.frequency.exponentialRampToValueAtTime(f * 1.16, t + 0.03);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(cfg.gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg.decay);
    o.connect(g).connect(bus.sfx);
    o.start(t);
    o.stop(t + cfg.decay + 0.05);

    if (cfg.harm) {
      // Perfect gets a shimmering fifth on top. Purely a reward signal.
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = 'sine';
      o2.frequency.setValueAtTime(f * 1.5, t);
      o2.frequency.exponentialRampToValueAtTime(f * 2.02, t + 0.05);
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.exponentialRampToValueAtTime(0.16, t + 0.003);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      o2.connect(g2).connect(bus.sfx);
      o2.start(t);
      o2.stop(t + 0.2);
    }
  },

  /** Combo milestone chime — rises with the milestone tier. */
  chime(bus, t, { tier = 0 } = {}) {
    const ctx = bus.ctx;
    const scale = [0, 4, 7, 12, 16, 19, 24];
    const semis = scale[Math.min(tier, scale.length - 1)];
    [0, 0.06].forEach((off, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880 * Math.pow(2, (semis + i * 7) / 12);
      g.gain.setValueAtTime(0.0001, t + off);
      g.gain.exponentialRampToValueAtTime(0.13, t + off + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.3);
      o.connect(g).connect(bus.sfx);
      o.start(t + off);
      o.stop(t + off + 0.35);
    });
  },

  /** UI click. */
  ui(bus, t, { up = true } = {}) {
    const ctx = bus.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(up ? 620 : 420, t);
    o.frequency.exponentialRampToValueAtTime(up ? 880 : 300, t + 0.05);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(bus.sfx);
    o.start(t);
    o.stop(t + 0.1);
  },
};
