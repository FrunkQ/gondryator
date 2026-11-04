import type { Pack } from './types';
import { STAR_GUITAR } from './star-guitar';
import { STARSHIP } from './starship';
import { MINTERATOR } from './minterator';
import { AROUND_THE_WORLD } from './around-the-world';
import { HALLOWEEN } from './halloween';

/** The rides: the train, the starship and the ghost train (a window true to life, something else across the aisle), and the Minterator. */
export const PACKS: Pack[] = [STAR_GUITAR, STARSHIP, HALLOWEEN, MINTERATOR];
/** Kept, but off the menu until it gets its twist: reachable with ?pack=around-the-world. */
export const HIDDEN_PACKS: Pack[] = [AROUND_THE_WORLD];
/** Old ids that still open a pack (old links and bookmarks keep working). */
export const PACK_ALIASES: Record<string, string> = { 'non-gondry': 'minterator' };

/** The pack with this id (or an old id for it), on the menu or hidden; undefined if there is none. */
export function findPack(id: string | null | undefined): Pack | undefined {
  if (!id) return undefined;
  const real = PACK_ALIASES[id] ?? id;
  return [...PACKS, ...HIDDEN_PACKS].find(p => p.id === real);
}
