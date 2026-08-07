/**
 * LEVEL 1 — "Savanna Stomp"
 *
 *   100 BPM · swung eighths · F major · EASY
 *   Cast: a giraffe conductor and a row of meerkat drummers.
 *
 * ── Design intent ────────────────────────────────────────────────────────────
 *
 * This level teaches. It is built almost entirely as CALL AND RESPONSE: the
 * meerkats play a two-bar phrase, then the player plays it back. The player is
 * never asked to perform a rhythm they haven't just heard, so difficulty comes
 * from listening rather than from reading.
 *
 * The rhythmic idea being taught is SWING. Every eighth note in the level is
 * swung (long-short, roughly 2:1). This is deliberately the first thing the
 * game teaches, because swing is where most players' internal grid breaks: they
 * try to place the off-beat exactly halfway and it feels wrong. Call-and-
 * response is the gentlest possible way to internalise it — you can hear the
 * target, so you don't have to count it.
 *
 * Progression:
 *   §1 Warm-up      quarter notes only. Establishes the ring pulse.
 *   §2 Call & Resp  two-bar phrases, straight quarters and half-note rests.
 *   §3 Off-beats    the swung eighth is introduced, one per phrase.
 *   §4 Two-button   the giraffe's low B cue appears, still sparse.
 *   §5 Finale       the phrases from §2–4 stitched together, no repeats.
 *
 * ── A note on the player's sound ─────────────────────────────────────────────
 *
 * Each chart note carries a `sound`. Hitting it plays that note of the melody.
 * The arrangement is written with those notes MISSING from the backing track —
 * so a clean run completes the tune, and a sloppy run has audible holes in it.
 * That single decision does more for "satisfying" than any particle effect.
 */

import { steps, mel, drums, melody, swingBeat } from '../../audio/sequencer.js';

const SWING = 0.30;

/* ── Harmony ───────────────────────────────────────────────────────────────
   |: F   | Dm  | Bb  | C   :|   — I vi IV V in F major, 4 bars, loops all song.
   Pentatonic melody notes (F G A C D) mean almost anything the player triggers
   sounds consonant over any of those chords. That's not laziness; it's what
   makes an easy level forgiving to the EAR as well as to the timing windows. */

const BASS_ROOT = ['F1', 'D1', 'A#1', 'C2'];
const CHORDS = [
  ['F3', 'A3', 'C4'],
  ['D3', 'F3', 'A3'],
  ['A#2', 'D3', 'F3'],
  ['C3', 'E3', 'G3'],
];

/** Melody notes the player triggers, cycled per phrase. Pentatonic F. */
const PENT = ['F4', 'G4', 'A4', 'C5', 'D5', 'F5'];

const SECTIONS = [
  { beat: 0,   name: null,               label: null },
  { beat: 16,  name: 'warmup',           label: 'WARM UP' },
  { beat: 48,  name: 'call',             label: 'FOLLOW THE MEERKATS!' },
  { beat: 80,  name: 'offbeat',          label: "NOW THE OFF-BEAT" },
  { beat: 112, name: 'twobutton',        label: 'GIRAFFE JOINS IN' },
  { beat: 144, name: 'finale',           label: 'BIG FINISH!' },
  { beat: 176, name: 'outro',            label: null },
];

const END_BEAT = 184;

/* ══ MUSIC ════════════════════════════════════════════════════════════════ */

function music() {
  const ev = [];
  const bars = Math.ceil(END_BEAT / 4);

  // ── Drums ──────────────────────────────────────────────────────────────
  // Laid-back shuffle. Kick on 1 and the "and" of 3, snare on 2 and 4 — the
  // most universally readable groove there is, which is what a tutorial wants.
  const kickP = steps('x.......x..x....', 4);
  const snarP = steps('....x.......x...', 4);
  const shakP = steps('x.x.x.x.x.x.x.x.', 4);

  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const late = bar >= 28;   // finale: dig in
    drums(ev, 'kick', kickP, b, 4, 1, { gain: 0.95, tune: 1.0 });
    drums(ev, 'snare', snarP, b, 4, 1, { gain: late ? 0.6 : 0.46, bright: 0.9 });
    drums(ev, 'hat', shakP, b, 4, 1, { gain: late ? 0.22 : 0.15, cut: 8200 }, SWING);
    // Bar-end fill every 8 bars — tells the player a new phrase is starting.
    if (bar % 8 === 7) {
      drums(ev, 'tom', steps('........x.x.x.x.', 4), b, 4, 1, { gain: 0.5, freq: 220 }, SWING);
    }
  }

  // ── Bass ───────────────────────────────────────────────────────────────
  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const root = BASS_ROOT[bar % 4];
    const fifth = ['C2', 'A1', 'F2', 'G2'][bar % 4];
    const line = mel(`${root} . ${root} - . . ${fifth} .`, 2);
    melody(ev, 'bass', line, b, 4, 1, { gain: 0.34, cutoff: 4.5, durScale: 1.6 }, SWING);
  }

  // ── Chord comps ────────────────────────────────────────────────────────
  // On the swung off-beats only. Gives the level its lope.
  for (let bar = 4; bar < bars; bar++) {
    const b = bar * 4;
    const ch = CHORDS[bar % 4];
    for (const off of [0.5, 1.5, 2.5, 3.5]) {
      ev.push({
        beat: b + swingBeat(off, SWING),
        voice: 'stab',
        opts: { notes: ch, gain: 0.055, dur: 0.16, wave: 'triangle' },
      });
    }
  }

  // ── Pad ────────────────────────────────────────────────────────────────
  for (let bar = 8; bar < bars; bar += 2) {
    ev.push({ beat: bar * 4, voice: 'pad', opts: { notes: CHORDS[bar % 4], gain: 0.035, dur: 7.4 } });
  }

  // ── The CALL phrases ───────────────────────────────────────────────────
  // Meerkats play these; the player answers with the identical rhythm in the
  // following two bars. Written here as marimba plucks.
  for (const c of CALLS) {
    for (let i = 0; i < c.hits.length; i++) {
      ev.push({
        beat: c.beat + swingBeat(c.hits[i], SWING),
        voice: 'pluck',
        opts: { note: c.notes[i], gain: 0.30, decay: 0.5 },
      });
    }
  }

  // ── Intro flourish + final chord ───────────────────────────────────────
  ev.push({ beat: 0, voice: 'pad', opts: { notes: ['F3', 'C4'], gain: 0.05, dur: 8 } });
  for (let i = 0; i < 3; i++) {
    ev.push({ beat: 6 + i * 0.5, voice: 'pluck', opts: { note: PENT[i], gain: 0.24 } });
  }
  ev.push({ beat: END_BEAT, voice: 'stab', opts: { notes: ['F3', 'A3', 'C4', 'F4'], gain: 0.2, dur: 2.4, wave: 'triangle' } });
  ev.push({ beat: END_BEAT, voice: 'kick', opts: { gain: 1.1 } });
  ev.push({ beat: END_BEAT, voice: 'clap', opts: { gain: 0.5 } });

  return ev;
}

