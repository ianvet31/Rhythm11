/**
 * MIDI parser tests.
 *
 * The parser is tested against MIDI files this script BUILDS byte by byte, so
 * every expected value is known exactly rather than eyeballed from a DAW
 * export. That matters because MIDI parsing fails in a specific, nasty way:
 * miss one detail of the encoding and the parse desynchronises, then produces
 * a plausible-looking stream of wrong notes rather than an error.
 *
 * The three details that cause that, each with a test below:
 *   • variable-length delta times
 *   • running status (the status byte may be omitted entirely)
 *   • note-on with velocity 0 meaning note-off
 *
 * Run: node tools/midi-check.mjs
 */

import { parseMidi, trackToChart, trackToEvents, findTrack, midiToName } from '../src/audio/midi.js';
import { Song, calibrationSong } from '../src/audio/song.js';
import { Conductor } from '../src/core/conductor.js';

let failures = 0;
let checks = 0;
const ok = (cond, msg, detail = '') => {
  checks++;
  if (!cond) { failures++; console.log(`  ✗ ${msg}${detail ? `\n      ${detail}` : ''}`); }
};
const section = (t) => console.log(`\n${t}`);

/* ── A tiny SMF writer, so tests have exact ground truth ──────────────────── */

function vlq(n) {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return out;
}
const u32 = (n) => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const u16 = (n) => [(n >> 8) & 255, n & 255];
const str = (s) => [...s].map((c) => c.charCodeAt(0));

function buildMidi({ ticksPerBeat = 480, format = 1, tracks }) {
  const chunks = [
    ...str('MThd'), ...u32(6), ...u16(format), ...u16(tracks.length), ...u16(ticksPerBeat),
  ];
  for (const events of tracks) {
    const body = [];
    for (const e of events) body.push(...vlq(e.delta), ...e.bytes);
    body.push(...vlq(0), 0xff, 0x2f, 0x00);      // end of track
    chunks.push(...str('MTrk'), ...u32(body.length), ...body);
  }
  return new Uint8Array(chunks);
}

const trackName = (name) => ({ delta: 0, bytes: [0xff, 0x03, name.length, ...str(name)] });
const tempo = (bpm, delta = 0) => {
  const us = Math.round(60000000 / bpm);
  return { delta, bytes: [0xff, 0x51, 0x03, (us >> 16) & 255, (us >> 8) & 255, us & 255] };
};
const timeSig = (num, denPow, delta = 0) =>
  ({ delta, bytes: [0xff, 0x58, 0x04, num, denPow, 24, 8] });
const noteOn = (note, vel, delta, chan = 0) => ({ delta, bytes: [0x90 | chan, note, vel] });
const noteOff = (note, delta, chan = 0) => ({ delta, bytes: [0x80 | chan, note, 0] });

/* ── Basic parse ──────────────────────────────────────────────────────────── */

section('MIDI: structure');
{
  const TPB = 480;
  const bytes = buildMidi({
    ticksPerBeat: TPB,
    tracks: [
      [trackName('Tempo'), tempo(140), timeSig(3, 2)],
      [
        trackName('Chart'),
        noteOn(36, 100, 0), noteOff(36, TPB / 2),          // beat 0, half-beat long
        noteOn(38, 80, TPB / 2), noteOff(38, TPB),         // beat 1, one beat long
        noteOn(36, 127, TPB * 2), noteOff(36, TPB / 4),    // beat 4
      ],
    ],
  });

  const m = parseMidi(bytes);
  ok(m.ticksPerBeat === TPB, 'reads the PPQ division', `got ${m.ticksPerBeat}`);
  ok(m.tracks.length === 2, 'reads both tracks', `got ${m.tracks.length}`);
  ok(m.tracks[0].name === 'Tempo' && m.tracks[1].name === 'Chart',
    'reads track names', `got ${m.tracks.map((t) => t.name).join(', ')}`);
  ok(Math.abs(m.tempoMap[0].bpm - 140) < 0.01, 'reads tempo', `got ${m.tempoMap[0].bpm}`);
  ok(m.timeSignatures[0].numerator === 3 && m.timeSignatures[0].denominator === 4,
    'reads the time signature as 3/4',
    `got ${m.timeSignatures[0]?.numerator}/${m.timeSignatures[0]?.denominator}`);

  const notes = m.tracks[1].notes;
  ok(notes.length === 3, 'reads all three notes', `got ${notes.length}`);
  ok(Math.abs(notes[0].beat - 0) < 1e-9, 'first note is at beat 0', `got ${notes[0].beat}`);
  ok(Math.abs(notes[0].durBeats - 0.5) < 1e-9, 'first note is half a beat long', `got ${notes[0].durBeats}`);
  ok(Math.abs(notes[1].beat - 1) < 1e-9, 'second note is at beat 1', `got ${notes[1].beat}`);
  ok(Math.abs(notes[2].beat - 4) < 1e-9, 'third note is at beat 4', `got ${notes[2].beat}`);
  ok(Math.abs(notes[1].velocity - 80 / 127) < 1e-6, 'velocity is normalised 0..1');
  ok(Math.abs(m.durationBeats - 4.25) < 1e-9, 'reports the total length', `got ${m.durationBeats}`);
}

