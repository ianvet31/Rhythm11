# Using your own songs

Everything you need to go from an FL Studio project to a playable level.

---

## The one thing that will bite you

**You cannot trust where a compressed audio file starts.**

Lossy codecs (MP3, AAC, Vorbis, Opus) work in fixed-size blocks. The encoder pads
the front of the file with silence to fill the first block, and the decoder is
meant to strip it back off. Whether it does — and how much — varies by codec, by
encoder, and **by browser**:

- MP3 has no standard field for it at all. The Xing/Info header that carries the
  delay is a later extension, and not every decoder honours it.
- A gapless AAC clip can come out **~45ms late in Chrome, Firefox and Edge**
  while Safari plays it correctly.

45ms is bigger than this game's entire ±32ms perfect window. A chart you author
in Chrome would be unplayable in Safari, and you'd have no idea why.

**How this repo deals with it:** it doesn't trust the file. `src/audio/track.js`
decodes to an `AudioBuffer`, then *measures the decoded samples* to find where the
audio really begins. By that point the codec, the container and the browser's
padding behaviour have already happened and are baked into samples we can see, so
the answer is the same everywhere.

You don't have to do anything for this — but it's why the workflow below says
"work in WAV" and why you should never hand-tune an offset in one browser and
assume it holds.

---

## Which format

| | use it? | why |
|---|---|---|
| **WAV** | **yes, while authoring** | Uncompressed. Zero encoder delay, byte-exact, nothing to go wrong. ~10MB/min stereo. |
| **FLAC** | fine | Lossless, ~half the size of WAV. Supported everywhere current. |
| **OGG Vorbis** | yes, for shipping | Good quality per byte. Chrome/Firefox/Edge forever; **Safari only since 18.4 / iOS 18.4**. |
| **Opus** | yes, for shipping | Best quality per byte — transparent around 96kbps stereo vs ~128 for AAC. Same recent-Safari caveat. |
| **AAC (.m4a)** | yes, as the fallback | Supported everywhere, including older Safari. |
| **MP3** | last resort | Universal, but the worst delay story of the lot. |

**Recommendation:** author in **WAV**. When you ship, provide `.ogg` *and* `.m4a`
and let the loader pick:

```js
audio: { src: ['assets/song.ogg', 'assets/song.m4a'] }
```

`src` is tried in order, first success wins. If you only ever run this locally,
just use WAV and skip the whole question.

---

## Exporting from FL Studio

1. **Lock your tempo and write it down to 3 decimals.** If your project is at
   `128.000`, great. If you nudged it to `127.5`, that's fine too — but the game
   needs the exact number. A BPM that's off by 0.05 drifts ~0.6ms per beat:
   invisible in bar 1, over 100ms by the end of a 3-minute track. Charts authored
   against the intro become unplayable in the outro.

2. **Export from bar 1, not from the playlist selection.** Set the export range
   to start exactly at 1:1:0. If there's a pickup or a count-in you don't want
   charted, that's fine — you'll set `firstBeat` to skip it.

3. **Format: WAV, 16 or 24-bit, at your project's sample rate** (44.1k or 48k
   both fine — the browser resamples on decode either way).

4. **Turn OFF "Save ACIDized"** and any "trim silence" option. You want the file
   to be exactly what you rendered.

5. **Leave tails intact.** Enable "Leave remainder" / tail so a final reverb isn't
   chopped — the game measures trailing silence and won't be confused by it.

If you're doing Aphex Twin-ish things with tempo automation or long ramps, see
*Tempo changes* below — the engine handles them, but the chart has to declare
them.

---

## The workflow

### 1. Align the song

Open `tools/chart-lab.html` in a browser (it needs a server for the module
imports — `npx serve .` from the repo root, then go to
`/tools/chart-lab.html`).

Drop your file in. You get a scrolling waveform with a beat grid over it.

- Type your **BPM from FL Studio** into the box, then hit **AUTO-FIT**. When
  a BPM is supplied it's trusted and only the offset is solved for — automatic
  tempo detection guesses half or double time often enough that your DAW's
  number should always win.
- Turn the **metronome on and play**. This is the real test. Looking at the
  waveform gets you close; *hearing* a click against the kick drum gets you
  exact — a few milliseconds out and you hear a flam, which is far more obvious
  than a few pixels of misalignment. Nudge **Offset** until the click disappears
  into the kick.
- Watch the **drift check** readout. It compares how well the grid fits the first
  eighth of the song against the last eighth. If it says `DRIFTING`, your BPM is
  wrong — not your offset. Fix the BPM first; offset can't compensate for it.

### 2. Tap the chart

With the track playing, tap <kbd>F</kbd>/<kbd>J</kbd> for A notes and
<kbd>K</kbd> for B notes. <kbd>Z</kbd> undoes.

