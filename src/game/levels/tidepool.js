/**
 * LEVEL 2 — "Neon Tide Pool"
 *
 *   132 BPM · straight · A minor · MEDIUM
 *   Cast: an octopus DJ, jellyfish backup dancers.
 *
 * ── Design intent ────────────────────────────────────────────────────────────
 *
 * Level 1 taught you to feel the beat. This one takes it away from you.
 *
 * The rhythmic idea is SYNCOPATION escalating into HEMIOLA. The level walks
 * through four increasingly destabilising relationships to the pulse:
 *
 *   §A  OFF-BEATS      notes on the "and". You still feel 1-2-3-4 underneath.
 *   §B  SIXTEENTHS     notes on the "e" and "a". The grid gets four times
 *                      finer, so being 60ms late now means being a whole
 *                      subdivision off rather than slightly sloppy.
 *   §C  HOLDS          press and sustain. Introduces a second skill — release
 *                      timing — and gives the hands a rest between bursts,
 *                      which is what makes the next section survivable.
 *   §D  HEMIOLA        the payoff. Notes every DOTTED eighth: a 3-unit pattern
 *                      running over a 4-unit bar.
 *
 *          bar       |1 . . . 2 . . . 3 . . . 4 . . . |
 *          16ths      x  x  x  x  x  x  x  x  x  x  x  x  x  x  x  x
 *          dotted-8th X . . X . . X . . X . . X . . X   ← repeats every 3
 *
 *      The pattern only realigns with the downbeat every three bars. For those
 *      three bars the player has to stop counting and just ride the pattern —
 *      and when it finally lands back on beat 1, it is genuinely thrilling.
 *      This is the single best rhythmic trick in dance music and it is
 *      shamelessly the centrepiece of the level.
 *
 * ── Two-button use ───────────────────────────────────────────────────────────
 *
 * B (the diamond) is reserved for accents that fall ON the beat, while A (the
 * ball) carries the syncopation. So the two buttons aren't arbitrary variety —
 * they physically separate "the grid" from "against the grid", and by the
 * hemiola section the player's left and right hands are literally playing the
 * two halves of the polyrhythm.
 */

import { steps, mel, drums, melody } from '../../audio/sequencer.js';

const BPM = 132;

/* |: Am | F | C | G :|  — the four chords that built the genre. */
const BASS_ROOT = ['A1', 'F1', 'C2', 'G1'];
const CHORDS = [
  ['A3', 'C4', 'E4'],
  ['F3', 'A3', 'C4'],
  ['C3', 'E3', 'G3'],
  ['G3', 'B3', 'D4'],
];
/** A minor pentatonic — the player can't hit a wrong-sounding note. */
const PENT = ['A4', 'C5', 'D5', 'E5', 'G5', 'A5'];
const PENT_LOW = ['A3', 'C4', 'D4', 'E4', 'G4'];

const SECTIONS = [
  { beat: 0,   name: 'intro',    label: null },
  { beat: 16,  name: 'offbeat',  label: 'RIDE THE OFF-BEAT' },
  { beat: 48,  name: 'sixteen',  label: 'FASTER GRID' },
  { beat: 80,  name: 'holds',    label: 'HOLD IT...' },
  { beat: 112, name: 'hemiola',  label: 'THREE OVER FOUR' },
  { beat: 152, name: 'finale',   label: 'BRING IT HOME' },
  { beat: 184, name: 'outro',    label: null },
];

const END_BEAT = 192;

/* ══ MUSIC ════════════════════════════════════════════════════════════════ */

