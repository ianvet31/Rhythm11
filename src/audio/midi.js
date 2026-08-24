/**
 * midi — a Standard MIDI File parser.
 *
 * ── Why MIDI is the right authoring format for this game ─────────────────────
 *
 * A rhythm game needs to know two things about a song: where the beats are, and
 * where the notes are. An audio file contains neither — you have to infer them,
 * which is what tools/chart-lab.html spends its whole existence doing.
 *
 * A MIDI file states both, exactly, in the units the game already uses. Ticks
 * are rational subdivisions of a quarter note, tempo changes are explicit
 * events, and note-ons are sample-perfect. Import a MIDI and there is no
 * alignment problem to solve, no drift to check for, and no offset to guess:
 * beat 0 is beat 0.
 *
 * So the intended workflow is: compose in the DAW, export the arrangement as
 * audio AND the chart as MIDI. The audio is what you hear, the MIDI is what the
 * game judges, and because both came from the same project they agree by
 * construction.
 *
 * ── Format notes that matter ─────────────────────────────────────────────────
 *
 * A SMF is a header chunk followed by track chunks. Within a track, every event
 * is preceded by a delta time in "variable-length quantity" encoding — 7 bits
 * per byte, high bit set on all but the last. The three details that trip up
 * naive parsers, all handled below:
 *
 *   1. RUNNING STATUS. If an event's status byte would repeat the previous
 *      one, it may be omitted entirely. Miss this and the parse desynchronises
 *      into garbage a few events in.
 *   2. NOTE-ON WITH VELOCITY 0 means note-off. Extremely common — many DAWs
 *      never emit a real note-off at all.
 *   3. TEMPO LIVES IN TICKS, and a tempo change alters the seconds-per-tick
 *      from that point on. Converting ticks to seconds therefore requires
 *      integrating across the tempo map, not multiplying by one number.
 *
 * This parser deliberately ignores everything not needed for charting:
 * controllers, pitch bend, aftertouch, sysex. They're skipped correctly, just
 * not reported.
 */

