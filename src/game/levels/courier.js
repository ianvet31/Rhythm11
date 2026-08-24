/**
 * MINIGAME 3 — "Rocket Courier"
 *
 *   150 BPM (with a modulation) · A minor · HARD
 *   Cast: a courier in a crash helmet on a night launchpad.
 *
 * ── The verb ─────────────────────────────────────────────────────────────────
 *
 * Parcels are lobbed at you out of the dark. Catch them.
 *   A (Space) — yellow parcel, caught two-handed
 *   B (K)     — pink parcel, stamped
 *
 * ── THE RULE THIS LEVEL IS BUILT AROUND ──────────────────────────────────────
 *
 *      VISUALS MAY TELL YOU **WHAT**.  ONLY AUDIO TELLS YOU **WHEN**.
 *
 * The parcel's colour reliably tells you which button — that's a "what", and
 * making the player guess it would just be cruel. But nothing about the parcel
 * tells you when it lands:
 *
 *   • Flight time varies per parcel (1.6–3.2 beats), seeded, so two parcels
 *     arriving on the same beat launched at completely different moments.
 *   • Arc height varies enormously.
 *   • Spin rate varies.
 *
 * All of that is arranged so a parcel still ARRIVES exactly on its beat — the
 * physics are honest, the *readability* is not. A player who tries to judge
 * "how far along is it" gets inconsistent results all night. A player who
 * listens is perfect.
 *
 * This is the sharpest expression of the Rhythm Heaven idea in the game, and it
 * only works because the audio telegraph is rock solid:
 *
 *   • Single parcel → one WHISTLE, exactly one beat early, always the same
 *     rising sweep. Learn it once and it never lies to you.
 *   • Burst of parcels → a TRILL one beat early that plays the burst's rhythm
 *     back at you in miniature. A call-and-response compressed into a beat.
 *
 * Overlapping whistles are the level's other idea: in §3 the telegraphs for two
 * different parcels sound at once, and you have to track both.
 *
 * ── The modulation ───────────────────────────────────────────────────────────
 *
 * At beat 112 the tempo drops to 100 — exactly ⅔ of 150, so a DOTTED QUARTER at
 * the old tempo equals a QUARTER at the new one (0.6s either way). Everything
 * slows, including the whistles, whose lead time is defined in beats and so
 * stretches with the music automatically. Then it climbs back and pushes past
 * the original tempo for the finale.
 */

import { steps, mel, drums, melody } from '../../audio/sequencer.js';

const T1 = 150;
const T2 = 100;          // = T1 × ⅔
const T3 = 168;

/** How far ahead of a catch its telegraph sounds. In BEATS, so it survives
 *  every tempo change for free. */
const LEAD = 1;

/* |: Am | F | G | Am :| */
const BASS_ROOT = ['A1', 'F1', 'G1', 'A1'];
const CHORDS = [
  ['A3', 'C4', 'E4'],
  ['F3', 'A3', 'C4'],
  ['G3', 'B3', 'D4'],
  ['A3', 'C4', 'E4'],
];
const PENT = ['A4', 'C5', 'D5', 'E5', 'G5'];

const SECTIONS = [
  { beat: 0, name: 'intro', label: null },
  { beat: 16, name: 'learn', label: 'WHISTLE, THEN CATCH' },
  { beat: 48, name: 'colours', label: 'PINK ONES GET STAMPED' },
  { beat: 80, name: 'overlap', label: 'TWO AT ONCE' },
  { beat: 112, name: 'slow', label: 'SLOW IT DOWN' },
  { beat: 136, name: 'back', label: 'BACK UP TO SPEED' },
  { beat: 160, name: 'fin', label: 'RUSH HOUR!' },
  { beat: 196, name: 'outro', label: null },
];

const END_BEAT = 204;

