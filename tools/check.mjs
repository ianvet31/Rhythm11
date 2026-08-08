/**
 * Design-rule checker.
 *
 * Rhythm charts fail in ways that are invisible in code review and obvious the
 * instant you play them: two notes 40ms apart that no human can hit, a note
 * placed after the song ends, a chart that drifts out of the tempo map. This
 * script asserts the rules that keep a chart *playable*, so they're caught
 * before they waste anyone's time.
 *
 * Run: node tools/check.mjs
 */

import { Conductor } from '../src/core/conductor.js';
import { Judge, Grade, gradeFor, WINDOWS, MISS_AFTER } from '../src/core/judge.js';
import { swingBeat, steps, mel } from '../src/audio/sequencer.js';
import { Voices } from '../src/audio/synth.js';
import { LEVELS } from '../src/game/levels/index.js';

let failures = 0;
let checks = 0;

function ok(cond, msg, detail = '') {
  checks++;
  if (!cond) {
    failures++;
    console.log(`  ✗ ${msg}${detail ? `\n      ${detail}` : ''}`);
  }
}
function section(t) { console.log(`\n${t}`); }

/* A Conductor needs an AudioContext only for the audio clock; the tempo maths
   is pure. A tiny stub lets us exercise it under Node. */
const stubCtx = {
  currentTime: 0, outputLatency: 0, baseLatency: 0,
  getOutputTimestamp: () => null,
};

/* ── Tempo maths ───────────────────────────────────────────────────────────── */

section('Tempo map');
{
  const c = new Conductor(stubCtx);
  c.setTempoMap([{ beat: 0, bpm: 120 }]);
  ok(Math.abs(c.beatToTime(4) - 2) < 1e-9, '120 BPM: beat 4 is at 2.000s', `got ${c.beatToTime(4)}`);
  ok(Math.abs(c.timeToBeat(2) - 4) < 1e-9, 'timeToBeat inverts beatToTime');

  // Piecewise map: 8 beats at 120 (4s), then 8 at 60 (8s) = 12s at beat 16.
  c.setTempoMap([{ beat: 0, bpm: 120 }, { beat: 8, bpm: 60 }]);
  ok(Math.abs(c.beatToTime(8) - 4) < 1e-9, 'segment boundary is continuous', `got ${c.beatToTime(8)}`);
  ok(Math.abs(c.beatToTime(16) - 12) < 1e-9, 'second segment integrates at its own tempo', `got ${c.beatToTime(16)}`);
  ok(Math.abs(c.timeToBeat(12) - 16) < 1e-9, 'inverse holds across a tempo change');
  ok(c.bpmAt(3.999) === 120 && c.bpmAt(4.001) === 60, 'bpmAt switches at the boundary');

  // Round-trip over a dense sweep.
  let worst = 0;
  for (let b = 0; b < 200; b += 0.13) worst = Math.max(worst, Math.abs(c.timeToBeat(c.beatToTime(b)) - b));
  ok(worst < 1e-9, 'beat↔time round-trips exactly', `worst error ${worst}`);
}

/* ── Swing ─────────────────────────────────────────────────────────────────── */

section('Swing');
{
  ok(swingBeat(0, 0.3) === 0, 'downbeats never move');
  ok(Math.abs(swingBeat(1, 0.3) - 1) < 1e-12, 'beat 1 never moves');
  ok(swingBeat(0.5, 0.3) > 0.5, 'the off-eighth is pushed later');
  ok(Math.abs(swingBeat(0.5, 0.3) - 0.65) < 1e-12, 'swing 0.3 puts the "and" at 0.65');
  // Monotonic: a swung chart must never reorder its notes.
  let mono = true, prev = -1;
  for (let b = 0; b < 8; b += 0.0625) { const v = swingBeat(b, 0.3); if (v < prev) mono = false; prev = v; }
  ok(mono, 'swing is monotonic (never reorders notes)');
}

