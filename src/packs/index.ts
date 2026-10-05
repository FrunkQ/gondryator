import type { Pack } from './types';
import { STAR_GUITAR } from './star-guitar';
import { STARSHIP } from './starship';
import { NON_GONDRY } from './non-gondry';
import { AROUND_THE_WORLD } from './around-the-world';
import { HALLOWEEN } from './halloween';

/** The rides: the train, the starship and the ghost train (a window true to life, something else across the aisle), and the non-Gondry view. */
export const PACKS: Pack[] = [STAR_GUITAR, STARSHIP, HALLOWEEN, NON_GONDRY];
/** Kept, but off the menu until it gets its twist: reachable with ?pack=around-the-world. */
export const HIDDEN_PACKS: Pack[] = [AROUND_THE_WORLD];