const TEMPO_MAP = [
  { beat: 0, bpm: T1 },
  { beat: 112, bpm: T2 },
  // Stepped accelerando, equal-ratio so the ear hears it as even.
  ...[1, 2, 3, 4].map((i) => ({ beat: 132 + i, bpm: T2 * Math.pow(T1 / T2, i / 5) })),
  { beat: 137, bpm: T1 },
  { beat: 160, bpm: T3 },
];

/* ══ THE DROP PLAN ════════════════════════════════════════════════════════
   One list drives notes, telegraphs and music together, so they cannot drift.

   Each entry: { at, pattern, kinds }
     at      beat the group ARRIVES (first parcel)
     pattern beat offsets within the group, relative to `at`
     kinds   'A' or 'B' per parcel                                            */

const DROPS = [];

const drop = (at, pattern, kinds) => {
  DROPS.push({ at, pattern, kinds: kinds || pattern.map(() => 'A') });
};

/* §1 — LEARN (16..48). One parcel at a time, on the beat, unhurried.
   Twelve repetitions of the same event is not padding: the whistle→catch link
   has to become automatic before anything else can be built on it. */
for (let bar = 4; bar < 12; bar++) {
  drop(bar * 4, [0]);
  if (bar >= 8) drop(bar * 4 + 2, [0]);
}

/* §2 — COLOURS (48..80). B parcels join. Alternating, then mixed. */
for (let bar = 12; bar < 20; bar++) {
  const b = bar * 4;
  const k = bar % 4;
  if (k === 0) { drop(b, [0], ['A']); drop(b + 2, [0], ['B']); }
  else if (k === 1) { drop(b, [0], ['B']); drop(b + 1.5, [0], ['A']); drop(b + 3, [0], ['B']); }
  else if (k === 2) { drop(b, [0, 1], ['A', 'B']); drop(b + 2.5, [0], ['A']); }
  else { drop(b, [0], ['B']); drop(b + 2, [0, 1], ['A', 'A']); }
}

/* §3 — OVERLAP (80..112). Groups close enough that their telegraphs collide.
   The trill for the second group starts while the first group is still
   arriving, so the player is hearing "what's next" and "do it now" at once —
   which is genuinely the hardest listening in the game. */
for (let bar = 20; bar < 28; bar++) {
  const b = bar * 4;
  const k = bar % 4;
  if (k === 0) { drop(b, [0, 0.5], ['A', 'A']); drop(b + 2, [0, 0.5, 1], ['B', 'B', 'A']); }
  else if (k === 1) { drop(b, [0, 0.5, 1], ['A', 'B', 'A']); drop(b + 2.5, [0, 0.5], ['B', 'A']); }
  else if (k === 2) { drop(b + 0.5, [0, 0.5, 1], ['B', 'A', 'B']); drop(b + 2.5, [0, 0.75], ['A', 'B']); }
  else { drop(b, [0, 0.5, 1, 1.5], ['A', 'B', 'A', 'B']); drop(b + 3, [0], ['A']); }
}

/* §4 — SLOW (112..136) at 100 BPM. Sparse, heavy, deliberate. The difficulty
   is entirely "did you keep the pulse through the change". */
for (let bar = 28; bar < 34; bar++) {
  const b = bar * 4;
  drop(b, [0], ['A']);
  drop(b + 1.5, [0], ['B']);
  if (bar % 2) drop(b + 3, [0], ['A']);
}

/* §5 — BACK UP (136..160). Density climbs with the tempo. */
for (let bar = 34; bar < 40; bar++) {
  const b = bar * 4;
  const k = bar - 34;
  if (k < 2) { drop(b, [0, 0.5], ['A', 'B']); drop(b + 2, [0], ['B']); }
  else if (k < 4) { drop(b, [0, 0.5, 1], ['A', 'B', 'A']); drop(b + 2, [0, 0.5], ['B', 'A']); }
  else { drop(b, [0, 0.5, 1], ['A', 'B', 'A']); drop(b + 2.5, [0, 0.5, 1], ['B', 'A', 'B']); }
}

/* §6 — RUSH HOUR (160..196) at 168 BPM. Everything, with two rests so the
   peaks read as peaks. */
