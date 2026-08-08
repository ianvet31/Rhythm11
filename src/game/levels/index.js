import puddlehop from './puddlehop.js';
import choir from './choir.js';
import courier from './courier.js';

export const LEVELS = [puddlehop, choir, courier];
export const LEVELS_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