/* ── Judgment ──────────────────────────────────────────────────────────────── */

section('Judgment');
{
  ok(gradeFor(0) === Grade.PERFECT, 'dead on = perfect');
  ok(gradeFor(0.031) === Grade.PERFECT && gradeFor(0.033) === Grade.GREAT, 'perfect window edge at 32ms');
  ok(gradeFor(-0.031) === Grade.PERFECT, 'windows are symmetric');
  ok(gradeFor(0.2) === Grade.MISS, 'far outside = miss');

  const notes = [
    { beat: 0, time: 1.0, action: 'A', type: 'tap' },
    { beat: 1, time: 1.1, action: 'A', type: 'tap' },
    { beat: 2, time: 3.0, action: 'B', type: 'tap' },
  ];
  const j = new Judge(notes);
  j.reset();

  // NEAREST matching, not earliest: a press at 1.09 must take the 1.1 note.
  const r = j.press('A', 1.09);
  ok(r && r.note.time === 1.1, 'press matches the NEAREST note, not the earliest',
    `matched t=${r && r.note.time}`);

  const r2 = j.press('A', 1.0);
  ok(r2 && r2.note.time === 1.0, 'the other note is still available');

  ok(j.press('B', 1.05) === null, 'wrong action does not steal a note');
  ok(j.strays === 1, 'that press was counted as a stray');
  ok(j.combo === 0, 'a stray press breaks the combo');

  j.update(5);
  ok(j.counts.miss === 1, 'unhit notes retire as misses once the window closes');

  const j2 = new Judge(notes.map((n) => ({ ...n })));
  j2.reset();
  j2.press('A', 1.0); j2.press('A', 1.1); j2.press('B', 3.0);
  ok(j2.accuracy === 1 && j2.rank() === 'S+', 'a flawless run ranks S+', `rank ${j2.rank()}`);
  ok(j2.maxCombo === 3, 'combo counts every hit');
}

/* ── Charts ────────────────────────────────────────────────────────────────── */

/** Fastest a single finger can reliably repeat. Below this, a chart must
 *  alternate hands or it is not playable, only survivable. */
const SAME_HAND_MIN_MS = 85;
/** Absolute floor for any two notes, either hand. */
const ANY_MIN_MS = 38;

