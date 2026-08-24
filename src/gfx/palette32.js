/**
 * A 32-colour palette, organised as RAMPS.
 *
 * ── Why ramps, not colours ───────────────────────────────────────────────────
 *
 * The instinct with a small palette is to pick 32 nice colours. That produces
 * flat, poster-like art — which is what the last version of this game looked
 * like, and why it read as clipart.
 *
 * What makes low-colour 3D look good is spending the budget on SHADING RAMPS:
 * 4-5 steps from shadow to highlight for each material. Then a lit surface has
 * somewhere to go as it turns away from the light, and the model reads as solid.
 * Five materials × 5 steps is most of the budget, and that's the correct
 * allocation.
 *
 * ── Why ramps aren't just darker versions of one hue ─────────────────────────
 *
 * Each ramp shifts hue as it darkens, not merely value. Shadows go cooler and
 * more saturated (bounced sky light), highlights go warmer and desaturate
 * toward the light's colour. A ramp that only changes brightness looks like
 * grey mixed into paint — dead. This is the single highest-leverage thing in
 * the whole art pipeline and it costs nothing but care in choosing numbers.
 *
 *   elephant hide, dark → light:
 *     #2b2740  cool near-black, strongly blue
 *     #464461  still cool, purple cast
 *     #6b6a85  the mid — nearly neutral
 *     #9a97ab  warming
 *     #c9c4cd  warm, desaturated highlight
 */

/** [r,g,b] entries. Index 0 is the sky/clear colour. */
export const PAL32 = [
  /*  0 */[0x2a, 0x1b, 0x3d],   // deep sky / clear
  /*  1 */[0x52, 0x2c, 0x54],   // sky band 2
  /*  2 */[0x8a, 0x3e, 0x5c],   // sky band 3
  /*  3 */[0xc7, 0x5c, 0x50],   // sky band 4
  /*  4 */[0xe8, 0x8b, 0x4e],   // sky band 5
  /*  5 */[0xf4, 0xb9, 0x62],   // sky band 6 / low sun
  /*  6 */[0xff, 0xe0, 0x9a],   // sun core

  // ── Elephant hide: cool shadows, warm highlight ──────────────────────
  /*  7 */[0x2b, 0x27, 0x40],
  /*  8 */[0x46, 0x44, 0x61],
  /*  9 */[0x6b, 0x6a, 0x85],
  /* 10 */[0x9a, 0x97, 0xab],
  /* 11 */[0xc9, 0xc4, 0xcd],

  // ── Ear inner / mouth: pinker, warmer ────────────────────────────────
  /* 12 */[0x4a, 0x2c, 0x40],
  /* 13 */[0x7d, 0x45, 0x55],
  /* 14 */[0xb0, 0x66, 0x6d],
  /* 15 */[0xd9, 0x91, 0x8e],

  // ── Foliage: deep blue-green shadow to yellow-green light ────────────
  /* 16 */[0x14, 0x2a, 0x22],
  /* 17 */[0x21, 0x44, 0x2c],
  /* 18 */[0x37, 0x63, 0x33],
  /* 19 */[0x55, 0x87, 0x39],
  /* 20 */[0x86, 0xb0, 0x4c],

  // ── Bark: violet shadow to warm ochre ────────────────────────────────
  /* 21 */[0x2c, 0x1e, 0x2c],
  /* 22 */[0x4a, 0x30, 0x2c],
  /* 23 */[0x6d, 0x48, 0x30],
  /* 24 */[0x96, 0x67, 0x3e],

  // ── Ground: cool dirt shadow to warm dust ────────────────────────────
  /* 25 */[0x3d, 0x2a, 0x3a],
  /* 26 */[0x6b, 0x45, 0x40],
  /* 27 */[0x9c, 0x6c, 0x45],
  /* 28 */[0xc9, 0x96, 0x5a],

  // ── Accents ──────────────────────────────────────────────────────────
  /* 29 */[0xff, 0x9f, 0x1c],   // mango
  /* 30 */[0xff, 0xd1, 0x66],   // mango light / UI gold
  /* 31 */[0xf6, 0xf2, 0xe4],   // near-white: tusks, eyes, highlights
];

/**
 * Named ramps, dark → light. Materials reference these.
 * Every ramp is 4-5 entries so flat shading lands on visible bands.
 */
export const RAMPS = {
  hide: [7, 8, 9, 10, 11],
  hideDark: [7, 7, 8, 9, 10],          // underside / back legs
  /**
   * The outer ear gets its OWN ramp, shifted a step darker than hide.
   *
   * Not for realism — for separation. An ear rendered in the same material as
   * the skull it sits against disappears completely, however large it is, and
   * on this elephant that erased the single most important silhouette feature.
   * A one-step offset is enough for the eye to read two surfaces.
   */
  earOuter: [7, 7, 8, 9, 10],
  ear: [12, 13, 14, 15, 15],
  tusk: [10, 11, 31, 31, 31],
  eye: [7, 7, 7, 7, 7],
  eyeWhite: [11, 31, 31, 31, 31],

  leaf: [16, 17, 18, 19, 20],
  leafDeep: [16, 16, 17, 18, 19],      // interior canopy, always shaded
  bark: [21, 22, 23, 24, 24],
  barkLit: [22, 23, 24, 24, 30],

  /**
   * Ground ramps sit close together on purpose.
   *
   * The first attempt used a wide split between path and verge, and at distance
   * the two tiles alternated into a field of dark blotches — the eye read it as
   * damage, not texture. Ground covers most of the frame, so its internal
   * contrast has to be LOW; all the contrast budget belongs to the characters.
   */
  ground: [26, 27, 28, 28, 28],
  groundDark: [26, 26, 27, 27, 28],
  /** Hazier, for tiles near the horizon. Fakes aerial perspective. */
  groundFar: [26, 27, 27, 28, 28],
  grass: [16, 17, 18, 19, 19],
  /** Contact shadow — a single dark tone, never dithered. */
  shadow: [25, 25, 25, 25, 25],

  mango: [22, 29, 29, 30, 30],
  mangoRipe: [26, 29, 30, 30, 31],
  plum: [12, 13, 14, 15, 15],
  lime: [17, 18, 19, 20, 20],

  sky: [0, 1, 2, 3, 4],
  sun: [5, 6, 6, 31, 31],
  white: [11, 31, 31, 31, 31],
};

/** Sky gradient bands, top → horizon. Drawn as horizontal fills. */
export const SKY_BANDS = [0, 0, 1, 1, 2, 2, 3, 4, 5];

/** Materials for the renderer: name → { ramp, dither }. */
export const MATERIALS = Object.fromEntries(
  Object.entries(RAMPS).map(([k, ramp]) => [k, { ramp, dither: true }]),
);
MATERIALS.default = MATERIALS.hide;
// Eyes and tusks must stay crisp — dithering a 3px feature just makes noise.
MATERIALS.eye = { ramp: RAMPS.eye, dither: false };
MATERIALS.eyeWhite = { ramp: RAMPS.eyeWhite, dither: false };
MATERIALS.tusk = { ramp: RAMPS.tusk, dither: false };
