/**
 * grove3d — the world she walks through.
 *
 * ── The composition problem ──────────────────────────────────────────────────
 *
 * A side-on 2D scene has one depth cue: things behind other things. A 3D scene
 * has perspective, and the job here is to actually USE it rather than build a
 * flat set and point a camera at it. Concretely:
 *
 *   • The path runs diagonally away from the camera, not left-to-right across
 *     the frame. She walks along +X and slightly +Z toward us, so the path
 *     recedes and the whole image has a direction.
 *   • Trees are placed on BOTH sides of the path at varying depths, so there's
 *     always something near the camera and something far away. A single row of
 *     trees at one depth is a stage backdrop.
 *   • Near trees are cropped by the frame edge. Objects running off-screen are
 *     what tells the eye the world continues past the camera.
 *
 * ── Why the trees are built once and instanced ───────────────────────────────
 *
 * Unlike the elephant, trees don't deform — they only sway, which is a
 * per-instance rotation. So four trunk variants are built once at module load
 * and drawn many times with different transforms. That keeps the per-frame cost
 * to matrix maths instead of geometry generation, which matters because there
 * are ~20 trees on screen against one elephant.
 */

import {
  emptyMesh, merge, place, placeRotY, box, spheroid, tube, quad, groundGrid,
  hash, lerp, clamp,
} from './mesh.js';
import { mat4, m4mul, m4rotY, m4translate, m4scale } from './raster.js';
import { SKY_BANDS, RAMPS } from './palette32.js';

/* ── Sky ──────────────────────────────────────────────────────────────────── */

/**
 * Horizontal colour bands plus a low sun.
 *
 * Drawn directly into the framebuffer rather than as geometry: the sky is
 * infinitely far away, so putting it through the 3D pipeline buys nothing and
 * costs a depth-buffer full of useless writes.
 */
export function drawSky(fb, { sunX = 0.74, sunY = 0.42, horizon = 0.60 } = {}) {
  const H = fb.h;
  const W = fb.w;
  const hz = Math.floor(H * horizon);

  // Bands compress toward the horizon — the sky is not a linear gradient, it's
  // dense near the ground and open overhead.
  for (let y = 0; y < hz; y++) {
    const t = y / hz;
    const idx = Math.min(
      SKY_BANDS.length - 1,
      Math.floor(Math.pow(t, 1.5) * SKY_BANDS.length),
    );
    fb.fillRect(0, y, W, y + 1, SKY_BANDS[idx]);
  }

  // Low sun: a disc with horizontal slots cut through its lower half, which is
  // the cheapest possible nod to a scanline sunset and reads instantly.
  const cx = W * sunX;
  const cy = hz * sunY + hz * 0.30;
  const R = Math.floor(H * 0.17);
  for (let y = -R; y <= R; y++) {
    const half = Math.floor(Math.sqrt(Math.max(0, R * R - y * y)));
    const py = Math.round(cy + y);
    if (py < 0 || py >= hz) continue;
    // Slots below the equator, getting thicker further down.
    const below = y / R;
    if (below > 0.05) {
      const period = Math.max(2, Math.round(3 + below * 6));
      if ((py % period) < Math.round(1 + below * 2.5)) continue;
    }
    const ci = below < -0.3 ? 6 : 5;
    fb.fillRect(cx - half, py, cx + half, py + 1, ci);
  }
}

/* ── Tree variants, built once ────────────────────────────────────────────── */

/**
 * One tree. Trunk is a swept tube with a root flare; the canopy is a cluster of
 * overlapping spheroids rather than one ball, so the silhouette is lumpy and
 * organic instead of lollipop-shaped.
 */
