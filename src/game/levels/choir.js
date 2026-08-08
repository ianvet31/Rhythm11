/**
 * MINIGAME 2 — "Choir Sprout"
 *
 *   120 BPM · D major · MEDIUM
 *   Cast: a tiny sprout in a choir stall. A large, imperious choirmaster.
 *
 * ── The verb ─────────────────────────────────────────────────────────────────
 *
 * One button. One tap = your sprout sings ONE note. Which note is decided by
 * the phrase, not by you — so the player's whole job is *when*, never *what*.
 * That's the design that lets a one-button game produce actual melody.
 *
 * ── The cue language ─────────────────────────────────────────────────────────
 *
 * The choirmaster sings a phrase. You sing it back, note for note, rhythm for
 * rhythm. Same call-and-response spine as Puddle Hop, but the payload is now
 * pitched, which changes what the player is listening *for*:
 *
 *   In Puddle Hop the caws are all the same sound, so you memorise a RHYTHM.
 *   Here every note is different, so you memorise a TUNE — and a tune is much
 *   easier to hold in your head than an abstract rhythm. That's what buys the
 *   extra difficulty in this level: syncopation you'd struggle to count is easy
 *   to remember when it's a melody you can hum.
 *
 * ── The rhythmic idea: SYNCOPATION AND RESTS ─────────────────────────────────
 *
 * Notes move onto the "and" of the beat, then into gaps where the ear expects a
 * note and doesn't get one.
 *
 *      §1  on the beat        ♪   ♪   ♪   ♪
 *      §2  on the off-beat     ♪   ♪   ♪   ♪
 *      §3  with rests         ♪    ♪  .   ♪
 *      §4  both, longer phrases
 *
 * Rests are the genuinely hard part and they're saved for last. A rest is the
 * one thing a player cannot execute by feel — you have to actively NOT act
 * while the pulse continues, and the temptation to fill the gap is enormous.
 * Stray taps are tracked separately in the results for exactly this reason.
 *
 * ── Why the sprout sings the real melody ─────────────────────────────────────
 *
 * The backing arrangement contains no melody line at all during response bars.
 * The tune only exists if the player produces it. Miss a note and there is a
 * literal hole in the music — not a buzzer, a *silence* where a note should be,
 * which is a far more informative and more embarrassing failure signal.
 */

import { steps, mel, drums, melody } from '../../audio/sequencer.js';

const BPM = 120;

/* |: D | Bm | G | A :| — I vi IV V in D. */
const BASS_ROOT = ['D1', 'B1', 'G1', 'A1'];
const CHORDS = [
  ['D3', 'F#3', 'A3'],
  ['B2', 'D3', 'F#3'],
  ['G2', 'B2', 'D3'],
  ['A2', 'C#3', 'E3'],
];

