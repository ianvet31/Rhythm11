/**
 * Headless smoke test.
 *
 * The design checker (check.mjs) validates data. This validates CODE PATHS: it
 * boots the real Play scene against stub Canvas/WebAudio implementations and
 * runs every level end to end at 60fps, with a synthetic player hitting notes at
 * a range of accuracies.
 *
 * That exercises, for real:
 *   • every branch of the renderer, including the miss/hold/judged cue states,
 *     all three scenes, all five critters, banners, count-in and the pause overlay
 *   • the judge across a full song, including hold press/release
 *   • the juice system's particle/popup/ring lifecycles
 *   • the sequencer's lookahead against a moving clock
 *
 * It cannot tell you the game LOOKS good. It can tell you the game does not
 * throw on frame 4,912 of the hard level, which is the class of bug that is
 * miserable to find by hand.
 *
 * Run: node tools/smoke.mjs
 */

/* ── Stubs ─────────────────────────────────────────────────────────────────── */

const noop = () => {};
const gradient = () => ({ addColorStop: noop });

function makeCtx2D() {
  const c = {
    canvas: null,
    calls: 0,
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop, arcTo: noop, ellipse: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop, clip: noop,
    fill: noop, stroke: noop, fillRect: noop, clearRect: noop, strokeRect: noop,
    translate: noop, rotate: noop, scale: noop, transform: noop,
    setTransform: noop, resetTransform: noop,
    fillText: noop, strokeText: noop,
    measureText: () => ({ width: 42 }),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => null,
    drawImage: noop,
  };
  // Any property assignment (fillStyle, font, globalAlpha…) must be accepted,
  // and any NaN written to one is a bug worth catching — so we trap it.
  return new Proxy(c, {
    set(t, k, v) {
      if (typeof v === 'number' && !Number.isFinite(v)) {
        throw new Error(`non-finite value assigned to ctx.${String(k)}: ${v}`);
      }
      t[k] = v;
      return true;
    },
    get(t, k) {
      if (k in t) { if (typeof t[k] === 'function') t.calls++; return t[k]; }
      return undefined;
    },
  });
}

function makeAudioParam(v = 0) {
  const p = {
    value: v,
    setValueAtTime: (val, t) => { assertFinite(val, 'setValueAtTime value'); assertFinite(t, 'setValueAtTime time'); return p; },
    linearRampToValueAtTime: (val, t) => { assertFinite(val, 'linearRamp value'); assertFinite(t, 'linearRamp time'); return p; },
    exponentialRampToValueAtTime: (val, t) => {
      assertFinite(val, 'expRamp value'); assertFinite(t, 'expRamp time');
      // The real API throws on a target of exactly 0 — catch it here instead.
      if (val === 0) throw new Error('exponentialRampToValueAtTime(0) throws in real browsers');
      return p;
    },
    setTargetAtTime: () => p,
    cancelScheduledValues: () => p,
  };
  return p;
}

function assertFinite(v, what) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`non-finite ${what}: ${v}`);
  }
}

function makeNode(extra = {}) {
  const n = {
    connect(dest) { return dest; },
    disconnect: noop,
    ...extra,
  };
  return n;
}

class StubAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.outputLatency = 0.012;
    this.baseLatency = 0.006;
    this.destination = makeNode();
    this.state = 'running';
    this.voicesStarted = 0;
  }
  getOutputTimestamp() {
    return { contextTime: this.currentTime, performanceTime: this.currentTime * 1000 };
  }
  resume() { return Promise.resolve(); }
  createGain() { return makeNode({ gain: makeAudioParam(1) }); }
  createOscillator() {
    const self = this;
    return makeNode({
      type: 'sine',
      frequency: makeAudioParam(440),
      detune: makeAudioParam(0),
      setPeriodicWave: noop,
      start(t) { assertFinite(t, 'osc.start'); self.voicesStarted++; },
      stop(t) { assertFinite(t, 'osc.stop'); },
    });
  }
  createBufferSource() {
    const self = this;
    return makeNode({
      buffer: null, loop: false,
      playbackRate: makeAudioParam(1),
      start(t) { assertFinite(t, 'src.start'); self.voicesStarted++; },
      stop(t) { assertFinite(t, 'src.stop'); },
    });
  }
  createBiquadFilter() {
    return makeNode({ type: 'lowpass', frequency: makeAudioParam(350), Q: makeAudioParam(1), gain: makeAudioParam(0) });
  }
  createDynamicsCompressor() {
    return makeNode({
      threshold: makeAudioParam(-24), knee: makeAudioParam(30), ratio: makeAudioParam(12),
      attack: makeAudioParam(0.003), release: makeAudioParam(0.25),
    });
  }
  createConvolver() { return makeNode({ buffer: null, normalize: true }); }
  createBuffer(ch, len) {
    const data = new Float32Array(len);
    return { sampleRate: this.sampleRate, length: len, numberOfChannels: ch, getChannelData: () => data };
  }
  createPeriodicWave() { return {}; }
}

/* ── Global environment ────────────────────────────────────────────────────── */

const listeners = new Map();
globalThis.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
  addEventListener: (t, f) => listeners.set(t, f),
  removeEventListener: (t) => listeners.delete(t),
};
globalThis.document = {
  createElement: () => ({ style: {}, getContext: () => makeCtx2D() }),
};
globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.AudioContext = StubAudioContext;
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = v; },
};

/* ── Imports (after globals exist) ─────────────────────────────────────────── */

const { View } = await import('../src/render/view.js');
const { Juice } = await import('../src/render/juice.js');
const { AudioBus } = await import('../src/audio/synth.js');
const { Conductor } = await import('../src/core/conductor.js');
const { InputRouter } = await import('../src/core/input.js');
const { Play } = await import('../src/game/play.js');
const { Calibrator } = await import('../src/game/calibrate.js');
const { LEVELS } = await import('../src/game/levels/index.js');

/* ── Harness ───────────────────────────────────────────────────────────────── */

const canvas = { style: {}, width: 1920, height: 1080, getContext: () => makeCtx2D() };
const ctx = new StubAudioContext();
const bus = new AudioBus(ctx);
const conductor = new Conductor(ctx);
const view = new View(canvas);
const juice = new Juice(view);
const input = new InputRouter();
const settings = { showMeter: true };

let failures = 0;
function fail(msg, err) {
  failures++;
  console.log(`  ✗ ${msg}`);
  if (err) console.log(String(err.stack || err).split('\n').slice(0, 4).map((l) => `      ${l}`).join('\n'));
}

/**
 * Invert Conductor.songTimeAt(): given a desired song position, what
 * `event.timeStamp` would a press at that position carry?
 *
 * This is what lets the simulated player be genuinely accurate rather than
 * accurate-to-the-nearest-frame — which is exactly the distinction core/input.js
 * exists to preserve, and which `frameQuantized` below demonstrates the cost of.
 */
function perfMsForSongTime(songTime) {
  return (songTime + conductor.audioOffset + conductor.startCtx
    + conductor.outputLatency - conductor.clockOffset) * 1000;
}

/**
 * Play a whole level with a simulated player.
 * @param {number} skill 0..1 — 1 hits dead centre, 0 sprays across the window.
 * @param {boolean} frameQuantized simulate the WRONG design: reading input in
 *   the render loop, so every press is stamped with the frame time instead of
 *   the true event time.
 */
