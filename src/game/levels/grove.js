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
 *   3.05 units/s ÷ (108/60 beats/s) = 1.69 world units per beat
 *      quarter  1.69u    eighth  0.85u    sixteenth  0.42u
 *
 * With a fruit radius of 0.24 (diameter 0.48), sixteenths overlap slightly —
 * which is exactly why they're charted as PAIRS and drawn as a bunch.
 * tools/check.mjs enforces the legibility floor so this can't silently
 * regress when the camera or the tempo changes.
 */
export const SCROLL_UNITS_PER_SEC = 3.05;

/* ══ HARMONY ══════════════════════════════════════════════════════════════
   The first version of this song was |: F | Dm | Bb | C :| looping for two
   minutes, and it was boring for two specific, fixable reasons:

     1. FOUR BARS. A four-bar loop announces itself after two passes. Eight
        bars is long enough that the ear tracks it as a phrase with a
        beginning and an end rather than as wallpaper.
     2. TRIADS. Plain major and minor chords have nowhere to go. Sevenths
        create tension that WANTS to resolve, and ii-V motion (Gm7 → C7 → F)
        is the single strongest forward pull in tonal music. That pull is
        what makes a loop feel like it's travelling somewhere.

   So: an eight-bar A section with real ii-V motion, and a contrasting B
   section that lifts to the subdominant before falling back.                */

/** A section — eight bars. F△7 Dm7 | Gm7 C7 | F△7 Dm7 | Gm7 C7 → F6 */
const PROG_A = [
  ['F3', 'A3', 'C4', 'E4'],       // F maj7
  ['D3', 'F3', 'A3', 'C4'],       // Dm7
  ['G3', 'A#3', 'D4', 'F4'],      // Gm7
  ['C3', 'E3', 'G3', 'A#3'],      // C7      ← the pull home
  ['F3', 'A3', 'C4', 'E4'],       // F maj7
  ['D3', 'F3', 'A3', 'C4'],       // Dm7
  ['G3', 'A#3', 'D4', 'F4'],      // Gm7
  ['C3', 'E3', 'G3', 'A#3'],      // C7
];

/** B section — lifts to Bb, walks back down. Used for the off-beat stretch. */
const PROG_B = [
  ['A#2', 'D3', 'F3', 'A3'],      // Bb maj7
  ['A2', 'C3', 'E3', 'G3'],       // Am7
  ['G2', 'A#2', 'D3', 'F3'],      // Gm7
  ['C3', 'F3', 'G3', 'A#3'],      // C7sus4  ← suspended: unresolved on purpose
  ['A#2', 'D3', 'F3', 'A3'],      // Bb maj7
  ['A2', 'C3', 'E3', 'G3'],       // Am7
  ['D3', 'F3', 'A3', 'C4'],       // Dm7
  ['C3', 'E3', 'G3', 'A#3'],      // C7
];

const BASS_A = ['F1', 'D1', 'G1', 'C2', 'F1', 'D1', 'G1', 'C2'];
const BASS_B = ['A#1', 'A1', 'G1', 'C2', 'A#1', 'A1', 'D1', 'C2'];

/** Which progression is running at a given bar. */
const progAt = (bar) => (bar >= 20 && bar < 28 ? PROG_B : PROG_A);
const bassAt = (bar) => (bar >= 20 && bar < 28 ? BASS_B : BASS_A);
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

/** Which arrangement section a bar belongs to. Drives what plays. */
function sectionAtBar(bar) {
  const beat = bar * 4;
  let name = 'intro';
  for (const s of SECTIONS) if (beat >= s.beat) name = s.name;
  return name;
}

/* ══ MUSIC ════════════════════════════════════════════════════════════════ */

