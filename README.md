# Rhythm 11

A browser rhythm game in the spirit of *Rhythm Heaven* — animal characters, chunky
retro vector art, and original synthesized music. Three stages, three difficulties,
three different rhythmic ideas.

No build step, no assets, no dependencies. The music is generated from oscillators
and the art is drawn from geometry, so the whole game is about 200 kB of source and
loads instantly.

---

## Play

```bash
npx serve .          # or any static server
# then open http://localhost:3000
```

Or build the single-file version and just double-click it:

```bash
node tools/build.mjs
open dist/rhythm11.html
```

**Controls**

| | keys |
|---|---|
| **A** — the ball | <kbd>Space</kbd> <kbd>J</kbd> <kbd>F</kbd> <kbd>←</kbd> |
| **B** — the diamond | <kbd>K</kbd> <kbd>D</kbd> <kbd>→</kbd> |
| pause | <kbd>Esc</kbd> |

Touch: tap the left half for A, the right half for B.

Run the calibration screen first. It takes fifteen seconds and it is the difference
between the game feeling tight and feeling broken — see *Calibration* below.

---

## The stages

### 1. Savanna Stomp — 100 BPM, easy
Meerkat drummers and a giraffe conductor. Built almost entirely as **call and
response**: the meerkats play a two-bar phrase, you play it back. You are never
asked to perform a rhythm you have not just heard.

The idea it teaches is **swing** — every eighth note is long-short, roughly 2:1.
Swing is where most players' internal grid first breaks, and call-and-response is
the gentlest way in, because you can hear the target instead of counting it.

### 2. Neon Tide Pool — 132 BPM, medium
An octopus DJ. Four sections that progressively destabilise the pulse: off-beats,
then sixteenths, then hold notes, then ten bars of **hemiola** — a note every
dotted eighth, a 3-unit pattern running over a 4-unit bar.

```
bar     |1 . . . 2 . . . 3 . . . 4 . . . |
16ths    x  x  x  x  x  x  x  x  x  x  x  x  x  x  x  x
dotted   X . . X . . X . . X . . X . . X     ← repeats every 3
```

It only realigns with the downbeat every three bars. For those three bars you have
to stop counting and ride it. The kick drum drops out underneath, because with a
four-on-the-floor still hammering, hemiola just sounds like a mistake.

### 3. Vulpine Overdrive — 158 BPM, hard
A fox on a hoverboard. Three ideas at once:

- **Odd meter** — six bars of 7/8 grouped 2+2+3. Nothing is syncopated; it's hard
  purely because the bar is the wrong length and your body keeps trying to add an
  eighth to fix it.
- **Metric modulation** — at beat 112 the tempo drops from 158 to 105.33 BPM. Not
  an arbitrary number: `105.33 = 158 × ⅔`, chosen so one *dotted quarter* at the
  old tempo equals one *quarter* at the new one (both 0.570s). A cross-rhythm
  before the change becomes the downbeat after it. Then it climbs back in six
  steps and pushes to 176 for the finale.
- **Alternating sixteenths** — 95ms apart, faster than one finger can reliably
  repeat, so streams strictly alternate A-B-A-B and each hand plays eighths. The
  chart never breaks the alternation mid-run; a single repeated letter inside a
  stream is the difference between hard and unfair.

---

## Why it feels the way it feels

Most of the engineering here is in service of one thing: the gap between pressing a
key and being convinced the game noticed.

### Three clocks, one timeline

A rhythm game has three clocks that do not agree.

| clock | granularity | what it's for |
|---|---|---|
| `AudioContext.currentTime` | ~2.7ms (one render quantum) | the only clock the sound card obeys |
| `performance.now()` | sub-ms | the epoch input events are stamped in |
| `requestAnimationFrame` | ~16.7ms | when pixels actually appear |

[`core/conductor.js`](src/core/conductor.js) keeps a continuously-corrected affine
map between the first two and expresses everything as **song time — seconds since
the player *heard* beat 0**. "Heard", not "scheduled": those differ by the output
latency of the audio stack, which ranges from 5ms on a wired desktop to 300ms on
Bluetooth headphones.

The correlation comes from `getOutputTimestamp()`, which reports a
`(contextTime, performanceTime)` pair for the same physical instant, low-pass
filtered so it drifts rather than jumps. A hard jump would teleport the judgment
line mid-song, which reads to the player as a random miss.

### Input never touches the frame loop

[`core/input.js`](src/core/input.js) uses `event.timeStamp` — when the key
physically went down — never `performance.now()` read inside the handler, which is
when JavaScript got around to it. Under load those differ by tens of milliseconds.

The smoke test measures the cost of getting this wrong. Same simulated player,
same intent, only the timestamp source differs:

```
event.timeStamp   → 100.00%  rank S+  mean  0.0ms  spread ± 0.0ms  perfect 209/209
frame-quantized   →  95.77%  rank A   mean +4.2ms  spread ±23.1ms  perfect 189/209
```

Twenty perfects, thrown away for nothing.

The hit sound is also scheduled *from inside the event handler*, not queued for the
next frame. Audio feedback delayed by one frame is felt as input lag even when the
judgment was correct — players feel the sound, not the score.

### Judgment windows

