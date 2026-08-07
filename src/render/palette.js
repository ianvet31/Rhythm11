/**
 * Palettes — small, deliberate, per-world.
 *
 * Each palette is capped at roughly eight usable colours. That constraint is
 * what makes flat vector art read as "designed" rather than "assembled": with a
 * limited set you're forced to reuse hues across unrelated objects, which is
 * exactly what makes a screen-printed poster feel cohesive.
 *
 * Every palette must satisfy one gameplay rule: `hot` and `cue` are reserved for
 * things the player must react to, and appear nowhere in the background. If a
 * cue colour also shows up in a bush, the player's eye has to do extra work at
 * exactly the moment it can't afford to.
 */

export const PALETTES = {
  savanna: {
    name: 'Savanna Stomp',
    skyTop: '#ffd9a0',
    skyBot: '#ffb066',
    sun: '#fff0c2',
    far: '#d98c5f',
    mid: '#c06a4a',
    near: '#8f4a3c',
    ground: '#e8a765',
    groundDark: '#c9834b',
    fur: '#e0a458',
    furDark: '#c07f3c',
    belly: '#ffe3b8',
    hot: '#ff4d6d',      // cue objects
    cue: '#ffd23f',       // judgment ring / active
    accent: '#4ec9a5',
  },
  tidepool: {
    name: 'Neon Tide Pool',
    skyTop: '#1b2a5e',
    skyBot: '#0d1235',
    sun: '#7ae8ff',
    far: '#233a7a',
    mid: '#1a2c5e',
    near: '#0f1c3d',
    ground: '#2b4a8f',
    groundDark: '#1b3060',
    fur: '#b96ce8',
    furDark: '#8a45c0',
    belly: '#e8c7ff',
    hot: '#00ffc8',
    cue: '#ff5ce0',
    accent: '#ffe14d',
  },
  overdrive: {
    name: 'Vulpine Overdrive',
    skyTop: '#2a0a3d',
    skyBot: '#0a0418',
    sun: '#ff2e88',
    far: '#4a1160',
    mid: '#2f0a44',
    near: '#17052a',
    ground: '#20073a',
    groundDark: '#12041f',
    fur: '#ff8c42',
    furDark: '#d4571f',
    belly: '#fff0d6',
    hot: '#00e5ff',
    cue: '#ffe14d',
    accent: '#ff2e88',
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

export const GRADE_LABEL = {
  perfect: 'PERFECT!',
  great: 'GREAT',
  good: 'ok',
  miss: 'MISS',
  holdbreak: 'LET GO!',
};