function runLevel(level, skill, { pauseAt = null, missEvery = 0, frameQuantized = false } = {}) {
  ctx.currentTime = 0;
  ctx.voicesStarted = 0;
  let result = null;
  const play = new Play({ view, bus, conductor, input, juice, settings }, level, (r) => { result = r; });
  play.start();

  const FPS = 60;
  const dt = 1 / FPS;
  let perfMs = 0;
  let frames = 0;
  let noteIdx = 0;
  const held = [];
  const maxFrames = Math.ceil((play.endTime + 3) * FPS) + 200;

  while (!result && frames < maxFrames) {
    // Advance both clocks together, exactly as they advance in a browser.
    ctx.currentTime += dt;
    perfMs += dt * 1000;

    // Simulated player: press each note when the *audio* clock reaches it,
    // offset by a skill-dependent error. Presses go through the same public
    // path the real InputRouter uses.
    const jt = conductor.songTimeNow();
    while (noteIdx < play.notes.length && play.notes[noteIdx].time <= jt + 0.001) {
      const n = play.notes[noteIdx];
      const shouldMiss = missEvery && noteIdx % missEvery === 0;
      if (!shouldMiss) {
        const spread = (1 - skill) * 0.10;
        const err = (Math.sin(noteIdx * 12.9898) * 0.5) * spread;
        // A real press carries the instant the key physically went down, which
        // has nothing to do with when the frame ran. Only the deliberately-bad
        // path stamps it with the frame time.
        const pressPerf = frameQuantized ? perfMs : perfMsForSongTime(n.time + err);
        play._press(n.action, pressPerf);
        if (n.type === 'hold') held.push({ n, releaseAt: n.holdEnd, action: n.action });
      }
      noteIdx++;
    }
    for (let i = held.length - 1; i >= 0; i--) {
      if (jt >= held[i].releaseAt) {
        play._release(held[i].action, frameQuantized ? perfMs : perfMsForSongTime(held[i].releaseAt));
        held.splice(i, 1);
      }
    }

    if (pauseAt !== null && frames === pauseAt) play.paused = true;
    if (pauseAt !== null && frames === pauseAt + 30) play.paused = false;

    play.update(dt, perfMs);
    play.draw(perfMs);
    frames++;
  }

  play.stop();
  return { result, frames, voices: ctx.voicesStarted, play };
}

/* ── Run ───────────────────────────────────────────────────────────────────── */

console.log('\nHeadless smoke test — full playthroughs against stub Canvas/WebAudio\n');

for (const level of LEVELS) {
  console.log(`${level.name}`);

  // 1. Near-perfect run.
  try {
    const { result, frames, voices } = runLevel(level, 1.0);
    if (!result) fail('perfect run never reached the results screen');
    else {
      const acc = result.accuracy;
      if (acc < 0.999) fail(`a dead-centre robot should score ~100%, got ${(acc * 100).toFixed(2)}%`);
      if (result.counts.miss > 0) fail(`dead-centre robot missed ${result.counts.miss} notes`);
      if (result.rank !== 'S+') fail(`dead-centre robot ranked ${result.rank}, expected S+`);
      console.log(`  ✓ perfect run: ${frames} frames · ${result.counts.perfect} perfect · rank ${result.rank} · ${voices} voices scheduled`);
    }
  } catch (e) { fail('perfect run threw', e); }

  // 2. Sloppy run — exercises great/good/miss rendering and the miss animation.
  try {
    const { result } = runLevel(level, 0.0, { missEvery: 9 });
    if (!result) fail('sloppy run never finished');
    else {
      const seen = Object.entries(result.counts).filter(([, v]) => v > 0).map(([k]) => k);
      if (!result.counts.miss) fail('missEvery=9 produced no misses — the miss path was never rendered');
      console.log(`  ✓ sloppy run: grades seen [${seen.join(', ')}] · ${(result.accuracy * 100).toFixed(1)}% · rank ${result.rank} · ${result.strays} strays`);
    }
  } catch (e) { fail('sloppy run threw', e); }

  // 3. Pause overlay + no input at all (every note must miss cleanly).
  try {
    const { result } = runLevel(level, 1.0, { pauseAt: 240, missEvery: 1 });
    if (!result) fail('no-input run never finished');
    else if (result.counts.miss !== result.total) {
      fail(`no-input run should miss all ${result.total}, missed ${result.counts.miss}`);
    } else console.log(`  ✓ no-input run + pause overlay: ${result.counts.miss}/${result.total} missed, rank ${result.rank}`);
  } catch (e) { fail('no-input / pause run threw', e); }
}

