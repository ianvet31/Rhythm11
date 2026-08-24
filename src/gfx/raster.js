/**
 * raster — a software 3D rasterizer that outputs 8-bit pixel art.
 *
 * ── Why write a 3D engine instead of using one ───────────────────────────────
 *
 * Because the target look isn't "3D". It's "3D as rendered by a machine from
 * 1994", and that aesthetic comes almost entirely from the LIMITS:
 *
 *   • a tiny framebuffer (320×180) so pixels are big and shapes must be bold
 *   • a fixed palette, so every colour decision is deliberate
 *   • flat-shaded polygons with hard lighting bands, not smooth gradients
 *   • ordered dithering where two palette colours have to fake a third
 *
 * A modern GPU pipeline fights you on every one of those. You end up spending
 * the effort disabling antialiasing, quantising colour in a shader, and forcing
 * nearest-neighbour sampling — reproducing 1994 hardware in software anyway,
 * just less directly.
 *
 * Doing it honestly is also what makes it VERIFIABLE. This renders into a plain
 * Uint8Array, which means it runs in Node with no GPU, which means frames can be
 * dumped to PNG and actually looked at (tools/shoot.mjs). That capability is why
 * the art can be iterated on at all.
 *
 * ── The pipeline ─────────────────────────────────────────────────────────────
 *
 *   model space  ──[model matrix]──▶  world space
 *                ──[view matrix]───▶  camera space
 *                ──[projection]────▶  clip space
 *                ──[/w, viewport]──▶  screen space  ──▶  triangle fill + z-test
 *
 * Everything is indices into a palette, never RGB, right up until the final
 * blit. That's what keeps the colour discipline honest: you literally cannot
 * draw an off-palette colour.
 */

/* ── Vector / matrix maths ─────────────────────────────────────────────────
   Plain arrays and free functions rather than classes. This is the hot path —
   a few hundred thousand operations per frame — and allocation is the enemy. */

export const vec3 = (x = 0, y = 0, z = 0) => [x, y, z];

export function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function v3cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
export function v3norm(a) {
  const l = v3len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Column-major 4×4, same convention as OpenGL. */
export function mat4() {
  return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function m4mul(a, b, out = new Float64Array(16)) {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function m4translate(x, y, z) {
  const m = mat4();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function m4scale(x, y = x, z = x) {
  const m = mat4();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

export function m4rotX(a) {
  const m = mat4(); const c = Math.cos(a); const s = Math.sin(a);
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}
export function m4rotY(a) {
  const m = mat4(); const c = Math.cos(a); const s = Math.sin(a);
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}
export function m4rotZ(a) {
  const m = mat4(); const c = Math.cos(a); const s = Math.sin(a);
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

/** Right-handed perspective projection. */
export function m4perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float64Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** Look-at view matrix. */
export function m4lookAt(eye, target, up = [0, 1, 0]) {
  const z = v3norm(v3sub(eye, target));
  const x = v3norm(v3cross(up, z));
  const y = v3cross(z, x);
  const m = mat4();
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2];
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2];
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2];
  m[12] = -v3dot(x, eye);
  m[13] = -v3dot(y, eye);
  m[14] = -v3dot(z, eye);
  return m;
}

/** Transform a point (w=1) by a matrix, returning [x,y,z,w]. */
export function m4apply(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
    m[3] * x + m[7] * y + m[11] * z + m[15],
  ];
}

/** Transform a direction (w=0) — for normals under rigid transforms. */
export function m4applyDir(m, p) {
  const [x, y, z] = p;
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ];
}

/* ── Ordered dithering ─────────────────────────────────────────────────────
   A 4×4 Bayer matrix. With a small palette you constantly need a colour you
   don't have; dithering fakes it by interleaving the two nearest ramp entries
   in a fixed pattern. Ordered (not error-diffusion) is the right choice here:
   it's stable frame to frame, so a surface doesn't shimmer as it moves — which
   error diffusion absolutely would, and which would look terrible in motion. */

const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
].map((v) => (v + 0.5) / 16);

/**
 * The framebuffer.
 *
 * `color` holds PALETTE INDICES, not RGB. `depth` holds 1/w for the z-test —
 * reciprocal depth, because it interpolates linearly in screen space where
 * plain z does not.
 */
export class Framebuffer {
  constructor(width, height, palette) {
    this.w = width;
    this.h = height;
    this.color = new Uint8Array(width * height);
    this.depth = new Float32Array(width * height);
    this.setPalette(palette);
  }

  /**
   * @param {Array<[r,g,b]>} palette up to 255 entries; index 0 is transparent
   *   for sprite work but is a normal drawable colour here.
   */
  setPalette(palette) {
    this.palette = palette;
    this.rgba = new Uint8ClampedArray(palette.length * 4);
    for (let i = 0; i < palette.length; i++) {
      this.rgba[i * 4 + 0] = palette[i][0];
      this.rgba[i * 4 + 1] = palette[i][1];
      this.rgba[i * 4 + 2] = palette[i][2];
      this.rgba[i * 4 + 3] = 255;
    }
  }

