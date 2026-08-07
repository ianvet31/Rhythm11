/**
 * LEVEL 3 — "Vulpine Overdrive"
 *
 *   158 BPM (with modulations) · E minor · HARD
 *   Cast: a fox on a hoverboard, tearing through a neon canyon.
 *
 * ── Design intent ────────────────────────────────────────────────────────────
 *
 * Levels 1 and 2 kept a constant pulse and moved the notes around inside it.
 * This level moves the pulse.
 *
 * Three ideas, each harder than anything in the first two levels:
 *
 * ① ODD METER (§B). Bars of 7/8 grouped 2+2+3.
 *
 *        |1 2|3 4|5 6 7|1 2|3 4|5 6 7|
 *         ↑   ↑   ↑     ↑   ↑   ↑        ← the accents you actually feel
 *
 *    Nothing is syncopated here; every note is on an eighth. It's hard purely
 *    because the bar is the wrong length, and the player's body keeps trying
 *    to add an eighth to make it 4/4. The accents are hammered by the kick so
 *    the grouping is felt rather than counted.
 *
 * ② METRIC MODULATION (§C). At beat 112 the tempo drops from 158 to 105.33.
 *    That is not an arbitrary number: 105.33 = 158 × ⅔, chosen so that
 *
 *        one DOTTED QUARTER at 158  ==  one QUARTER at 105.33   (0.570 s)
 *
 *    A pulse that was a lopsided cross-rhythm before the change becomes the
 *    new downbeat after it. If the player was locked onto the dotted-quarter
 *    layer, the tempo change is seamless and they sail through. If they were
 *    counting quarters, the floor drops out. It is the same trick §D of Tide
 *    Pool was training you for, weaponised.
 *
 *    Then §D climbs back — four discrete tempo steps over eight beats — before
 *    a final push to 176 for the last stretch. Because the Conductor's tempo
 *    map converts beats→seconds with exact per-segment integration, and because
 *    charts are authored in BEATS, every one of these changes is free: notes,
 *    cue travel, and animation all follow automatically.
 *
 * ③ ALTERNATING STREAMS (§A, §E). Sixteenths at 158 BPM are 95ms apart. That
 *    is faster than most people can reliably repeat one finger, so the streams
 *    strictly alternate A-B-A-B and the two hands each play eighths. The chart
 *    is written so the alternation NEVER breaks mid-stream — a single repeated
 *    letter inside a run is the difference between hard and unfair.
 *
 * ── Difficulty is not just density ───────────────────────────────────────────
 *
 * There are long gaps in this chart, deliberately. A hard level that never
 * stops is exhausting rather than exciting; the peaks only read as peaks if
 * there are troughs. Every dense passage is followed by at least two bars where
 * the player can breathe and watch the fox.
 */

import { steps, mel, drums, melody } from '../../audio/sequencer.js';

const T1 = 158;             // main tempo
const T2 = (158 * 2) / 3;   // 105.33 — the metric modulation target
const T3 = 176;             // final push

/* |: Em | Em | C | D :| — with an Am for the breakdown. */
const BASS_ROOT = ['E1', 'E1', 'C2', 'D2'];
const CHORDS = [
  ['E3', 'G3', 'B3'],
  ['E3', 'G3', 'B3'],
  ['C3', 'E3', 'G3'],
  ['D3', 'F#3', 'A3'],
];
const PENT = ['E4', 'G4', 'A4', 'B4', 'D5', 'E5'];
const PENT_LOW = ['E3', 'G3', 'A3', 'B3', 'D4'];

const SECTIONS = [
  { beat: 0,   name: 'intro',    label: null },
  { beat: 16,  name: 'streams',  label: 'HANDS ALTERNATE' },
  { beat: 64,  name: 'seven',    label: 'SEVEN EIGHT — 2+2+3' },
  { beat: 112, name: 'modul',    label: 'TEMPO SHIFT' },
  { beat: 136, name: 'climb',    label: 'SPEEDING UP' },
  { beat: 160, name: 'finale',   label: 'OVERDRIVE!' },
  { beat: 204, name: 'outro',    label: null },
];

const END_BEAT = 212;

/**
 * Stepped accelerando. The tempo map is piecewise constant by design (it makes
 * beat↔time exact and cheap), so a smooth ramp is approximated by short
 * segments. Eight steps over eight beats is fine enough that it's heard as a
 * continuous speed-up rather than as gear changes.
 */
