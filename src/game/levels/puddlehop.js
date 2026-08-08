/**
 * MINIGAME 1 — "Puddle Hop"
 *
 *   96 BPM · G major · EASY
 *   Cast: Pip, a small person in a rain hat. A crow on a signpost.
 *
 * ── The verb ─────────────────────────────────────────────────────────────────
 *
 * One button. One tap = one step. That's the whole interface.
 *
 * ── The cue language ─────────────────────────────────────────────────────────
 *
 * The crow caws a figure. You step it back. That is the only thing that ever
 * happens, and it's the entire reason this design works: the player is never
 * asked for a rhythm they have not heard, seconds earlier, in full.
 *
 *      bar 1–2   CROW:  caw . caw . caw-caw-caw . . .
 *      bar 3–4   PIP:   ●   . ●   . ● ● ●       . . .
 *
 * Call and response is generated from ONE pattern list below, so the response
 * cannot drift from the call — they are literally the same array, offset by two
 * bars. tools/check.mjs verifies the property independently anyway.
 *
 * ── The rhythmic idea: TRIPLETS ──────────────────────────────────────────────
 *
 * The level teaches the difference between dividing a beat in two and dividing
 * it in three.
 *
 *      straight  |♪  ♪ |♪  ♪ |     two per beat
 *      triplet   |♪ ♪ ♪|♪ ♪ ♪|     three per beat — same time, one more step
 *
 * Triplets are the right first "hard" idea because you can't fake them. A
 * player who is subdividing in two will place the middle note of a triplet at
 * 50% instead of 33%, which is 100ms out at this tempo — a clean miss, with an
 * obvious cause the player can hear the moment it happens.
 *
 * And there's a physical joke that makes it teachable: a triplet is three quick
 * steps, which is exactly what you do to skip over a puddle. The rhythm and the
 * action mean the same thing. Getting the triplet right is *visibly* the
 * difference between clearing the water and landing in it.
 *
 * ── Why the puddles are where they are ───────────────────────────────────────
 *
 * Every puddle is positioned at the step index where a triplet burst lands. The
 * level's hardest rhythmic moment and its biggest visual payoff are the same
 * moment. Miss it and you get soaked, which is funnier and more informative
 * than a number going down.
 */

import { steps, mel, drums, melody } from '../../audio/sequencer.js';

const BPM = 96;

/* |: G | Em | C | D :| — plain, warm, unhurried. */
const BASS_ROOT = ['G1', 'E1', 'C2', 'D2'];
const CHORDS = [
  ['G3', 'B3', 'D4'],
  ['E3', 'G3', 'B3'],
  ['C3', 'E3', 'G3'],
  ['D3', 'F#3', 'A3'],
];
/** G major pentatonic — every step Pip takes is consonant. */
const PENT = ['G4', 'A4', 'B4', 'D5', 'E5', 'G5'];

/* ══ THE PHRASE LIBRARY ═══════════════════════════════════════════════════
   Beat offsets inside a two-bar (8 beat) cell.

   `t3` marks a triplet burst: three steps spaced ⅓ beat apart, i.e. the
   puddle-skip. `q` is a plain quarter-note walk.                              */

const T = (start) => [start, start + 1 / 3, start + 2 / 3];   // eighth-triplet
const H = (start) => [start, start + 2 / 3, start + 4 / 3];   // half-note triplet (3 over 2)

const PHRASES = {
  //             ── §1 walking ──
  walk1: { hits: [0, 2, 4, 6], hops: [] },
  walk2: { hits: [0, 1, 2, 4, 5, 6], hops: [] },
  //             ── §2 the big skip: 3 over 2 beats ──
  skip1: { hits: [0, 2, ...H(4)], hops: [2] },
  skip2: { hits: [0, ...H(2), 6], hops: [1] },
  //             ── §3 fast triplets ──
  trip1: { hits: [0, 2, ...T(4), 6], hops: [2] },
  trip2: { hits: [0, ...T(2), 4, ...T(6)], hops: [1, 5] },
  //             ── §4 mixed, the real test ──
  mix1: { hits: [0, 1, ...T(2), 4, 6, 7], hops: [2] },
  mix2: { hits: [0, ...H(1), 4, ...T(6)], hops: [1, 4] },
  mix3: { hits: [0, 2, 3, ...T(4), ...T(6)], hops: [3, 6] },
  //             ── §5 finale ──
  fin1: { hits: [0, ...T(1), 2, ...T(3), 4, 6], hops: [1, 4] },
  fin2: { hits: [0, 1, 2, ...T(4), 6, 7], hops: [3] },
};

/**
 * The running order. Each entry is [phraseKey, callStartBeat]; the response
 * always begins exactly two bars (8 beats) later.
 */
const PLAN = [
  ['walk1', 16], ['walk2', 32],
  ['skip1', 48], ['skip2', 64],
  ['trip1', 80], ['trip2', 96],
  ['mix1', 112], ['mix2', 128], ['mix3', 144],
  ['fin1', 160], ['fin2', 176],
];

const RESPONSE_GAP = 8;
const END_BEAT = 200;

const SECTIONS = [
  { beat: 0, name: 'intro', label: null },
  { beat: 16, name: 'walk', label: 'FOLLOW THE CROW' },
  { beat: 48, name: 'skip', label: 'THREE STEPS — SKIP THE PUDDLE' },
  { beat: 80, name: 'trip', label: 'FASTER NOW' },
  { beat: 112, name: 'mix', label: 'MIND YOUR FEET' },
  { beat: 160, name: 'fin', label: 'ALMOST HOME!' },
  { beat: 192, name: 'outro', label: null },
];

