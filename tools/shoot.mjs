/**
 * shoot — render frames of a level to PNG so they can actually be LOOKED at.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * This whole game was built without anyone, human or otherwise, ever seeing a
 * frame of it. The design checks and the headless smoke test prove it doesn't
 * throw and that the timing maths is exact. They say nothing whatsoever about
 * whether it looks good, and it turned out it didn't.
 *
 * Verifying that a program runs is a different activity from verifying that it
 * looks right, and the second one cannot be done by reasoning about code. You
 * have to render it and look.
 *
 * Usage:
 *   node tools/shoot.mjs <levelId> [beat,beat,beat...] [--out dir] [--scale 1]
 *
 *   node tools/shoot.mjs grove 20,24,28,32
 *   node tools/shoot.mjs grove --sweep 16:64:4      # every 4 beats from 16-64
 *   node tools/shoot.mjs grove --contact            # one contact sheet
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '/tmp/node_modules/@napi-rs/canvas/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── Stubs: everything except the 2D context, which is REAL ──────────────── */

const noop = () => {};
globalThis.window = {
  innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
};
// A REAL offscreen canvas. 3D stages blit their framebuffer through one, and
// napi-canvas's drawImage will only accept a genuine canvas object — a wrapper
// or Proxy is rejected outright. So hand back the real thing and just bolt a
// `style` property onto it for the DOM code that expects one.
globalThis.document = {
  createElement: () => {
    const c = createCanvas(320, 180);
    if (!('style' in c)) Object.defineProperty(c, 'style', { value: {}, writable: true });
    return c;
  },
};
globalThis.localStorage = { getItem: () => null, setItem: noop };

