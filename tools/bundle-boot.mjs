/**
 * Bundle boot test.
 *
 * tools/build.mjs is a hand-rolled module concatenator. It rewrites import and
 * export syntax with regexes, which is a category of code that fails silently
 * and spectacularly: the output is still valid JavaScript, it just has the
 * wrong bindings. `node --check` on the bundle proves nothing.
 *
 * So this actually EXECUTES the built file against stub Canvas/WebAudio and
 * drives a few frames. If the transform dropped an export, mangled a default
 * import, or got module ordering wrong, this throws.
 *
 * It is a shallow test on purpose — smoke.mjs covers behaviour against the
 * source tree. This one asks a single question: is the bundle the same program?
 *
 * Run: node tools/bundle-boot.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Skip the rasterizer's pixel loop — see the note in src/gfx/raster.js. All the
// geometry, transform and stage logic still runs; only the fill is elided.
globalThis.__RHYTHM_NO_FILL = true;

const noop = () => {};
const grad = () => ({ addColorStop: noop });

const mkctx = () => new Proxy({
  save: noop, restore: noop, beginPath: noop, closePath: noop, moveTo: noop,
  lineTo: noop, arc: noop, arcTo: noop, ellipse: noop, quadraticCurveTo: noop,
  rect: noop, clip: noop, fill: noop, stroke: noop, fillRect: noop,
  clearRect: noop, translate: noop, rotate: noop, scale: noop,
  setTransform: noop, fillText: noop, strokeText: noop,
  measureText: () => ({ width: 10 }),
  createLinearGradient: grad, createRadialGradient: grad,
  createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData: () => {}, drawImage: () => {},
  getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
}, { set: (t, k, v) => { t[k] = v; return true; }, get: (t, k) => t[k] });

const mkEl = () => ({
  style: {}, innerHTML: '', className: '', textContent: '', value: '0',
  disabled: false, checked: false,
  appendChild: noop, addEventListener: noop, removeEventListener: noop,
  querySelector: () => mkEl(), querySelectorAll: () => [],
  getContext: mkctx, width: 100, height: 100,
});

globalThis.window = {
  innerWidth: 1440, innerHeight: 900, devicePixelRatio: 2,
  addEventListener: noop, removeEventListener: noop,
};
globalThis.document = { getElementById: mkEl, createElement: mkEl };
globalThis.localStorage = { getItem: () => null, setItem: noop };

let frames = 0;
globalThis.requestAnimationFrame = (fn) => {
  if (frames++ < 6) setTimeout(() => fn(frames * 16.7), 0);
};

class Param {
  constructor(v) { this.value = v; }
  setValueAtTime() { return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
}
const node = (e = {}) => ({ connect: (d) => d, disconnect: noop, ...e });

globalThis.AudioContext = class {
  constructor() {
    this.currentTime = 0; this.sampleRate = 48000;
    this.outputLatency = 0.01; this.baseLatency = 0.005;
    this.destination = node();
  }
  getOutputTimestamp() { return { contextTime: this.currentTime, performanceTime: this.currentTime * 1000 }; }
  resume() { return Promise.resolve(); }
  createGain() { return node({ gain: new Param(1) }); }
  createOscillator() { return node({ frequency: new Param(440), detune: new Param(0), setPeriodicWave: noop, start: noop, stop: noop }); }
  createBufferSource() { return node({ playbackRate: new Param(1), start: noop, stop: noop }); }
  createBiquadFilter() { return node({ frequency: new Param(1), Q: new Param(1), gain: new Param(0) }); }
  createDynamicsCompressor() {
    return node({ threshold: new Param(0), knee: new Param(0), ratio: new Param(0), attack: new Param(0), release: new Param(0) });
  }
  createConvolver() { return node({}); }
  createBuffer(ch, len) { const d = new Float32Array(len); return { sampleRate: 48000, getChannelData: () => d }; }
  createPeriodicWave() { return {}; }
};

const html = readFileSync(join(ROOT, 'dist', 'rhythm11.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log('✗ no inline script found in the bundle'); process.exit(1); }
const src = m[1].replace('<\\/script>', '');

try {
  // eslint-disable-next-line no-new-func
  new Function(src)();
} catch (e) {
  console.log('✗ bundle threw on boot');
  console.log(String(e.stack || e).split('\n').slice(0, 6).map((l) => `    ${l}`).join('\n'));
  process.exit(1);
}

await new Promise((r) => setTimeout(r, 150));

if (frames < 2) {
  console.log(`✗ bundle booted but never rendered (${frames} frames)`);
  process.exit(1);
}
console.log(`✓ bundle booted and rendered ${frames} frames with no exceptions (${(Buffer.byteLength(html) / 1024).toFixed(1)} kB)`);