function music() {
  const ev = [];
  const bars = Math.ceil(END_BEAT / 4);

  // Four-on-the-floor from bar 4. Unambiguous pulse is what makes syncopation
  // legible — you can only play *against* a beat the listener can still feel.
  const kickP = steps('x...x...x...x...', 4);
  const clapP = steps('....x.......x...', 4);
  const hatP = steps('..x...x...x...x.', 4);
  const hat16 = steps('..x..xx...x..xx.', 4);

  for (let bar = 4; bar < bars; bar++) {
    const b = bar * 4;
    const sec = sectionAt(b);
    // The kick DROPS OUT for the hemiola. Removing the four-on-the-floor is
    // what lets the 3-pattern take over the listener's sense of "where one is";
    // with the kick still hammering, hemiola just sounds like a mistake.
    if (sec !== 'hemiola' || bar % 3 === 0) {
      drums(ev, 'kick', kickP, b, 4, 1, { gain: sec === 'hemiola' ? 0.7 : 1.0, tune: 1.04 });
    }
    drums(ev, 'clap', clapP, b, 4, 1, { gain: 0.34 });
    drums(ev, 'hat', bar % 2 ? hat16 : hatP, b, 4, 1, { gain: 0.16, cut: 9000 });
    if (bar % 8 === 7) drums(ev, 'snare', steps('........x.x.xxx.', 4), b, 4, 1, { gain: 0.34 });
  }

  // Bass: driving offbeat eighths, the engine of the track.
  for (let bar = 4; bar < bars; bar++) {
    const b = bar * 4;
    const root = BASS_ROOT[bar % 4];
    const line = mel(`${root} . ${root} ${root} . ${root} ${root} .`, 2);
    melody(ev, 'bass', line, b, 4, 1, { gain: 0.30, cutoff: 5.5, durScale: 0.9 });
  }

  // Pads throughout — the "underwater" of the underwater level.
  for (let bar = 2; bar < bars; bar += 2) {
    ev.push({ beat: bar * 4, voice: 'pad', opts: { notes: CHORDS[bar % 4], gain: 0.05, dur: 5.6 } });
  }

  // Arpeggio shimmer, 16ths, only in the busy sections. It doubles as a metric
  // reference the player can lock onto when the chart goes off-grid.
  for (let bar = 12; bar < bars; bar++) {
    const b = bar * 4;
    const sec = sectionAt(b);
    if (sec === 'intro' || sec === 'outro') continue;
    const ch = CHORDS[bar % 4];
    for (let i = 0; i < 16; i++) {
      if (i % 2) continue;
      const n = ch[(i / 2) % ch.length];
      ev.push({
        beat: b + i * 0.25,
        voice: 'lead',
        opts: { note: n.replace(/\d/, (d) => String(Number(d) + 1)), gain: 0.045, dur: 0.16, wave: 'triangle' },
      });
    }
  }

  // Riser into the hemiola: telegraph the hardest section.
  ev.push({ beat: 104, voice: 'riser', opts: { dur: 8 * (60 / BPM), gain: 0.14, from: 300, to: 4200 } });
  ev.push({ beat: 112, voice: 'clap', opts: { gain: 0.7 } });

  // Hemiola guide: a soft rim tick every dotted eighth, so the shape the player
  // is being asked to play is AUDIBLE, not just visible.
  for (let b = 112; b < 152; b += 0.75) {
    ev.push({ beat: b, voice: 'hat', opts: { gain: 0.13, cut: 11000 } });
  }

  // Intro sweep and final chord.
  ev.push({ beat: 0, voice: 'riser', opts: { dur: 16 * (60 / BPM), gain: 0.10, from: 180, to: 2600 } });
  ev.push({ beat: 0, voice: 'pad', opts: { notes: ['A2', 'E3'], gain: 0.06, dur: 8 } });
  ev.push({ beat: END_BEAT, voice: 'stab', opts: { notes: ['A3', 'C4', 'E4', 'A4'], gain: 0.2, dur: 2.6 } });
  ev.push({ beat: END_BEAT, voice: 'kick', opts: { gain: 1.15 } });

  return ev;
}

function sectionAt(beat) {
  let s = SECTIONS[0];
  for (const x of SECTIONS) if (beat >= x.beat) s = x;
  return s.name;
}

/* ══ CHART ════════════════════════════════════════════════════════════════ */

