import type { Pack } from './types';

// The non-Gondry view :( -- no train and no window. You sit still inside a sphere of light and
// every kind of sound drives something different: flowers for notes, a wave for the melody,
// blasts for the bass, lightning on the snare, sparks on the hats, a fresh scene for every
// section and melody phrase. All of it lives in render/visualiser.ts; this pack only sets the
// view and the post-effects looks. Each song gets its own seed (R rerolls it).
export const NON_GONDRY: Pack = {
  id: 'non-gondry',
  name: 'The non-Gondry view :(',
  credits: 'No train, no window: a world of light around you, seeded by each song.',
  viewpoint: 'wraparound',
  vehicle: 'void',
  rig: { type: 'static', speed: 0, eyeHeight: 0, maxYaw: 180, maxPitch: 80, startPitch: 6, fov: 75 },
  spawnMode: 'visualise',
  layers: [],
  mapping: [],
  ambient: [],
  themes: [{ name: 'void', ground: { base: '#000000', stripes: ['#000000'] } }],
  themeCycle: ['void'],
  light: [{ at: 0, sky: '#000000', horizon: '#000000', sun: '#ffffff', sunIntensity: 0, sunElevation: 10, fog: 0 }],
  title: { template: 'station-board' },
  // The visualiser picks a look per scene; this cycle is the fallback before the music starts.
  fx: { cycle: ['trip', 'kaleido', 'liquid', 'prism', 'echo', 'thermal', 'fold', 'hyper', 'tunnel'] },
  window: { width: 0, height: 0, bottom: 0, pillar: 0, distance: 1, frame: '#000000', wall: '#000000' },
};