const FIN = [
  [[0, 0.5, 1, 1.5], ['A', 'B', 'A', 'B']],
  [[0, 0.5, 1, 1.5, 2, 2.5], ['B', 'A', 'B', 'A', 'B', 'A']],
  [[0, 0.5, 1], ['A', 'B', 'A']],
  [[0, 0.25, 0.5, 1, 1.5], ['A', 'A', 'B', 'A', 'B']],
  null,                                   // breathe
  [[0, 0.5, 1, 1.5, 2, 2.5, 3], ['A', 'B', 'A', 'B', 'A', 'B', 'A']],
  [[0, 0.25, 0.5, 0.75, 1.5, 2], ['B', 'B', 'A', 'A', 'B', 'A']],
  [[0, 0.5, 1, 2, 2.5], ['A', 'B', 'A', 'B', 'A']],
  null,                                   // breathe
];
FIN.forEach((f, i) => { if (f) drop(160 + i * 4, f[0], f[1]); });

/* The final catch. Declared here rather than bolted on inside chart(), so that
   music(), cues() and chart() all see exactly the same DROPS list — appending
   to it later would have produced a parcel with no note, or a note with no
   parcel, depending on evaluation order. */
drop(END_BEAT, [0], ['A']);

/* ══ MUSIC ════════════════════════════════════════════════════════════════ */

function music() {
  const ev = [];
  const bars = Math.ceil(END_BEAT / 4);

  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const slow = b >= 112 && b < 136;
    if (slow) {
      drums(ev, 'kick', steps('x.......x.......', 4), b, 4, 1, { gain: 1.15, tune: 0.9, decay: 0.42 });
      drums(ev, 'snare', steps('....x.......x...', 4), b, 4, 1, { gain: 0.5, tone: 150 });
      drums(ev, 'hat', steps('..x...x...x...x.', 4), b, 4, 1, { gain: 0.12, open: true });
    } else {
      // Rotated per four-bar phrase; see tools/check.mjs on arrangement variety.
      const ph = Math.floor(bar / 4);
      const KICKS = [
        steps('x.....x.x.......', 4),
        steps('x.....x.x...x...', 4),
        steps('x...x...x.....x.', 4),
      ];
      drums(ev, 'kick', KICKS[ph % KICKS.length], b, 4, 1, { gain: 1.0, tune: 0.98 });
      drums(ev, 'snare', steps(ph % 2 ? '....x......ox..o' : '....x.......x...', 4),
        b, 4, 1, { gain: 0.5, bright: 1.1 });
      drums(ev, 'hat', steps(ph % 3 === 1 ? 'x.xxx.x.x.xxx.x.' : 'x.x.x.x.x.x.x.x.', 4),
        b, 4, 1, { gain: 0.13, cut: 9500 });
      if (bar % 8 === 7) drums(ev, 'tom', steps('........x.x.x.x.', 4), b, 4, 1, { gain: 0.45, freq: 250 });
    }
  }

  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const root = BASS_ROOT[bar % 4];
    melody(ev, 'bass', mel(`${root} ${root} . ${root} . ${root} ${root} .`, 2), b, 4, 1,
      { gain: 0.30, cutoff: 5.5, durScale: 0.9 });
  }

  for (let bar = 6; bar < bars; bar += 2) {
    ev.push({ beat: bar * 4, voice: 'pad', opts: { notes: CHORDS[bar % 4], gain: 0.045, dur: 4.2 } });
  }

  // Arpeggio, out during the slow section so the modulation lands cleanly.
  for (let bar = 8; bar < bars; bar++) {
    const b = bar * 4;
    if (b >= 108 && b < 136) continue;
    const ch = CHORDS[bar % 4];
    for (let i = 0; i < 8; i++) {
      ev.push({
        beat: b + i * 0.5, voice: 'lead',
        opts: { note: ch[i % ch.length].replace(/\d/, (d) => String(Number(d) + 1)), gain: 0.045, dur: 0.13 },
      });
    }
  }

  // ── THE TELEGRAPHS. Generated from the same DROPS list as the chart.
  for (const d of DROPS) {
    if (d.pattern.length === 1) {
      // Single parcel: one clean rising whistle, one beat early.
      ev.push({
        beat: d.at - LEAD, voice: 'whistle',
        opts: { dur: 0.34, gain: 0.20, from: 620, to: 1640 },
      });
    } else {
      // Burst: a trill that PLAYS THE RHYTHM back at you, in miniature, one
      // beat before you have to perform it. Same idea as the crow's caw and the
      // choirmaster's phrase — the call is always the answer.
      for (const o of d.pattern) {
        ev.push({
          beat: d.at - LEAD + o, voice: 'whistle',
          opts: { dur: 0.10, gain: 0.15, from: 1250, to: 1850 },
        });
      }
    }
  }

  ev.push({ beat: 0, voice: 'riser', opts: { dur: 16 * (60 / T1), gain: 0.11, from: 200, to: 3000 } });
  ev.push({ beat: 104, voice: 'riser', opts: { dur: 8 * (60 / T1), gain: 0.14, from: 2800, to: 280 } });
  ev.push({ beat: 152, voice: 'riser', opts: { dur: 8 * (60 / T1), gain: 0.15, from: 260, to: 4600 } });
  ev.push({ beat: 160, voice: 'clap', opts: { gain: 0.8 } });
  ev.push({ beat: END_BEAT, voice: 'stab', opts: { notes: ['A3', 'C4', 'E4', 'A4'], gain: 0.22, dur: 2.8 } });
  ev.push({ beat: END_BEAT, voice: 'kick', opts: { gain: 1.2 } });

  return ev;
}

