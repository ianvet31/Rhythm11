/**
 * Rhythm11 — entry point.
 *
 * Owns the AudioContext, the single render loop, and the screen state machine:
 *
 *      title ──► menu ──┬──► play ──► results ──┐
 *                       │                       │
 *                       └──► calibrate ◄────────┘
 *
 * ── One loop, one clock ──────────────────────────────────────────────────────
 *
 * There is exactly one requestAnimationFrame loop in the entire game, here.
 * Screens are updated and drawn from it. Nothing anywhere else in the codebase
 * schedules its own frames or timers for animation — a second loop would race
 * with this one and produce the sort of frame-to-frame inconsistency that a
 * rhythm game player notices immediately.
 *
 * ── The autoplay dance ───────────────────────────────────────────────────────
 *
 * Browsers refuse to start an AudioContext without a user gesture. We create it
 * suspended, and resume on the first click. Until then we render a title screen
 * — which is why "PRESS ANY KEY" exists in every game with sound.
 */

import { View, VW, VH } from './render/view.js';
import { Juice } from './render/juice.js';
import { AudioBus, Voices } from './audio/synth.js';
import { Conductor } from './core/conductor.js';
import { InputRouter } from './core/input.js';
import { Play } from './game/play.js';
import { Calibrator } from './game/calibrate.js';
import { LEVELS } from './game/levels/index.js';
import { PALETTES } from './render/palette.js';
import { boldText, layer, circle, star, stroke_, INK, ease, clamp, lerp } from './render/shapes.js';
import * as Critters from './render/critters.js';
import { savannaScene } from './render/scenes.js';

/* ── Persistence ───────────────────────────────────────────────────────────── */

const SAVE_KEY = 'rhythm11.save.v1';

function loadSave() {
  try {
    return { bests: {}, settings: {}, ...JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') };
  } catch { return { bests: {}, settings: {} }; }
}
function persist(save) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode */ }
}

const save = loadSave();
const settings = {
  music: 0.85,
  sfx: 0.9,
  showMeter: true,
  audioOffsetMs: 0,
  visualOffsetMs: 0,
  ...save.settings,
};

/* ── Boot ──────────────────────────────────────────────────────────────────── */

const canvas = document.getElementById('game');
const uiRoot = document.getElementById('ui');
const view = new View(canvas);
const juice = new Juice(view);
const input = new InputRouter();
input.attach(window);

let ctx = null;
let bus = null;
let conductor = null;
let calibrator = null;

let screen = 'title';
let play = null;
let results = null;
let titleT = 0;

function ensureAudio() {
  if (ctx) return ctx.resume();
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  bus = new AudioBus(ctx);
  conductor = new Conductor(ctx);
  conductor.audioOffset = settings.audioOffsetMs / 1000;
  conductor.visualOffset = settings.visualOffsetMs / 1000;
  bus.setMusicVolume(settings.music);
  bus.setSfxVolume(settings.sfx);
  calibrator = new Calibrator(bus, conductor);
  return ctx.resume();
}
// `latencyHint: 'interactive'` asks the browser for the smallest buffer it can
// manage. It is the single highest-leverage line in this file for input feel.

/* ── Screens ───────────────────────────────────────────────────────────────── */

function clearUI() { uiRoot.innerHTML = ''; }

function showTitle() {
  screen = 'title';
  clearUI();
  const p = el('div', 'panel', `
    <h1>RHYTHM 11</h1>
    <h2>a game about hitting things exactly on time</h2>
    <p>Headphones recommended. Wired, if you have them.</p>
    <button class="btn" id="go">PRESS TO BEGIN</button>
    <div class="hint">
      <kbd>Space</kbd> <kbd>J</kbd> <kbd>F</kbd> = <b>A</b> (ball) &nbsp;·&nbsp;
      <kbd>K</kbd> <kbd>D</kbd> = <b>B</b> (diamond)<br>
      <kbd>Esc</kbd> pause &nbsp;·&nbsp; touch: tap left half / right half
    </div>
  `);
  uiRoot.appendChild(p);
  p.querySelector('#go').onclick = async () => {
    await ensureAudio();
    Voices.ui(bus, ctx.currentTime);
    if (!settings.calibrated) showCalibrate(true); else showMenu();
  };
}

