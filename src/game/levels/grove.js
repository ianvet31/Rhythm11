/**
 * MINIGAME 4 — "Mango Stomp"
 *
 *   108 BPM · F major · EASY–MEDIUM
 *   Cast: one elephant. A grove of fruit trees.
 *
 * ── The verb ─────────────────────────────────────────────────────────────────
 *
 * One button. Tap to STOMP. The shockwave knocks loose whatever fruit is
 * directly overhead, and she catches it with her trunk and eats it.
 *
 * ── The notation is the scenery ──────────────────────────────────────────────
 *
 * Fruit hangs in the canopy at horizontal positions that ARE the rhythm. The
 * grove scrolls past at a constant pixels-per-second, so horizontal distance is
 * literally proportional to time:
 *
 *      quarter notes    ●        ●        ●        ●
 *      eighths          ●    ●   ●    ●   ●    ●   ●
 *      a "bunch"        ●        ●●       ●        ●●
 *
 * Vertical position is randomised per fruit and means NOTHING. That's the
 * design: scattered heights make it look like fruit in a tree rather than a
 * row of buttons, while the only axis that carries information stays perfectly
 * clean. It's a note highway wearing a very good disguise — and the disguise
 * matters, because the player reads it as a place instead of as a UI.
 *
 * ── An honest note about the house rule ──────────────────────────────────────
 *
 * The other three minigames follow a strict rule: *visuals may tell you WHAT,
 * only audio tells you WHEN.* This level deliberately breaks it. The fruit is a
 * genuine, reliable, spatial timing cue.
 *
 * That's a considered exception, not a lapse, and it's worth being precise
 * about why it doesn't undermine the rest:
 *
 *   • Rocket Courier's visuals are *dishonest* — randomised flight times that
 *     punish watching. This level's are perfectly honest. Both are legitimate;
 *     what's illegitimate is being honest-ish, where watching mostly works and
 *     occasionally betrays you.
 *   • The rhythm is ALSO stated in the music: one bar before every cluster, a
 *     marimba plays that cluster's exact figure. The level is fully playable
 *     with your eyes shut. The fruit is a second, redundant channel — not a
 *     replacement for listening.
 *   • Redundant cueing is what makes a level approachable. This is the one in
 *     the set a person can pick up cold, which the other three are not.
 *
 * The rule survives because it was never "no visual cues". It was "no visual
 * cue the player can't trust". Fruit you can trust completely is fine.
 *
 * ── Rhythmic progression ─────────────────────────────────────────────────────
 *
 *   §1 quarters      one stomp per beat. Establish the walk.
 *   §2 eighths       two per beat; the grove visibly thickens.
 *   §3 off-beats     fruit between the trunks — spatially obvious, physically
 *                    awkward, which is the joke.
 *   §4 bunches       sixteenth PAIRS, drawn as two fruit touching. The visual
 *                    and the rhythm mean the same thing again.
 *   §5 finale        all of it, with the walk at its most emphatic.
 */

import { steps, mel, drums, melody } from '../../audio/sequencer.js';

const BPM = 108;

/**
 * Scroll speed. This single number ties the art to the music: it converts
 * beats into pixels, so it decides how legible the fruit spacing is.
 *
 *   165 px/s ÷ (108/60 beats/s) = 91.7 px per beat
 *      quarter  92px    eighth  46px    sixteenth  23px
 *
 * With a fruit radius of 13, sixteenths overlap slightly — which is exactly
 * why they're charted as PAIRS and drawn as a bunch. tools/check.mjs enforces
 * the legibility floor so this can't silently regress.
 */
export const SCROLL_PX_PER_SEC = 165;

/* |: F | Dm | Bb | C7 :| — warm, slightly funky, 1970s library music. */
const BASS_ROOT = ['F1', 'D1', 'A#1', 'C2'];
const CHORDS = [
  ['F3', 'A3', 'C4'],
  ['D3', 'F3', 'A3'],
  ['A#2', 'D3', 'F3'],
  ['C3', 'E3', 'A#3'],
];
/** F major pentatonic — whatever the player stomps is consonant. */
const PENT = ['F4', 'G4', 'A4', 'C5', 'D5', 'F5', 'D5', 'C5'];

/** The fruit varieties, cycled so the grove isn't monotone. */
const KINDS = ['mango', 'plum', 'lime'];

/* ══ CLUSTERS ═════════════════════════════════════════════════════════════
   Each cluster is ONE BAR of fruit, and clusters land every two bars. The gap
   bar is where the marimba states the next figure — so the grove naturally
   alternates thick and thin, which is both the call-and-response structure and
   a perfectly plausible way for fruit to grow.                                */