class Param {
  constructor(v) { this.value = v; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  cancelScheduledValues() { return this; }
  setTargetAtTime() { return this; }
}
const node = (e = {}) => ({ connect: (d) => d, disconnect: noop, ...e });
class StubCtx {
  constructor() {
    this.currentTime = 0; this.sampleRate = 48000;
    this.outputLatency = 0.01; this.baseLatency = 0.005; this.destination = node();
  }
  getOutputTimestamp() { return { contextTime: this.currentTime, performanceTime: this.currentTime * 1000 }; }
  resume() { return Promise.resolve(); }
  createGain() { return node({ gain: new Param(1) }); }
  createOscillator() { return node({ frequency: new Param(440), detune: new Param(0), setPeriodicWave: noop, start: noop, stop: noop }); }
  createBufferSource() { return node({ playbackRate: new Param(1), start: noop, stop: noop }); }
  createBiquadFilter() { return node({ frequency: new Param(1), Q: new Param(1), gain: new Param(0) }); }
  createDynamicsCompressor() { return node({ threshold: new Param(0), knee: new Param(0), ratio: new Param(0), attack: new Param(0), release: new Param(0) }); }
  createConvolver() { return node({}); }
  createBuffer(ch, len) { const d = new Float32Array(len); return { sampleRate: 48000, getChannelData: () => d }; }
  createPeriodicWave() { return {}; }
}
globalThis.AudioContext = StubCtx;

/* ── Imports ─────────────────────────────────────────────────────────────── */

const { VW, VH } = await import('../src/render/view.js');
const { Juice } = await import('../src/render/juice.js');
const { AudioBus } = await import('../src/audio/synth.js');
const { Conductor } = await import('../src/core/conductor.js');
const { InputRouter } = await import('../src/core/input.js');
const { Play } = await import('../src/game/play.js');
const { LEVELS } = await import('../src/game/levels/index.js');

/* ── Args ────────────────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const levelId = argv[0] || 'grove';
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const has = (name) => argv.includes(`--${name}`);

let beats = [];
const sweep = flag('sweep', null);
if (sweep) {
  const [a, b, step] = sweep.split(':').map(Number);
  for (let x = a; x <= b; x += (step || 4)) beats.push(x);
} else {
  const positional = argv[1] && !argv[1].startsWith('--') ? argv[1] : null;
  beats = positional ? positional.split(',').map(Number) : [20, 22, 24, 26];
}

const outDir = join(ROOT, flag('out', 'shots'));
const scale = Number(flag('scale', 1));
mkdirSync(outDir, { recursive: true });

/* ── A canvas the View can actually draw into ────────────────────────────── */

const level = LEVELS.find((l) => l.id === levelId);
if (!level) {
  console.log(`no such level: ${levelId}. Have: ${LEVELS.map((l) => l.id).join(', ')}`);
  process.exit(1);
}

const W = Math.round(VW * scale);
const H = Math.round(VH * scale);
const canvas = createCanvas(W, H);

// View calls resize() and sets canvas.width/height + style. Give it what it
// expects, but keep our fixed backing store.
const fakeCanvasEl = {
  style: {},
  get width() { return W; }, set width(_) {},
  get height() { return H; }, set height(_) {},
  getContext: () => canvas.getContext('2d'),
};

const ctxAudio = new StubCtx();
const bus = new AudioBus(ctxAudio);
const conductor = new Conductor(ctxAudio);
const { View } = await import('../src/render/view.js');
const view = new View(fakeCanvasEl);
const juice = new Juice(view);
const input = new InputRouter();

const play = new Play(
  { view, bus, conductor, input, juice, settings: { showMeter: false }, track: null },
  level,
  () => {},
);

/**
 * Drive the game to a given musical beat and render one frame.
 *
 * Steps forward in real 60fps increments rather than jumping, because the
 * stages are full of springs, envelopes and scroll smoothing whose current
 * value depends on their history. Teleporting the clock would render a pose
 * that never actually occurs during play.
 */
function renderAtBeat(targetBeat, { hitEverything = true } = {}) {
  play.judge.reset();
  play.juice.clear();
  play.stage.reset();
  conductor.setTempoMap(level.tempoMap);
  const startCtx = conductor.start(0.001);
  ctxAudio.currentTime = 0;

  const targetTime = conductor.beatToTime(targetBeat);
  const dt = 1 / 60;
  let perfMs = 0;
  let noteIdx = 0;

  for (let t = 0; t < targetTime; t += dt) {
    ctxAudio.currentTime += dt;
    perfMs += dt * 1000;
    const jt = conductor.songTimeNow();

    if (hitEverything) {
      while (noteIdx < play.notes.length && play.notes[noteIdx].time <= jt) {
        const n = play.notes[noteIdx];
        const p = (n.time + conductor.audioOffset + conductor.startCtx
          + conductor.outputLatency - conductor.clockOffset) * 1000;
        play._press(n.action, p);
        noteIdx++;
      }
    }
    play.update(dt, perfMs);
  }
  play.draw(perfMs);
  return canvas.toBuffer('image/png');
}

/* ── Shoot ───────────────────────────────────────────────────────────────── */

const files = [];
for (const b of beats) {
  const png = renderAtBeat(b);
  const f = join(outDir, `${levelId}-b${String(b).padStart(4, '0')}.png`);
  writeFileSync(f, png);
  files.push(f);
  console.log(`  ${f}  ${(png.length / 1024).toFixed(0)}kB`);
}

/* Contact sheet — several beats in one image, which is far more useful for
   judging animation than flipping between files. */
if (has('contact') || beats.length > 1) {
  const cols = Math.min(beats.length, 2);
  const rows = Math.ceil(beats.length / cols);
  const sheet = createCanvas(W * cols, H * rows);
  const sc = sheet.getContext('2d');
  sc.fillStyle = '#000';
  sc.fillRect(0, 0, W * cols, H * rows);
  const { Image } = await import('/tmp/node_modules/@napi-rs/canvas/index.js');
  for (let i = 0; i < files.length; i++) {
    const img = new Image();
    img.src = (await import('node:fs')).readFileSync(files[i]);
    sc.drawImage(img, (i % cols) * W, Math.floor(i / cols) * H, W, H);
    sc.fillStyle = 'rgba(0,0,0,0.7)';
    sc.fillRect((i % cols) * W, Math.floor(i / cols) * H, 92, 26);
    sc.fillStyle = '#0f0';
    sc.font = 'bold 16px sans-serif';
    sc.fillText(`beat ${beats[i]}`, (i % cols) * W + 8, Math.floor(i / cols) * H + 18);
  }
  const cf = join(outDir, `${levelId}-contact.png`);
  writeFileSync(cf, sheet.toBuffer('image/png'));
  console.log(`  ${cf}  (contact sheet)`);
}