function showMenu() {
  screen = 'menu';
  clearUI();
  const cards = LEVELS.map((l) => {
    const best = save.bests[l.id];
    return `
      <button class="level-card" data-id="${l.id}">
        <div class="name">${l.name}</div>
        <div class="diff d-${l.difficulty}">${l.difficulty} · ${l.bpm} BPM</div>
        <div class="blurb">${l.blurb}</div>
        ${best ? `<div class="blurb" style="margin-top:8px;opacity:1;color:var(--pop2)">
          BEST ${best.rank} · ${(best.accuracy * 100).toFixed(1)}% · ${best.score}</div>` : ''}
      </button>`;
  }).join('');

  const p = el('div', 'panel', `
    <h1>CHOOSE A STAGE</h1>
    <div class="levels">${cards}</div>
    <button class="btn ghost" id="cal">CALIBRATE</button>
    <button class="btn ghost" id="opt">OPTIONS</button>
    <div class="hint">Offset: ${settings.audioOffsetMs.toFixed(0)}ms audio · ${settings.visualOffsetMs.toFixed(0)}ms visual</div>
  `);
  uiRoot.appendChild(p);
  p.querySelectorAll('.level-card').forEach((b) => {
    b.onclick = () => { Voices.ui(bus, ctx.currentTime); startLevel(b.dataset.id); };
  });
  p.querySelector('#cal').onclick = () => { Voices.ui(bus, ctx.currentTime); showCalibrate(false); };
  p.querySelector('#opt').onclick = () => { Voices.ui(bus, ctx.currentTime); showOptions(); };
}

function showOptions() {
  screen = 'options';
  clearUI();
  const p = el('div', 'panel', `
    <h1>OPTIONS</h1>
    <div class="slider-row"><span>Music</span>
      <input type="range" id="mv" min="0" max="1" step="0.02" value="${settings.music}"><span id="mvl"></span></div>
    <div class="slider-row"><span>Effects</span>
      <input type="range" id="sv" min="0" max="1" step="0.02" value="${settings.sfx}"><span id="svl"></span></div>
    <div class="slider-row"><span>Audio offset</span>
      <input type="range" id="ao" min="-150" max="150" step="1" value="${settings.audioOffsetMs}"><span id="aol"></span></div>
    <div class="slider-row"><span>Visual offset</span>
      <input type="range" id="vo" min="-120" max="120" step="1" value="${settings.visualOffsetMs}"><span id="vol"></span></div>
    <div class="slider-row"><span>Timing meter</span>
      <input type="checkbox" id="tm" ${settings.showMeter ? 'checked' : ''}></div>
    <p style="text-align:left;margin-top:14px">
      <b>Audio offset</b> shifts judgment. Raise it if you are consistently rated LATE.<br>
      <b>Visual offset</b> shifts only the drawing, for displays that lag their audio.
    </p>
    <button class="btn" id="back">BACK</button>
  `);
  uiRoot.appendChild(p);
  const bind = (id, labelId, fmt, apply) => {
    const inp = p.querySelector(`#${id}`);
    const lab = p.querySelector(`#${labelId}`);
    const sync = () => { lab.textContent = fmt(Number(inp.value)); apply(Number(inp.value)); };
    inp.oninput = sync; sync();
  };
  bind('mv', 'mvl', (v) => `${Math.round(v * 100)}%`, (v) => { settings.music = v; bus.setMusicVolume(v); });
  bind('sv', 'svl', (v) => `${Math.round(v * 100)}%`, (v) => { settings.sfx = v; bus.setSfxVolume(v); });
  bind('ao', 'aol', (v) => `${v}ms`, (v) => { settings.audioOffsetMs = v; conductor.audioOffset = v / 1000; });
  bind('vo', 'vol', (v) => `${v}ms`, (v) => { settings.visualOffsetMs = v; conductor.visualOffset = v / 1000; });
  p.querySelector('#tm').onchange = (e) => { settings.showMeter = e.target.checked; };
  p.querySelector('#back').onclick = () => { saveSettings(); showMenu(); };
}

function saveSettings() {
  save.settings = settings;
  persist(save);
}

