import type { Pack } from './types';
import { STARSHIP } from './starship';

// The starship's other side. Out of the main canopy, real space; out of this side, the ship flies
// through places space never had: a reef adrift among the stars (jellyfish on the hats, anemones
// and coral on the snare, whales gliding by on the bass) and a crystal canyon (geodes, spires,
// halo gates). The psychedelic vortex turns behind it all, and on breaks and drops the disco takes
// the whole side over (render/otherside.ts). Same score, same mapping, same beat-sync.
const BOTH = <T>(reef: T, canyon: T) => ({ reef, canyon });
const NEON = ['#ff8ad8', '#8affd0', '#ffe070', '#9ab0ff'];

export const SHIP_OTHER_SIDE: Pack = {
  ...STARSHIP,
  id: 'starship-other-side',
  name: 'The starship\'s other side',
  sectionEvents: undefined,
  layers: [
    { id: 'fence', depth: 6, depthJitter: 0.3, scale: 1, scaleByVel: 0.4, models: BOTH(['lantern-buoy'], ['nav-light']) },
    { id: 'trackside', depth: 10, scale: 1, scaleByVel: 0.2, models: BOTH(['jellyfish'], ['crystal']), tints: BOTH(NEON, ['#ffffff', '#c8b0ff']) },
    { id: 'near', depth: 24, depthJitter: 4, scale: 1, scaleByVel: 0.35,
      models: BOTH(['anemone', 'coral-fan', 'anemone', 'jellyfish'], ['geode', 'crystal', 'halo-gate']),
      tints: BOTH(['#ffffff', '#ffd0f0', '#d0fff0'], ['#ffffff', '#e0c8ff', '#c8f0ff']) },
    { id: 'mid', depth: 50, depthJitter: 4, scale: 1.2, scaleByVel: 0.2,
      models: BOTH(['space-whale', 'coral-fan', 'space-whale'], ['geode', 'light-spire', 'star-dock']),
      tints: BOTH(['#ffffff', '#ffd8f0', '#c8f0ff'], ['#ffffff', '#e8d0ff']) },
    { id: 'row', depth: 85, depthJitter: 3, scale: 1, scaleByVel: 0.1, pitchCenter: 64, heightPerSemitone: 0.08,
      models: BOTH(['jellyfish', 'coral-fan'], ['light-spire', 'crystal']), tints: BOTH(NEON, NEON) },
    { id: 'far', depth: 320, depthJitter: 60, scale: 1.5, scaleByVel: 0.3,
      models: BOTH(['space-whale', 'gas-giant'], ['ringed-planet', 'moon', 'gas-giant']),
      tints: BOTH(['#ffffff', '#ffc8f0', '#c8ffe8'], ['#ffffff', '#c8d8ff', '#ffd0f0']) },
  ],
  ambient: [
    { depthMin: 30, depthMax: 220, density: BOTH(3, 4), models: BOTH(['lantern-buoy', 'jellyfish', 'asteroid'], ['crystal', 'asteroid', 'asteroid-high']), scale: [0.6, 1.6] },
  ],
  ridges: [
    { pitch: 'leadPitch', depth: 60, spacing: 9, minDur: 0.45, pitchCenter: 69, float: { y: 9, perSemitone: 0.55 },
      models: BOTH(['light-ribbon'], ['light-ribbon']), tints: BOTH(['#ff8ad8', '#8affd0'], ['#c8b0ff', '#8ad8ff']) },
  ],
  idle: [
    { model: 'lantern-buoy', depth: 6, spacing: 9 },
    { model: 'jellyfish', depth: 26, spacing: 50, jitter: 30, chance: 0.6 },
  ],
  themes: [
    { name: 'reef', ground: { base: '#000000', stripes: ['#000000'] } },
    { name: 'canyon', ground: { base: '#000000', stripes: ['#000000'] } },
  ],
  themeCycle: ['reef', 'canyon'],
  themeBySection: { intro: 'reef' },
};
