/**
 * Judge — decides what a press was worth, and keeps score.
 *
 * ── Window design ────────────────────────────────────────────────────────────
 *
 *        miss │  good  │ great│PERFECT│great │  good  │ miss
 *   ──────────┼────────┼──────┼───┬───┼──────┼────────┼──────────►
 *           -110     -62    -32   0   +32   +62     +110   ms
 *
 * The numbers are chosen, not guessed:
 *
 *   ±32ms perfect — roughly two frames at 60Hz. Tight enough that hitting it
 *     feels like an achievement, loose enough that it isn't luck given the
 *     ~4–10ms of unavoidable OS+audio jitter. Below ~25ms you're grading the
 *     player's hardware instead of their timing.
 *
 *   ±62ms great — near the limit of where a listener can still tell a note is
 *     misaligned from the beat. Inside this, it *sounds* right.
 *
 *   ±110ms good — clearly late/early but recognisably the same note. Past this
 *     it reads as a different beat entirely, so it can't be credited.
 *
 * Windows are constant in TIME, not in beats. A player's motor precision does
 * not improve because the song is slower; making windows scale with tempo
 * (a common mistake) makes slow songs feel mushy and fast songs feel impossible.
 */

export const Grade = {
  PERFECT: 'perfect',
  GREAT: 'great',
  GOOD: 'good',
  MISS: 'miss',
};

export const WINDOWS = {
  [Grade.PERFECT]: 0.032,
  [Grade.GREAT]: 0.062,
  [Grade.GOOD]: 0.110,
};

/** Beyond this, a press isn't associated with the note at all. */
export const MISS_AFTER = 0.130;

const GRADE_SCORE = {
  [Grade.PERFECT]: 1000,
  [Grade.GREAT]: 600,
  [Grade.GOOD]: 250,
  [Grade.MISS]: 0,
};

/** Accuracy weight per grade (for the percentage on the results screen). */
const GRADE_ACC = {
  [Grade.PERFECT]: 1,
  [Grade.GREAT]: 0.65,
  [Grade.GOOD]: 0.28,
  [Grade.MISS]: 0,
};

export function gradeFor(deltaSec) {
  const d = Math.abs(deltaSec);
  if (d <= WINDOWS[Grade.PERFECT]) return Grade.PERFECT;
  if (d <= WINDOWS[Grade.GREAT]) return Grade.GREAT;
  if (d <= WINDOWS[Grade.GOOD]) return Grade.GOOD;
  return Grade.MISS;
}

/** Combo multiplier: grows, then caps. Uncapped multipliers make the back half
 *  of a song worth more than the front, which punishes early mistakes twice. */
function comboMult(combo) {
  if (combo >= 100) return 2.0;
  if (combo >= 50) return 1.6;
  if (combo >= 25) return 1.35;
  if (combo >= 10) return 1.15;
  return 1;
}

export const COMBO_MILESTONES = [10, 25, 50, 100, 200, 400];

/**
 * @typedef {Object} Note
 * @property {number} beat
 * @property {number} time      seconds from beat 0 (filled in by the chart loader)
 * @property {'A'|'B'} action
 * @property {'tap'|'hold'} type
 * @property {number} [holdBeats]
 * @property {number} [holdEnd]  seconds
 * @property {string} [cue]      art hint for the renderer
 * --- runtime state ---
 * @property {boolean} judged
 * @property {string} [grade]
 * @property {number} [delta]
 * @property {boolean} [holding]
 */

export class Judge {
  /** @param {Note[]} notes sorted by time */
  constructor(notes) {
    this.notes = notes;
    this.reset();

    /** @type {(note:Note, grade:string, delta:number)=>void} */
    this.onJudge = null;
    /** Stray press that matched no note. */
    this.onStray = null;
    /** Combo crossed a milestone. */
    this.onMilestone = null;
  }

  reset() {
    for (const n of this.notes) {
      n.judged = false;
      n.grade = undefined;
      n.delta = undefined;
      n.holding = false;
      n.holdBroken = false;
    }
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.deltas = [];       // signed, for the early/late readout
    this.strays = 0;
    this._searchFrom = 0;   // notes before this index are all resolved
    this._nextMilestone = 0;
  }

  get total() { return this.notes.length; }
  get judgedCount() { return this.counts.perfect + this.counts.great + this.counts.good + this.counts.miss; }

  /** 0..1 */
  get accuracy() {
    const n = this.judgedCount;
    if (!n) return 1;
    let sum = 0;
    for (const k of Object.keys(this.counts)) sum += this.counts[k] * GRADE_ACC[k];
    return sum / n;
  }

  /** Mean signed error in ms. Positive = the player is consistently LATE.
   *  Surfaced on the results screen so players can self-calibrate. */
  get meanErrorMs() {
    if (!this.deltas.length) return 0;
    return (this.deltas.reduce((a, b) => a + b, 0) / this.deltas.length) * 1000;
  }

