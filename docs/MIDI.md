# Charting from MIDI

The intended workflow once you have your own songs.

---

## Why MIDI and not just audio

A rhythm game needs to know two things: where the beats are, and where the
notes are. **An audio file contains neither** — you have to infer them, which is
what `tools/chart-lab.html` spends its whole existence doing, and why it needs a
drift check and an offset slider.

**A MIDI file states both, exactly**, in the units the game already uses. Ticks
are rational subdivisions of a quarter note, tempo changes are explicit events,
and note-ons are perfect. Import a MIDI and there is no alignment to solve, no
drift to check, and no offset to guess: beat 0 is beat 0.

So: **export both.** The audio is what you hear, the MIDI is what the game
judges, and because they came from the same project they agree by construction.

---

## Exporting from FL Studio

1. Put your chart on its **own MIDI channel** — easiest is a drum pad you tap
   the rhythm on. One note for A, another for B.
2. `File → Export → MIDI file`.
3. Keep your **audio export from the same project, same range**. If the audio
   starts at bar 1, the MIDI must too.

The default pitch mapping follows the General MIDI drum convention, because
that's what comes out naturally when you tap a chart on a drum pad:

| pitch | note | action |
|---|---|---|
| 36 | C1 (kick) | **A** |
| 38 | D1 (snare) | **B** |

Everything else is ignored unless you supply your own map.

---

## Using it in a level

```js
import { Song } from '../../audio/song.js';

const song = await Song.fromMidiUrl('assets/mysong.mid', {
  audio: { src: ['assets/mysong.ogg', 'assets/mysong.m4a'] },
});

export default {
  id: 'mysong',
  name: 'My Song',
  song,                                  // tempo + meter come from the MIDI
  chart: () => song.chartFromTrack('Chart'),
  music: () => song.eventsFromTrack('Cues', { voice: 'pluck' }),
};
```

`Song` is the single place tempo and offset are defined. Before it existed, the
tempo lived in `level.bpm` for synth levels, in `audio.firstBeat` for recorded
ones, and inside the file for MIDI — and calibration, the design checker and
every stage each had to know about all three. That is how timing bugs hide.

**The MIDI's tempo map wins.** If the level also declared one they could
disagree, and the resulting drift would be invisible until the last chorus.

---

## Custom pitch mapping

```js
song.chartFromTrack('Chart', {
  actionForMidi: (m) => (m === 60 ? 'A' : m === 62 ? 'B' : null),
  holdThresholdBeats: 2,     // notes this long or longer become holds
  beatOffset: 0,             // shift the whole chart
});
```

Return `null` to ignore a pitch. That's how one track can carry both the chart
and reference material you don't want judged.

---

## Driving the synth from MIDI

A MIDI track can also *play* rather than be judged — useful for cues and
telegraphs, which you'll want to tweak without re-rendering the song:

```js
song.eventsFromTrack('Cues', { voice: 'pluck', gain: 0.3 });
```

These are scheduled from the same beat 0 as the recorded audio, so they're
sample-accurate against it.

---

## What the parser handles

Three details cause most MIDI parsing bugs, and they fail nastily — the parse
desynchronises and produces a plausible-looking stream of *wrong* notes rather
than an error. All three are handled and each has a test in
`tools/midi-check.mjs`:

- **Variable-length delta times** — 7 bits per byte, high bit as continuation.
- **Running status** — a repeated status byte may be omitted entirely.
- **Note-on with velocity 0** means note-off. Many DAWs never emit a real
  note-off at all.

Tests build MIDI files byte by byte, so every expected value is known exactly
rather than eyeballed from an export.

**Not supported:** SMPTE time division (throws with a clear message — export
with a musical/PPQ time base). Controllers, pitch bend and aftertouch are
skipped correctly but not reported.

---

## Calibration uses this too

The calibration click track is now an ordinary `Song` played by the ordinary
`Sequencer` against the ordinary `Conductor`.

It used to be a bespoke `setInterval` loop scheduling its own clicks — which
meant the code *measuring* your latency was not the code that would later *use*
the measurement. Two implementations of the same idea can disagree, and if they
do, calibration silently makes gameplay worse instead of better. Sharing the
machinery makes that impossible.