/** The sprout's register. Index into this is what a phrase stores. */
const SOP = ['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'D5', 'E5'];
/** The choirmaster sings the same tune an octave down. */
const BASSO = ['D3', 'E3', 'F#3', 'G3', 'A3', 'B3', 'D4', 'E4'];

const VOWELS = ['ah', 'oh', 'ee', 'oo'];

/* ══ PHRASES ══════════════════════════════════════════════════════════════
   Each phrase is a list of [beatOffset, scaleDegree] inside a two-bar cell.  */

const PHRASES = {
  // §1 — on the beat. Establish the game.
  p1: [[0, 0], [1, 2], [2, 4], [4, 4], [5, 2], [6, 0]],
  p2: [[0, 4], [1, 4], [2, 2], [3, 0], [4, 2], [6, 4]],

  // §2 — the "and". Same shapes, shifted half a beat.
  p3: [[0, 0], [1.5, 2], [2.5, 4], [4, 5], [5.5, 4], [6.5, 2]],
  p4: [[0.5, 4], [1.5, 5], [2.5, 6], [4.5, 4], [5.5, 2], [7, 0]],

  // §3 — rests. Gaps where the pulse keeps going and you must not fill them.
  // Note these are DENSER than §2, not sparser: a rest only reads as a rest if
  // there's enough activity around it for the absence to be conspicuous. Four
  // notes in two bars with a gap is just a slow phrase.
  p5: [[0, 6], [0.5, 5], [1.5, 4], [4, 4], [4.5, 5], [5.5, 2], [6, 0]],
  p6: [[0, 0], [0.5, 2], [1, 4], [3, 4], [4, 5], [4.5, 6], [6.5, 4], [7, 2]],
  p7: [[1, 4], [1.5, 6], [2, 5], [2.5, 4], [5, 4], [5.5, 5], [6, 2], [6.5, 0]],

  // §4 — longer, wider leaps, both ideas at once. Sixteenth PAIRS appear here
  // for the first time: two notes 125ms apart, always as a pair and never as a
  // run, so it reads as an ornament on a note rather than a speed test.
  p8: [[0, 0], [0.5, 4], [1, 6], [1.5, 5], [2.5, 4], [3, 2], [4.5, 2], [5, 4], [5.5, 5], [7, 6]],
  p9: [[0, 6], [0.5, 5], [1, 4], [1.5, 5], [3, 2], [3.5, 0], [4, 0], [4.5, 2], [6, 4], [6.5, 5], [7, 6]],
  p10: [[0.5, 5], [1, 6], [1.25, 7], [2, 6], [3.5, 6], [4, 4], [4.5, 5], [5.5, 5], [6, 6], [6.5, 2], [7, 0]],

  // §5 — finale. A tune that resolves.
  p11: [[0, 0], [0.5, 2], [1, 2], [1.5, 4], [2.5, 5], [3, 4], [4, 6], [4.5, 5], [5, 5], [5.5, 4], [6.5, 2], [7, 0]],
  p12: [[0, 6], [0.5, 5], [1, 4], [1.25, 4], [2, 2], [3, 4], [3.5, 4], [4, 5], [4.5, 6], [5, 6], [6, 7], [6.5, 6], [7, 6]],
  p13: [[0, 0], [0.5, 4], [1, 5], [1.5, 6], [2, 7], [3, 6], [4, 5], [4.5, 4], [5, 2], [5.5, 4], [6, 5], [7, 6]],
};

const PLAN = [
  ['p1', 16], ['p2', 32],
  ['p3', 48], ['p4', 64],
  ['p5', 80], ['p6', 96], ['p7', 112],
  ['p8', 128], ['p9', 144], ['p10', 160],
  ['p11', 176], ['p12', 192], ['p13', 208],
];

const RESPONSE_GAP = 8;
const END_BEAT = 232;

const SECTIONS = [
  { beat: 0, name: 'intro', label: null },
  { beat: 16, name: 'onbeat', label: 'SING IT BACK' },
  { beat: 48, name: 'offbeat', label: 'BETWEEN THE BEATS' },
  { beat: 80, name: 'rests', label: 'MIND THE GAPS' },
  { beat: 128, name: 'long', label: 'LONGER PHRASES' },
  { beat: 176, name: 'fin', label: 'BIG FINISH!' },
  { beat: 224, name: 'outro', label: null },
];

const INSTANCES = PLAN.map(([key, beat]) => ({ key, beat, hits: PHRASES[key] }));

/* ══ MUSIC ════════════════════════════════════════════════════════════════ */

function music() {
  const ev = [];
  const bars = Math.ceil(END_BEAT / 4);

  // Gentle, choral, unobtrusive. The accompaniment's job is to hold the pulse
  // and the harmony steady while two voices trade a tune over the top.
  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    drums(ev, 'kick', steps('x.......x.......', 4), b, 4, 1, { gain: 0.7, tune: 1.05 });
    drums(ev, 'hat', steps('....x.......x...', 4), b, 4, 1, { gain: 0.12, cut: 8600 });
    // A soft clap on 2 and 4 from bar 8 — the choir stamping along.
    if (bar >= 8) drums(ev, 'clap', steps('....x.......x...', 4), b, 4, 1, { gain: 0.16 });
  }

  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    melody(ev, 'bass', mel(`${BASS_ROOT[bar % 4]} . . . ${BASS_ROOT[bar % 4]} . . .`, 2),
      b, 4, 1, { gain: 0.26, cutoff: 3.6, durScale: 1.8 });
  }

  // Sustained choir pad underneath — the rest of the ensemble.
  for (let bar = 2; bar < bars; bar++) {
    ev.push({ beat: bar * 4, voice: 'pad', opts: { notes: CHORDS[bar % 4], gain: 0.05, dur: 2.1 } });
  }

  // Piano-ish comp on the off-beats, which quietly rehearses the syncopation
  // the player will be asked for in §2 long before they're asked for it.
  for (let bar = 6; bar < bars; bar++) {
    const b = bar * 4;
    for (const off of [0.5, 1.5, 2.5, 3.5]) {
      ev.push({ beat: b + off, voice: 'stab', opts: { notes: CHORDS[bar % 4], gain: 0.04, dur: 0.16, wave: 'triangle' } });
    }
  }

  // ── THE CALLS: the choirmaster sings each phrase, an octave down.
  for (const { beat, hits } of INSTANCES) {
    hits.forEach(([o, deg], i) => {
      ev.push({
        beat: beat + o,
        voice: 'sing',
        opts: {
          note: BASSO[deg], gain: 0.24, dur: 0.34,
          vowel: VOWELS[i % VOWELS.length], vib: 10,
        },
      });
    });
  }

  // Intro: the choirmaster warms up, so the voice is familiar before it means
  // anything the player has to act on.
  ev.push({ beat: 0, voice: 'pad', opts: { notes: ['D3', 'A3'], gain: 0.06, dur: 8 } });
  [8, 10, 12, 13].forEach((b, i) => {
    ev.push({ beat: b, voice: 'sing', opts: { note: BASSO[i], gain: 0.22, dur: 0.5, vowel: 'oh' } });
  });

  ev.push({ beat: END_BEAT, voice: 'stab', opts: { notes: ['D3', 'F#3', 'A3', 'D4'], gain: 0.2, dur: 3 } });
  ev.push({ beat: END_BEAT, voice: 'kick', opts: { gain: 1.0 } });

  return ev;
}

