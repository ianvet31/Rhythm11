/**
 * HUD — deliberately almost empty.
 *
 * ── Why there is so little here ──────────────────────────────────────────────
 *
 * The first build of this game had a judgment ring, a scrolling lane with beat
 * ticks, a live score, an accuracy percentage, a progress bar, and a timing
 * histogram — all on screen, during play. Every one of those was a place the
 * player could look instead of listen, and the lane in particular made the
 * music decorative: you could mute the game and still hit most notes.
 *
 * In a game where the music IS the instruction set, that's not a small problem.
 * So the in-play HUD is now:
 *
 *   • a combo badge, once you're past 5, in a corner
 *   • the verb, for the first five seconds
 *   • a count-in before the first note
 *   • section banners
 *
 * That's it. No score, no progress, no per-note judgment spam. Every number
 * moved to the results screen, where reading it costs the player nothing.
 *
 * The timing meter still exists (it's genuinely useful for improving) but it is
 * off by default and lives in Options, because it is exactly the kind of thing
 * that pulls attention away from the character and toward a graph.
 */

import {
  circle, roundRect, poly, stroke_, star, boldText, layer,
  INK, ease, clamp, lerp,
} from './shapes.js';
import { VW, VH } from './view.js';
import { WINDOWS, MISS_AFTER, Grade } from '../core/judge.js';
import { GRADE_COLOR } from './palette.js';

/**
 * Combo badge. Small, cornered, and it only appears once a combo is worth
 * caring about — an always-present "1" would just be noise.
 */
export function drawComboBadge(c, P, { combo, pop }) {
  const s = ease.outBack(clamp(pop, 0, 1), 3);
  layer(c, () => {
    c.translate(VW - 84, 54);
    c.scale(1 + (1 - s) * 0.3, 1 + (1 - s) * 0.3);
    boldText(c, String(combo), 0, 0, 44, P.cue, INK, 'center');
    boldText(c, 'IN A ROW', 0, 28, 12, '#fffaf0', INK, 'center');
  });
}

/** The verb, stated plainly at the start and then never again. */
export function drawVerb(c, P, { text, age, dur }) {
  if (!text) return;
  const fade = clamp((dur - age) / 0.8, 0, 1) * clamp(age / 0.4, 0, 1);
  layer(c, () => {
    c.globalAlpha = fade * 0.9;
    roundRect(c, VW / 2 - 220, VH - 66, 440, 40, 20, 'rgba(20,14,30,0.66)', 0);
    boldText(c, text, VW / 2, VH - 46, 19, '#fffaf0', INK);
  });
}

/**
 * Count-in before the first note.
 *
 * This is the one place a visual countdown is unambiguously correct: there is
 * no music to listen to yet, so there is nothing for it to displace.
 */
export function drawCountIn(c, P, { beatsLeft }) {
  if (beatsLeft <= 0 || beatsLeft > 4.999) return;
  const n = Math.ceil(beatsLeft);
  const frac = n - beatsLeft;
  const s = ease.outBack(clamp(frac * 2.4, 0, 1), 2.2);
  layer(c, () => {
    c.globalAlpha = clamp(1.6 - frac * 1.6, 0, 1);
    c.translate(VW / 2, VH / 2 - 60);
    c.scale(s, s);
    boldText(c, String(n), 0, 0, 124, P.cue, INK);
  });
}

/**
 * Section banner. Announces what's changing, never when to press.
 * Slides through rather than sitting still, so it can't be mistaken for a
 * persistent UI element.
 */
export function drawBanner(c, P, { text, age, dur = 1.7 }) {
  if (!text || age > dur) return;
  const t = age / dur;
  const inT = clamp(t / 0.14, 0, 1);
  const outT = clamp((t - 0.82) / 0.18, 0, 1);
  layer(c, () => {
    c.globalAlpha = 1 - outT;
    const x = lerp(-VW, 0, ease.outQuint(inT)) + lerp(0, VW, ease.inQuad(outT));
    c.translate(x, 0);
    c.fillStyle = 'rgba(20,14,30,0.74)';
    c.fillRect(0, 168, VW, 68);
    stroke_(c, [[0, 168], [VW, 168]], 3, P.cue);
    stroke_(c, [[0, 236], [VW, 236]], 3, P.cue);
    boldText(c, text, VW / 2, 202, 34, P.cue, INK);
  });
}

export function drawPauseCard(c, P) {
  c.fillStyle = 'rgba(10,7,18,0.74)';
  c.fillRect(0, 0, VW, VH);
  boldText(c, 'PAUSED', VW / 2, VH / 2 - 20, 56, P.cue, INK);
  boldText(c, 'ESC to resume  ·  BACKSPACE to quit', VW / 2, VH / 2 + 40, 18, '#fffaf0', INK);
}

/**
 * Timing meter — a live histogram of the player's error, off by default.
 *
 * A cloud left of centre means "you're rushing", right means "you're dragging".
 * Over a song the shape tells a player more about their playing than a score
 * does, and it's how they discover their calibration is off. It is also,
 * unavoidably, a thing to stare at instead of listening — hence opt-in.
 */
export function drawTimingMeter(c, P, { ticks, meanMs }) {
  const cx = VW / 2, y = VH - 22, halfW = 118;
  const msToPx = halfW / (MISS_AFTER * 1000);

  layer(c, () => {
    c.globalAlpha = 0.8;
    const bands = [
      [WINDOWS[Grade.GOOD], 'rgba(122,184,255,0.18)'],
      [WINDOWS[Grade.GREAT], 'rgba(78,201,165,0.24)'],
      [WINDOWS[Grade.PERFECT], 'rgba(255,210,63,0.38)'],
    ];
    for (const [wsec, col] of bands) {
      const wpx = wsec * 1000 * msToPx;
      roundRect(c, cx - wpx, y - 6, wpx * 2, 12, 6, col, 0);
    }
    stroke_(c, [[cx, y - 11], [cx, y + 11]], 2.5, 'rgba(255,255,255,0.8)');

    for (const t of ticks) {
      const px = cx + clamp(t.ms, -MISS_AFTER * 1000, MISS_AFTER * 1000) * msToPx;
      c.globalAlpha = t.a * 0.9;
      stroke_(c, [[px, y - 8], [px, y + 8]], 2.5, GRADE_COLOR[t.grade] || '#fff');
    }

    if (Number.isFinite(meanMs) && Math.abs(meanMs) > 0.5) {
      c.globalAlpha = 0.85;
      const mx = cx + clamp(meanMs, -MISS_AFTER * 1000, MISS_AFTER * 1000) * msToPx;
      poly(c, [[mx, y - 14], [mx - 5, y - 21], [mx + 5, y - 21]], '#fffaf0', 0);
    }
  });
}