function music() {
  const ev = [];
  const bars = Math.ceil(END_BEAT / 4);

  /* ── DRUMS ───────────────────────────────────────────────────────────────
     Two kicks per bar, the second landing on the "and of 3" rather than on 3.
     Displacing that kick by an eighth is the difference between a march and a
     groove: the bar stops being symmetrical, and the ear leans forward waiting
     for the resolution on the next downbeat.

     Ghost notes (`o`) on the snare matter more than they look. They're barely
     audible individually, but they fill the space between backbeats so the
     groove breathes instead of ticking.

     The backbeat is kept deliberately quiet throughout — the player's own
     stomp must always be the loudest percussive event on screen.            */
  /* Four kick variants and three shaker variants, rotated on a FOUR-BAR
     phrase rather than per bar.

     Rotating per bar reads as restlessness; rotating every eight bars leaves
     long stretches that measurably repeat (tools/check.mjs flags any eight-bar
     block more than 85% identical to the next). Four bars is the phrase length
     the ear already groups by, so variation lands where it expects a change. */
  const KICKS = [
    steps('x.....x.....x...', 4),
    steps('x.....x...x.....', 4),
    steps('x...x.....x.x...', 4),
    steps('x.....x.....x.x.', 4),
  ];
  const SNARES = [
    steps('..o.X..o..o.X..o', 4),
    steps('....X..o..o.X.o.', 4),
    steps('..o.X.....o.X..o', 4),
  ];
  const SHAKES = [
    steps('xoxoXoxoxoxoXoxo', 4),
    steps('xoxoXo.oxoxoXoxx', 4),
    steps('x.xoXoxox.xoXox.', 4),
  ];
  const CONGAS = [
    steps('..x..x..x...x.x.', 4),
    steps('..x...x..x..x..x', 4),
    steps('x..x..x...x..x..', 4),
  ];

  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const sec = sectionAtBar(bar);
    const full = sec !== 'intro' && sec !== 'outro';
    const breakdown = bar >= 28 && bar < 31;      // strip back before the finale

    const phrase = Math.floor(bar / 4);
    drums(ev, 'kick', KICKS[phrase % KICKS.length], b, 4, 1,
      { gain: breakdown ? 0.7 : 0.95, tune: 0.98 });
    if (!breakdown) {
      drums(ev, 'snare', SNARES[phrase % SNARES.length], b, 4, 1,
        { gain: 0.24, bright: 0.85, decay: 0.11 });
    }
    if (full) {
      drums(ev, 'shaker', SHAKES[phrase % SHAKES.length], b, 4, 1, { gain: 0.075 });
      // Open hat on 2 and 4 in some phrases only — its absence is what makes
      // its return register.
      if (phrase % 3 !== 1) {
        drums(ev, 'hat', steps('....x.......x...', 4), b, 4, 1, { gain: 0.09, cut: 8600, open: true });
      }
    }

    // Congas enter with the eighths section and give the groove its swing.
    if (bar >= 12 && !breakdown) {
      drums(ev, 'conga', CONGAS[Math.floor(bar / 4) % CONGAS.length], b, 4, 1,
        { note: bar % 2 ? 'A3' : 'D4', gain: 0.10, decay: 0.18 });
    }
    // Woodblock on the "and of 4" — a tiny hook into the next bar.
    if (bar >= 8 && bar % 2 === 1) {
      ev.push({ beat: b + 3.5, voice: 'wood', opts: { gain: 0.09, freq: 1550 } });
    }

    // Fills every eight bars, plus a big one into the finale.
    if (bar % 8 === 7) {
      drums(ev, 'tom', steps('........x.x.x...', 4), b, 4, 1, { gain: 0.34, freq: 210 });
      drums(ev, 'snare', steps('............x.xx', 4), b, 4, 1, { gain: 0.30 });
    }
    if (bar === 35) {
      drums(ev, 'tom', steps('x.x.x.x.x.x.xxxx', 4), b, 4, 1, { gain: 0.40, freq: 260 });
    }
  }

  /* ── BASS ────────────────────────────────────────────────────────────────
     Anticipation is the whole idea here. The root of each bar is played an
     eighth EARLY, on the "and of 4" of the bar before, so the harmony arrives
     ahead of the downbeat and drags the beat forward. Take that away and the
     line sits politely on the beat and the track dies.                       */
  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const prog = bassAt(bar);
    const root = prog[bar % 8];
    const next = bassAt(bar + 1)[(bar + 1) % 8];
    const breakdown = bar >= 28 && bar < 31;
    const g = breakdown ? 0.22 : 0.32;

    melody(ev, 'bass', mel(`${root} . . ${root} . ${root} . .`, 2), b, 4, 1,
      { gain: g, cutoff: 4.4, durScale: 1.1 });
    // The anticipation into the next bar.
    ev.push({
      beat: b + 3.5, voice: 'bass',
      opts: { note: next, gain: g * 0.9, dur: 0.4, cutoff: 5 },
    });
  }

  /* ── ELECTRIC PIANO ─────────────────────────────────────────────────────
     Comping on the off-beats, but not every off-beat — a fixed pattern of
     syncopated hits that varies between bars. Chording on all four "ands" is
     what makes an arrangement sound like a demo. */
  const COMP = [[0.5, 1.5, 2.5, 3.5], [0.5, 1.75, 2.5], [0.75, 1.5, 3.25], [0.5, 2.5, 3.5]];
  for (let bar = 4; bar < bars; bar++) {
    const b = bar * 4;
    const chord = progAt(bar)[bar % 8];
    for (const off of COMP[(Math.floor(bar / 2) + bar) % COMP.length]) {
      ev.push({
        beat: b + off, voice: 'wurli',
        opts: { note: chord[1], gain: 0.055, dur: 0.36 },
      });
      ev.push({
        beat: b + off, voice: 'wurli',
        opts: { note: chord[3] || chord[2], gain: 0.045, dur: 0.34 },
      });
    }
  }

  // Sustained pad underneath, one per bar, following the real harmony.
  for (let bar = 4; bar < bars; bar++) {
    ev.push({
      beat: bar * 4, voice: 'pad',
      opts: { notes: progAt(bar)[bar % 8].slice(0, 3), gain: 0.030, dur: 2.3 },
    });
  }

  /* ── THE HOOK ────────────────────────────────────────────────────────────
     A four-bar vibraphone melody, stated on entry and answered by horns.

     It starts on the "and" of beat 1 rather than on the downbeat. Starting a
     hook off the beat is most of what makes it memorable — the ear has to
     hold the empty downbeat in mind to place the note, and that small act of
     participation is what makes a tune stick.                                */
  const HOOK = mel('. C5 . A4 F4 . G4 . . A4 . C5 D5 - - . . F5 . D5 C5 . A4 . G4 - - . . . . .', 2);
  const HOOK_BARS = [8, 16, 40];
  for (const startBar of HOOK_BARS) {
    melody(ev, 'vibes', HOOK, startBar * 4, 16, 1, { gain: 0.13, decay: 0.9 });
  }
  // Second statement doubled an octave up, quietly — thickens without clutter.
  melody(ev, 'vibes',
    HOOK.map((e) => ({ ...e, notes: e.notes.map((n) => n.replace(/\d/, (d) => String(+d + 1))) })),
    40 * 4, 16, 1, { gain: 0.05, decay: 0.6 });

  /* ── HORN ANSWERS ────────────────────────────────────────────────────────
     Short stabs in the gaps the hook leaves. Call and response between two
     voices is how you fill a bar without making it busy: each one plays only
     where the other rests. */
  const HORN_BARS = [[12, 0], [13, 0], [20, 0], [28, 0], [36, 0]];
  for (const [bar] of HORN_BARS) {
    const b = bar * 4;
    const ch = progAt(bar)[bar % 8];
    ev.push({ beat: b + 1.5, voice: 'horn', opts: { notes: ch.slice(1), gain: 0.085, dur: 0.2 } });
    ev.push({ beat: b + 2.0, voice: 'horn', opts: { notes: ch.slice(1), gain: 0.065, dur: 0.16 } });
    ev.push({ beat: b + 3.5, voice: 'horn', opts: { notes: ch.slice(0, 3), gain: 0.09, dur: 0.34 } });
  }

  // ── THE CALLS. One bar before each cluster, a marimba plays that cluster's
  // exact figure. This is what makes the level playable with your eyes shut,
  // and it's what the design checker verifies.
  for (const { beat, hits, ci } of CLUSTERS) {
    hits.forEach((o, i) => {
      const note = PENT[(ci + i) % PENT.length];
      ev.push({
        beat: beat - CALL_LEAD + o,
        voice: 'pluck',
        opts: { note, gain: 0.26, decay: 0.36 },
      });
      // Doubled an octave down on vibes. The call has to cut through a much
      // busier arrangement than it used to, and doubling at the octave adds
      // weight without adding a second attack for the ear to track.
      ev.push({
        beat: beat - CALL_LEAD + o,
        voice: 'vibes',
        opts: { note: note.replace(/\d/, (d) => String(+d - 1)), gain: 0.075, decay: 0.5 },
      });
    });
  }

  // The final mango's call. Declared explicitly because that note isn't part of
  // a cluster, and a note whose call doesn't sound is exactly what the
  // telegraph check exists to catch.
  ev.push({ beat: END_BEAT - CALL_LEAD, voice: 'pluck', opts: { note: 'F4', gain: 0.3, decay: 0.5 } });

  /* ── INTRO ───────────────────────────────────────────────────────────────
     Percussion first, then bass, then harmony, then the hook — instruments
     entering one at a time. It costs eight bars and it does two jobs: it lets
     the player hear each layer alone before they're stacked, and it makes the
     arrival of the full groove feel like an arrival.                          */
  ev.push({ beat: 0, voice: 'pad', opts: { notes: ['F3', 'C4'], gain: 0.045, dur: 8 } });
  drums(ev, 'shaker', steps('x.x.x.x.x.x.x.x.', 4), 0, 4, 2, { gain: 0.05 });
  drums(ev, 'wood', steps('x.......x.......', 4), 4, 4, 1, { gain: 0.07, freq: 1550 });
  for (let i = 0; i < 4; i++) {
    ev.push({ beat: 4 + i, voice: 'conga', opts: { note: i % 2 ? 'A3' : 'D4', gain: 0.09 } });
  }

  /* ── OUTRO ───────────────────────────────────────────────────────────────
     A proper cadence: the ii-V pulls one last time and lands on F6. Ending on
     the tonic after that tension is the musical equivalent of the last fruit
     landing in her mouth. */
  ev.push({ beat: END_BEAT - 2, voice: 'horn', opts: { notes: ['G3', 'A#3', 'D4'], gain: 0.10, dur: 0.4 } });
  ev.push({ beat: END_BEAT - 1, voice: 'horn', opts: { notes: ['C3', 'E3', 'A#3'], gain: 0.11, dur: 0.5 } });
  ev.push({ beat: END_BEAT, voice: 'horn', opts: { notes: ['F3', 'A3', 'C4', 'D4'], gain: 0.14, dur: 2.4 } });
  ev.push({ beat: END_BEAT, voice: 'vibes', opts: { note: 'F5', gain: 0.18, decay: 2.6 } });
  ev.push({ beat: END_BEAT, voice: 'kick', opts: { gain: 1.05 } });
  ev.push({ beat: END_BEAT, voice: 'conga', opts: { note: 'D4', gain: 0.2 } });

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
  scrollUnitsPerSec: SCROLL_UNITS_PER_SEC,
  /** Fruit radius in world units — the checker needs it to judge legibility. */
  fruitRadius: 0.24,
  music,
  chart,
  cues,
};
