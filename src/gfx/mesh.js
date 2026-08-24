/**
 * mesh — primitives for building models out of code.
 *
 * There's no modelling tool in this pipeline, so shapes are assembled from
 * parameterised primitives: boxes, tapered cylinders, spheroids, and swept
 * tubes along a path. That's a real constraint, but it's the same constraint
 * low-poly modellers worked under, and it pushes toward the chunky readable
 * forms the style wants anyway.
 *
 * The most useful thing in here is `tube()` — a swept polygon along an
 * arbitrary curve with a varying radius. An elephant is basically a big
 * spheroid with five tubes attached, and the trunk in particular needs to be a
 * real swept curve so it can bend and taper while animating.
 *
 * ── Conventions ──────────────────────────────────────────────────────────────
 *
 *   +X right, +Y up, +Z toward the camera. Right-handed.
 *   Faces are counter-clockwise when seen from OUTSIDE. The rasterizer culls
 *   clockwise faces, so a model with inverted winding renders inside-out —
 *   which looks like holes, and is the most common bug when building by hand.
 */

/** An empty mesh you can append into. */
export function emptyMesh() {
  return { verts: [], faces: [] };
}

/** Append `src` into `dst`, offsetting indices. Optionally transform verts. */
export function merge(dst, src, xform = null) {
  const base = dst.verts.length;
  for (const v of src.verts) dst.verts.push(xform ? xform(v) : [v[0], v[1], v[2]]);
  for (const f of src.faces) dst.faces.push([f[0] + base, f[1] + base, f[2] + base, f[3]]);
  return dst;
}

/** Translate/scale helper for merge(). */
export const place = (tx, ty, tz, sx = 1, sy = sx, sz = sx) =>
  (v) => [v[0] * sx + tx, v[1] * sy + ty, v[2] * sz + tz];

/** Rotate about Y then place — for radial arrangements like tree branches. */
export const placeRotY = (ang, tx, ty, tz, s = 1) => {
  const c = Math.cos(ang); const sn = Math.sin(ang);
  return (v) => {
    const x = v[0] * s; const y = v[1] * s; const z = v[2] * s;
    return [x * c + z * sn + tx, y + ty, -x * sn + z * c + tz];
  };
};

/* ── Box ──────────────────────────────────────────────────────────────────── */

export function box(w, h, d, mat = 'default', ox = 0, oy = 0, oz = 0) {
  const x = w / 2; const y = h / 2; const z = d / 2;
  const verts = [
    [-x + ox, -y + oy, z + oz], [x + ox, -y + oy, z + oz],
    [x + ox, y + oy, z + oz], [-x + ox, y + oy, z + oz],
    [-x + ox, -y + oy, -z + oz], [x + ox, -y + oy, -z + oz],
    [x + ox, y + oy, -z + oz], [-x + ox, y + oy, -z + oz],
  ];
  const faces = [
    [0, 1, 2, mat], [0, 2, 3, mat],       // front  +Z
    [5, 4, 7, mat], [5, 7, 6, mat],       // back   -Z
    [1, 5, 6, mat], [1, 6, 2, mat],       // right  +X
    [4, 0, 3, mat], [4, 3, 7, mat],       // left   -X
    [3, 2, 6, mat], [3, 6, 7, mat],       // top    +Y
    [4, 5, 1, mat], [4, 1, 0, mat],       // bottom -Y
  ];
  return { verts, faces };
}

/* ── Spheroid ─────────────────────────────────────────────────────────────── */

/**
 * A UV spheroid. Low segment counts on purpose — 8×6 is plenty at 320×180 and
 * the visible faceting is part of the look.
 */
export function spheroid(rx, ry, rz, mat = 'default', segU = 10, segV = 7) {
  const verts = [];
  const faces = [];
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI;
    const sp = Math.sin(phi); const cp = Math.cos(phi);
    for (let u = 0; u < segU; u++) {
      const th = (u / segU) * Math.PI * 2;
      verts.push([rx * sp * Math.cos(th), ry * cp, rz * sp * Math.sin(th)]);
    }
  }
  const idx = (u, v) => v * segU + (u % segU);
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = idx(u, v); const b = idx(u + 1, v);
      const c = idx(u + 1, v + 1); const d = idx(u, v + 1);
      if (v !== 0) faces.push([a, d, c, mat]);
      if (v !== segV - 1) faces.push([a, c, b, mat]);
    }
  }
  return { verts, faces };
}

/* ── Tube along a path ────────────────────────────────────────────────────── */

