/**
 * song — one description of a piece of music, whatever it's made of.
 *
 * ── The problem this solves ──────────────────────────────────────────────────
 *
 * There were three ways a level could get its music — synthesized events, a
 * recorded audio file, or (now) a MIDI file — and each declared its timing
 * differently. The tempo lived in `level.bpm` for one, in `audio.firstBeat` for
 * another, and inside the file itself for the third. Calibration, the design
 * checker and the stages each had to know about all three.
 *
 * That's how timing bugs hide. A Song is the single place tempo and offset are
 * defined, so every consumer asks the same object the same question and there
 * is exactly one answer.
 *
 * ── The model ────────────────────────────────────────────────────────────────
 *
 *      beat 0  ─────────────────────────────────────────────▶  musical time
 *        │
 *        │  the instant the player HEARS the downbeat
 *        │
 *      sources: any combination of
 *        • synth     scheduled events (always available, zero latency)
 *        • audio     a decoded recording, aligned by measuring its samples
 *        • midi      note data, which can drive EITHER the chart or the synth
 *
 * All three are anchored to the same beat 0 and the same tempo map, so they are
 * sample-accurate against each other by construction. That's what lets you run
 * a produced track underneath while the game still synthesizes its cues.
 *
 * ── Why tempo lives here and not in the level ────────────────────────────────
 *
 * Because a MIDI file already contains a tempo map, and it is authoritative. If
 * the level also declared one, they could disagree, and the resulting drift
 * would be invisible until the last chorus. A Song built from MIDI takes the
 * file's map; a Song built any other way takes the one you supply. Either way
 * there is only ever one.
 */

import { parseMidi, trackToChart, trackToEvents, findTrack, midiToName } from './midi.js';

export class Song {
  /**
   * @param {object} spec
   * @param {number} [spec.bpm]              shorthand for a constant tempo
   * @param {Array<{beat:number,bpm:number}>} [spec.tempoMap]
   * @param {{numerator:number,denominator:number}} [spec.meter]
   * @param {object} [spec.audio]            see audio/track.js
   * @param {object} [spec.midi]             parsed MIDI (use Song.fromMidi)
   * @param {()=>Array} [spec.synth]         synthesized backing events
   */
  constructor(spec = {}) {
    this.spec = spec;

    if (spec.tempoMap && spec.tempoMap.length) {
      this.tempoMap = [...spec.tempoMap].sort((a, b) => a.beat - b.beat);
    } else if (spec.bpm) {
      this.tempoMap = [{ beat: 0, bpm: spec.bpm }];
    } else {
      this.tempoMap = [{ beat: 0, bpm: 120 }];
    }
    if (this.tempoMap[0].beat !== 0) this.tempoMap.unshift({ beat: 0, bpm: this.tempoMap[0].bpm });

    this.meter = spec.meter || { numerator: 4, denominator: 4 };
    this.audio = spec.audio || null;
    this.midi = spec.midi || null;
    this._synth = spec.synth || null;
  }

  /** Nominal tempo, for display and for anything that needs one number. */
  get bpm() { return this.tempoMap[0].bpm; }

  get hasTempoChanges() { return this.tempoMap.length > 1; }

  /** Synthesized backing events, or [] if this song is purely recorded. */
  synthEvents() { return this._synth ? this._synth() : []; }

  /**
   * Build a Song from a parsed MIDI file.
   *
   * The file's tempo map wins — see the note at the top of this file.
   *
   * @param {object} parsed  result of parseMidi()
   * @param {object} [extra] anything else (audio source, synth layer)
   */
  static fromMidi(parsed, extra = {}) {
    return new Song({
      ...extra,
      tempoMap: parsed.tempoMap,
      meter: parsed.timeSignatures[0] || { numerator: 4, denominator: 4 },
      midi: parsed,
    });
  }

  /** Build a Song from raw MIDI bytes. */
  static async fromMidiBytes(bytes, extra = {}) {
    return Song.fromMidi(parseMidi(bytes), extra);
  }

  /** Fetch and parse a .mid, then build a Song. */
  static async fromMidiUrl(url, extra = {}) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
    return Song.fromMidiBytes(await res.arrayBuffer(), extra);
  }

  /**
   * Pull a chart out of a named MIDI track.
   * @param {string} trackName
   * @param {object} [opts] see trackToChart()
   */
  chartFromTrack(trackName, opts) {
    if (!this.midi) throw new Error('This song has no MIDI data.');
    const track = findTrack(this.midi, trackName);
    if (!track) {
      throw new Error(
        `No MIDI track named "${trackName}". Available: ${
          this.midi.tracks.map((t) => `"${t.name}"`).join(', ')}`,
      );
    }
    return trackToChart(track, opts);
  }

  /** Turn a named MIDI track into synth backing events. */
  eventsFromTrack(trackName, opts) {
    if (!this.midi) throw new Error('This song has no MIDI data.');
    const track = findTrack(this.midi, trackName);
    if (!track) return [];
    return trackToEvents(track, opts);
  }

  /** Every track name, for error messages and tooling. */
  trackNames() { return this.midi ? this.midi.tracks.map((t) => t.name) : []; }
}

/**
 * Normalise whatever a level declares into a Song.
 *
 * Levels may still spell things out the old way (`bpm` + `tempoMap` + `music()`
 * at the top level) — this adapts them, so adding the Song model didn't require
 * rewriting four working levels at the same time as changing the timing code.
 * Doing both at once is how you end up unable to tell which change broke it.
 */
export function songForLevel(level) {
  if (level.song instanceof Song) return level.song;
  return new Song({
    bpm: level.bpm,
    tempoMap: level.tempoMap,
    audio: level.audio,
    synth: level.music,
  });
}

/**
 * A standard calibration song.
 *
 * ── Why calibration gets a real Song ─────────────────────────────────────────
 *
 * Calibration used to run its own private metronome loop at a hard-coded 100
 * BPM with its own scheduler. That meant the thing measuring your latency did
 * not go through the same code path as the thing that then USES the
 * measurement — so a bug in one could not be caught by the other, and the two
 * could disagree without anything noticing.
 *
 * Now the click track is an ordinary Song with ordinary synth events, played by
 * the ordinary sequencer against the ordinary Conductor. If calibration is
 * right, gameplay timing is right, because they are the same machinery.
 */
export function calibrationSong(bpm = 100, bars = 32) {
  return new Song({
    bpm,
    synth: () => {
      const ev = [];
      for (let b = 0; b < bars * 4; b++) {
        const downbeat = b % 4 === 0;
        ev.push({
          beat: b,
          voice: 'hat',
          opts: { gain: downbeat ? 0.5 : 0.28, cut: downbeat ? 6000 : 9500 },
        });
        if (downbeat) ev.push({ beat: b, voice: 'kick', opts: { gain: 0.7 } });
      }
      return ev;
    },
  });
}