```
      miss │  good  │ great│PERFECT│great │  good  │ miss
 ──────────┼────────┼──────┼───┬───┼──────┼────────┼──────────►
         -110     -62    -32   0   +32   +62     +110   ms
```

±32ms is about two frames — tight enough to feel earned, loose enough not to be
grading your hardware. Windows are constant in **time**, not in beats: your motor
precision doesn't improve because the song is slower.

Presses match the **nearest** unjudged note, not the earliest. With "earliest", one
early press consumes the wrong note and every subsequent press shifts, turning a
single mistake into a wall of misses.

### Juice

A perfect hit fires, within ~30ms: the note's musical sound, a hit chime, a ring
flash, an expanding shockwave, a character squash, 18 particles, a score pop with
an overshoot ease, **~35ms of hitstop**, and a camera punch. None of it changes the
score. All of it changes whether you want to press the button again.

Feedback scales with quality — a *good* hit gets a small, dull, quiet response and
a *perfect* gets a big gold bright one. That gap is what makes precision worth
chasing.

Hitstop freezes the **animation** clock only. The audio and judgment clocks keep
running at full speed. Pausing the music for 35ms would destroy the thing the whole
game is built on.

### The player completes the music

Every chart note carries a musical sound, and the backing track is arranged with
those notes *missing*. A clean run finishes the tune; a sloppy run has audible
holes in it. This does more for satisfaction than any particle effect.

### Character animation can't drift

Every critter takes a **beat phase**, not a timer. The cast is physically incapable
of falling out of sync at any tempo, through any tempo change, at any frame rate —
the animation is a pure function of musical position. `bounce()` in
[`render/critters.js`](src/render/critters.js) packages the anticipation → impact →
recovery curve that makes a character look like it *lands* on the beat rather than
starting to move on it.

### Calibration

Between "the sound card was told to play a click" and "your finger moves" is a
chain nobody can measure directly. `AudioContext.outputLatency` covers a fraction
of it. The rest has to be measured with the only instrument available: you.

[`game/calibrate.js`](src/game/calibrate.js) plays a click, you tap along, and it
takes the **median** offset (one sneeze would drag a mean by tens of milliseconds)
of taps folded to the **nearest** click (fold to the *previous* click and a
slightly-early player calibrates almost a full beat off).

Audio offset and visual offset are separate settings on purpose. Conflating them is
why calibration in a lot of games fixes your score but makes the animation look
wrong.

---

## Verification

```bash
node tools/check.mjs    # design rules
node tools/smoke.mjs    # full headless playthroughs
node tools/build.mjs    # single-file bundle
```

**`check.mjs`** asserts the rules that keep a chart *playable* — things that are
invisible in code review and obvious the moment you play. Closest same-hand pair
≥85ms. Closest pair overall ≥38ms, except an exact simultaneity, which is a
deliberate chord. No note before the count-in or after the song ends. Every voice
reference resolves. Density inside the band for its stated difficulty. At least one
real rest, because peaks only read as peaks if there are troughs.

It caught three genuine bugs in the hard chart's generated sections, where
`count × step` overflowed the bar and collided with the next bar's opening note.

**`smoke.mjs`** boots the real `Play` scene against stub Canvas/WebAudio and plays
every level end to end at 60fps with a simulated player, three ways: near-perfect,
sloppy-with-misses, and no input at all. That exercises every renderer branch,
every judgment path, hold press/release, and the full particle lifecycle — roughly
17,000 frames per level. It also traps non-finite values written to canvas or audio
params, and `exponentialRampToValueAtTime(0)`, which throws in real browsers.

**Not verified:** nobody has looked at this in an actual browser yet. The headless
tests prove it doesn't throw and that the timing maths is right; they cannot tell
you whether it *looks* good or whether the feel lands. That's the first thing to do.

---

## Layout

```
src/
  core/
    conductor.js    the three clocks, tempo map, beat↔time
    input.js        low-latency capture
    judge.js        windows, scoring, combo, accuracy stats
  audio/
    synth.js        every sound in the game, from oscillators
    sequencer.js    lookahead scheduler + notation helpers
  render/
    view.js         virtual resolution, camera, shake, punch
    shapes.js       the drawing vocabulary
    critters.js     the cast — beat-phase driven
    scenes.js       three landscapes
    juice.js        particles, hitstop, popups, flash
    hud.js          ring, lane, cues, meters
    palette.js      per-world colour
  game/
    play.js         the gameplay scene
    calibrate.js    latency measurement
    levels/         songs + charts
  main.js           entry, screens, the single rAF loop
tools/
  check.mjs         design-rule checker
  smoke.mjs         headless playthroughs
  build.mjs         single-file bundler
```

---

## Ideas worth stealing next

- **Character-only cues.** Rhythm Heaven's real trick is that the *animation* is
  the cue and there is no lane at all. The lane here is a readability crutch; an
  option to hide it would be a genuine test of whether the animation reads.
- **Per-level minigames** rather than one shared cue presentation.
- **Practice mode** — loop a section at reduced tempo, using the tempo map that
  already exists.
- **Replays.** Judgment is deterministic given a list of `(action, songTime)`
  pairs, so replays are a few hundred bytes.
- **Sight-read scoring** — separate scores for first attempt vs. practised.

## License

MIT.