function buildTree(seed) {
  const M = emptyMesh();
  const h = 3.9 + hash(seed) * 1.7;
  const lean = (hash(seed + 7) - 0.5) * 0.30;
  const twist = hash(seed + 11) * Math.PI * 2;

  // Trunk
  const N = 6;
  const path = [];
  const radii = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    path.push([
      Math.sin(t * 1.6 + twist) * lean * h * 0.16,
      t * h,
      Math.cos(t * 1.2 + twist) * lean * h * 0.12,
    ]);
    // Root flare: fat at the very bottom, then a long even taper.
    radii.push(t < 0.12
      ? lerp(0.46, 0.26, t / 0.12)
      : lerp(0.26, 0.13, (t - 0.12) / 0.88));
  }
  merge(M, tube(path, radii, 'bark', 6));

  // Buttress roots — three wedges at the base. Small detail, but it plants the
  // tree in the ground instead of letting it look pushed in like a pin.
  for (let i = 0; i < 3; i++) {
    const a = twist + (i / 3) * Math.PI * 2;
    merge(M, spheroid(0.16, 0.30, 0.34, 'bark', 5, 4),
      placeRotY(a, Math.cos(a) * 0.30, 0.16, Math.sin(a) * 0.30, 1));
  }

  // Branches: a few tapered tubes fanning out near the top.
  const top = path[N - 1];
  const nb = 3 + Math.floor(hash(seed + 3) * 3);
  for (let i = 0; i < nb; i++) {
    const a = twist + (i / nb) * Math.PI * 2 + hash(seed + i) * 0.6;
    const reach = 0.9 + hash(seed + i * 5) * 0.8;
    const rise = 0.5 + hash(seed + i * 9) * 0.7;
    const bp = [];
    const br = [];
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      bp.push([
        top[0] + Math.cos(a) * reach * t,
        top[1] - 0.5 + rise * t - t * t * 0.2,
        top[2] + Math.sin(a) * reach * t,
      ]);
      br.push(lerp(0.11, 0.045, t));
    }
    merge(M, tube(bp, br, 'bark', 5));
  }

  /* Canopy: 5-8 overlapping spheroids at varied heights and offsets.
     Two materials — the outer blobs use the lit 'leaf' ramp, the inner ones a
     permanently-shaded ramp, which fakes ambient occlusion inside the foliage
     for free. That depth is most of what stops it reading as a green balloon. */
  const nc = 9 + Math.floor(hash(seed + 21) * 5);
  for (let i = 0; i < nc; i++) {
    // Two rings plus a crown, rather than one ring — a single ring of blobs
    // reads as a wreath with a hole in the middle from below.
    const ring = i % 3;
    const a = twist * 1.7 + (i / nc) * Math.PI * 4.3;
    const rad = ring === 2 ? 0.15 : (0.62 + ring * 0.42) + hash(seed + i * 13) * 0.34;
    const cy = top[1] + (ring === 2 ? 0.62 : 0.18)
      + (hash(seed + i * 17) - 0.4) * 0.55;
    const size = (ring === 1 ? 0.52 : 0.66) + hash(seed + i * 19) * 0.30;
    // Blobs on the shaded side and the interior use the permanently-dark ramp,
    // which fakes occlusion inside the foliage for free.
    const inner = ring === 1 || Math.cos(a) < -0.25;
    merge(M,
      spheroid(size * 1.20, size * 0.82, size * 1.16, inner ? 'leafDeep' : 'leaf', 9, 6),
      place(top[0] + Math.cos(a) * rad, cy, top[2] + Math.sin(a) * rad));
  }

  return M;
}

const TREES = [0, 1, 2, 3, 4, 5].map((i) => buildTree(i * 31 + 5));

/* ── Fruit ────────────────────────────────────────────────────────────────── */

const FRUIT_MESH = {
  mango: spheroid(0.24, 0.21, 0.24, 'mango', 6, 5),
  plum: spheroid(0.21, 0.21, 0.21, 'plum', 6, 5),
  lime: spheroid(0.20, 0.18, 0.20, 'lime', 6, 5),
};
const STEM_MESH = tube([[0, 0, 0], [0.02, 0.16, 0]], [0.03, 0.02], 'bark', 4, false);

export function drawFruit(r, materials, x, y, z, kind, scale = 1, spin = 0) {
  const m = m4mul(m4translate(x, y, z), m4mul(m4rotY(spin), m4scale(scale)));
  r.mesh(FRUIT_MESH[kind] || FRUIT_MESH.mango, m, materials);
  r.mesh(STEM_MESH, m4mul(m4translate(x, y + 0.13, z), m4scale(scale)), materials);
}

/* ── Ground ───────────────────────────────────────────────────────────────── */

/**
 * A long strip of ground running along X, subdivided so distance shading and
 * per-tile variation have something to work with.
 *
 * The path itself is a lighter band of tiles down the middle — worn dirt where
 * the elephants walk. It's what gives the composition a leading line.
 */
/**
 * Deep enough to reach past the horizon. A shallow strip leaves a bare band
 * between its far edge and the sky, which reads as the world ending — the ground
 * has to run further than the camera can see.
 */
const GROUND = groundGrid(140, 90, 70, 30, (c, r2) => {
  // A wide, soft-edged path. The first version used a narrow band and the far
  // verge became a single dark stripe running the width of the frame — the eye
  // read it as a wall rather than as ground continuing away from you.
  const zc = Math.abs(r2 - 15) * 0.42;
  // groundFar was tried here and produced a hard terrace line where it met
  // groundDark. A flat plane has one normal, so two ramps on it differ by a
  // constant step everywhere - which reads as a wall, not as haze.
  if (false) return 'groundFar';
  if (zc < 1.8) return 'ground';          // the worn path
  return 'groundDark';
  // Note: no per-tile random variation. An earlier version scattered lighter
  // tiles through the verge and at distance they clumped into dark patches that
  // read as holes in the ground. Large flat areas want to stay flat; texture
  // belongs on small objects where the eye expects detail.
});