/** Read a variable-length quantity. @returns {[value, nextOffset]} */
function readVLQ(bytes, at) {
  let value = 0;
  let i = at;
  for (let n = 0; n < 4; n++) {
    const b = bytes[i++];
    value = (value << 7) | (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return [value, i];
}

function readU32(b, at) {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}
function readU16(b, at) { return (b[at] << 8) | b[at + 1]; }
function readStr(b, at, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

/**
 * Parse a Standard MIDI File.
 *
 * @param {ArrayBuffer|Uint8Array} data
 * @returns {{
 *   format: number,
 *   division: number,
 *   ticksPerBeat: number,
 *   tempoMap: Array<{beat:number, bpm:number}>,
 *   timeSignatures: Array<{beat:number, numerator:number, denominator:number}>,
 *   tracks: Array<{
 *     name: string,
 *     channel: number|null,
 *     notes: Array<{beat:number, durBeats:number, midi:number, velocity:number}>,
 *   }>,
 *   durationBeats: number,
 * }}
 */
export function parseMidi(data) {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (readStr(b, 0, 4) !== 'MThd') {
    throw new Error('Not a MIDI file (missing MThd header).');
  }
  const headerLen = readU32(b, 4);
  const format = readU16(b, 8);
  const numTracks = readU16(b, 10);
  const division = readU16(b, 12);

  if (division & 0x8000) {
    // SMPTE time division. Vanishingly rare from music software, and it means
    // ticks are absolute time rather than musical — which defeats the whole
    // reason for using MIDI here.
    throw new Error('SMPTE-division MIDI is not supported; export with a musical (PPQ) time base.');
  }
  const ticksPerBeat = division;

  let at = 8 + headerLen;

  /** Tempo changes, collected across all tracks and merged at the end. */
  const rawTempos = [{ tick: 0, bpm: 120 }];
  const timeSignatures = [];
  const tracks = [];

  for (let t = 0; t < numTracks; t++) {
    if (at + 8 > b.length) break;
    if (readStr(b, at, 4) !== 'MTrk') {
      // Unknown chunk type: the spec says skip it by its declared length.
      at += 8 + readU32(b, at + 4);
      continue;
    }
    const len = readU32(b, at + 4);
    const end = at + 8 + len;
    let i = at + 8;

    let tick = 0;
    let runningStatus = 0;
    let name = '';
    let channel = null;
    /** midi note number → { startTick, velocity } for the note currently held */
    const open = new Map();
    const notes = [];

    while (i < end) {
      const [delta, next] = readVLQ(b, i);
      i = next;
      tick += delta;

      let status = b[i];
      if (status & 0x80) {
        i++;
        runningStatus = status;
      } else {
        // Running status: reuse the previous status byte, consume no byte.
        status = runningStatus;
      }

      const type = status & 0xf0;
      const chan = status & 0x0f;

      if (status === 0xff) {
        // ── Meta event
        const metaType = b[i++];
        const [mlen, mnext] = readVLQ(b, i);
        i = mnext;

        if (metaType === 0x03 && !name) {
          name = readStr(b, i, mlen).trim();
        } else if (metaType === 0x51 && mlen === 3) {
          const usPerBeat = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
          if (usPerBeat > 0) rawTempos.push({ tick, bpm: 60000000 / usPerBeat });
        } else if (metaType === 0x58 && mlen >= 2) {
          timeSignatures.push({
            tick,
            numerator: b[i],
            denominator: 2 ** b[i + 1],
          });
        }
        i += mlen;
      } else if (status === 0xf0 || status === 0xf7) {
        // ── SysEx: skip by declared length.
        const [slen, snext] = readVLQ(b, i);
        i = snext + slen;
      } else if (type === 0x90 || type === 0x80) {
        // ── Note on / off
        const note = b[i++];
        const vel = b[i++];
        if (channel === null) channel = chan;

        // Note-on with velocity 0 is a note-off. Many DAWs emit only these.
        if (type === 0x90 && vel > 0) {
          open.set(note, { startTick: tick, velocity: vel });
        } else {
          const o = open.get(note);
          if (o) {
            open.delete(note);
            notes.push({
              beat: o.startTick / ticksPerBeat,
              durBeats: Math.max(tick - o.startTick, 1) / ticksPerBeat,
              midi: note,
              velocity: o.velocity / 127,
              _startTick: o.startTick,
            });
          }
        }
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
        i += 2;    // aftertouch, controller, pitch bend
      } else if (type === 0xc0 || type === 0xd0) {
        i += 1;    // program change, channel pressure
      } else {
        // Unrecognised: we've lost sync. Bail on this track rather than
        // producing plausible-looking nonsense.
        break;
      }
    }

    // Any note still held at end-of-track gets a nominal length.
    for (const [note, o] of open) {
      notes.push({
        beat: o.startTick / ticksPerBeat,
        durBeats: 0.25,
        midi: note,
        velocity: o.velocity / 127,
        _startTick: o.startTick,
      });
    }

    notes.sort((p, q) => p.beat - q.beat || p.midi - q.midi);
    tracks.push({ name: name || `Track ${t + 1}`, channel, notes });
    at = end;
  }

  // Merge tempo changes: dedupe by tick, keep the last at each, sort.
  const byTick = new Map();
  for (const tm of rawTempos) byTick.set(tm.tick, tm.bpm);
  const tempoMap = [...byTick.entries()]
    .map(([tick, bpm]) => ({ beat: tick / ticksPerBeat, bpm }))
    .sort((p, q) => p.beat - q.beat);
  if (!tempoMap.length || tempoMap[0].beat !== 0) {
    tempoMap.unshift({ beat: 0, bpm: 120 });
  }

  let durationBeats = 0;
  for (const tr of tracks) {
    for (const n of tr.notes) durationBeats = Math.max(durationBeats, n.beat + n.durBeats);
  }

  return {
    format,
    division,
    ticksPerBeat,
    tempoMap,
    timeSignatures: timeSignatures.map((ts) => ({
      beat: ts.tick / ticksPerBeat,
      numerator: ts.numerator,
      denominator: ts.denominator,
    })),
    tracks,
    durationBeats,
  };
}

/* ── Turning a parsed MIDI into game data ─────────────────────────────────── */

/** MIDI note number → note name, for readability and for the synth. */
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiToName(m) {
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/**
 * Convert one MIDI track into chart notes.
 *
 * ── How a track becomes a chart ──────────────────────────────────────────────
 *
 * The pitch decides which BUTTON, not which sound. That inversion is the whole
 * point: in this game the player controls *when*, never *what*, so a chart maps
 * a small set of pitches onto the A/B actions and ignores the rest.
 *
 * The default map uses the General MIDI drum convention, because that's what
 * comes out of a DAW most naturally when you tap a chart on a drum pad:
 *
 *   C1 (36) kick   → A
 *   D1 (38) snare  → B
 *
 * Anything else is dropped unless you supply your own `actionForMidi`.
 *
 * @param {object} track a track from parseMidi()
 * @param {object} [opts]
 * @param {(midi:number)=>('A'|'B'|null)} [opts.actionForMidi]
 * @param {number} [opts.beatOffset] shift the whole chart, in beats
 * @param {number} [opts.holdThresholdBeats] notes longer than this become holds
 */
export function trackToChart(track, opts = {}) {
  const {
    actionForMidi = (m) => (m === 36 ? 'A' : m === 38 ? 'B' : null),
    beatOffset = 0,
    holdThresholdBeats = 0,
  } = opts;

  const out = [];
  for (const n of track.notes) {
    const action = actionForMidi(n.midi);
    if (!action) continue;
    const note = {
      beat: n.beat + beatOffset,
      action,
      type: (holdThresholdBeats > 0 && n.durBeats >= holdThresholdBeats) ? 'hold' : 'tap',
      velocity: n.velocity,
      midi: n.midi,
    };
    if (note.type === 'hold') note.holdBeats = n.durBeats;
    out.push(note);
  }
  return out.sort((p, q) => p.beat - q.beat);
}

/**
 * Convert a melodic track into synth events for the backing track.
 * Useful when you want the game to PLAY a MIDI part rather than judge it —
 * for calls, telegraphs, or a whole chiptune arrangement.
 */
export function trackToEvents(track, { voice = 'pluck', gain = 0.28, beatOffset = 0, opts = {} } = {}) {
  return track.notes.map((n) => ({
    beat: n.beat + beatOffset,
    voice,
    opts: {
      note: midiToName(n.midi),
      gain: gain * (0.5 + n.velocity * 0.5),
      dur: n.durBeats,
      ...opts,
    },
  }));
}

/** Find a track by name, case-insensitively and ignoring surrounding space. */
export function findTrack(midi, name) {
  const want = String(name).trim().toLowerCase();
  return midi.tracks.find((t) => t.name.trim().toLowerCase() === want) || null;
}

/** Human-readable summary — what Chart Lab shows after you drop a .mid in. */
export function describeMidi(midi) {
  return {
    format: midi.format,
    ticksPerBeat: midi.ticksPerBeat,
    tempo: midi.tempoMap.length === 1
      ? `${midi.tempoMap[0].bpm.toFixed(2)} BPM`
      : `${midi.tempoMap.length} tempo changes (${midi.tempoMap[0].bpm.toFixed(1)}–${
        Math.max(...midi.tempoMap.map((t) => t.bpm)).toFixed(1)} BPM)`,
    timeSignature: midi.timeSignatures.length
      ? `${midi.timeSignatures[0].numerator}/${midi.timeSignatures[0].denominator}`
      : '4/4 (assumed)',
    durationBeats: midi.durationBeats,
    tracks: midi.tracks.map((t) => ({
      name: t.name,
      notes: t.notes.length,
      range: t.notes.length
        ? `${midiToName(Math.min(...t.notes.map((n) => n.midi)))}–${
          midiToName(Math.max(...t.notes.map((n) => n.midi)))}`
        : '—',
    })),
  };
}