function showCalibrate(firstRun) {
  screen = 'calibrate';
  clearUI();
  const p = el('div', 'panel', `
    <h1>CALIBRATE</h1>
    <p>Tap <kbd>Space</kbd> on every click. Just relax into it — the first few taps are ignored.</p>
    <div id="meter" style="height:70px"></div>
    <div class="stat-row"><span class="k">taps</span><span class="v" id="cnt">0</span></div>
    <div class="stat-row"><span class="k">your offset</span><span class="v" id="off">—</span></div>
    <div class="stat-row"><span class="k">consistency</span><span class="v" id="spr">—</span></div>
    <button class="btn" id="ok" disabled>APPLY</button>
    <button class="btn ghost" id="skip">${firstRun ? 'SKIP' : 'CANCEL'}</button>
    <div class="hint">A positive offset means you tap after the click — usually your hardware, not you.</div>
  `);
  uiRoot.appendChild(p);

  const cnt = p.querySelector('#cnt');
  const off = p.querySelector('#off');
  const spr = p.querySelector('#spr');
  const ok = p.querySelector('#ok');
  const meter = p.querySelector('#meter');

  calibrator.onUpdate = (s) => {
    cnt.textContent = `${s.count} / ${s.needed}`;
    off.textContent = s.count > 4 ? `${s.offsetMs > 0 ? '+' : ''}${s.offsetMs.toFixed(0)} ms` : '—';
    spr.textContent = s.spreadMs ? `±${s.spreadMs.toFixed(0)} ms` : '—';
    ok.disabled = !s.ready;
    meter.innerHTML = s.recent.map((d) => {
      const x = 50 + clamp(d * 1000, -100, 100) / 2.4;
      const c = Math.abs(d) < 0.032 ? 'var(--pop2)' : Math.abs(d) < 0.062 ? 'var(--cool)' : 'var(--pop)';
      return `<div style="position:absolute;left:${x}%;top:20px;width:3px;height:30px;background:${c};opacity:.8"></div>`;
    }).join('') + '<div style="position:absolute;left:50%;top:12px;width:2px;height:46px;background:#fff"></div>';
    meter.style.position = 'relative';
  };

  calibrator.start();
  input.enabled = true;
  input.onPress = (action, perfMs) => { if (action === 'A') calibrator.tap(perfMs); };
  input.onRelease = null;

  const finish = () => { calibrator.stop(); input.onPress = null; };
  ok.onclick = () => {
    const ms = calibrator.apply();
    settings.audioOffsetMs = Math.round(ms);
    settings.calibrated = true;
    finish(); saveSettings(); Voices.ui(bus, ctx.currentTime); showMenu();
  };
  p.querySelector('#skip').onclick = () => {
    settings.calibrated = true;
    finish(); saveSettings(); Voices.ui(bus, ctx.currentTime); showMenu();
  };
}

function startLevel(id) {
  const level = LEVELS.find((l) => l.id === id);
  clearUI();
  screen = 'play';
  juice.clear();
  play = new Play({ view, bus, conductor, input, juice, settings }, level, (r) => showResults(r));
  play.start();
}