/* ── Running status ───────────────────────────────────────────────────────── */

section('MIDI: running status');
{
  // Three note-ons and their note-offs, with the status byte written ONCE.
  // Every subsequent event omits it. This is what a size-conscious exporter
  // produces, and a parser that ignores it desynchronises immediately.
  const TPB = 96;
  const body = [
    trackName('Run'),
    noteOn(60, 100, 0),                                  // full status byte
    { delta: TPB, bytes: [60, 0] },                      // running: note-on vel 0 = off
    { delta: 0, bytes: [62, 100] },                      // running: note-on
    { delta: TPB, bytes: [62, 0] },                      // running: off
    { delta: 0, bytes: [64, 100] },
    { delta: TPB, bytes: [64, 0] },
  ];
  const m = parseMidi(buildMidi({ ticksPerBeat: TPB, tracks: [body] }));
  const n = m.tracks[0].notes;
  ok(n.length === 3, 'parses three notes written with running status', `got ${n.length}`);
  ok(n.map((x) => x.midi).join(',') === '60,62,64', 'pitches survive running status',
    `got ${n.map((x) => x.midi).join(',')}`);
  ok(Math.abs(n[1].beat - 1) < 1e-9 && Math.abs(n[2].beat - 2) < 1e-9,
    'timing survives running status', `got ${n.map((x) => x.beat).join(', ')}`);
  ok(n.every((x) => Math.abs(x.durBeats - 1) < 1e-9),
    'note-on with velocity 0 is correctly treated as note-off');
}

/* ── Long delta times ─────────────────────────────────────────────────────── */

section('MIDI: variable-length quantities');
{
  const TPB = 480;
  // A delta of 100 beats needs a multi-byte VLQ (48000 ticks > 127).
  const m = parseMidi(buildMidi({
    ticksPerBeat: TPB,
    tracks: [[trackName('Far'), noteOn(60, 100, TPB * 100), noteOff(60, TPB)]],
  }));
  const n = m.tracks[0].notes[0];
  ok(n && Math.abs(n.beat - 100) < 1e-9, 'decodes a multi-byte delta time', `got ${n?.beat}`);
}

/* ── Tempo changes ────────────────────────────────────────────────────────── */

section('MIDI: tempo changes');
{
  const TPB = 480;
  const m = parseMidi(buildMidi({
    ticksPerBeat: TPB,
    tracks: [[trackName('T'), tempo(120), tempo(60, TPB * 8)]],
  }));
  ok(m.tempoMap.length === 2, 'reads both tempo changes', `got ${m.tempoMap.length}`);
  ok(m.tempoMap[1].beat === 8, 'the change is at the right beat', `got ${m.tempoMap[1].beat}`);

  // The Conductor must integrate across the change, not multiply by one tempo.
  const c = new Conductor({ currentTime: 0, outputLatency: 0, baseLatency: 0, getOutputTimestamp: () => null });
  c.setTempoMap(m.tempoMap);
  ok(Math.abs(c.beatToTime(8) - 4) < 1e-9, '8 beats at 120 BPM is 4s', `got ${c.beatToTime(8)}`);
  ok(Math.abs(c.beatToTime(16) - 12) < 1e-9, 'the next 8 at 60 BPM add 8s', `got ${c.beatToTime(16)}`);
}

/* ── Chart conversion ─────────────────────────────────────────────────────── */

