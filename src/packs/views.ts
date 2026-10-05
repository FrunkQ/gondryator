import type { RigSpec } from './types';

// Viewing profiles: where the rider looks, and where on screen a note's object lands as it sounds.
// A ride spreads one into its rig (`rig: { ...VIEW.window, type: 'lateral-rail', ... }`) and can
// still override any field.
export const VIEW = {
  /**
   * Out of a side window (the train, the starship): the view rests a little behind square-on, and
   * each object comes into sight at the leading edge of the view as its sound plays, so whatever
   * slides away is what has already played.
   */
  window: { startYaw: -16, startPitch: 2, hitAt: 'entry' },
  /**
   * Facing forward (an open cart on a ride): the view rests well ahead along the line, and each
   * object arrives in the middle of that view as its sound plays, then sweeps past and away. You
   * see things coming, so the middle of the view is "now".
   */
  ahead: { startYaw: 50, startPitch: -3, hitAt: 'centre' },
} as const satisfies Record<string, Partial<RigSpec>>;