/**
 * Sweep a regular polygon along a 3D path with a per-station radius.
 *
 * This is the workhorse: legs, trunk, tail, tree trunks and branches are all
 * tubes. Because the path is just an array of points, an animated part only has
 * to recompute its path each frame and the geometry follows.
 *
 * Frames are computed with a parallel-transport-ish approach: pick an "up" that
 * isn't parallel to the tangent and derive the ring basis from it. Naive
 * per-segment frames twist visibly when the path curves.
 *
 * @param {number[][]} path    stations, at least 2
 * @param {number[]} radii     one per station
 * @param {number} sides       4 is blocky and fine for limbs; 6-8 for the trunk
 * @param {boolean} caps       close the ends
 */
export function tube(path, radii, mat = 'default', sides = 6, caps = true) {
  const verts = [];
  const faces = [];
  const n = path.length;

  let prevUp = [0, 1, 0];

  for (let i = 0; i < n; i++) {
    const p = path[i];
    // Tangent by central difference where possible — smoother than forward
    // difference, which kinks at every station.
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(n - 1, i + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const tl = Math.hypot(t[0], t[1], t[2]) || 1;
    t = [t[0] / tl, t[1] / tl, t[2] / tl];

    // Choose a reference up that isn't parallel to the tangent.
    let up = prevUp;
    if (Math.abs(up[0] * t[0] + up[1] * t[1] + up[2] * t[2]) > 0.94) {
      up = [1, 0, 0];
    }
    // side = normalize(cross(up, t)); realUp = cross(t, side)
    let sx = up[1] * t[2] - up[2] * t[1];
    let sy = up[2] * t[0] - up[0] * t[2];
    let sz = up[0] * t[1] - up[1] * t[0];
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl; sy /= sl; sz /= sl;
    const ux = t[1] * sz - t[2] * sy;
    const uy = t[2] * sx - t[0] * sz;
    const uz = t[0] * sy - t[1] * sx;
    prevUp = [ux, uy, uz];

    const r = radii[i];
    for (let k = 0; k < sides; k++) {
      const ang = (k / sides) * Math.PI * 2;
      const ca = Math.cos(ang) * r;
      const sa = Math.sin(ang) * r;
      verts.push([
        p[0] + sx * ca + ux * sa,
        p[1] + sy * ca + uy * sa,
        p[2] + sz * ca + uz * sa,
      ]);
    }
  }

  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      const c = (i + 1) * sides + ((k + 1) % sides);
      const d = (i + 1) * sides + k;
      faces.push([a, b, c, mat]);
      faces.push([a, c, d, mat]);
    }
  }

  if (caps) {
    const c0 = verts.length;
    verts.push([...path[0]]);
    for (let k = 0; k < sides; k++) {
      faces.push([c0, (k + 1) % sides, k, mat]);
    }
    const c1 = verts.length;
    verts.push([...path[n - 1]]);
    const base = (n - 1) * sides;
    for (let k = 0; k < sides; k++) {
      faces.push([c1, base + k, base + ((k + 1) % sides), mat]);
    }
  }

  return { verts, faces };
}

/* ── Flat quad ────────────────────────────────────────────────────────────── */

/** A double-sided quad from four corners. Used for ground and billboards. */
export function quad(p0, p1, p2, p3, mat = 'default', doubleSided = false) {
  const verts = [p0, p1, p2, p3];
  const faces = [[0, 1, 2, mat], [0, 2, 3, mat]];
  if (doubleSided) faces.push([0, 2, 1, mat], [0, 3, 2, mat]);
  return { verts, faces };
}

/**
 * A ground plane subdivided into a grid.
 *
 * Subdivision matters even though the plane is flat: the rasterizer shades per
 * face, so a single enormous quad would be one uniform colour. Splitting it
 * lets distance fog and per-tile colour variation do their work.
 */
export function groundGrid(w, d, cols, rows, matFn) {
  const verts = [];
  const faces = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      verts.push([-w / 2 + (c / cols) * w, 0, -d / 2 + (r / rows) * d]);
    }
  }
  const idx = (c, r) => r * (cols + 1) + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Wound so the surface normal points +Y (up). Get this backwards and the
      // whole plane is backface-culled — which looks exactly like "the ground
      // wasn't drawn", because it wasn't.
      const m = matFn(c, r);
      faces.push([idx(c, r), idx(c + 1, r + 1), idx(c, r + 1), m]);
      faces.push([idx(c, r), idx(c + 1, r), idx(c + 1, r + 1), m]);
    }
  }
  return { verts, faces };
}

/* ── Utility ──────────────────────────────────────────────────────────────── */

/** Deterministic 0..1 hash — same world every run. */
export function hash(i) {
  const v = Math.sin(i * 127.1 + 43.7) * 43758.5453;
  return v - Math.floor(v);
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Count triangles, for keeping an eye on the budget. */
export function triCount(mesh) { return mesh.faces.length; }
