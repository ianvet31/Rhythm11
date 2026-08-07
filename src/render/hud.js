/**
 * HUD — score, combo, the judgment ring, and the timing meter.
 *
 * ── Readability rules ────────────────────────────────────────────────────────
 *
 * The HUD is competing with the art for the player's attention, and during a
 * hard section the player has none to spare. So:
 *
 *   • Nothing in the HUD animates on the beat except the judgment ring, which
 *     is *supposed* to be a metronome.
 *   • The score number never changes size for its own sake — it only pops when
 *     it actually increases, so motion always means something happened.
 *   • The timing meter is the only place negative feedback appears as data
 *     rather than as spectacle. Players who want to improve read it; players who
 *     want to vibe never look at it and lose nothing.
 */

import {
  circle, ellipse, roundRect, poly, stroke_, star, boldText, layer, INK, ease, clamp, lerp,
} from './shapes.js';
import { VW, VH } from './view.js';
import { WINDOWS, MISS_AFTER, Grade } from '../core/judge.js';
import { GRADE_COLOR } from './palette.js';

const TAU = Math.PI * 2;

/** Where the player's timing is evaluated. Fixed forever — muscle memory. */
export const RING = { x: 178, y: 372, r: 44 };

/**
 * The judgment ring.
 *
 * It pulses once per beat — an always-available visual metronome, so a player
 * who loses the beat during a rest can find it again without waiting for the
 * next cue. The pulse peaks exactly ON the beat and decays after, matching how
 * a drummer's stick looks: the interesting moment is the impact, not the travel.
 */
export function drawRing(c, P, { phase, pressed = 0, glow = 0, lastGrade = null, gradeAge = 1 }) {
  const pulse = Math.pow(1 - phase, 3.2);
  const r = RING.r * (1 + pulse * 0.09 + pressed * 0.12);

  layer(c, () => {
    // Outer halo
    circle(c, RING.x, RING.y, r + 20 + pulse * 6, `rgba(255,255,255,${0.05 + pulse * 0.07})`, 0);

    // Recent-judgment tint: the ring itself remembers the last hit briefly.
    if (lastGrade && gradeAge < 1) {
      const a = (1 - gradeAge) * 0.55;
      circle(c, RING.x, RING.y, r + 8, `${hexA(GRADE_COLOR[lastGrade] || '#fff', a)}`, 0);
    }

    // Body
    circle(c, RING.x, RING.y, r, 'rgba(20,14,30,0.42)', 0);
    c.lineWidth = 7;
    c.strokeStyle = P.cue;
    c.globalAlpha = 0.55 + pulse * 0.45 + glow * 0.3;
    c.beginPath(); c.arc(RING.x, RING.y, r, 0, TAU); c.stroke();
    c.globalAlpha = 1;

    // Inner ring, counter-pulsing — gives the shape depth without art assets.
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.beginPath(); c.arc(RING.x, RING.y, r - 11 - pulse * 4, 0, TAU); c.stroke();

    // Four tick marks at the compass points, so the ring reads as a target.
    for (let i = 0; i < 4; i++) {
      const a = i * (TAU / 4) - TAU / 8;
      const inner = r + 6, outer = r + 13 + pulse * 5;
      stroke_(c, [
        [RING.x + Math.cos(a) * inner, RING.y + Math.sin(a) * inner],
        [RING.x + Math.cos(a) * outer, RING.y + Math.sin(a) * outer],
      ], 4, P.cue);
    }

    if (pressed > 0) {
      circle(c, RING.x, RING.y, r * 0.55, `rgba(255,255,255,${0.30 * pressed})`, 0);
    }
  });
}