const PATTERNS = {
  // §1 — quarters
  q1: [0, 1, 2, 3],
  q2: [0, 2, 3],
  q3: [0, 1, 3],
  // §2 — eighths
  e1: [0, 0.5, 1, 2, 2.5, 3],
  e2: [0, 1, 1.5, 2, 3, 3.5],
  e3: [0, 0.5, 1.5, 2, 2.5, 3.5],
  e4: [0, 0.5, 1, 1.5, 2, 3],
  // §3 — off-beats
  o1: [0.5, 1.5, 2.5, 3.5],
  o2: [0, 1.5, 2, 3.5],
  o3: [0.5, 1, 2.5, 3, 3.5],
  o4: [0, 0.5, 1.5, 2.5, 3],
  // §4 — bunches (sixteenth pairs)
  b1: [0, 0.25, 1, 2, 2.25, 3],
  b2: [0, 1, 1.25, 2.5, 3],
  b3: [0, 0.5, 0.75, 2, 2.5, 2.75],
  b4: [0, 0.25, 1.5, 2, 2.25, 3.5],
  // §5 — finale
  f1: [0, 0.5, 1, 1.5, 2, 2.5, 3],
  f2: [0, 0.25, 0.5, 1.5, 2, 2.75, 3],
  f3: [0, 0.5, 0.75, 1.5, 2.5, 3, 3.25],
  f4: [0, 1, 1.25, 1.5, 2, 2.5, 3, 3.5],
};

/** [patternKey, barOfTheCLUSTER]. The call sounds one bar (4 beats) earlier. */
const PLAN = [
  ['q1', 20], ['q2', 28], ['q3', 36], ['q1', 44],
  ['e1', 52], ['e2', 60], ['e3', 68], ['e4', 76],
  ['o1', 84], ['o2', 92], ['o3', 100], ['o4', 108],
  ['b1', 116], ['b2', 124], ['b3', 132], ['b4', 140],
  ['f1', 148], ['f2', 152], ['f3', 156], ['f4', 160],
];

const CALL_LEAD = 4;
const END_BEAT = 172;

const SECTIONS = [
  { beat: 0, name: 'intro', label: null },
  { beat: 16, name: 'walk', label: 'STOMP THE FRUIT DOWN' },
  { beat: 48, name: 'eighths', label: 'THICKER GROVE' },
  { beat: 80, name: 'offbeat', label: 'BETWEEN THE TREES' },
  { beat: 112, name: 'bunches', label: 'BUNCHES — TWO QUICK' },
  { beat: 144, name: 'fin', label: 'ALL YOU CAN EAT!' },
  { beat: 166, name: 'outro', label: null },
];

const CLUSTERS = PLAN.map(([key, beat], ci) => ({
  key, beat, hits: PATTERNS[key], ci,
}));

/* ══ MUSIC ════════════════════════════════════════════════════════════════ */