/**
 * The stomp shockwave — an expanding ring of dust on the ground.
 *
 * ── Why a ring and not a puff ────────────────────────────────────────────────
 *
 * A puff of dust says "something moved". A ring travelling OUTWARD from a point
 * says "something hit the ground there, hard" — it gives the impact a location
 * and a direction, and its expansion rate is read as force.
 *
 * Expansion is eased out hard (t^0.45): almost all the growth happens in the
 * first few frames, then it drifts. Linear expansion reads as a balloon
 * inflating; front-loaded expansion reads as a blast.
 *
 * Built as a flat annulus lying on the ground, so perspective foreshortens it
 * into an ellipse automatically. A screen-space circle would sit wrong the
 * moment the camera moved.
 */
const DUST_RING = (() => {
  const verts = [];
  const faces = [];
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    verts.push([Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62]);   // inner
    verts.push([Math.cos(a) * 1.0, 0.12, Math.sin(a) * 1.0]);  // outer, lifted
  }
  for (let i = 0; i < N; i++) {
    const a = i * 2; const b = i * 2 + 1;
    const c = ((i + 1) % N) * 2; const d = ((i + 1) % N) * 2 + 1;
    faces.push([a, d, b, 'dust']);
    faces.push([a, c, d, 'dust']);
  }
  return { verts, faces };
})();

/** @param {number} t 0 = just struck, 1 = gone */
export function drawDustRing(r, materials, x, z, t, power = 1) {
  if (t <= 0 || t >= 1) return;
  const rad = Math.pow(t, 0.45) * 3.1 * power;
  const lift = t * 0.5;
  r.mesh(DUST_RING, m4mul(
    m4translate(x, 0.03 + lift, z),
    m4scale(rad, 1 - t * 0.5, rad * 0.85),
  ), materials);
}

/** A soft contact shadow disc, laid flat just above the ground. */
const SHADOW = (() => {
  const verts = [[0, 0, 0]];
  const faces = [];
  const N = 12;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    verts.push([Math.cos(a), 0, Math.sin(a) * 0.55]);
  }
  for (let i = 0; i < N; i++) {
    faces.push([0, 1 + ((i + 1) % N), 1 + i, 'shadow']);
  }
  return { verts, faces };
})();

/**
 * Ground shadow for a character.
 *
 * Not a real shadow — a flat disc under the feet. At this resolution nobody can
 * tell, and it does the one job that matters: without it a character reads as
 * floating above the ground rather than standing on it. It's the single
 * cheapest fix for "the 3D looks wrong" and it's almost always the cause.
 */
export function drawShadow(r, materials, x, z, radius = 1, squash = 1) {
  r.mesh(SHADOW, m4mul(
    m4translate(x, 0.02, z),
    m4scale(radius, 1, radius * squash),
  ), materials);
}

/** Tufts of grass along the verges. Built once, scattered by transform. */
const TUFT = (() => {
  const M = emptyMesh();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    merge(M, tube(
      [[0, 0, 0], [Math.cos(a) * 0.10, 0.22, Math.sin(a) * 0.10],
        [Math.cos(a) * 0.20, 0.34, Math.sin(a) * 0.20]],
      [0.055, 0.035, 0.012], 'grass', 3, false,
    ));
  }
  return M;
})();

/* ── Scene assembly ───────────────────────────────────────────────────────── */

/**
 * @param {Renderer} r
 * @param {object} o
 * @param {number} o.scroll     world units travelled — everything slides by -X
 * @param {number} o.sway       radians of wind, applied per-tree with an offset
 */
