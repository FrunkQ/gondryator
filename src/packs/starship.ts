import type { Pack } from './types';
import { VIEW } from './views';

// The starship: the same idea as the train, flown through space. An open canopy shows far more
// of the sky; out of the main side, stars, nebulae and traffic keep time with the music; out of
// the other side, a psychedelic double of it all spinning in a vortex. Kick -> lattice struts
// with a light ring at eye level, snare -> cargo pods and tumbling rocks, hats -> nav lights,
// bass -> freighters as long as the note, melody -> spires of light at its pitch, pads -> planets.
// At every new section the ship jumps through a ring gate; in the breakdown, a star-liner convoy.
// Now and then a rare find drifts past: a derelict, a listening post, a solar sail, a space whale.
// It waits for launch beside a floating screen counting down (render/world.ts launchScreen), and
// its other side flies through a reef and a crystal canyon (packs/ship-other-side.ts).
const ALL = <T>(v: T) => ({ nebula: v, belt: v, deep: v });

export const STARSHIP: Pack = {
  id: 'starship',
  name: 'Starship (open cockpit)',
  credits: 'An original ride in the spirit of the Gondryator. All models are procedural.',
  vehicle: 'ship',
  otherSide: 'trippy',
  viewpoint: 'cockpit',
  rig: { ...VIEW.window, type: 'lateral-rail', speed: 34, speedByEnergy: 0.4, eyeHeight: 4, maxYaw: 75, lookYaw: 180, maxPitch: 35, fov: 62 },
  spawnMode: 'pass-by',
  layers: [
    { id: 'fence', depth: 6, depthJitter: 0.2, scale: 1, scaleByVel: 0.4, models: ALL(['nav-light']) },
    { id: 'trackside', depth: 10, scale: 1, scaleByVel: 0.1, models: ALL(['gate-strut']) },
    { id: 'near', depth: 24, depthJitter: 4, scale: 1, scaleByVel: 0.35,
      models: { nebula: ['cargo-pod', 'satellite', 'asteroid-big'], belt: ['asteroid-big', 'asteroid-big', 'cargo-pod'], deep: ['satellite', 'cargo-pod', 'halo-gate'] },
      tints: ALL(['#ffffff', '#ffe8d0', '#e0f0ff']),
      rare: { chance: 0.03, models: ALL(['derelict']) } },
    { id: 'mid', depth: 50, depthJitter: 4, scale: 1, scaleByVel: 0.2, lengthByDur: 0.85, stretch: ['freighter'],
      models: { nebula: ['freighter', 'freighter', 'star-dock'], belt: ['freighter'], deep: ['star-dock', 'space-station', 'freighter'] },
      tints: ALL(['#ffffff', '#e6ecf4', '#f4e6dc']),
      rare: { chance: 0.04, models: ALL(['dish-array', 'derelict']) } },
    { id: 'row', depth: 85, depthJitter: 3, scale: 1, scaleByVel: 0.1, pitchCenter: 64, heightPerSemitone: 0.08,
      models: { nebula: ['light-spire'], belt: ['crystal', 'light-spire'], deep: ['light-spire', 'crystal'] },
      tints: ALL(['#ffffff', '#ffc8f0', '#c8ffe8', '#fff0b0']) },
    { id: 'far', depth: 320, depthJitter: 60, scale: 1.5, scaleByVel: 0.3,
      models: { nebula: ['ringed-planet', 'gas-giant'], belt: ['moon', 'gas-giant'], deep: ['gas-giant', 'ringed-planet', 'moon'] },
      tints: ALL(['#ffffff', '#c8d8ff', '#ffd0c0']),
      // Rare finds: a solar sail, a space whale, sometimes.
      rare: { chance: 0.1, models: ALL(['solar-sail', 'space-whale']) } },
  ],
  mapping: [
    { match: { stem: 'drums', kind: 'kick' }, layer: 'trackside', tier: 1 },
    { match: { stem: 'drums', kind: 'snare' }, layer: 'near', tier: 2 },
    { match: { stem: 'drums', kind: 'hat' }, layer: 'fence', tier: 3 },
    { match: { stem: 'bass', kind: 'note' }, layer: 'mid', tier: 2 },
    { match: { stem: 'other', kind: 'note', minDur: 1.2 }, layer: 'far', tier: 2, every: 3 },
    { match: { stem: 'vocals', kind: 'note' }, layer: 'row', tier: 1 },
    { match: { stem: 'other', kind: 'note' }, layer: 'row', tier: 1 },
  ],
  ambient: [
    { depthMin: 30, depthMax: 220, density: { nebula: 2, belt: 7, deep: 1.5 },
      models: ALL(['asteroid', 'asteroid-high', 'asteroid-low']), scale: [0.6, 1.8] },
    { depthMin: 600, depthMax: 900, density: ALL(0.25), models: ALL(['comet']), scale: [1.5, 3] },
  ],
  // Held and sliding notes as ribbons of light hanging in space: the melody high, the bass low.
  ridges: [
    { pitch: 'leadPitch', depth: 60, spacing: 9, minDur: 0.45, pitchCenter: 69, float: { y: 9, perSemitone: 0.55 },
      models: ALL(['light-ribbon']), tints: ALL(['#ffffff', '#ffc8f0', '#c8ffe8']) },
    { pitch: 'bassPitch', depth: 40, spacing: 9, minDur: 0.5, pitchCenter: 40, float: { y: 1.5, perSemitone: 0.3 },
      models: ALL(['light-ribbon']), tints: ALL(['#ffb070', '#ff8060']) },
  ],
  idle: [
    { model: 'gate-strut', depth: 10, spacing: 60 },
    { model: 'nav-light', depth: 6, spacing: 8 },
    { model: 'asteroid-big', depth: 26, spacing: 70, jitter: 30, chance: 0.5 },
    { model: 'freighter', depth: 52, spacing: 120, jitter: 40, chance: 0.5 },
  ],
  themes: [
    { name: 'nebula', ground: { base: '#000000', stripes: ['#000000'] } },
    { name: 'belt', ground: { base: '#000000', stripes: ['#000000'] } },
    { name: 'deep', ground: { base: '#000000', stripes: ['#000000'] } },
  ],
  themeCycle: ['nebula', 'belt', 'deep'],
  themeBySection: { breakdown: 'deep' },
  // A low, distant sun: hard light on the hulls, and most of the windows lit.
  light: [
    { at: 0.0, sky: '#000000', horizon: '#000000', sun: '#fff1dc', sunIntensity: 2.4, sunElevation: 5, fog: 0 },
    { at: 0.5, sky: '#000000', horizon: '#000000', sun: '#ffe6c8', sunIntensity: 2.6, sunElevation: 12, fog: 0 },
    { at: 1.0, sky: '#000000', horizon: '#000000', sun: '#ffc8a0', sunIntensity: 2.2, sunElevation: 3, fog: 0 },
  ],
  title: { template: 'launch-screen' },
  end: { template: 'arrival-screen' },
  // The star view stays clean (the warp jumps aside); the looks belong to the other side.
  fx: { cycle: ['trip', 'hyper', 'kaleido', 'tunnel', 'prism', 'fold', 'echo', 'thermal'], bySection: { intro: 'hyper', breakdown: 'tunnel' } },
  sectionEvents: { onNewSection: 'ring-gate', onBreakdown: 'star-liner', breakdownDepth: 16 },
  window: { width: 3, height: 2, bottom: -1, pillar: 0.05, distance: 1.85, frame: '#9aa3ad', wall: '#3a4048' },
};