function music() {
  const ev = [];
  const bars = Math.ceil(END_BEAT / 4);

  // An unhurried, heavy-footed groove. Kick on 1 and 3 so it walks; a shaker
  // on the off-beats to give it lift; rimshot backbeat kept quiet so the
  // player's own stomps are always the loudest percussive thing.
  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    drums(ev, 'kick', steps('x.......x.......', 4), b, 4, 1, { gain: 0.9, tune: 0.98 });
    drums(ev, 'snare', steps('....x.......x...', 4), b, 4, 1, { gain: 0.26, bright: 0.8, decay: 0.12 });
    drums(ev, 'hat', steps('..x...x...x...x.', 4), b, 4, 1, { gain: 0.13, cut: 8000 });
    if (bar >= 12) drums(ev, 'hat', steps('x.x.x.x.x.x.x.x.', 4), b, 4, 1, { gain: 0.07, cut: 10500 });
    if (bar % 8 === 7) drums(ev, 'tom', steps('........x...x.x.', 4), b, 4, 1, { gain: 0.42, freq: 190 });
  }

  // Bass: a walking figure with a little swagger on the "and" of 4.
  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const root = BASS_ROOT[bar % 4];
    const fifth = ['C2', 'A1', 'F2', 'G2'][bar % 4];
    melody(ev, 'bass', mel(`${root} . ${root} - . ${fifth} ${root} .`, 2), b, 4, 1,
      { gain: 0.32, cutoff: 4.2, durScale: 1.3 });
  }

  // Electric-piano comp on the off-beats.
  for (let bar = 4; bar < bars; bar++) {
    const b = bar * 4;
    for (const off of [0.5, 1.5, 2.5, 3.5]) {
      ev.push({ beat: b + off, voice: 'stab', opts: { notes: CHORDS[bar % 4], gain: 0.05, dur: 0.2, wave: 'triangle' } });
    }
  }

  for (let bar = 6; bar < bars; bar += 2) {
    ev.push({ beat: bar * 4, voice: 'pad', opts: { notes: CHORDS[bar % 4], gain: 0.035, dur: 4.6 } });
  }

  // ── THE CALLS. One bar before each cluster, a marimba plays that cluster's
  // exact figure. This is what makes the level playable with your eyes shut,
  // and it's what the design checker verifies.
  for (const { beat, hits, ci } of CLUSTERS) {
    hits.forEach((o, i) => {
      ev.push({
        beat: beat - CALL_LEAD + o,
        voice: 'pluck',
        opts: { note: PENT[(ci + i) % PENT.length], gain: 0.26, decay: 0.36 },
      });
    });
  }

  // The final mango's call. Declared explicitly because that note isn't part of
  // a cluster, and a note whose call doesn't sound is exactly what the
  // telegraph check exists to catch.
  ev.push({ beat: END_BEAT - CALL_LEAD, voice: 'pluck', opts: { note: 'F4', gain: 0.3, decay: 0.5 } });

  // Intro: she walks in, and the marimba establishes its voice.
  ev.push({ beat: 0, voice: 'pad', opts: { notes: ['F3', 'C4'], gain: 0.05, dur: 8 } });
  for (let i = 0; i < 4; i++) {
    ev.push({ beat: 8 + i, voice: 'pluck', opts: { note: PENT[i], gain: 0.24, decay: 0.4 } });
  }

  ev.push({ beat: END_BEAT, voice: 'stab', opts: { notes: ['F3', 'A3', 'C4', 'F4'], gain: 0.2, dur: 2.8, wave: 'triangle' } });
  ev.push({ beat: END_BEAT, voice: 'kick', opts: { gain: 1.05 } });

  return ev;
}

/* ══ CUES ═════════════════════════════════════════════════════════════════ */

/**
 * The stage needs the marimba calls (so the canopy can shiver in sympathy) and
 * a per-cluster marker. Fruit positions come from the notes themselves.
 */
function cues() {
  const out = [];
  for (const { beat, hits } of CLUSTERS) {
    for (const o of hits) out.push({ beat: beat - CALL_LEAD + o, kind: 'call' });
    out.push({ beat: beat - CALL_LEAD, kind: 'cluster' });
  }
  for (let i = 0; i < 4; i++) out.push({ beat: 8 + i, kind: 'call' });
  out.push({ beat: END_BEAT - CALL_LEAD, kind: 'call' });
  out.push({ beat: END_BEAT - CALL_LEAD, kind: 'cluster' });
  return out;
}

/* ══ CHART ════════════════════════════════════════════════════════════════ */

function chart() {
  const notes = [];

  for (const { beat, hits, ci } of CLUSTERS) {
    hits.forEach((o, i) => {
      const idx = ci * 8 + i;
      notes.push({
        beat: beat + o,
        action: 'A',
        type: 'tap',
        // Cosmetic, read by the stage: which fruit, and how high it hangs.
        kind: KINDS[idx % KINDS.length],
        hangSeed: idx,
        // The marimba note this stomp answers, one bar back.
        answers: beat - CALL_LEAD + o,
        sound: {
          voice: 'stomp',
          opts: { note: PENT[(ci + i) % PENT.length], gain: 0.30, weight: 1 },
        },
      });
    });
  }

  // The last mango. Bigger stomp, bigger chord.
  notes.push({
    beat: END_BEAT,
    action: 'A',
    type: 'tap',
    kind: 'mango',
    hangSeed: 999,
    finale: true,
    answers: END_BEAT - CALL_LEAD,
    sound: { voice: 'stomp', opts: { note: 'F4', gain: 0.36, weight: 1.35 } },
  });
  // ...which needs its call.
  return notes.sort((a, b) => a.beat - b.beat);
}

export default {
  id: 'grove',
  name: 'Mango Stomp',
  difficulty: 'easy',
  blurb: 'An elephant walks through a fruit grove. The fruit hangs in the rhythm you have to play — stomp underneath each one and she catches it.',
  verb: 'Tap to stomp. Fruit overhead falls.',
  bpm: BPM,
  palette: 'grove',
  stage: 'grove',
  tempoMap: [{ beat: 0, bpm: BPM }],
  sections: SECTIONS,
  endBeat: END_BEAT,
  callLead: CALL_LEAD,
  scrollPxPerSec: SCROLL_PX_PER_SEC,
  music,
  chart,
  cues,
};