function hexA(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return `rgba(255,255,255,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * The travel lane. Cues slide right→left along it into the ring.
 *
 * Beat tick marks are drawn along the lane so the *spacing* of the music is
 * visible, not just the notes. This is what lets a player sight-read a
 * syncopated pattern: they can see the note sitting between two ticks.
 */
export function drawLane(c, P, { conductor, songTime, pxPerSec }) {
  layer(c, () => {
    c.globalAlpha = 0.22;
    stroke_(c, [[RING.x, RING.y], [VW + 40, RING.y]], 3, '#ffffff');
    c.globalAlpha = 1;

    // Ticks are placed by TIME, not by pixel-per-beat, so they stay locked to
    // the notes through a tempo change. During the modulation in level 3 you
    // can literally watch the tick spacing widen.
    const beat = conductor.timeToBeat(songTime);
    const first = Math.ceil(beat);
    for (let b = first; b < first + 64; b++) {
      const x = RING.x + (conductor.beatToTime(b) - songTime) * pxPerSec;
      if (x > VW + 20) break;
      const downbeat = ((b % 4) + 4) % 4 === 0;
      const fade = clamp((VW - x) / 220 + 0.25, 0, 1) * clamp((x - RING.x) / 60, 0, 1);
      layer(c, () => {
        c.globalAlpha = fade * (downbeat ? 0.5 : 0.22);
        stroke_(c, [[x, RING.y - (downbeat ? 15 : 8)], [x, RING.y + (downbeat ? 15 : 8)]],
          downbeat ? 4 : 2.5, '#ffffff');
      });
    }
  });
}

/**
 * A cue object travelling toward the ring.
 *
 * Motion is strictly LINEAR in time. This is non-negotiable: any easing on an
 * approaching note destroys the player's ability to extrapolate arrival time.
 * All the personality goes into spin, wobble, and trail — never into position.
 *
 * @param {number} tToHit seconds until it should be hit (negative = passed)
 */
export function drawCue(c, P, { x, y, tToHit, action, type, held = false, holdPx = 0, judged = false, grade = null, age = 0, spin = 0 }) {
  if (judged && grade !== 'miss') {
    // Consumed: shrink out fast so it doesn't linger over the ring.
    const t = clamp(age / 0.18, 0, 1);
    if (t >= 1) return;
    layer(c, () => {
      c.globalAlpha = 1 - t;
      c.translate(x, y);
      c.scale(1 + t * 0.8, 1 + t * 0.8);
      cueBody(c, P, action, type, 0);
    });
    return;
  }
  if (judged && grade === 'miss') {
    const t = clamp(age / 0.4, 0, 1);
    if (t >= 1) return;
    layer(c, () => {
      c.globalAlpha = (1 - t) * 0.6;
      c.translate(x, y + t * t * 140);
      c.rotate(t * 2);
      cueBody(c, P, action, type, 0);
    });
    return;
  }

  // Approach trail — length encodes speed, so fast sections *look* fast.
  const near = clamp(1 - tToHit / 0.9, 0, 1);
  layer(c, () => {
    c.globalAlpha = 0.20 + near * 0.2;
    const tl = 26 + near * 26;
    stroke_(c, [[x + tl, y], [x + 8, y]], 9 - near * 3, action === 'A' ? P.hot : P.accent);
  });

  if (type === 'hold' && holdPx > 0) {
    layer(c, () => {
      c.globalAlpha = held ? 0.95 : 0.6;
      roundRect(c, x, y - 13, holdPx, 26, 13,
        held ? P.cue : hexA(action === 'A' ? P.hot : P.accent, 0.55), 4);
    });
  }

  layer(c, () => {
    c.translate(x, y);
    // Wobble grows as it approaches: builds anticipation without moving the
    // object off its linear path.
    const w = Math.sin(near * 22) * 0.05 * near;
    c.rotate(spin + w);
    c.scale(1 + w, 1 - w);
    cueBody(c, P, action, type, near);
  });
}

function cueBody(c, P, action, type, near) {
  const col = action === 'A' ? P.hot : P.accent;
  if (action === 'A') {
    // Round "note ball" — the primary, most common cue.
    circle(c, 0, 0, 21, col, 5);
    circle(c, -6, -7, 7, 'rgba(255,255,255,0.65)', 0);
    circle(c, 0, 0, 9, 'rgba(255,255,255,0.25)', 0);
  } else {
    // Diamond — instantly distinguishable in peripheral vision, which is where
    // it will actually be read. Shape, not just colour: ~8% of players can't
    // rely on the hue difference.
    poly(c, [[0, -24], [24, 0], [0, 24], [-24, 0]], col, 5);
    poly(c, [[0, -11], [11, 0], [0, 11], [-11, 0]], 'rgba(255,255,255,0.35)', 0);
  }
  if (type === 'hold') {
    stroke_(c, [[-9, 0], [9, 0]], 4, INK);
    stroke_(c, [[0, -9], [0, 9]], 4, INK);
  }
  if (near > 0.75) {
    // Final-approach halo. Last-moment "now" signal.
    circle(c, 0, 0, 30 + (near - 0.75) * 40, hexA('#ffffff', (near - 0.75) * 0.5), 0);
  }
}

/* ── Panels ────────────────────────────────────────────────────────────────── */

export function drawScore(c, P, { score, displayScore, combo, comboPop, accuracy }) {
  layer(c, () => {
    boldText(c, String(Math.round(displayScore)).padStart(6, '0'), VW - 26, 42, 34, '#fffaf0', INK, 'right');
    c.font = 'bold 13px "Trebuchet MS", Verdana, sans-serif';
    c.textAlign = 'right';
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.fillText(`${(accuracy * 100).toFixed(1)}%`, VW - 28, 68);
  });

  if (combo >= 2) {
    layer(c, () => {
      const pop = ease.outBack(clamp(comboPop, 0, 1), 3);
      c.translate(96, 62);
      c.scale(1 + (1 - pop) * 0.35, 1 + (1 - pop) * 0.35);
      boldText(c, String(combo), 0, 0, 46, P.cue, INK, 'center');
      boldText(c, 'COMBO', 0, 30, 15, '#fffaf0', INK, 'center');
    });
  }
}

/** Song progress. Deliberately thin and edge-anchored — informative, ignorable. */
export function drawProgress(c, P, { t01, sections = [] }) {
  const x = 200, y = 24, w = VW - 460, h = 7;
  layer(c, () => {
    roundRect(c, x, y, w, h, h / 2, 'rgba(0,0,0,0.35)', 0);
    roundRect(c, x, y, Math.max(w * clamp(t01, 0, 1), h), h, h / 2, P.cue, 0);
    for (const s of sections) {
      circle(c, x + w * s, y + h / 2, 3.2, 'rgba(255,255,255,0.5)', 0);
    }
  });
}

/**
 * Timing meter — a live histogram of the player's error.
 *
 * Each hit drops a tick where it landed. A cloud that sits left of centre means
 * "you're rushing", right means "you're dragging". Over a song the shape of the
 * cloud tells the player more about their playing than any score does, and it's
 * how they discover they need to change their calibration offset.
 */
export function drawTimingMeter(c, P, { ticks, meanMs }) {
  const cx = VW / 2, y = VH - 26, halfW = 128;
  const msToPx = halfW / (MISS_AFTER * 1000);

  layer(c, () => {
    c.globalAlpha = 0.85;
    // Window bands, widest first
    const bands = [
      [WINDOWS[Grade.GOOD], 'rgba(122,184,255,0.20)'],
      [WINDOWS[Grade.GREAT], 'rgba(78,201,165,0.26)'],
      [WINDOWS[Grade.PERFECT], 'rgba(255,210,63,0.40)'],
    ];
    for (const [wsec, col] of bands) {
      const wpx = wsec * 1000 * msToPx;
      roundRect(c, cx - wpx, y - 7, wpx * 2, 14, 7, col, 0);
    }
    stroke_(c, [[cx, y - 12], [cx, y + 12]], 2.5, 'rgba(255,255,255,0.8)');
    c.font = '10px "Trebuchet MS", Verdana, sans-serif';
    c.textAlign = 'center';
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.fillText('EARLY', cx - halfW - 26, y);
    c.fillText('LATE', cx + halfW + 24, y);

    for (const t of ticks) {
      const px = cx + clamp(t.ms, -MISS_AFTER * 1000, MISS_AFTER * 1000) * msToPx;
      c.globalAlpha = t.a * 0.9;
      stroke_(c, [[px, y - 9], [px, y + 9]], 2.5, GRADE_COLOR[t.grade] || '#fff');
    }

    // Running mean — the actionable number.
    if (Number.isFinite(meanMs) && Math.abs(meanMs) > 0.5) {
      c.globalAlpha = 0.85;
      const mx = cx + clamp(meanMs, -MISS_AFTER * 1000, MISS_AFTER * 1000) * msToPx;
      poly(c, [[mx, y - 15], [mx - 5, y - 22], [mx + 5, y - 22]], '#fffaf0', 0);
    }
  });
}

/** Count-in numbers before the first note. */
export function drawCountIn(c, P, { beatsLeft }) {
  if (beatsLeft <= 0 || beatsLeft > 4.999) return;
  const n = Math.ceil(beatsLeft);
  const frac = n - beatsLeft;              // 0 at the start of this count, →1
  const s = ease.outBack(clamp(frac * 2.4, 0, 1), 2.2);
  layer(c, () => {
    c.globalAlpha = clamp(1.6 - frac * 1.6, 0, 1);
    c.translate(VW / 2, VH / 2 - 40);
    c.scale(s, s);
    boldText(c, String(n), 0, 0, 128, P.cue, INK);
  });
}

/** Section banner ("HERE IT COMES!"). */
export function drawBanner(c, P, { text, age, dur = 1.6 }) {
  if (!text || age > dur) return;
  const t = age / dur;
  const inT = clamp(t / 0.14, 0, 1);
  const outT = clamp((t - 0.82) / 0.18, 0, 1);
  layer(c, () => {
    c.globalAlpha = (1 - outT);
    const x = lerp(-VW, 0, ease.outQuint(inT)) + lerp(0, VW, ease.inQuad(outT));
    c.translate(x, 0);
    c.fillStyle = 'rgba(29,21,38,0.72)';
    c.fillRect(0, 178, VW, 76);
    stroke_(c, [[0, 178], [VW, 178]], 3, P.cue);
    stroke_(c, [[0, 254], [VW, 254]], 3, P.cue);
    boldText(c, text, VW / 2, 216, 42, P.cue, INK);
  });
}
