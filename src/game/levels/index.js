import savanna from './savanna.js';
import tidepool from './tidepool.js';
import overdrive from './overdrive.js';

export const LEVELS = [savanna, tidepool, overdrive];
export const LEVELS_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l]));
