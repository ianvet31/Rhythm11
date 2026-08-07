/**
 * Shapes — the drawing vocabulary for the art style.
 *
 * The look: flat fills, thick dark ink outlines, rounded chunky forms, a
 * deliberately small palette. Think screen-printed poster rather than gradient
 * mesh. Every shape here draws fill-then-stroke with the same heavy line weight
 * so the whole game reads as one hand.
 *
 * Everything is analytic geometry — no images, no sprite sheets. That means a
 * character can squash, stretch, and change proportion per-frame, which is
 * exactly what beat-synced animation needs.
 */

export const INK = '#1d1526';
export const INK_SOFT = 'rgba(29,21,38,0.28)';

/** Push/pop helper so callers can't leak transform state. */
export function layer(c, fn) {
  c.save();
  try { fn(); } finally { c.restore(); }
}

export function inked(c, w = 5, color = INK) {
  c.lineWidth = w;
  c.strokeStyle = color;
}

/* ── Primitives ────────────────────────────────────────────────────────────── */

export function circle(c, x, y, r, fill, lw = 5, stroke = INK) {
  c.beginPath();
  c.arc(x, y, Math.max(r, 0.1), 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (lw > 0) { inked(c, lw, stroke); c.stroke(); }
}

export function ellipse(c, x, y, rx, ry, fill, lw = 5, rot = 0, stroke = INK) {
  c.beginPath();
  c.ellipse(x, y, Math.max(rx, 0.1), Math.max(ry, 0.1), rot, 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (lw > 0) { inked(c, lw, stroke); c.stroke(); }
}

export function roundRect(c, x, y, w, h, r, fill, lw = 5, stroke = INK) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (lw > 0) { inked(c, lw, stroke); c.stroke(); }
}

/** Closed polygon from a flat [x,y,x,y,...] or [[x,y],...] list. */
export function poly(c, pts, fill, lw = 5, close = true, stroke = INK) {
  const P = Array.isArray(pts[0]) ? pts : pts.reduce((a, v, i) =>
    (i % 2 ? (a[a.length - 1].push(v), a) : (a.push([v]), a)), []);
  c.beginPath();
  c.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) c.lineTo(P[i][0], P[i][1]);
  if (close) c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (lw > 0) { inked(c, lw, stroke); c.stroke(); }
}

/**
 * A closed blob through control points, smoothed with quadratic midpoints.
 * This is the workhorse for organic bodies — noses, bellies, clouds, hills.
 */
export function blob(c, pts, fill, lw = 5, stroke = INK) {
  const n = pts.length;
  c.beginPath();
  let mx = (pts[n - 1][0] + pts[0][0]) / 2;
  let my = (pts[n - 1][1] + pts[0][1]) / 2;
  c.moveTo(mx, my);
  for (let i = 0; i < n; i++) {
    const cur = pts[i];
    const nxt = pts[(i + 1) % n];
    c.quadraticCurveTo(cur[0], cur[1], (cur[0] + nxt[0]) / 2, (cur[1] + nxt[1]) / 2);
  }
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (lw > 0) { inked(c, lw, stroke); c.stroke(); }
}

/** Open curve through points (limbs, tails, antennae). */
export function stroke_(c, pts, lw = 6, color = INK, cap = 'round') {
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  c.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  c.lineCap = cap;
  c.lineWidth = lw;
  c.strokeStyle = color;
  c.stroke();
  c.lineCap = 'round';
}

/** Regular star — used for perfect-hit bursts and rank badges. */
export function star(c, x, y, spikes, outer, inner, fill, lw = 4, rot = 0, stroke = INK) {
  c.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = rot + (i * Math.PI) / spikes - Math.PI / 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    i ? c.lineTo(px, py) : c.moveTo(px, py);
  }
  c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (lw > 0) { inked(c, lw, stroke); c.stroke(); }
}

/* ── Character parts ───────────────────────────────────────────────────────── */

/**
 * Cartoon eye. `blink` 0..1 closes the lid; `look` is a unit-ish vector for the
 * pupil. Small, but it does most of the emotional work in this art style.
 */
export function eye(c, x, y, r, blink = 0, look = [0, 0], pupil = INK) {
  if (blink > 0.85) {
    stroke_(c, [[x - r, y], [x, y + r * 0.25], [x + r, y]], Math.max(r * 0.35, 2.5), INK);
    return;
  }
  const oy = r * (1 - blink);
  ellipse(c, x, y, r, oy, '#fffaf0', Math.max(r * 0.28, 2.5));
  const px = x + look[0] * r * 0.42;
  const py = y + look[1] * oy * 0.42;
  circle(c, px, py, r * 0.48, pupil, 0);
  circle(c, px - r * 0.16, py - r * 0.18, r * 0.15, 'rgba(255,255,255,0.9)', 0);
}

/** Simple smile/frown arc. `mood` from -1 (sad) to 1 (delighted). */
export function mouth(c, x, y, w, mood = 1, open = 0, lw = 4) {
  if (open > 0.15) {
    ellipse(c, x, y + w * 0.1, w * 0.5, w * 0.34 * open + w * 0.12, '#4a2036', lw);
    ellipse(c, x, y + w * 0.28 * open, w * 0.26, w * 0.16 * open, '#ff7d9c', 0);
    return;
  }
  const bend = w * 0.42 * mood;
  stroke_(c, [[x - w / 2, y - bend * 0.25], [x, y + bend], [x + w / 2, y - bend * 0.25]], lw, INK);
}

/** Blush patch. */
export function blush(c, x, y, r, alpha = 0.5, color = '255,120,140') {
  ellipse(c, x, y, r, r * 0.62, `rgba(${color},${alpha})`, 0);
}

/* ── Text ──────────────────────────────────────────────────────────────────── */

/**
 * Chunky outlined display text. Two passes (thick stroke, then fill) rather
 * than a shadow, so it stays legible on any background — important because the
 * HUD sits on top of moving art.
 */
export function boldText(c, text, x, y, size, fill = '#ffd23f', outline = INK, align = 'center', weight = 'bold') {
  c.save();
  c.font = `${weight} ${size}px "Trebuchet MS", Verdana, sans-serif`;
  c.textAlign = align;
  c.lineJoin = 'round';
  c.lineWidth = Math.max(size * 0.17, 3);
  c.strokeStyle = outline;
  c.strokeText(text, x, y);
  c.fillStyle = fill;
  c.fillText(text, x, y);
  c.restore();
}

/* ── Easing ────────────────────────────────────────────────────────────────── */

export const ease = {
  /** Overshoots then settles. The reason a hit "pops" instead of "moves". */
  outBack: (t, s = 1.9) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
  inQuad: (t) => t * t,
  inOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  /** Damped bounce — squash recovery. */
  elastic: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -9 * t) * Math.cos(t * 18)),
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b === a ? 0 : clamp((v - a) / (b - a), 0, 1));