function showResults(r) {
  screen = 'results';
  results = r;
  play = null;
  input.onPress = null;

  const best = save.bests[r.level.id];
  const isBest = !best || r.score > best.score;
  if (isBest) {
    save.bests[r.level.id] = { score: r.score, accuracy: r.accuracy, rank: r.rank, maxCombo: r.maxCombo };
    persist(save);
  }

  const bias = r.meanErrorMs;
  const advice = Math.abs(bias) < 8
    ? 'Your timing is centred. Nice.'
    : bias > 0
      ? `You are running about ${bias.toFixed(0)}ms LATE on average. Try raising your audio offset by ${Math.round(bias)}ms in Options.`
      : `You are running about ${(-bias).toFixed(0)}ms EARLY on average. Try lowering your audio offset by ${Math.round(-bias)}ms in Options.`;

  clearUI();
  const p = el('div', 'panel', `
    <h1>${r.verdict.text}</h1>
    <h2>${r.level.name} — rank ${r.rank}${isBest ? ' · NEW BEST' : ''}</h2>
    <div class="stat-row"><span class="k">score</span><span class="v">${r.score.toLocaleString()}</span></div>
    <div class="stat-row"><span class="k">accuracy</span><span class="v">${(r.accuracy * 100).toFixed(2)}%</span></div>
    <div class="stat-row"><span class="k">max combo</span><span class="v">${r.maxCombo} / ${r.total}</span></div>
    <div class="stat-row"><span class="k" style="color:var(--pop2)">perfect</span><span class="v">${r.counts.perfect}</span></div>
    <div class="stat-row"><span class="k" style="color:var(--cool)">great</span><span class="v">${r.counts.great}</span></div>
    <div class="stat-row"><span class="k">good</span><span class="v">${r.counts.good}</span></div>
    <div class="stat-row"><span class="k" style="color:var(--pop)">miss</span><span class="v">${r.counts.miss}</span></div>
    <div class="stat-row"><span class="k">stray taps</span><span class="v">${r.strays}</span></div>
    <div class="stat-row"><span class="k">timing spread</span><span class="v">±${r.jitterMs.toFixed(0)}ms</span></div>
    <p style="margin-top:14px">${advice}</p>
    <button class="btn" id="again">RETRY</button>
    <button class="btn ghost" id="menu">STAGE SELECT</button>
  `);
  uiRoot.appendChild(p);
  p.querySelector('#again').onclick = () => { Voices.ui(bus, ctx.currentTime); startLevel(r.level.id); };
  p.querySelector('#menu').onclick = () => { Voices.ui(bus, ctx.currentTime); showMenu(); };
}

function el(tag, cls, html) {
  const n = document.createElement(tag);
  n.className = cls;
  n.innerHTML = html;
  return n;
}

/* ── Global keys ───────────────────────────────────────────────────────────── */

input.onKey = (code) => {
  if (code === 'Escape') {
    if (screen === 'play' && play) {
      play.paused = !play.paused;
      // NOTE: pausing stops judgment but does NOT stop the music. Pausing audio
      // mid-song and resuming it correctly is a genuinely hard problem (the
      // context clock keeps running); this build treats pause as "look away
      // safely", and the honest thing is that your score suffers.
    } else if (screen === 'options' || screen === 'calibrate') {
      showMenu();
    }
  }
  if (code === 'Backspace' && screen === 'play' && play?.paused) {
    play.stop();
    play = null;
    showMenu();
  }
};

/* ── The loop ──────────────────────────────────────────────────────────────── */

let lastPerf = performance.now();

function frame(perfMs) {
  requestAnimationFrame(frame);

  // Clamp dt. A tab that was backgrounded returns with a multi-second dt, which
  // would fling every particle off screen and burn through all the hitstop at
  // once. Clamping makes recovery graceful.
  const dt = Math.min((perfMs - lastPerf) / 1000, 1 / 15);
  lastPerf = perfMs;

  if (screen === 'play' && play) {
    play.update(dt, perfMs);
    play.draw(perfMs);
    return;
  }

  // Non-gameplay screens get a calm animated backdrop.
  titleT += dt;
  view.update(dt);
  juice.update(dt);
  view.begin();
  drawBackdrop(view.ctx, titleT);
  juice.draw(view.ctx);
}

function drawBackdrop(c, t) {
  const P = PALETTES.savanna;
  const beat = t * (100 / 60);
  savannaScene(c, P, { beat, hype: 0.2, time: t });
  Critters.crowd(c, P, { x: 40, y: 322, w: 880, count: 12, beat, hype: 0.3, s: 0.8 });
  Critters.giraffe(c, P, { x: 790, y: 470, s: 0.95, phase: beat % 1, beat, baton: 1, blink: 0 });
  [180, 280].forEach((x, i) => {
    Critters.burrow(c, P, { x, y: 470, s: 0.9 });
    Critters.meerkat(c, P, {
      x, y: 470, s: 0.9, pop: 1, phase: (beat + i * 0.5) % 1,
      look: [0.4, 0], seed: i,
    });
  });
  // Dim so the DOM panel on top stays readable.
  c.fillStyle = 'rgba(18,14,31,0.55)';
  c.fillRect(0, 0, VW, VH);
}

requestAnimationFrame(frame);
showTitle();