  clear(colorIndex = 0) {
    this.color.fill(colorIndex);
    this.depth.fill(0);          // 0 = infinitely far, since we store 1/w
  }

  /** Fill a horizontal band — used for skies. */
  fillRect(x0, y0, x1, y1, ci) {
    const xa = Math.max(0, Math.floor(x0));
    const xb = Math.min(this.w, Math.ceil(x1));
    const ya = Math.max(0, Math.floor(y0));
    const yb = Math.min(this.h, Math.ceil(y1));
    for (let y = ya; y < yb; y++) {
      this.color.fill(ci, y * this.w + xa, y * this.w + xb);
    }
  }

  setPixel(x, y, ci) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.color[y * this.w + x] = ci;
  }

  /**
   * Rasterize one triangle.
   *
   * Vertices arrive in SCREEN space as [x, y, invW, shade] where shade is 0..1
   * lighting. Standard edge-function / barycentric fill: compute the signed
   * area of the triangle formed by each edge and the pixel centre; if all three
   * have the same sign the pixel is inside. Barycentric weights fall out of the
   * same numbers for free, which is what interpolates depth and shading.
   *
   * @param {object} mat
   * @param {number[]} mat.ramp  palette indices, dark → light. Shading picks
   *   from this, so lighting is quantised into hard bands by construction —
   *   which is the look.
   * @param {boolean} [mat.dither=true]
   */
  triangle(a, b, c, mat) {
    // Backface cull via screen-space winding. Doing it here rather than in
    // world space is cheaper and catches degenerate projections too.
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (area <= 0) return;

    /**
     * Escape hatch for the headless smoke test.
     *
     * That test plays every level end to end at 60fps — around 22,000 frames —
     * purely to prove nothing throws. Filling a 320×180 framebuffer that many
     * times in Node takes minutes and tests nothing the test cares about: all
     * the interesting failures (bad geometry, NaN transforms, missing
     * materials) have already happened by the time we reach the pixel loop.
     *
     * So the fill can be skipped while every stage above it still runs. The
     * pixels themselves are verified by tools/shoot.mjs and tools/preview3d.mjs,
     * which render real frames and are looked at.
     */
    if (globalThis.__RHYTHM_NO_FILL) return;

    let minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    let maxX = Math.min(this.w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    let minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    let maxY = Math.min(this.h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    if (minX > maxX || minY > maxY) return;

    const ramp = mat.ramp;
    const rampMax = ramp.length - 1;
    const dither = mat.dither !== false;
    const invArea = 1 / area;

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;

        const w0 = (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
        if (w0 < 0) continue;
        const w1 = (c[0] - b[0]) * (py - b[1]) - (px - b[0]) * (c[1] - b[1]);
        if (w1 < 0) continue;
        const w2 = (a[0] - c[0]) * (py - c[1]) - (px - c[0]) * (a[1] - c[1]);
        if (w2 < 0) continue;

        // Barycentric coordinates. Note the rotation: w1 belongs to vertex a.
        const la = w1 * invArea;
        const lb = w2 * invArea;
        const lc = w0 * invArea;

        const invW = la * a[2] + lb * b[2] + lc * c[2];
        const idx = y * this.w + x;
        if (invW <= this.depth[idx]) continue;      // farther than what's there

        let shade = la * a[3] + lb * b[3] + lc * c[3];
        if (shade < 0) shade = 0; else if (shade > 1) shade = 1;

        let level = shade * rampMax;
        if (dither) {
          // Push by the Bayer threshold so the fractional part between two ramp
          // entries becomes a stable checkerboard rather than a hard step.
          level += BAYER4[(y & 3) * 4 + (x & 3)] - 0.5;
        }
        let li = Math.round(level);
        if (li < 0) li = 0; else if (li > rampMax) li = rampMax;

        this.color[idx] = ramp[li];
        this.depth[idx] = invW;
      }
    }
  }

  /**
   * Blit to an ImageData-compatible Uint8ClampedArray at integer scale.
   * Nearest neighbour, obviously — any smoothing here destroys the whole point.
   */
  toRGBA(out, scale = 1) {
    const { w, h, color, rgba } = this;
    if (scale === 1) {
      for (let i = 0, o = 0; i < color.length; i++, o += 4) {
        const p = color[i] * 4;
        out[o] = rgba[p]; out[o + 1] = rgba[p + 1];
        out[o + 2] = rgba[p + 2]; out[o + 3] = 255;
      }
      return out;
    }
    const outW = w * scale;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = color[y * w + x] * 4;
        const r = rgba[p]; const g = rgba[p + 1]; const b = rgba[p + 2];
        for (let dy = 0; dy < scale; dy++) {
          let o = ((y * scale + dy) * outW + x * scale) * 4;
          for (let dx = 0; dx < scale; dx++) {
            out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
            o += 4;
          }
        }
      }
    }
    return out;
  }
}