  /** Standard deviation of error in ms — the real measure of consistency. */
  get jitterMs() {
    if (this.deltas.length < 2) return 0;
    const m = this.deltas.reduce((a, b) => a + b, 0) / this.deltas.length;
    const v = this.deltas.reduce((a, b) => a + (b - m) ** 2, 0) / (this.deltas.length - 1);
    return Math.sqrt(v) * 1000;
  }

  /**
   * Handle a press.
   *
   * Matching rule: take the NEAREST unjudged note of the matching action within
   * MISS_AFTER. Nearest — not earliest. On a dense stream, "earliest unjudged"
   * causes a cascade: one early press consumes the wrong note and every
   * subsequent press is shifted, turning a single mistake into a wall of misses.
   *
   * @param {'A'|'B'} action
   * @param {number} songTime  from Conductor.songTimeAt(event.timeStamp)
   * @returns {{note:Note, grade:string, delta:number}|null}
   */
  press(action, songTime) {
    let best = null;
    let bestDist = Infinity;

    for (let i = this._searchFrom; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time - songTime > MISS_AFTER) break;   // sorted: nothing further can match
      if (n.judged || n.action !== action) continue;
      const d = Math.abs(n.time - songTime);
      if (d <= MISS_AFTER && d < bestDist) { bestDist = d; best = n; }
    }

    if (!best) {
      this.strays++;
      this.combo = 0;
      this._nextMilestone = 0;
      this.onStray?.(action, songTime);
      return null;
    }

    const delta = songTime - best.time;   // positive = late
    const grade = gradeFor(delta);
    return this._resolve(best, grade, delta);
  }

  /** Release, for hold notes. */
  release(action, songTime) {
    for (let i = this._searchFrom; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.type !== 'hold' || !n.holding || n.action !== action) continue;
      n.holding = false;
      // Released early enough to matter? Downgrade, don't fully fail — losing a
      // whole note for a 40ms early release feels arbitrary.
      const early = n.holdEnd - songTime;
      if (early > WINDOWS[Grade.GOOD]) {
        n.holdBroken = true;
        this.combo = 0;
        this._nextMilestone = 0;
        this.onJudge?.(n, 'holdbreak', early);
      } else {
        this.onJudge?.(n, 'holdend', -early);
      }
      return;
    }
  }

  /**
   * Advance time: retire notes whose window has fully closed.
   * Called once per frame with the *authoritative* (unsmoothed) song time —
   * misses must not be affected by visual smoothing.
   */
  update(songTime) {
    for (let i = this._searchFrom; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time + MISS_AFTER > songTime) break;
      if (!n.judged) this._resolve(n, Grade.MISS, MISS_AFTER);
    }
    // Slide the search window forward past fully-resolved notes.
    while (
      this._searchFrom < this.notes.length &&
      this.notes[this._searchFrom].judged &&
      this.notes[this._searchFrom].time + MISS_AFTER < songTime
    ) {
      this._searchFrom++;
    }

    // A held note that the player never released still counts as held.
    for (let i = this._searchFrom; i < this.notes.length; i++) {
      const n = this.notes[i];
      if (n.time > songTime) break;
      if (n.type === 'hold' && n.holding && songTime > n.holdEnd + WINDOWS[Grade.GOOD]) {
        n.holding = false;
        this.onJudge?.(n, 'holdend', 0);
      }
    }
  }

  _resolve(note, grade, delta) {
    note.judged = true;
    note.grade = grade;
    note.delta = delta;
    this.counts[grade]++;

    if (grade === Grade.MISS) {
      this.combo = 0;
      this._nextMilestone = 0;
    } else {
      this.deltas.push(delta);
      this.score += Math.round(GRADE_SCORE[grade] * comboMult(this.combo));
      this.combo++;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
      if (note.type === 'hold') note.holding = true;

      while (
        this._nextMilestone < COMBO_MILESTONES.length &&
        this.combo >= COMBO_MILESTONES[this._nextMilestone]
      ) {
        this.onMilestone?.(COMBO_MILESTONES[this._nextMilestone], this._nextMilestone);
        this._nextMilestone++;
      }
    }

    this.onJudge?.(note, grade, delta);
    return { note, grade, delta };
  }

  /** Letter rank for the results screen. */
  rank() {
    const a = this.accuracy;
    const perfectRun = this.counts.miss === 0 && this.strays === 0;
    if (a >= 0.995 && perfectRun) return 'S+';
    if (a >= 0.96 && perfectRun) return 'S';
    if (a >= 0.92) return 'A';
    if (a >= 0.84) return 'B';
    if (a >= 0.72) return 'C';
    if (a >= 0.55) return 'D';
    return 'F';
  }

  /** Rhythm-Heaven-style verdict. */
  verdict() {
    const a = this.accuracy;
    if (a >= 0.96 && this.counts.miss === 0) return { text: 'SUPERB!', tone: 'gold' };
    if (a >= 0.80) return { text: 'OK!', tone: 'good' };
    return { text: 'TRY AGAIN', tone: 'bad' };
  }
}