export function buildGrove(r, { scroll = 0, sway = 0, materials }) {
  const M = materials;

  // Ground, snapped to a tile so its subdivision doesn't shimmer as it scrolls.
  const TILE = 2;
  const gx = -(scroll % TILE);
  r.mesh(GROUND, m4translate(gx, 0, 0), M);

  /* Trees.
     Placed on both verges at staggered depths. `SPACING` is deliberately not a
     multiple of the fruit spacing — if they lined up, the grove would visibly
     pulse in time with the chart, which would read as a bug. */
  const SPACING = 3.3;
  const first = Math.floor(scroll / SPACING) - 3;
  for (let i = first; i < first + 26; i++) {
    const n = hash(i * 3 + 1);
    const n2 = hash(i * 3 + 2);
    /**
     * Most trees go on the FAR verge. Near-side trees are dramatic — they crop
     * against the frame edge and sell the depth — but they also stand between
     * the camera and the action, so one every fourth slot is plenty. More than
     * that and the player spends the level looking at bark.
     */
    /**
     * The camera sits at POSITIVE z looking toward the origin, so:
     *   z > 0  is between the camera and the path — trees here loom huge
     *   z < 0  is beyond the path — trees here recede into the distance
     *
     * Most of the grove belongs behind the path. Foreground trunks are a
     * framing device used sparingly; a whole row of them just walls off the
     * scene, which is exactly what happened when these were the wrong way round.
     */
    const near = (i % 7 === 3);
    const z = near
      ? lerp(5.0, 7.5, n2)          // foreground framing, cropped by the frame
      : lerp(-2.4, -22.0, n * n);   // behind the path, biased far

    const x = i * SPACING + n2 * 2.4 - scroll;
    const s = near ? lerp(0.9, 1.2, n) : lerp(0.85, 1.45, n);
    const tree = TREES[Math.abs(i) % TREES.length];
    const lean = Math.sin(sway + i * 1.7) * 0.02;

    r.mesh(tree, m4mul(
      m4translate(x, 0, z),
      m4mul(m4rotY(n * Math.PI * 2 + lean), m4scale(s)),
    ), M);
  }

  // Grass tufts along the verges.
  const TSP = 1.35;
  const tfirst = Math.floor(scroll / TSP) - 2;
  for (let i = tfirst; i < tfirst + 44; i++) {
    const n = hash(i * 11 + 3);
    if (n < 0.30) continue;
    const side = n > 0.62 ? 1 : -1;
    const z = side * lerp(1.9, 3.4, hash(i * 11 + 5));
    const x = i * TSP + n * 0.9 - scroll;
    r.mesh(TUFT, m4mul(
      m4translate(x, 0, z),
      m4mul(m4rotY(n * 6.28), m4scale(lerp(0.7, 1.5, hash(i * 11 + 9)))),
    ), M);
  }
}

/* ── The fruit canopy ─────────────────────────────────────────────────────── */

/**
 * A continuous band of foliage arching over the path, with fruit hanging from it.
 *
 * ── Why this exists as its own thing ─────────────────────────────────────────
 *
 * Fruit positions are dictated by the RHYTHM — they land wherever the chart puts
 * them. Individual trees are placed for composition. Those two constraints do
 * not agree, so hanging fruit off tree branches would leave most of it dangling
 * in open air, which is exactly what the first 3D pass looked like.
 *
 * A continuous overhanging canopy guarantees every fruit has foliage above it,
 * whatever the chart does. It also frames the top of the screen and gives the
 * scene a ceiling, which makes the space feel enclosed rather than like a model
 * on a table.
 *
 * Built per-frame from a scrolling index so it tiles seamlessly forever.
 */
export function buildFruitCanopy(r, materials, scroll, sway = 0) {
  const SP = 1.5;
  const first = Math.floor(scroll / SP) - 2;
  for (let i = first; i < first + 26; i++) {
    const n = hash(i * 5 + 17);
    const n2 = hash(i * 5 + 23);
    const x = i * SP - scroll;
    // The band spans the path in z and dips lower at its front edge, so it
    // reads as a leafy roof rather than a flat ceiling.
    for (let k = 0; k < 3; k++) {
      const z = -2.3 + k * 1.55 + (n2 - 0.5) * 0.6;
      const y = CANOPY_Y + (k === 1 ? 0.30 : 0) + (n - 0.5) * 0.55
        + Math.sin(sway + i * 0.8) * 0.05;
      const s = 0.78 + n * 0.42 - k * 0.06;
      const shaded = k === 0 || n < 0.34;
      r.mesh(
        spheroid(s * 1.25, s * 0.72, s * 1.15, shaded ? 'leafDeep' : 'leaf', 8, 5),
        m4translate(x + (n2 - 0.5) * 0.5, y, z),
        materials,
      );
    }
  }
}

/** Underside of the fruit canopy. Fruit hangs below this. */
export const CANOPY_Y = 4.35;

/** Where fruit hangs, in world Y. Kept here so chart and art agree. */
export const FRUIT_Y = 2.95;

/** A stem connecting a piece of fruit up into the canopy above it. */
const STALK = tube([[0, 0, 0], [0, 1, 0]], [0.035, 0.045], 'bark', 4, false);
export function drawStalk(r, materials, x, y, z, len) {
  r.mesh(STALK, m4mul(m4translate(x, y, z), m4scale(1, len, 1)), materials);
}
/** Ground-plane Z the fruit line sits on — directly over the path. */
export const FRUIT_Z = 0.35;