The **Quantise** dropdown snaps taps to the grid. A grey line shows how far your
raw tap was from where it snapped, so you can see your own timing error — if the
grey lines all lean one way, your tapping is biased and you may want to
re-calibrate.

Use `raw (no snap)` only if you're deliberately charting something the grid can't
express, like a swung feel or a rubato passage.

### 3. Export

Fill in the level id and name, hit **EXPORT LEVEL FILE**, and copy the result
into `src/game/levels/`. It's a working level with `TODO`s where you need to make
design decisions — which stage, which palette, what the verb is.

Then register it in `src/game/levels/index.js` and run `npm test`. The design
checker will tell you what's missing or unplayable.

---

## Level schema for a recorded track

```js
export default {
  id: 'mysong',
  name: 'My Song',
  bpm: 128,
  tempoMap: [{ beat: 0, bpm: 128 }],

  audio: {
    // Tried in order; first one that loads and decodes wins.
    src: ['assets/mysong.ogg', 'assets/mysong.m4a'],

    // Seconds from the first AUDIBLE sample to beat 1 of your chart.
    // 0 = the music starts right on the downbeat.
    // Use a positive value to skip a count-in or a pickup.
    firstBeat: 0,

    // Measure and remove leading silence (default true). Turn OFF only if the
    // track deliberately fades in from nothing — the detector needs a transient
    // to find, and a slow fade has none. Then supply `audioStart` yourself.
    trimSilence: true,

    gain: 0.9,
  },

  // Optional, and worth knowing about: synthesized events still work ALONGSIDE
  // a recorded track, scheduled from the same beat-0 instant, so they're
  // sample-accurate against it. Handy for cue sounds — you can tweak a
  // telegraph without re-rendering the song.
  music: () => [],

  chart: () => [ /* notes, in BEATS */ ],
};
```

### Why charts are in beats, not seconds

A chart in seconds breaks the moment you change the tempo, and can't express a
tempo change at all. In beats, the `Conductor`'s tempo map converts to seconds
exactly, and everything — notes, animation, cue travel — follows for free.

### Tempo changes

```js
tempoMap: [
  { beat: 0,   bpm: 128 },
  { beat: 128, bpm: 96 },   // half-time section
  { beat: 160, bpm: 128 },
],
```

The map must match what the audio actually does. For a smooth accelerando,
approximate it with several small steps — see `courier.js`, which ramps in
equal *ratio* steps because equal BPM steps sound like they slow down.

---

## Memory, and when it matters

A decoded `AudioBuffer` is 4 bytes per sample per channel. A 3-minute stereo
track at 48kHz is about **69MB resident**, and decoded buffers are cached so
retrying a level doesn't re-decode.

Fine for a handful of songs. If you get to twenty, you'll want to evict the cache
between levels — `clearTrackCache()` in `src/audio/track.js`.

---

## Things that will go wrong, and what they mean

| symptom | cause |
|---|---|
| Everything is late by a constant amount, on one browser only | Codec padding. Should be handled automatically — if not, check `trimSilence` isn't `false`. |
| Fine at the start, drifts apart by the end | BPM is wrong. Offset cannot fix this. Use the drift check. |
| Off by exactly half a beat, or a whole beat | Offset is on the wrong grid line. Add or subtract `60/bpm`. |
| Off by a consistent 20–200ms everywhere, all browsers | This is *your* latency, not the file's. Run the game's Calibrate screen. |
| First beat arrives late the first time you play a level | Decode blocking. The loading screen exists for this; make sure the level declares `audio` so it gets preloaded. |
| Notes drift only in a tempo-change section | Your `tempoMap` doesn't match the audio. |

---

## Why not just use an `<audio>` element?

Because it can't be started at a precise moment, its `currentTime` is only
loosely related to what the speaker is doing, and it runs on a different clock
from the `AudioContext` — so it drifts against anything you schedule.

`AudioBufferSourceNode.start(when)` takes an absolute AudioContext time and
begins at that exact sample. And since the buffer and `ctx.currentTime` both
advance at the context's sample rate, they cannot drift apart at all. That
property is the entire reason this game can stay in sync for four minutes.

---

Sources on codec delay and browser support:
[Gapless playback — Hydrogenaudio](https://wiki.hydrogenaudio.org/index.php?title=Gapless_playback) ·
[Sounds fun — Jake Archibald](https://jakearchibald.com/2016/sounds-fun/) ·
[Web audio codec guide — MDN](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Audio_codecs) ·
[decodeAudioData MP3 info frames — Mozilla bug 1566389](https://bugzilla.mozilla.org/show_bug.cgi?id=1566389)