function chart() {
  const notes = [];
  let mi = 0;
  const nextNote = (pool = PENT) => pool[mi++ % pool.length];

  const tap = (beat, action = 'A', pool = PENT, gain = 0.24) => {
    notes.push({
      beat, action, type: 'tap', cue: 'bubble',
      sound: { voice: 'lead', opts: { note: nextNote(pool), gain, dur: 0.2, wave: 'bright' } },
    });
  };

  const hold = (beat, beats, action = 'A') => {
    notes.push({
      beat, action, type: 'hold', holdBeats: beats, cue: 'bubble',
      sound: { voice: 'lead', opts: { note: nextNote(PENT_LOW), gain: 0.2, dur: beats * (60 / BPM) * 0.95, vib: 22 } },
    });
  };

  /* §A — OFF-BEATS (16..48).
     Bar 1 of each pair states it on the beat, bar 2 answers on the "and".
     Pairing them keeps the reference point alive. */
  for (let bar = 4; bar < 12; bar++) {
    const b = bar * 4;
    if (bar % 2 === 0) {
      [0, 1, 2, 3].forEach((o) => tap(b + o, 'A'));
    } else {
      [0.5, 1.5, 2.5, 3.5].forEach((o, i) => tap(b + o, i === 0 ? 'B' : 'A'));
    }
  }

  /* §B — SIXTEENTHS (48..80). "e" and "a" placements in short bursts, so the
     hand never has to sustain a 16th stream — bursts are more musical AND
     more forgiving than a wall of notes. */
  const SIXTEEN_CELLS = [
    [0, 0.75, 1, 2, 2.75, 3],
    [0, 0.25, 1, 1.75, 2, 3.25],
    [0, 0.5, 0.75, 2, 2.5, 2.75],
    [0, 1.25, 1.5, 2, 3, 3.25, 3.5],
  ];
  for (let bar = 12; bar < 20; bar++) {
    const b = bar * 4;
    const cell = SIXTEEN_CELLS[bar % SIXTEEN_CELLS.length];
    cell.forEach((o) => tap(b + o, o % 1 === 0 ? 'B' : 'A'));
  }

  /* §C — HOLDS (80..112). Alternates a two-beat hold with a syncopated tag,
     which is also a deliberate stamina valve before the hemiola. */
  for (let bar = 20; bar < 28; bar++) {
    const b = bar * 4;
    if (bar % 2 === 0) {
      hold(b, 2, 'A');
      tap(b + 2.5, 'A');
      tap(b + 3, 'B');
    } else {
      tap(b, 'B');
      hold(b + 1, 1.5, 'A');
      tap(b + 2.75, 'A');
      tap(b + 3.5, 'A');
    }
  }

  /* §D — HEMIOLA (112..152). Every dotted eighth (0.75 beats) for ten bars.
     The pattern's period is 3 sixteenths against a 16-sixteenth bar, so it
     realigns with beat 1 every three bars — 40 beats gives us three full
     cycles plus the satisfying landing.

     Every third note (i.e. every time the dotted-eighth pattern happens to land
     on an actual beat) is assigned to B. The player's two hands end up playing
     the 3 and the 4 separately, which is the only way this is playable at 132. */
  {
    let i = 0;
    for (let b = 112; b < 150; b += 0.75, i++) {
      const onBeat = Math.abs(b % 1) < 1e-6;
      tap(b, onBeat ? 'B' : 'A', onBeat ? PENT_LOW : PENT);
    }
    // The landing. Three bars of tension resolve on a downbeat.
    tap(150, 'B', PENT_LOW, 0.3);
    tap(151, 'A');
  }

  /* §E — FINALE (152..184). One bar from each earlier section, in order, so
     the finale is literally a recap — the player recognises every cell. */
  const RECAP = [
    [0, 1, 2, 3],
    [0.5, 1.5, 2.5, 3.5],
    [0, 0.75, 1, 2, 2.75, 3],
    [0, 0.25, 1, 1.75, 2, 3.25],
    [0, 0.75, 1.5, 2.25, 3],          // hemiola flavour, one bar
    [0, 0.5, 0.75, 1.5, 2, 2.5, 3],
    [0, 0.75, 1.5, 2.25, 3, 3.75],
    [0, 0.5, 1, 1.5, 2, 2.5, 3],
  ];
  RECAP.forEach((cell, i) => {
    const b = 152 + i * 4;
    cell.forEach((o) => tap(b + o, o % 1 === 0 && i > 3 ? 'B' : 'A'));
  });

  // Landing.
  notes.push({
    beat: END_BEAT, action: 'B', type: 'tap', cue: 'bubble',
    sound: { voice: 'stab', opts: { notes: ['A4', 'C5', 'E5'], gain: 0.26, dur: 1.4 } },
  });

  return notes.sort((a, b) => a.beat - b.beat);
}

export default {
  id: 'tidepool',
  name: 'Neon Tide Pool',
  difficulty: 'medium',
  blurb: 'An octopus DJ and a syncopated bassline. Off-beats, sixteenths, holds — and ten bars of three-against-four.',
  bpm: BPM,
  palette: 'tidepool',
  scene: 'tidepool',
  swing: 0,
  tempoMap: [{ beat: 0, bpm: BPM }],
  approachBeats: 4,
  sections: SECTIONS,
  endBeat: END_BEAT,
  music,
  chart,
};