section('MIDI: chart conversion');
{
  const TPB = 480;
  const bytes = buildMidi({
    ticksPerBeat: TPB,
    tracks: [
      [trackName('Tempo'), tempo(108)],
      [
        trackName('Chart'),
        noteOn(36, 100, 0), noteOff(36, TPB / 4),
        noteOn(38, 100, 0), noteOff(38, TPB / 4),
        noteOn(60, 100, 0), noteOff(60, TPB / 4),        // melodic — not a chart note
        noteOn(36, 100, 0), noteOff(36, TPB * 4),        // long: becomes a hold
      ],
      [trackName('Lead'), noteOn(67, 90, 0), noteOff(67, TPB)],
    ],
  });
  const song = Song.fromMidi(parseMidi(bytes));

  ok(Math.abs(song.bpm - 108) < 0.01, 'Song takes its tempo from the MIDI', `got ${song.bpm}`);
  ok(!song.hasTempoChanges, 'a single-tempo file reports no changes');

  const chart = song.chartFromTrack('Chart', { holdThresholdBeats: 2 });
  ok(chart.length === 3, 'maps only the mapped pitches into the chart', `got ${chart.length}`);
  ok(chart[0].action === 'A' && chart[1].action === 'B',
    'C1 becomes A and D1 becomes B (GM drum convention)',
    `got ${chart.map((n) => n.action).join(',')}`);
  ok(chart.some((n) => n.type === 'hold'), 'a long note becomes a hold');
  ok(chart.every((n) => n.beat >= 0), 'chart beats are non-negative');

  const shifted = song.chartFromTrack('Chart', { beatOffset: 16 });
  ok(Math.abs(shifted[0].beat - 16) < 1e-9, 'beatOffset shifts the whole chart',
    `got ${shifted[0].beat}`);

  const custom = song.chartFromTrack('Chart', { actionForMidi: (m2) => (m2 === 60 ? 'A' : null) });
  ok(custom.length === 1 && custom[0].midi === 60, 'a custom pitch map is honoured');

  const events = song.eventsFromTrack('Lead', { voice: 'lead' });
  ok(events.length === 1 && events[0].voice === 'lead', 'a melodic track becomes synth events');
  ok(events[0].opts.note === 'G4', 'MIDI 67 is G4', `got ${events[0].opts.note}`);

  let threw = false;
  try { song.chartFromTrack('Nope'); } catch { threw = true; }
  ok(threw, 'asking for a missing track throws rather than returning silence');
}

/* ── Note names ───────────────────────────────────────────────────────────── */

section('MIDI: note names');
{
  ok(midiToName(60) === 'C4', 'MIDI 60 is C4', `got ${midiToName(60)}`);
  ok(midiToName(69) === 'A4', 'MIDI 69 is A4 (440Hz)', `got ${midiToName(69)}`);
  ok(midiToName(36) === 'C2', 'MIDI 36 is C2', `got ${midiToName(36)}`);
  ok(midiToName(61) === 'C#4', 'accidentals name correctly', `got ${midiToName(61)}`);
}

/* ── Song model ───────────────────────────────────────────────────────────── */

section('Song model');
{
  const s = new Song({ bpm: 128 });
  ok(s.tempoMap.length === 1 && s.tempoMap[0].bpm === 128, 'bpm shorthand builds a tempo map');
  ok(s.meter.numerator === 4, 'defaults to 4/4');
  ok(s.synthEvents().length === 0, 'a song with no synth layer yields no events');

  const s2 = new Song({ tempoMap: [{ beat: 8, bpm: 90 }] });
  ok(s2.tempoMap[0].beat === 0,
    'a tempo map that does not start at beat 0 gets one prepended',
    `starts at ${s2.tempoMap[0].beat}`);

  const cal = calibrationSong(100, 4);
  const ev = cal.synthEvents();
  ok(cal.bpm === 100, 'calibration song runs at the requested tempo');
  ok(ev.length > 0, 'calibration song produces click events');
  ok(ev.filter((e) => e.voice === 'kick').length === 4,
    'one accented downbeat per bar', `got ${ev.filter((e) => e.voice === 'kick').length}`);
  ok(ev.every((e) => Number.isFinite(e.beat) && e.beat >= 0), 'click beats are sane');
  // Every click must land exactly on an integer beat — this is the reference
  // the player's latency is measured against, so it cannot be approximate.
  ok(ev.every((e) => Math.abs(e.beat - Math.round(e.beat)) < 1e-12),
    'every calibration click is exactly on a beat');
}

console.log(`\n${failures === 0 ? '✓ ALL PASS' : `✗ ${failures} FAILURE(S)`} — ${checks} checks\n`);
process.exit(failures ? 1 : 0);