/* Calibrator */
console.log('\nCalibrator');
try {
  const cal = new Calibrator(bus, conductor);
  ctx.currentTime = 0;
  cal.start();
  const spb = cal.secPerBeat;
  // A click SCHEDULED at ctx time T is HEARD at T + outputLatency. A player who
  // taps 35ms after hearing it therefore taps at T + outputLatency + 0.035.
  // (Omitting outputLatency here is the exact mistake that makes a calibration
  //  screen under-report by the buffer size.)
  const tapPerf = (ctxTime) => (ctxTime - conductor.clockOffset) * 1000;
  const clickHeardAt = (i, startCtx) => startCtx + i * spb + conductor.outputLatency;

  // Simulate a player who is consistently 35ms late, with ±6ms of noise.
  for (let i = 0; i < 24; i++) {
    cal.tap(tapPerf(clickHeardAt(i, cal.startCtx) + 0.035) + (i % 3 - 1) * 6);
  }
  const s = cal.state();
  cal.stop();
  if (!s.ready) fail(`calibrator not ready after 24 taps (count=${s.count})`);
  if (Math.abs(s.offsetMs - 35) > 8) fail(`calibrator measured ${s.offsetMs.toFixed(1)}ms for a 35ms bias`);
  else console.log(`  ✓ recovered a 35ms bias as ${s.offsetMs.toFixed(1)}ms (spread ±${s.spreadMs.toFixed(1)}ms)`);

  // Outlier rejection: one wild tap must not move the median.
  const cal2 = new Calibrator(bus, conductor);
  ctx.currentTime = 0;
  cal2.start();
  for (let i = 0; i < 24; i++) {
    const bias = i === 11 ? 0.16 : 0.02;   // one wild tap among a steady 20ms
    cal2.tap(tapPerf(clickHeardAt(i, cal2.startCtx) + bias));
  }
  const s2 = cal2.state();
  cal2.stop();
  if (Math.abs(s2.offsetMs - 20) > 5) fail(`one outlier moved the median to ${s2.offsetMs.toFixed(1)}ms (expected ~20)`);
  else console.log(`  ✓ a single wild tap did not move the median (${s2.offsetMs.toFixed(1)}ms)`);
} catch (e) { fail('calibrator threw', e); }

/* ── The input-design claim, measured ──────────────────────────────────────── */

console.log('\nInput design: event.timeStamp vs. reading input in the frame loop');
try {
  const level = LEVELS[1];
  const good = runLevel(level, 1.0).result;
  const bad = runLevel(level, 1.0, { frameQuantized: true }).result;

  console.log(`  event.timeStamp   → ${(good.accuracy * 100).toFixed(2)}%  rank ${good.rank}  `
    + `mean ${good.meanErrorMs.toFixed(1)}ms  spread ±${good.jitterMs.toFixed(1)}ms  perfect ${good.counts.perfect}/${good.total}`);
  console.log(`  frame-quantized   → ${(bad.accuracy * 100).toFixed(2)}%  rank ${bad.rank}  `
    + `mean ${bad.meanErrorMs.toFixed(1)}ms  spread ±${bad.jitterMs.toFixed(1)}ms  perfect ${bad.counts.perfect}/${bad.total}`);

  // Same simulated player, identical intent, only the timestamp source differs.
  if (!(bad.counts.perfect < good.counts.perfect)) {
    fail('frame-quantized input did not measurably degrade — the harness is not testing what it claims');
  } else {
    console.log(`  ✓ identical player, ${good.counts.perfect - bad.counts.perfect} fewer perfects from frame-quantized`
      + ` timestamps alone (+${(bad.meanErrorMs - good.meanErrorMs).toFixed(1)}ms systematic lateness)`);
  }
} catch (e) { fail('input comparison threw', e); }

console.log(`\n${failures === 0 ? '✓ ALL PASS' : `✗ ${failures} FAILURE(S)`}\n`);
process.exit(failures ? 1 : 0);
