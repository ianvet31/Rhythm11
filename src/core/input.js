/**
 * Input — capture presses with the least latency and the most accurate
 * timestamp the browser will give us.
 *
 * ── The rules this file exists to enforce ────────────────────────────────────
 *
 * 1. NEVER read input in the render loop. `if (keyIsDown) hit()` inside rAF
 *    quantises every press to the frame boundary, adding 0–16.7ms of uniformly
 *    distributed error. On a ±30ms perfect window that is over half your
 *    precision, thrown away for nothing.
 *
 * 2. ALWAYS use `event.timeStamp`, never `performance.now()` read inside the
 *    handler. timeStamp is when the event *occurred*; performance.now() in the
 *    handler is when JavaScript got around to it. Under load those differ by
 *    tens of milliseconds — exactly the amount that makes a game feel unfair.
 *
 * 3. Handle the press synchronously in the handler. The hit sound must be
 *    scheduled from inside the event callback, not queued for the next frame.
 *    Audio feedback delayed by a frame is perceptible as input lag even though
 *    the *judgment* was correct. Players feel the sound, not the score.
 *
 * 4. Ignore auto-repeat. Holding a key fires keydown forever at the OS repeat
 *    rate, which would register as a burst of hits.
 */

/** Logical actions. Deliberately few — the difficulty lives in the rhythm. */
export const Action = { A: 'A', B: 'B' };

const KEY_MAP = {
  Space: Action.A, KeyJ: Action.A, KeyF: Action.A, ArrowLeft: Action.A, KeyZ: Action.A,
  KeyK: Action.B, KeyD: Action.B, ArrowRight: Action.B, KeyX: Action.B,
};

export class InputRouter {
  constructor() {
    /** @type {(action:string, perfMs:number)=>void} */
    this.onPress = null;
    /** @type {(action:string, perfMs:number)=>void} */
    this.onRelease = null;
    /** Non-gameplay keys (Escape, Enter, etc). */
    this.onKey = null;

    this.held = new Set();
    this._down = new Set();   // physical codes currently down, for repeat filtering
    this.enabled = true;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  attach(target = window) {
    this.target = target;
    // Not passive: we must preventDefault on Space so the page doesn't scroll,
    // and on repeat keys. The listener does almost no work, so the
    // non-passive cost is irrelevant here.
    target.addEventListener('keydown', this._onKeyDown, { passive: false });
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('pointerdown', this._onPointerDown, { passive: false });
    target.addEventListener('pointerup', this._onPointerUp);
    // If focus is lost mid-hold we'd never see the keyup and the note would
    // hang forever. Clear everything.
    window.addEventListener('blur', this._onBlur);
  }

  detach() {
    const t = this.target;
    if (!t) return;
    t.removeEventListener('keydown', this._onKeyDown);
    t.removeEventListener('keyup', this._onKeyUp);
    t.removeEventListener('pointerdown', this._onPointerDown);
    t.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('blur', this._onBlur);
  }

  isHeld(action) { return this.held.has(action); }

  _onKeyDown(e) {
    const action = KEY_MAP[e.code];

    if (action) e.preventDefault();

    // Auto-repeat: the OS is hammering us, not the player.
    if (e.repeat || this._down.has(e.code)) return;
    this._down.add(e.code);

    if (!action) {
      this.onKey?.(e.code, e);
      return;
    }
    if (!this.enabled) return;

    this.held.add(action);
    // timeStamp, not performance.now(). See rule 2 above.
    this.onPress?.(action, e.timeStamp);
  }

  _onKeyUp(e) {
    this._down.delete(e.code);
    const action = KEY_MAP[e.code];
    if (!action) return;
    // Only release the logical action when NO physical key for it is still down
    // (Space and J both map to A; releasing one shouldn't drop a hold).
    const stillDown = Object.keys(KEY_MAP)
      .some((code) => KEY_MAP[code] === action && this._down.has(code));
    if (stillDown) return;
    this.held.delete(action);
    if (!this.enabled) return;
    this.onRelease?.(action, e.timeStamp);
  }

  _onPointerDown(e) {
    if (!this.enabled) return;
    if (e.target && e.target.closest && e.target.closest('#ui > *')) return; // let UI take it
    e.preventDefault();
    const action = e.clientX < window.innerWidth / 2 ? Action.A : Action.B;
    this._pointerAction = action;
    this.held.add(action);
    this.onPress?.(action, e.timeStamp);
  }

  _onPointerUp(e) {
    const action = this._pointerAction;
    if (!action) return;
    this._pointerAction = null;
    this.held.delete(action);
    if (!this.enabled) return;
    this.onRelease?.(action, e.timeStamp);
  }

  _onBlur() {
    for (const a of [...this.held]) this.onRelease?.(a, performance.now());
    this.held.clear();
    this._down.clear();
    this._pointerAction = null;
  }
}
