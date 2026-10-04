import type { Pack } from './types';
import { STAR_GUITAR } from './star-guitar';
import { RIVERBOAT } from './riverboat';
import { NIGHT_BUS } from './night-bus';
import { AROUND_THE_WORLD } from './around-the-world';

/** The vehicles: each has a window true to life and a trippy one across the aisle. */
export const PACKS: Pack[] = [STAR_GUITAR, RIVERBOAT, NIGHT_BUS];
/** Kept, but off the menu until it gets its twist: reachable with ?pack=around-the-world. */
export const HIDDEN_PACKS: Pack[] = [AROUND_THE_WORLD];
