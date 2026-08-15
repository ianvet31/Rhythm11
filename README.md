# Rhythm 11

A browser rhythm game in the spirit of *Rhythm Heaven*. Four minigames, four
different rhythmic ideas, and **no note highway**.

No build step, no assets, no dependencies. The music is generated from
oscillators and the characters are drawn from geometry, so the whole game is
~215 kB of source and loads instantly.

---

## Play

Double-click **`dist/rhythm11.html`** — it's self-contained and runs straight off
the disk.

Or run the source (better for iterating):

```bash
npx serve .
```

**Controls**

| | keys |
|---|---|
| **A** | <kbd>Space</kbd> <kbd>J</kbd> <kbd>F</kbd> <kbd>←</kbd> |
| **B** | <kbd>K</kbd> <kbd>D</kbd> <kbd>→</kbd> |
| pause | <kbd>Esc</kbd> |

Do the calibration first. Fifteen seconds, and it's the difference between the
game feeling tight and feeling broken.

---

## The design rule

Most rhythm games show you a scrolling highway of notes. You can mute them and
still play. The music is decoration.

Rhythm Heaven inverts that: the cues are **audio**, the visuals are often
[deliberately unhelpful or out of sync](https://medium.com/quick-game-design-notes/rhythm-heaven-quick-design-notes-5abb6ce52e97),
and [each song is literally the instruction set](https://moegamer.net/2018/07/05/nintendo-ds-essentials-rhythm-paradise/) —
missing a cue is failing to *hear*, not failing to press. This game follows that,
and states the rule explicitly:

> **Visuals may tell you WHAT. Only audio tells you WHEN.**

Which produces two hard constraints on everything in `src/game/stages/`:

- **Every rhythm is played to you before you play it.** Every note in every chart
  declares `answers` — the beat of the call it responds to. A design check
  verifies that call actually sounds, at least 250ms and at most 8s earlier.
  Nothing at runtime reads `answers`, so a chart can't be fudged into passing.
- **No animation may reliably predict a note you still owe.** Characters react to
  you, they don't lead you. Showing the *pulse* is fine — a swinging baton, a
  bobbing head. Showing which beats carry notes is not.

Each stage file opens with a "cue audit" listing which of its animations are cues
and which are decoration, so the distinction survives future edits.

---

## The minigames

### 1. Puddle Hop — 96 BPM, easy
**Tap to take a step.** A crow on a signpost caws a figure. You step it back.

The idea is **triplets** — dividing a beat in three instead of two. You can't fake
them: subdivide in two and the middle note lands 100ms out, an obvious miss with
an audible cause.

And there's a physical joke that makes it teachable. A triplet is three quick
steps, which is exactly what you do to skip a puddle. Every puddle sits where a
triplet burst lands, so the hardest rhythmic moment and the biggest visual payoff
are the same moment. Miss it and you get soaked — funnier and more informative
than a number going down.

### 2. Mango Stomp — 108 BPM, easy–medium
**Tap to stomp.** An elephant walks right through a fruit grove. The fruit hangs
in the canopy at horizontal positions that *are* the rhythm — the grove scrolls
at a constant 165 px/s, so distance is literally proportional to time.

```
quarter notes    ●        ●        ●        ●
eighths          ●    ●   ●    ●   ●    ●   ●
a "bunch"        ●        ●●       ●        ●●
```

Vertical position is randomised and means nothing. That's the point: scattered
heights look like fruit in a tree instead of a row of buttons, while the only
axis carrying information stays perfectly clean.

**This level deliberately breaks the house rule above** — the fruit is a
reliable visual timing cue. That's a considered exception, not a lapse:

- Rocket Courier's visuals are *dishonest*, and punish watching. These are
  perfectly honest. Both are legitimate; what isn't is honest-*ish*, where
  watching mostly works and occasionally betrays you.
- The rhythm is **also** in the music — one bar before every cluster, a marimba
  plays that cluster's exact figure. The level is fully playable with the screen
  off. The fruit is a redundant second channel, not a replacement for listening.
- Redundant cueing is what makes a level approachable. This is the one a person
  can pick up cold; the other three are not.

The rule survives because it was never "no visual cues" — it was "no visual cue
the player can't trust".

### 3. Choir Sprout — 120 BPM, medium
**Tap to sing the next note.** The choirmaster sings a phrase; your sprout sings
it back. *Which* note is decided by the phrase, so your whole job is *when*.

The idea is **syncopation, then rests**. Rests are the genuinely hard part and
come last: a rest is the one thing you can't execute by feel — you have to
actively not act while the pulse continues.

The backing track contains no melody during response bars. The tune only exists
if you produce it. Miss a note and there's a literal hole in the music.

### 4. Rocket Courier — 150 BPM (+ modulation), hard
**Tap A for yellow, B for pink.** Parcels out of the dark.

This is the sharpest expression of the rule. Each parcel's flight time
(1.6–3.2 beats), arc height and spin are randomised per-parcel from a seed — yet
every one still *arrives* exactly on its beat. The physics are honest; the
readability is not. Watch them and you'll be inconsistent all night. Listen and
you're perfect.

The whistle is the only honest thing in the level: one beat early, always the
same rising sweep. A burst gets a **trill** instead — the rhythm played back at
you in miniature, one beat before you perform it.

Two more ideas: **overlapping telegraphs** in §3 (the next group's trill starts
while the current one is still arriving), and a **metric modulation** at beat 112
from 150 to 100 BPM — exactly ⅔, so a dotted quarter at the old tempo equals a
quarter at the new one. Whistle lead is defined in *beats*, so it stretches
through the change for free.

---

## Why it feels the way it feels

### Three clocks, one timeline

| clock | granularity | what it's for |
|---|---|---|
| `AudioContext.currentTime` | ~2.7ms | the only clock the sound card obeys |
| `performance.now()` | sub-ms | the epoch input events are stamped in |
| `requestAnimationFrame` | ~16.7ms | when pixels actually appear |

[`core/conductor.js`](src/core/conductor.js) keeps a filtered affine map between
the first two and expresses everything as **song time — seconds since the player
*heard* beat 0**. "Heard", not "scheduled": those differ by output latency,
5ms on a wired desktop to 300ms on Bluetooth.

### Input never touches the frame loop

[`core/input.js`](src/core/input.js) uses `event.timeStamp` — when the key
physically went down — never `performance.now()` read inside the handler.

The smoke test measures the cost of getting it wrong. Same simulated player, only
the timestamp source differs, on the fastest level:

```
event.timeStamp   → 100.00%  rank S+  mean  0.0ms  spread ± 0.0ms  perfect 154/154
frame-quantized   →  99.32%  rank S   mean +10.2ms spread ±12.4ms  perfect 151/154
```

Note this comparison has to run on the *hard* level. On a slow chart the 10ms of
systematic lateness stays inside the ±32ms perfect window and the bug hides.

The hit sound is scheduled from *inside* the event handler. Audio delayed one
frame is felt as input lag even when the judgment was correct — players feel the
sound, not the score.

### Judgment windows

```
      miss │  good  │ great│PERFECT│great │  good  │ miss
 ──────────┼────────┼──────┼───┬───┼──────┼────────┼──────────►
         -110     -62    -32   0   +32   +62     +110   ms
```

Constant in **time**, not beats — your motor precision doesn't improve because the
song is slower. Presses match the **nearest** unjudged note; with "earliest", one
early press consumes the wrong note and every subsequent press shifts.

### The HUD is nearly empty

No score, no progress bar, no PERFECT/GREAT confetti during play. Every pixel of
UI is a pixel a player might read timing from instead of listening. What's left:
a combo badge past 5, the verb for five seconds, a count-in, and section banners.
All the numbers arrive at the results screen, where reading them costs nothing.

The timing meter still exists — it's the best tool for improving — but it's
opt-in, because it's also the most tempting thing to stare at.

### Juice

A perfect hit fires, within ~30ms: the note's musical sound, a chime, a ring
flash, a shockwave, a character squash, 18 particles, **~35ms of hitstop**, and a
camera punch. None of it changes the score.

Hitstop freezes the *animation* clock only. Audio and judgment keep running at
full speed.

### Characters can't drift

Every character takes a **beat phase**, not a timer. The cast is physically
incapable of falling out of sync at any tempo, through any tempo change, at any
frame rate.

### Smoothness is four specific things

Not more frames. `render/beasts.js` is built around them:

1. **Continuity of value *and* slope.** Animation that jumps looks bad;
   animation whose *speed* jumps looks cheap. The elephant's trunk, head tilt
   and body lean run through damped springs, which are continuous in position
   and velocity by construction — and can be re-targeted mid-flight without a
   discontinuity. That matters because sixteenth pairs re-target the trunk
   140ms apart, and a tween would visibly restart.
2. **Overlapping action.** The trunk lags the head, the head lags the body, the
   ears lag everything, the tail lags most of all. Each part reads the beat with
   its own offset, so the silhouette is always moving even on a still beat.
   Everything moving in lockstep reads as a puppet no matter how good the
   drawing is.
3. **Anticipation and follow-through.** The stomp rises before it falls, and the
   body keeps compressing after contact. The impact frame is one or two frames
   of extreme squash — too brief to consciously see, long enough to feel.
4. **Volume preservation.** Squash by *k*, stretch by *1/k*. Otherwise "squash"
   just reads as "the sprite got smaller".

Plus one gameplay-driven cheat: a fruit hanging high and one hanging low take
exactly the same 0.22s to fall, achieved by solving for the gravity each needs.
Physically that's wrong, but hang height is randomised purely to look natural —
if it changed the fall time, the reward for a perfect stomp would arrive at a
different moment every time. Consistency of feedback beats consistency of
physics.

---

## Verification

```bash
npm test    # check + smoke + build + bundle-boot
```

**`tools/check.mjs`** — design rules. The telegraph rule above; closest same-hand
pair ≥85ms; closest pair overall ≥38ms except an exact simultaneity, which is a
deliberate chord; peak density inside the band for its stated difficulty.

Difficulty is graded on **peak** density over a 2s window, not average. Average
notes/sec is meaningless here: roughly half of every song is the game playing at
you, during which the player correctly does nothing.

It has caught real bugs both times it was extended — three overflowing stream
cells in the first build, and two under-dense charts in this one.

**`tools/smoke.mjs`** — boots the real `Play` scene against stub Canvas/WebAudio
and plays every level end to end at 60fps, three ways: near-perfect, sloppy, and
no input at all. ~7,500 frames per level. Traps non-finite values written to
canvas or audio params, and `exponentialRampToValueAtTime(0)`, which throws in
real browsers.

**`tools/bundle-boot.mjs`** — actually executes the bundled HTML. `build.mjs`
rewrites module syntax with regexes, which fails silently: the output is still
valid JavaScript with the wrong bindings. `node --check` proves nothing.

**Not verified:** nobody has looked at this in a browser. There's no Chrome on
this machine and the extension never connected. The tests prove it doesn't throw
and the timing maths is exact; they cannot tell you whether the art reads or the
feel lands.

---

## Layout

```
src/
  core/       conductor (the three clocks) · input · judge
  audio/      synth (every sound, from oscillators) · sequencer (lookahead)
  render/     view · shapes · folks (the cast) · juice · hud · palette
  game/
    play.js     engine: time, input, judgment, feedback
    stage.js    base class + the cue rules every minigame plays by
    stages/     one presentation per minigame — scenery, characters, reactions
    levels/     one music + chart + cue list per minigame
    calibrate.js
  main.js     entry, screens, the single rAF loop
tools/        check · smoke · build · bundle-boot
```

The engine/stage split is what lets three minigames with nothing visual in common
share one timing core. `play.js` no longer knows what a note *looks* like.

---

## Ideas worth stealing next

- **Practice mode** — loop a section at reduced tempo, using the tempo map that
  already exists.
- **A fourth minigame** — the stage system makes this cheap now. Something with a
  hold, which no current minigame uses.
- **Replays** — judgment is deterministic given `(action, songTime)` pairs, so
  replays are a few hundred bytes.
- **Sight-read scoring** — separate first-attempt and practised scores. In a game
  built on listening, the first attempt is the real test.

## License

MIT.

---

Sources on Rhythm Heaven's design:
[Quick design notes](https://medium.com/quick-game-design-notes/rhythm-heaven-quick-design-notes-5abb6ce52e97) ·
[Nintendo DS Essentials: Rhythm Paradise](https://moegamer.net/2018/07/05/nintendo-ds-essentials-rhythm-paradise/) ·
[Auditory experience notes](https://pikaonablog.wordpress.com/2012/10/21/game-design-and-production-ii-experiences-part-2-auditory-rhythm-heaven/)