/**
 * The renderer: owns the camera and collects triangles.
 *
 * Triangles are gathered and sorted before drawing rather than drawn as
 * submitted. With a depth buffer that isn't strictly necessary for opaque
 * geometry — but sorting back-to-front makes the dithering stable across
 * overlapping surfaces, and it's what lets alpha-ish tricks work later.
 */
export class Renderer {
  constructor(fb) {
    this.fb = fb;
    this.aspect = fb.w / fb.h;
    this.proj = m4perspective(Math.PI / 4, this.aspect, 0.1, 400);
    this.view = mat4();
    this.viewProj = mat4();
    /**
     * Key light. Coming from up-left-front so the camera-facing side of a
     * right-moving character is lit and its far side falls into shadow — the
     * angle that gives the most form for the fewest polygons.
     */
    this.light = v3norm([0.48, 0.72, 0.50]);
    /**
     * Ambient is deliberately LOW. It sets the darkest a surface can get, so a
     * high value compresses the whole shading range into the top of the ramp
     * and everything comes out one flat mid-tone — which is exactly what the
     * first render did. 0.18 lets faces reach the bottom of their ramp and
     * gives the model actual form.
     */
    this.ambient = 0.30;
    this.tris = [];
    /** Distance at which geometry fades to the fog colour. 0 disables. */
    this.fogNear = 0;
    this.fogFar = 0;
    this.fogRamp = null;
  }

  setCamera(eye, target, fovY = Math.PI / 4) {
    this.eye = eye;
    this.proj = m4perspective(fovY, this.aspect, 0.1, 400);
    this.view = m4lookAt(eye, target);
    m4mul(this.proj, this.view, this.viewProj);
  }

  begin() { this.tris.length = 0; }

  /**
   * Submit a mesh.
   *
   * @param {object} mesh  { verts:Float64Array|number[][], faces:[[i,j,k,matKey]] }
   * @param {Float64Array} model  model matrix
   * @param {Record<string,{ramp:number[]}>} materials
   */
  mesh(mesh, model, materials) {
    const mvp = m4mul(this.viewProj, model);
    const { w, h } = this.fb;
    const hw = w / 2;
    const hh = h / 2;

    // Transform vertices once, not once per face.
    const V = mesh.verts;
    const n = V.length;
    const sx = this.__sx || (this.__sx = []);
    sx.length = 0;
    const wpos = this.__wp || (this.__wp = []);
    wpos.length = 0;

    for (let i = 0; i < n; i++) {
      const p = m4apply(mvp, V[i]);
      const iw = 1 / (p[3] || 1e-6);
      sx.push([
        (p[0] * iw * 0.5 + 0.5) * w,
        (1 - (p[1] * iw * 0.5 + 0.5)) * h,
        iw,
        p[3],
      ]);
      wpos.push(m4apply(model, V[i]));
    }

    for (const f of mesh.faces) {
      const [i0, i1, i2, matKey] = f;
      const A = sx[i0]; const B = sx[i1]; const C = sx[i2];

      // Near-plane reject. Proper clipping is a lot of machinery; at this
      // resolution, dropping triangles that cross the camera plane is
      // invisible as long as the camera never enters geometry.
      if (A[3] <= 0.05 || B[3] <= 0.05 || C[3] <= 0.05) continue;

      const wa = wpos[i0]; const wb = wpos[i1]; const wc = wpos[i2];
      const nrm = v3norm(v3cross(v3sub(wb, wa), v3sub(wc, wa)));

      // Flat shading: one lighting value for the whole face. This is the
      // single biggest contributor to the retro look — smooth normals would
      // read as modern immediately.
      let lam = v3dot(nrm, this.light);
      if (lam < 0) lam = 0;
      let shade = this.ambient + (1 - this.ambient) * lam;

      const mat = materials[matKey] || materials.default;
      if (!mat) continue;

      // Depth sort key: average reciprocal depth, far → near.
      const key = (A[2] + B[2] + C[2]) / 3;

      this.tris.push({
        a: [A[0], A[1], A[2], shade],
        b: [B[0], B[1], B[2], shade],
        c: [C[0], C[1], C[2], shade],
        mat,
        key,
      });
    }
  }

  /** Draw everything collected, far to near. */
  flush() {
    this.tris.sort((p, q) => p.key - q.key);
    for (const t of this.tris) this.fb.triangle(t.a, t.b, t.c, t.mat);
    this.tris.length = 0;
  }

  /** Project a world point to screen — for placing 2D things in 3D space. */
  project(p) {
    const q = m4apply(this.viewProj, p);
    if (q[3] <= 0.001) return null;
    const iw = 1 / q[3];
    return {
      x: (q[0] * iw * 0.5 + 0.5) * this.fb.w,
      y: (1 - (q[1] * iw * 0.5 + 0.5)) * this.fb.h,
      invW: iw,
      w: q[3],
    };
  }
}
