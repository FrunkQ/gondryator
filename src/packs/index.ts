import type { Pack } from './types';
import { STAR_GUITAR } from './star-guitar';
import { STARSHIP } from './starship';
import { AROUND_THE_WORLD } from './around-the-world';

/** The rides: each has a window true to life and something else entirely across the aisle. */
export const PACKS: Pack[] = [STAR_GUITAR, STARSHIP];
/** Kept, but off the menu until it gets its twist: reachable with ?pack=around-the-world. */
export const HIDDEN_PACKS: Pack[] = [AROUND_THE_WORLD];