/* ══ CUES ═════════════════════════════════════════════════════════════════ */

function cues() {
  const out = [];
  for (const { beat, hits } of INSTANCES) {
    hits.forEach(([o, deg]) => out.push({ beat: beat + o, kind: 'master', deg }));
    out.push({ beat: beat + RESPONSE_GAP - 0.5, kind: 'point' });
  }
  [8, 10, 12, 13].forEach((b, i) => out.push({ beat: b, kind: 'master', deg: i }));
  return out;
}

/* ══ CHART ════════════════════════════════════════════════════════════════ */

function chart() {
  const notes = [];

  for (const { beat, hits } of INSTANCES) {
    const resp = beat + RESPONSE_GAP;
    hits.forEach(([o, deg], i) => {
      notes.push({
        beat: resp + o,
        action: 'A',
        type: 'tap',
        deg,
        answers: beat + o,
        sound: {
          voice: 'sing',
          opts: {
            note: SOP[deg], gain: 0.28, dur: 0.36,
            vowel: VOWELS[i % VOWELS.length], vib: 16,
          },
        },
      });
    });
  }

  notes.push({
    beat: END_BEAT,
    action: 'A',
    type: 'tap',
    deg: 0,
    answers: END_BEAT - 8,
    sound: { voice: 'sing', opts: { note: 'D5', gain: 0.3, dur: 1.5, vowel: 'ah', vib: 22 } },
  });

  return notes.sort((a, b) => a.beat - b.beat);
}

export default {
  id: 'choir',
  name: 'Choir Sprout',
  difficulty: 'medium',
  blurb: 'The choirmaster sings a phrase. Sing it back. Your taps are the melody — miss one and there is a hole in the music.',
  verb: 'Tap to sing the next note.',
  bpm: BPM,
  palette: 'hall',
  stage: 'choir',
  tempoMap: [{ beat: 0, bpm: BPM }],
  sections: SECTIONS,
  endBeat: END_BEAT,
  responseGap: RESPONSE_GAP,
  music,
  chart,
  cues,
};
