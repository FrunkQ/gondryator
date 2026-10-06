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
  window: {
    startYaw: -16, startPitch: 2, hitAt: 'entry',
    // The note aligner (docs/VISUALISER.md, "When does a note hit?"). Looking back or square-on,
    // things land as they come into view; turning to look up the line obliquely, the hit drifts
    // to the middle of the view; looking right up the line, where things grow out of the distance
    // and whip past, it is the moment they leave. (Looking right back down the line, things only
    // enter, then shrink away, so the entry stays.)
    hitCurve: [[-90, 1], [-5, 1], [30, 0], [50, 0], [75, -0.85]],
  },
  /**
   * Facing forward (an open cart on a ride): the view rests well ahead along the line, and each
   * object arrives in the middle of that view as its sound plays, then sweeps past and away. You
   * see things coming, so the middle of the view is "now".
   */
  ahead: {
    startYaw: 50, startPitch: -3, hitAt: 'centre',
    // Facing forward, the middle is "now"; turned to the side it is the entry, as at a window;
    // looking straight down the line it is the moment things leave the view.
    hitCurve: [[-90, 1], [0, 1], [35, 0], [60, 0], [85, -0.85]],
  },
} as const satisfies Record<string, Partial<RigSpec>>;