/* ══ CUES ═════════════════════════════════════════════════════════════════ */

/**
 * The stage needs to know when to LAUNCH each parcel, which is earlier than the
 * telegraph and varies per parcel. Flight time is derived from the parcel's
 * seed — the whole misleading-visual mechanism lives in this one number.
 */
function cues() {
  const out = [];
  let n = 0;
  for (const d of DROPS) {
    d.pattern.forEach((o, i) => {
      const seed = n++;
      const flight = 1.6 + ((Math.sin(seed * 53.31) + 1) / 2) * 1.6;  // 1.6–3.2 beats
      out.push({
        beat: d.at + o - flight,
        kind: 'launch',
        seed,
        flight,
        arrive: d.at + o,
        parcel: d.kinds[i],
      });
    });
    out.push({ beat: d.at - LEAD, kind: 'telegraph', count: d.pattern.length });
  }
  return out;
}

/* ══ CHART ════════════════════════════════════════════════════════════════ */

function chart() {
  const notes = [];
  let n = 0;
  for (const d of DROPS) {
    d.pattern.forEach((o, i) => {
      notes.push({
        beat: d.at + o,
        action: d.kinds[i],
        type: 'tap',
        seed: n++,
        // Points at this parcel's own telegraph blip.
        answers: d.at - LEAD + (d.pattern.length === 1 ? 0 : o),
        sound: d.at === END_BEAT
          ? { voice: 'stab', opts: { notes: ['A4', 'C5', 'E5'], gain: 0.26, dur: 1.5 } }
          : { voice: 'lead', opts: { note: PENT[(n * 3) % PENT.length], gain: 0.2, dur: 0.14, wave: 'bright' } },
      });
    });
  }

  return notes.sort((a, b) => a.beat - b.beat);
}

export default {
  id: 'courier',
  name: 'Rocket Courier',
  difficulty: 'hard',
  blurb: 'Parcels out of the dark. The whistle is one beat early, every time — and everything you can see about the parcel is a lie.',
  verb: 'Tap A for yellow, B for pink. Listen for the whistle.',
  bpm: T1,
  palette: 'pad',
  stage: 'courier',
  tempoMap: TEMPO_MAP,
  sections: SECTIONS,
  endBeat: END_BEAT,
  lead: LEAD,
  music,
  chart,
  cues,
};
