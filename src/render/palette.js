/**
 * Palettes — small, deliberate, per-world.
 *
 * Each palette is capped at roughly ten usable colours. That constraint is what
 * makes flat vector art read as "designed" rather than "assembled": with a
 * limited set you're forced to reuse hues across unrelated objects, which is
 * what makes a screen-printed poster feel cohesive.
 *
 * One gameplay rule every palette obeys: `callColor` is reserved for the game
 * TELLING you something — the crow's caw rings, the choirmaster's phrase, the
 * courier's whistle. It appears nowhere in the scenery. When that colour flashes
 * it always means "listen", and it never means anything else.
 */

export const PALETTES = {
  /* ── Puddle Hop — a drizzly park at dusk ─────────────────────────────── */
  park: {
    name: 'Puddle Hop',
    skyTop: '#8fb8d6',
    skyBot: '#d9c3a8',
    sun: '#fff0d0',
    far: '#7d94ab',
    mid: '#5f7186',
    near: '#3f4c60',
    ground: '#8a7a63',
    groundDark: '#6b5c48',
    stone: '#b9ae99',
    stoneDark: '#8f8471',
    post: '#6b4f36',
    water: '#6fa8c9',
    waterLight: '#a8d6ea',
    rain: 'rgba(200,225,240,0.55)',
    // Pip
    body: '#ffd166',
    trim: '#e8553f',
    skin: '#ffe3c4',
    hatColor: '#e8553f',
    callColor: '#ffb03a',
    cue: '#ffd166',
    hot: '#e8553f',
    accent: '#4ec9a5',
  },

  /* ── Choir Sprout — a warm wooden hall ───────────────────────────────── */
  hall: {
    name: 'Choir Sprout',
    skyTop: '#3c2a4d',
    skyBot: '#241a33',
    sun: '#ffd98a',
    far: '#4a3560',
    mid: '#3a2a4d',
    near: '#2a1e39',
    ground: '#6b4a35',
    groundDark: '#4a3325',
    wood: '#8a5c3d',
    woodDark: '#5f3e29',
    curtain: '#7d2a4a',
    curtainDark: '#5a1c35',
    // Sprouts
    body: '#a8d84f',
    trim: '#5aa832',
    skin: '#f6e6c8',
    leaf: '#7ed957',
    masterBody: '#5b7fd4',
    masterTrim: '#2f4fa8',
    callColor: '#ffd98a',
    cue: '#ffd98a',
    hot: '#ff7ab5',
    accent: '#7ed957',
  },

  /* ── Mango Stomp — a warm retro grove, late afternoon ────────────────────
     Deliberately a 1970s screen-print: burnt orange, mustard, avocado, cream.
     Six hues doing all the work, no colour used in only one place. */
  grove: {
    name: 'Mango Stomp',
    skyTop: '#f4b942',
    skyBot: '#e8825a',
    sun: '#fff1c9',
    sunRing: '#ffd166',
    far: '#c96f4a',
    mid: '#a8523c',
    near: '#7d3a2e',
    ground: '#c98f4a',
    groundDark: '#a06b34',
    grass: '#8a9b3c',
    dust: '#e8c98f',
    bark: '#6b4226',
    leaf: '#5c7a2e',
    leafDark: '#3f5a20',
    // The elephant
    hide: '#9aa5b8',
    hideLight: '#c3cbd9',
    hideDark: '#6f7a90',
    ear: '#8f99ac',
    earInner: '#c99aa0',
    nail: '#f2e8d5',
    ink2: '#5a3320',
    callColor: '#fff1c9',
    cue: '#ffd166',
    hot: '#ff9f1c',
    accent: '#8a9b3c',
  },

  /* ── Rocket Courier — a neon launchpad at night ──────────────────────── */
  pad: {
    name: 'Rocket Courier',
    skyTop: '#1b0f3a',
    skyBot: '#07040f',
    sun: '#ff2e88',
    far: '#2d1a5c',
    mid: '#1d1140',
    near: '#120a28',
    ground: '#241645',
    groundDark: '#150c2a',
    metal: '#4a5570',
    metalDark: '#2e3549',
    // Courier
    body: '#ff8c42',
    trim: '#2b2f4a',
    skin: '#ffddb8',
    hatColor: '#00e5ff',
    parcelA: '#ffd23f',
    parcelB: '#ff5ce0',
    callColor: '#00e5ff',
    cue: '#ffd23f',
    hot: '#ff2e88',
    accent: '#00e5ff',
  },
};

/** Colour used to draw a judgment result. */
export const GRADE_COLOR = {
  perfect: '#ffd23f',
  great: '#4ec9a5',
  good: '#7ab8ff',
  miss: '#ff4d6d',
  holdbreak: '#ff4d6d',
  holdend: '#4ec9a5',
};

/**
 * Judgment labels.
 *
 * Rhythm Heaven famously shows almost nothing during play — no PERFECT/GREAT
 * spam over the action. So only the extremes get a label: a perfect is worth
 * celebrating and a miss needs acknowledging. Everything in between is
 * communicated by sound and by how the character moves, which keeps the screen
 * clear and keeps the player listening.
 */
export const GRADE_LABEL = {
  perfect: 'NICE!',
  great: null,
  good: null,
  miss: 'OOPS',
  holdbreak: 'LET GO!',
};