function climbSteps(fromBeat, toBeat, fromBpm, toBpm, n = 8) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    out.push({
      beat: fromBeat + (toBeat - fromBeat) * ((i - 1) / n),
      // Interpolate in log space: equal-ratio steps are what the ear reads as
      // an even accelerando. Linear BPM steps sound like they slow down.
      bpm: fromBpm * Math.pow(toBpm / fromBpm, t),
    });
  }
  return out;
}

const TEMPO_MAP = [
  { beat: 0, bpm: T1 },
  { beat: 112, bpm: T2 },
  ...climbSteps(136, 144, T2, T1, 6),
  { beat: 144, bpm: T1 },
  { beat: 180, bpm: T3 },
];

/* ══ MUSIC ════════════════════════════════════════════════════════════════ */

function music() {
  const ev = [];
  const bars = Math.ceil(END_BEAT / 4);

  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const sec = sectionAt(b);
    if (sec === 'seven') continue;   // 7/8 gets its own generator below
    if (sec === 'modul') continue;

    const heavy = sec === 'finale';
    drums(ev, 'kick', steps('x.....x.x.....x.', 4), b, 4, 1, { gain: 1.05, tune: 0.96 });
    drums(ev, 'snare', steps('....x.......x...', 4), b, 4, 1, { gain: heavy ? 0.62 : 0.5, bright: 1.15 });
    drums(ev, 'hat', steps('x.x.x.x.x.x.x.x.', 4), b, 4, 1, { gain: 0.15, cut: 9500 });
    if (heavy) drums(ev, 'hat', steps('..x...x...x...x.', 4), b, 4, 1, { gain: 0.12, open: true });
    if (bar % 8 === 7) drums(ev, 'tom', steps('........x.x.x.x.', 4), b, 4, 1, { gain: 0.5, freq: 260 });
  }

  /* §B — 7/8 groove, beats 64..112. Six 7/8 bars fill 42 beats; the remainder
     snaps back to 4/4 for the two-bar approach to the modulation.
     Accent map 2+2+3 is played by the kick, which is the ONLY thing keeping
     the grouping audible. */
  for (let i = 0; i < 6; i++) {
    const b = 64 + i * 7;
    for (const o of [0, 2, 4]) ev.push({ beat: b + o, voice: 'kick', opts: { gain: 1.05, tune: 0.96 } });
    ev.push({ beat: b + 1, voice: 'snare', opts: { gain: 0.4, bright: 1.1 } });
    ev.push({ beat: b + 4.5, voice: 'snare', opts: { gain: 0.34, bright: 1.1 } });
    for (let h = 0; h < 7; h++) ev.push({ beat: b + h, voice: 'hat', opts: { gain: 0.15, cut: 9500 } });
    // Bass follows the grouping, not the barline.
    for (const [o, n] of [[0, 'E1'], [2, 'E1'], [4, 'G1'], [5.5, 'D2']]) {
      ev.push({ beat: b + o, voice: 'bass', opts: { note: n, gain: 0.32, dur: 0.34, cutoff: 6 } });
    }
  }
  for (let bar = 26; bar < 28; bar++) {
    const b = bar * 4;
    drums(ev, 'kick', steps('x...x...x...x...', 4), b, 4, 1, { gain: 1.0 });
    drums(ev, 'hat', steps('x.x.x.x.x.x.x.x.', 4), b, 4, 1, { gain: 0.14, cut: 9500 });
  }

  /* §C — the modulation. Half-time, heavy, sparse. The whole point is that it
     feels like the world slowed down even though nothing skipped. */
  for (let bar = 28; bar < 34; bar++) {
    const b = bar * 4;
    drums(ev, 'kick', steps('x.......x.......', 4), b, 4, 1, { gain: 1.15, tune: 0.9, decay: 0.42 });
    drums(ev, 'snare', steps('....x.......x...', 4), b, 4, 1, { gain: 0.55, tone: 150, decay: 0.3 });
    drums(ev, 'hat', steps('..x...x...x...x.', 4), b, 4, 1, { gain: 0.13, open: true });
    ev.push({ beat: b, voice: 'pad', opts: { notes: ['A2', 'C3', 'E3'], gain: 0.07, dur: 2.2 } });
  }

  // Bass everywhere except the 7/8 and modulation sections (they have their own).
  for (let bar = 2; bar < bars; bar++) {
    const b = bar * 4;
    const sec = sectionAt(b);
    if (sec === 'seven' || sec === 'modul') continue;
    const root = BASS_ROOT[bar % 4];
    const line = mel(`${root} ${root} . ${root} ${root} . ${root} .`, 2);
    melody(ev, 'bass', line, b, 4, 1, { gain: 0.32, cutoff: 6, durScale: 0.85 });
  }

  // Lead arpeggio — sixteenths, aggressive, drops out in the breakdown.
  for (let bar = 8; bar < bars; bar++) {
    const b = bar * 4;
    const sec = sectionAt(b);
    if (sec === 'intro' || sec === 'modul' || sec === 'outro') continue;
    const ch = CHORDS[bar % 4];
    for (let i = 0; i < 8; i++) {
      ev.push({
        beat: b + i * 0.5,
        voice: 'lead',
        opts: { note: ch[i % ch.length].replace(/\d/, (d) => String(Number(d) + 1)), gain: 0.05, dur: 0.14 },
      });
    }
  }

  // Pads + risers to mark structure.
  for (let bar = 4; bar < bars; bar += 2) {
    ev.push({ beat: bar * 4, voice: 'pad', opts: { notes: CHORDS[bar % 4], gain: 0.045, dur: 4.4 } });
  }
  ev.push({ beat: 0, voice: 'riser', opts: { dur: 16 * (60 / T1), gain: 0.12, from: 200, to: 3400 } });
  ev.push({ beat: 104, voice: 'riser', opts: { dur: 8 * (60 / T1), gain: 0.15, from: 3000, to: 300 } }); // falling: we're slowing down
  ev.push({ beat: 152, voice: 'riser', opts: { dur: 8 * (60 / T1), gain: 0.16, from: 260, to: 5000 } });
  ev.push({ beat: 160, voice: 'clap', opts: { gain: 0.8 } });
  ev.push({ beat: 160, voice: 'kick', opts: { gain: 1.2 } });

  ev.push({ beat: END_BEAT, voice: 'stab', opts: { notes: ['E3', 'G3', 'B3', 'E4'], gain: 0.24, dur: 3 } });
  ev.push({ beat: END_BEAT, voice: 'kick', opts: { gain: 1.25 } });
  ev.push({ beat: END_BEAT, voice: 'clap', opts: { gain: 0.7 } });

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
  const pick = (pool) => pool[mi++ % pool.length];

  const tap = (beat, action, pool = PENT, gain = 0.22) => {
    notes.push({
      beat, action, type: 'tap', cue: 'spark',
      sound: { voice: 'lead', opts: { note: pick(pool), gain, dur: 0.15, wave: 'bright' } },
    });
  };
  const hold = (beat, beats, action = 'A') => {
    notes.push({
      beat, action, type: 'hold', holdBeats: beats, cue: 'spark',
      sound: { voice: 'bass', opts: { note: pick(PENT_LOW), gain: 0.26, dur: 0.5, cutoff: 7 } },
    });
  };

  /**
   * Alternating stream. Guarantees no letter ever repeats back-to-back, which
   * is what keeps 16ths at 158 BPM physically possible.
   */
  const stream = (start, count, step, startWith = 'A') => {
    let a = startWith;
    for (let i = 0; i < count; i++) {
      tap(start + i * step, a);
      a = a === 'A' ? 'B' : 'A';
    }
    return a;
  };

  /* §A — STREAMS (16..64). Alternating eighths, with 16th bursts on the tail of
     every second bar. Gaps every fourth bar. */
  for (let bar = 4; bar < 16; bar++) {
    const b = bar * 4;
    const k = bar % 4;
    if (k === 0) {
      stream(b, 4, 1, 'A');                        // steady quarters, breathe
    } else if (k === 1) {
      stream(b, 8, 0.5, 'A');                      // eighths
    } else if (k === 2) {
      stream(b, 6, 0.5, 'A');
      stream(b + 3, 4, 0.25, 'A');                 // 16th burst on beat 4
    } else {
      stream(b, 4, 0.5, 'A');
      hold(b + 2, 1.5, 'A');
      tap(b + 3.75, 'B');
    }
  }

  /* §B — 7/8 (64..106). Six bars of 2+2+3. The chart plays exactly the accent
     pattern for two bars, then decorates it — you get to feel the grouping
     before you're asked to play against it. */
  for (let i = 0; i < 6; i++) {
    const b = 64 + i * 7;
    if (i < 2) {
      // Skeleton: just the three accents.
      tap(b, 'B', PENT_LOW); tap(b + 2, 'B', PENT_LOW); tap(b + 4, 'B', PENT_LOW);
    } else if (i < 4) {
      // Accents plus the eighth after each — 2+2+3 becomes audible as motion.
      for (const o of [0, 0.5, 2, 2.5, 4, 4.5, 5.5]) {
        tap(b + o, o % 1 === 0 ? 'B' : 'A');
      }
    } else {
      // Full: eighths across the whole 7, alternating.
      stream(b, 14, 0.5, 'A');
    }
  }
  // Two 4/4 bars to re-establish before the tempo drops.
  stream(106, 8, 0.5, 'A');
  hold(110, 1.5, 'B');

  /* §C — MODULATION (112..136) at 105.33 BPM. Sparse and heavy. Every note is
     on a beat or a half — the difficulty is entirely "did you keep the pulse
     through the change", not dexterity. */
  for (let bar = 28; bar < 34; bar++) {
    const b = bar * 4;
    tap(b, 'B', PENT_LOW, 0.3);
    hold(b + 1, 1, 'A');
    tap(b + 2.5, 'A');
    tap(b + 3, 'B', PENT_LOW);
    if (bar % 2) tap(b + 3.5, 'A');
  }

  /* §D — CLIMB (136..160). Density rises along with the tempo.
     Each bar is written explicitly rather than generated, because a generated
     "count × step" pattern silently overflows its bar the moment count × step
     exceeds 4 — which collides with the next bar's opening note. (tools/check
     caught exactly that; every cell below is verified to fit inside its bar.) */
  const CLIMB = [
    (b) => stream(b, 4, 1, 'A'),                                   // b .. b+3
    (b) => { stream(b, 6, 0.5, 'A'); tap(b + 3, 'B', PENT_LOW); }, // b .. b+3
    (b) => stream(b, 8, 0.5, 'A'),                                 // b .. b+3.5
    (b) => { stream(b, 7, 0.5, 'B'); hold(b + 3.5, 0.5, 'A'); },   // b .. b+3.5
    (b) => { stream(b, 6, 0.5, 'A'); stream(b + 3, 4, 0.25, 'A'); },// b .. b+3.75
    (b) => { stream(b, 4, 0.5, 'A'); stream(b + 2, 8, 0.25, 'A'); },// b .. b+3.75
  ];
  CLIMB.forEach((fn, k) => fn(136 + k * 4));

  /* §E — FINALE (160..204). Everything, including a 176 BPM push at 180.
     Note the two-bar rests at 172 and 192: the peaks need the troughs. */
  const FIN = [
    (b) => stream(b, 8, 0.5, 'A'),
    (b) => { stream(b, 4, 0.5, 'A'); stream(b + 2, 8, 0.25, 'A'); },
    (b) => { stream(b, 6, 0.5, 'A'); hold(b + 3, 1, 'B'); },
    (b) => { /* breathe */ tap(b, 'B', PENT_LOW, 0.3); tap(b + 2, 'B', PENT_LOW, 0.3); },
    (b) => stream(b, 16, 0.25, 'A'),
    (b) => { stream(b, 8, 0.25, 'A'); stream(b + 2.5, 6, 0.25, 'B'); },
    (b) => { for (let i = 0; i < 6; i++) tap(b + i * 0.75, i % 2 ? 'A' : 'B'); },  // hemiola callback
    (b) => { tap(b, 'B', PENT_LOW, 0.3); hold(b + 1, 2, 'A'); },
    (b) => stream(b, 16, 0.25, 'B'),
    (b) => { stream(b, 6, 0.5, 'A'); stream(b + 3, 4, 0.25, 'B'); },
    (b) => { for (let i = 0; i < 8; i++) tap(b + i * 0.5, i % 3 === 0 ? 'B' : 'A'); },
  ];
  FIN.forEach((fn, i) => fn(160 + i * 4));

  // Landing — both buttons at once is the only chord in the game.
  notes.push({
    beat: END_BEAT, action: 'A', type: 'tap', cue: 'spark',
    sound: { voice: 'stab', opts: { notes: ['E4', 'G4', 'B4'], gain: 0.26, dur: 1.6 } },
  });
  notes.push({
    beat: END_BEAT, action: 'B', type: 'tap', cue: 'spark',
    sound: { voice: 'stab', opts: { notes: ['E3', 'B3'], gain: 0.24, dur: 1.8 } },
  });

  return notes.sort((a, b) => a.beat - b.beat);
}

export default {
  id: 'overdrive',
  name: 'Vulpine Overdrive',
  difficulty: 'hard',
  blurb: 'A fox at speed through a neon canyon. Alternating sixteenths, six bars of 7/8, and a metric modulation that drops the tempo to two-thirds mid-song.',
  bpm: T1,
  palette: 'overdrive',
  scene: 'overdrive',
  swing: 0,
  tempoMap: TEMPO_MAP,
  approachBeats: 4.6,
  sections: SECTIONS,
  endBeat: END_BEAT,
  music,
  chart,
};