for (const L of LEVELS) {
  section(`Level: ${L.name} (${L.difficulty})`);
  const c = new Conductor(stubCtx);
  c.setTempoMap(L.tempoMap);

  const notes = L.chart();
  const music = L.music();
  const cues = L.cues ? L.cues() : [];

  /* ── THE TELEGRAPH RULE ──────────────────────────────────────────────────
     The defining constraint of this game: with no note highway, a player can
     only hit a note they were TOLD about. Every note therefore declares
     `answers` — the beat of the call or telegraph it responds to — and that
     call must

       (a) actually exist as a sounded event in music(), and
       (b) have sounded far enough in advance to be usable, and
       (c) not be so far in advance that nobody could still remember it.

     This is the rule that stops the game quietly drifting back into "just
     memorise the chart". It cannot be satisfied by accident: `answers` is used
     by nothing at runtime, so a chart that passes it passes on the merits. */

  const soundedBeats = new Set(music.map((e) => Math.round(e.beat * 48) / 48));
  const hasSoundAt = (beat) => soundedBeats.has(Math.round(beat * 48) / 48);

  ok(notes.every((n) => n.answers != null), 'every note declares what it answers',
    `${notes.filter((n) => n.answers == null).length} without \`answers\``);

  const orphan = notes.find((n) => n.answers != null && !hasSoundAt(n.answers));
  ok(!orphan, 'every note\'s call is actually sounded in the music',
    orphan && `note at beat ${orphan.beat} answers beat ${orphan.answers}, where nothing plays`);

  let minLead = Infinity, minLeadAt = 0;
  let maxLead = 0, maxLeadAt = 0;
  for (const n of notes) {
    if (n.answers == null) continue;
    const lead = c.beatToTime(n.beat) - c.beatToTime(n.answers);
    if (lead < minLead) { minLead = lead; minLeadAt = n.beat; }
    if (lead > maxLead) { maxLead = lead; maxLeadAt = n.beat; }
  }
  // 250ms is about the floor for hearing a cue and acting on it deliberately.
  ok(minLead >= 0.25, 'no call lands less than 250ms before the note it cues',
    `min lead ${(minLead * 1000).toFixed(0)}ms at beat ${minLeadAt}`);
  // Beyond ~8s you are testing memory, not rhythm.
  ok(maxLead <= 8.0, 'no call is more than 8s ahead of its note',
    `max lead ${maxLead.toFixed(2)}s at beat ${maxLeadAt}`);
  console.log(`    telegraph lead: ${(minLead * 1000).toFixed(0)}–${(maxLead * 1000).toFixed(0)}ms`);

  // Cue list sanity — the stage reacts to these, so a stale one is a visual bug.
  ok(cues.length > 0, 'declares presentation cues');
  ok(cues.every((q) => q.beat >= 0 && q.beat <= L.endBeat + 1), 'all cues fall inside the song');
  ok(!!L.stage, 'names a stage');
  ok(!!L.verb, 'states its verb in one line');

  ok(notes.length > 0, 'has notes');
  ok(music.length > 0, 'has music events');

  // Sorted and inside the song.
  let sorted = true;
  for (let i = 1; i < notes.length; i++) if (notes[i].beat < notes[i - 1].beat) sorted = false;
  ok(sorted, 'chart is sorted by beat');
  ok(notes[0].beat >= 4, 'no note before beat 4 (the player needs a count-in)', `first at ${notes[0].beat}`);
  ok(notes[notes.length - 1].beat <= L.endBeat, 'no note after endBeat');

  // Voices referenced actually exist.
  const badVoice = music.find((e) => !Voices[e.voice]);
  ok(!badVoice, 'every music event names a real voice', badVoice && `unknown: ${badVoice.voice}`);
  const badSound = notes.find((n) => n.sound && !Voices[n.sound.voice]);
  ok(!badSound, 'every note sound names a real voice', badSound && `unknown: ${badSound.sound.voice}`);
  ok(notes.every((n) => n.action === 'A' || n.action === 'B'), 'all actions are A or B');
  ok(notes.every((n) => n.type !== 'hold' || n.holdBeats > 0), 'hold notes have a positive length');

  // Playability, measured in real milliseconds through the tempo map.
  const times = notes.map((n) => ({ t: c.beatToTime(n.beat), a: n.action, beat: n.beat }));
  //
  // Note on the rule: a gap of EXACTLY zero across different actions is a
  // chord — both buttons at once, deliberate and playable. A gap of 15ms is a
  // mistake: too close to play as two notes, too far apart to play as one.
  // So zero is allowed and everything between zero and the floor is not.
  let minAny = Infinity, minAnyAt = 0;
  let minSame = Infinity, minSameAt = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i].t - times[i - 1].t) * 1000;
    const chord = gap < 1e-6 && times[i].a !== times[i - 1].a;
    if (!chord && gap < minAny) { minAny = gap; minAnyAt = times[i].beat; }
    if (times[i].a === times[i - 1].a && gap < minSame) { minSame = gap; minSameAt = times[i].beat; }
  }
  ok(minAny >= ANY_MIN_MS, `closest pair ≥ ${ANY_MIN_MS}ms`,
    `min ${minAny.toFixed(1)}ms at beat ${minAnyAt}`);
  ok(minSame >= SAME_HAND_MIN_MS, `closest SAME-hand pair ≥ ${SAME_HAND_MIN_MS}ms`,
    `min ${minSame.toFixed(1)}ms at beat ${minSameAt}`);

  // Simultaneous notes on the same action are unhittable.
  let dupe = null;
  for (let i = 1; i < times.length; i++) {
    if (times[i].a === times[i - 1].a && Math.abs(times[i].t - times[i - 1].t) < 1e-6) dupe = times[i].beat;
  }
  ok(!dupe, 'no two same-action notes at the identical time', dupe && `at beat ${dupe}`);

  // Density profile — a hard level should peak higher than an easy one.
  const dur = c.beatToTime(L.endBeat);
  const nps = notes.length / dur;
  let peak = 0;
  for (let t = 0; t < dur - 2; t += 0.5) {
    const n = times.filter((x) => x.t >= t && x.t < t + 2).length / 2;
    peak = Math.max(peak, n);
  }
  console.log(`    ${notes.length} notes · ${dur.toFixed(1)}s · ${nps.toFixed(2)} notes/sec avg · ${peak.toFixed(1)} peak`);
  console.log(`    ${music.length} music events · A/B split ${notes.filter(n=>n.action==='A').length}/${notes.filter(n=>n.action==='B').length}`);

  /* Difficulty is graded on PEAK density, not average.
     Average notes/sec is meaningless for a call-and-response game: roughly half
     of every song is the game playing AT you, during which the player correctly
     does nothing. A level with a brutal peak and generous rests would score as
     "easy" on the average and as accurate on the peak. Peak over a 2s window is
     what the hands actually have to survive. */
  const EXPECT = { easy: [1.5, 4.5], medium: [2.5, 6.5], hard: [4.0, 12.0] }[L.difficulty];
  ok(peak >= EXPECT[0] && peak <= EXPECT[1],
    `peak density suits "${L.difficulty}" (${EXPECT[0]}–${EXPECT[1]} n/s)`, `got ${peak.toFixed(2)}`);

  /* And the flip side: the player must be doing something a reasonable share of
     the time. A song that is 90% call is a listening exercise, not a game. */
  const active = times.filter((_, i) => i === 0 || times[i].t - times[i - 1].t < 2).length;
  ok(active / notes.length > 0.5, 'most notes sit inside a phrase rather than alone',
    `${((active / notes.length) * 100).toFixed(0)}% clustered`);

  // Sections must be ordered and inside the song.
  ok(L.sections.every((s, i) => i === 0 || s.beat > L.sections[i - 1].beat), 'sections are ordered');
  ok(L.sections[L.sections.length - 1].beat <= L.endBeat, 'sections end inside the song');

  // Rest check: a level should give the player somewhere to breathe.
  let longestGap = 0;
  for (let i = 1; i < times.length; i++) longestGap = Math.max(longestGap, times[i].t - times[i - 1].t);
  ok(longestGap >= 1.2, 'has at least one real rest (≥1.2s)', `longest gap ${longestGap.toFixed(2)}s`);
}

/* ── Notation helpers ──────────────────────────────────────────────────────── */

section('Notation');
{
  const s = steps('x...x...', 4);
  ok(s.length === 2 && s[0].beat === 0 && s[1].beat === 1, 'steps() places 16ths correctly');
  ok(steps('X...', 4)[0].vel > 1, 'X is an accent');
  ok(steps('o...', 4)[0].vel < 1, 'o is a ghost note');
  ok(steps('x|...|', 4).length === 1, 'bar separators are ignored');

  const m = mel('C4 - . E4', 2);
  ok(m.length === 2, 'mel() ties extend rather than add notes');
  ok(Math.abs(m[0].beats - 1) < 1e-9, 'a tie doubles the note length');
  ok(Math.abs(m[1].beat - 1.5) < 1e-9, 'rests advance the cursor');
  ok(mel('[C4,E4]', 2)[0].notes.length === 2, 'chords parse');
}

console.log(`\n${failures === 0 ? '✓ ALL PASS' : `✗ ${failures} FAILURE(S)`} — ${checks} checks\n`);
process.exit(failures ? 1 : 0);