/* ══ MUSIC ════════════════════════════════════════════════════════════════ */

function music() {
  const ev = [];
  const bars = Math.ceil(END_BEAT / 4);

  // A soft, ambling groove. Brushed feel — this is a walk in the rain, not a
  // race, and the groove has to leave room for the crow to be heard clearly.
  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    drums(ev, 'kick', steps('x.......x.......', 4), b, 4, 1, { gain: 0.85, tune: 1.02 });
    drums(ev, 'snare', steps('....x.......x...', 4), b, 4, 1, { gain: 0.30, bright: 0.75, decay: 0.14 });
    drums(ev, 'hat', steps('..x...x...x...x.', 4), b, 4, 1, { gain: 0.11, cut: 7600 });
    if (bar % 8 === 7) drums(ev, 'tom', steps('........x...x...', 4), b, 4, 1, { gain: 0.4, freq: 200 });
  }

  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const root = BASS_ROOT[bar % 4];
    melody(ev, 'bass', mel(`${root} . ${root} - . . ${root} .`, 2), b, 4, 1,
      { gain: 0.30, cutoff: 4, durScale: 1.4 });
  }

  for (let bar = 4; bar < bars; bar++) {
    const b = bar * 4;
    const ch = CHORDS[bar % 4];
    for (const off of [1.5, 3.5]) {
      ev.push({ beat: b + off, voice: 'stab', opts: { notes: ch, gain: 0.05, dur: 0.3, wave: 'triangle' } });
    }
  }

  for (let bar = 6; bar < bars; bar += 2) {
    ev.push({ beat: bar * 4, voice: 'pad', opts: { notes: CHORDS[bar % 4], gain: 0.035, dur: 5.2 } });
  }

  // ── THE CALLS. The crow's caws — the single most important sound here.
  // Deliberately timbrally distinct from everything else (a hard, bright
  // pluck), so "this is a call" needs no explanation and no UI.
  for (const { beat, hits } of PHRASE_INSTANCES) {
    hits.forEach((o, i) => {
      ev.push({
        beat: beat + o,
        voice: 'pluck',
        opts: { note: PENT[i % PENT.length], gain: 0.34, decay: 0.30 },
      });
    });
  }

  // Intro: the crow clears its throat so the player learns the sound before it
  // means anything.
  ev.push({ beat: 0, voice: 'pad', opts: { notes: ['G3', 'D4'], gain: 0.05, dur: 8 } });
  for (const b of [8, 10, 12]) {
    ev.push({ beat: b, voice: 'pluck', opts: { note: 'G4', gain: 0.3, decay: 0.3 } });
  }

  ev.push({ beat: END_BEAT, voice: 'stab', opts: { notes: ['G3', 'B3', 'D4', 'G4'], gain: 0.2, dur: 2.6, wave: 'triangle' } });
  ev.push({ beat: END_BEAT, voice: 'kick', opts: { gain: 1.0 } });

  return ev;
}

/** Every call instance, expanded from the plan. Shared by music() and cues(). */
const PHRASE_INSTANCES = PLAN.map(([key, beat]) => ({
  key, beat, hits: PHRASES[key].hits, hops: PHRASES[key].hops,
}));

/* ══ CUES (presentation) ══════════════════════════════════════════════════ */

/**
 * What the STAGE reacts to. One `caw` per call note, plus a `turn` marker at
 * the moment the response begins so the crow can point at Pip.
 */
function cues() {
  const out = [];
  for (const { beat, hits } of PHRASE_INSTANCES) {
    for (const o of hits) out.push({ beat: beat + o, kind: 'caw' });
    out.push({ beat: beat + RESPONSE_GAP - 0.5, kind: 'turn' });
  }
  for (const b of [8, 10, 12]) out.push({ beat: b, kind: 'caw' });
  return out;
}

/* ══ CHART ════════════════════════════════════════════════════════════════ */

function chart() {
  const notes = [];

  for (const { beat, hits, hops } of PHRASE_INSTANCES) {
    const respBeat = beat + RESPONSE_GAP;
    hits.forEach((o, i) => {
      notes.push({
        beat: respBeat + o,
        action: 'A',
        type: 'tap',
        // `hop` marks the step that clears a puddle — the stage uses it to make
        // Pip leap, and to decide where to draw water.
        hop: hops.includes(i),
        // Every player note declares which call note it answers. The design
        // checker uses this to verify the telegraph property; the engine uses
        // it for nothing, which is the point — it can't be faked into passing.
        answers: beat + o,
        sound: { voice: 'pluck', opts: { note: PENT[i % PENT.length], gain: 0.30, decay: 0.34 } },
      });
    });
  }

  notes.push({
    beat: END_BEAT,
    action: 'A',
    type: 'tap',
    hop: true,
    answers: END_BEAT - 8,
    sound: { voice: 'stab', opts: { notes: ['G4', 'B4', 'D5'], gain: 0.22, dur: 1.2, wave: 'triangle' } },
  });

  return notes.sort((a, b) => a.beat - b.beat);
}

export default {
  id: 'puddlehop',
  name: 'Puddle Hop',
  difficulty: 'easy',
  blurb: 'A crow caws a rhythm. You step it back. Three quick steps clears the puddle — two gets you wet.',
  verb: 'Tap to take a step.',
  bpm: BPM,
  palette: 'park',
  stage: 'puddlehop',
  tempoMap: [{ beat: 0, bpm: BPM }],
  sections: SECTIONS,
  endBeat: END_BEAT,
  responseGap: RESPONSE_GAP,
  music,
  chart,
  cues,
};