/* ══ PHRASES ══════════════════════════════════════════════════════════════
   Each entry is a two-bar CALL, immediately followed by a two-bar RESPONSE the
   player performs. `hits` are beat offsets within the two-bar cell. */

const PHRASE_LIB = {
  //  bar 1        | bar 2
  a: [0, 2, 4, 6],                 // plain quarters, half-note feel
  b: [0, 1, 2, 4, 6],              // adds a walking pair
  c: [0, 2, 3, 4, 6, 7],           // busier tail
  d: [0, 0.5, 2, 4, 4.5, 6],       // FIRST swung off-beat
  e: [0, 1.5, 2, 4, 5.5, 6],       // off-beat on the "and of 2"
  f: [0, 0.5, 1, 2, 4, 5, 6, 6.5], // rolling
  g: [0, 2, 2.5, 3, 4, 6, 6.5, 7], // syncopated tail, both bars
  h: [0, 1, 2, 3, 4, 4.5, 5, 6],   // dense, finale material
};

/** call/response pairs: [phraseKey, startBeatOfCall] */
const PHRASE_PLAN = [
  ['a', 48], ['b', 64],
  ['d', 80], ['e', 96],
  ['c', 112], ['g', 128],
  ['f', 144], ['h', 160],
];

/** Which of those the giraffe (action B) takes, by index within the phrase. */
const B_NOTE_AT = {
  112: [0], 128: [0, 3], 144: [0, 4], 160: [0, 3, 6],
};

const CALLS = PHRASE_PLAN.map(([key, beat]) => {
  const hits = PHRASE_LIB[key];
  return {
    beat,
    hits,
    notes: hits.map((_, i) => PENT[i % PENT.length]),
    key,
  };
});

/* ══ CHART ════════════════════════════════════════════════════════════════ */

function chart() {
  const notes = [];

  // §1 Warm-up: unaccompanied quarter notes so the player can find the pulse
  // against the ring. Sparse on purpose — 8 bars of "you can do this".
  for (let bar = 4; bar < 12; bar++) {
    const pattern = bar < 8 ? [0, 2] : [0, 1, 2, 3];
    pattern.forEach((o, i) => {
      notes.push({
        beat: bar * 4 + o,
        action: 'A',
        type: 'tap',
        cue: 'meerkat',
        sound: { voice: 'pluck', opts: { note: PENT[(i + bar) % 4], gain: 0.34, decay: 0.55 } },
      });
    });
  }

  // §2–§5 Responses. Each answers the call two bars earlier.
  for (const call of CALLS) {
    const respBeat = call.beat + 8;
    const bIdx = new Set(B_NOTE_AT[call.beat] || []);
    call.hits.forEach((o, i) => {
      const isB = bIdx.has(i);
      notes.push({
        beat: respBeat + swingBeat(o, SWING),
        action: isB ? 'B' : 'A',
        type: 'tap',
        cue: isB ? 'giraffe' : 'meerkat',
        sound: isB
          ? { voice: 'pluck', opts: { note: ['F3', 'C4', 'A3'][i % 3], gain: 0.34, decay: 0.7 } }
          : { voice: 'pluck', opts: { note: call.notes[i], gain: 0.34, decay: 0.5 } },
      });
    });
  }

  // Final hit — everyone lands together on the downbeat.
  notes.push({
    beat: END_BEAT,
    action: 'A',
    type: 'tap',
    cue: 'meerkat',
    sound: { voice: 'stab', opts: { notes: ['F4', 'A4', 'C5'], gain: 0.24, dur: 1.2, wave: 'triangle' } },
  });

  return notes.sort((a, b) => a.beat - b.beat);
}

export default {
  id: 'savanna',
  name: 'Savanna Stomp',
  difficulty: 'easy',
  blurb: 'Meerkat drummers and a giraffe conductor. Call and response, with a lazy shuffle. Learn the swing.',
  bpm: 100,
  palette: 'savanna',
  scene: 'savanna',
  swing: SWING,
  tempoMap: [{ beat: 0, bpm: 100 }],
  /** Cues travel this many beats' worth of lane before arriving. Slow tempo →
   *  a longer look-ahead in beats would push cues off-screen, so this is tuned
   *  in beats but checked against pixels-per-second in play.js. */
  approachBeats: 3.2,
  sections: SECTIONS,
  endBeat: END_BEAT,
  calls: CALLS,
  music,
  chart,
};
