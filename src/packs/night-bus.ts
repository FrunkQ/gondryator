import type { Pack } from './types';

// Vehicle 3: the top deck of a night bus through the city at blue hour. Bollards on the hats,
// street lamps on the kick, bus shelters on the snare, shopfronts and diners on the bass, tower
// blocks that rise and fall with the melody, skyscrapers on the pads. A lit footbridge crosses
// the road at each new section, and a tram glides past in the breakdown.
const SAME = <T>(v: T) => ({ high: v, neon: v, late: v });

export const NIGHT_BUS: Pack = {
  id: 'night-bus',
  name: 'Night bus (top deck)',
  credits: 'A city at night from the top deck, in the spirit of Star Guitar. All scenery is original.',
  vehicle: 'bus',
  otherSide: 'trippy',
  viewpoint: 'fixed-window',
  rig: { type: 'lateral-rail', speed: 10, speedByEnergy: 0.25, eyeHeight: 4.1, maxYaw: 70, lookYaw: 180, startYaw: 8, startPitch: -6, maxPitch: 28, fov: 52 },
  spawnMode: 'pass-by',
  layers: [
    { id: 'fence', depth: 5.2, scale: 1, scaleByVel: 0.2, models: SAME(['bollard']) },
    { id: 'trackside', depth: 5.6, scale: 1, scaleByVel: 0.1, models: SAME(['street-lamp']) },
    { id: 'near', depth: 7.6, scale: 1, scaleByVel: 0.1, models: SAME(['bus-shelter']) },
    { id: 'mid', depth: 13, depthJitter: 0.5, scale: 1, scaleByVel: 0.1, lengthByDur: 0.9,
      models: { high: ['shopfront', 'shopfront', 'neon-diner'], neon: ['neon-diner', 'shopfront'], late: ['shopfront'] },
      tints: { high: ['#ffffff', '#e8e0ff'], neon: ['#ffffff', '#ffe0f0', '#e0fff8'], late: ['#ffffff', '#d8e4ff'] } },
    { id: 'row', depth: 45, depthJitter: 3, scale: 1, scaleByVel: 0.1, pitchCenter: 64, heightPerSemitone: 0.06, models: SAME(['tower-block']),
      tints: SAME(['#ffffff', '#e6e9f0', '#f0e8e0']) },
    { id: 'far', depth: 260, depthJitter: 60, scale: 1, scaleByVel: 0.25, models: SAME(['skyscraper']) },
  ],
  mapping: [
    { match: { stem: 'drums', kind: 'kick' }, layer: 'trackside', tier: 1 },
    { match: { stem: 'drums', kind: 'snare' }, layer: 'near', tier: 2 },
    { match: { stem: 'drums', kind: 'hat' }, layer: 'fence', tier: 3 },
    { match: { stem: 'bass', kind: 'note' }, layer: 'mid', tier: 2 },
    { match: { stem: 'other', kind: 'note', minDur: 1.2 }, layer: 'far', tier: 2 },
    { match: { stem: 'vocals', kind: 'note' }, layer: 'row', tier: 1 },
    { match: { stem: 'other', kind: 'note' }, layer: 'row', tier: 1 },
  ],
  ambient: [
    { depthMin: 22, depthMax: 34, density: { high: 2, neon: 2, late: 1.5 }, models: SAME(['plane-tree']), scale: [0.8, 1.1] },
  ],
  idle: [
    { model: 'kerb', depth: 4.9, spacing: 30 },
    { model: 'parked-car', depth: 3.4, spacing: 9, jitter: 3, chance: 0.55 },
    { model: 'street-lamp', depth: 5.6, spacing: 28, chance: 0.6 },
    { model: 'shopfront', depth: 13.5, spacing: 15, chance: 0.85 },
  ],
  themes: [
    { name: 'high', ground: { base: '#3b3b3e', stripes: ['#38383b', '#3e3d40'] } },
    { name: 'neon', ground: { base: '#36363a', stripes: ['#333337', '#3a393d'] } },
    { name: 'late', ground: { base: '#343438', stripes: ['#313135', '#37373b'] } },
  ],
  themeCycle: ['high', 'neon', 'late'],
  haze: 0.2,
  light: [
    { at: 0.0, sky: '#2b3f6a', horizon: '#c97a5a', sun: '#ffb27a', sunIntensity: 0.9, sunElevation: 2 },
    { at: 0.4, sky: '#1d2b52', horizon: '#6b5a7a', sun: '#8aa0d8', sunIntensity: 0.45, sunElevation: 1 },
    { at: 1.0, sky: '#121a36', horizon: '#3d3a5c', sun: '#8aa0d8', sunIntensity: 0.35, sunElevation: 1 },
  ],
  title: { template: 'station-board' },
  fx: { cycle: ['clean', 'prism', 'trip', 'fold', 'kaleido', 'thermal', 'echo', 'liquid'], bySection: { breakdown: 'liquid', intro: 'clean' } },
  sectionEvents: { onNewSection: 'footbridge', onBreakdown: 'tram' },
  window: { width: 1.5, height: 1.15, bottom: -0.6, pillar: 0.14, distance: 0.75, frame: '#1f2326', wall: '#40323f' },
};
