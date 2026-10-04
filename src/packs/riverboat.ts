import type { Pack } from './types';

// Vehicle 2: a glass-roofed riverboat down the Seine. Mooring posts on the hats, quay lamps on the
// kick, houseboats on the snare, Haussmann fronts on the bass, a roofline that hums the melody, and
// domes and an iron tower on the pads. A stone bridge passes overhead at every new section.
const SAME = <T>(v: T) => ({ quai: v, ile: v, soir: v });

export const RIVERBOAT: Pack = {
  id: 'riverboat',
  name: 'Riverboat (Paris)',
  credits: 'Down the river by boat, in the spirit of Star Guitar. All scenery is original.',
  vehicle: 'boat',
  otherSide: 'trippy',
  viewpoint: 'fixed-window',
  rig: { type: 'lateral-rail', speed: 7, speedByEnergy: 0.2, eyeHeight: 3.4, maxYaw: 70, lookYaw: 180, startYaw: 8, startPitch: 2, maxPitch: 28, fov: 52 },
  spawnMode: 'pass-by',
  layers: [
    { id: 'fence', depth: 26.4, scale: 1, scaleByVel: 0.2, models: SAME(['mooring-post']) },
    { id: 'trackside', depth: 27.6, scale: 1, scaleByVel: 0.1, models: SAME(['quay-lamp']) },
    { id: 'near', depth: 19, depthJitter: 1, scale: 1, scaleByVel: 0.15, models: SAME(['houseboat']),
      tints: SAME(['#ffffff', '#ffe8e0', '#e0f0ff', '#f0ffe8']) },
    { id: 'mid', depth: 58, depthJitter: 3, scale: 1, scaleByVel: 0.15, lengthByDur: 0.9, y: 2.5, models: SAME(['haussmann']),
      tints: SAME(['#ffffff', '#fff2dc', '#f4efe6']) },
    { id: 'row', depth: 84, depthJitter: 2, scale: 1, scaleByVel: 0.1, pitchCenter: 64, heightPerSemitone: 0.06, y: 2.5, models: SAME(['haussmann-row']),
      tints: SAME(['#ffffff', '#fff0d8']) },
    { id: 'far', depth: 380, depthJitter: 60, scale: 1, scaleByVel: 0.2, y: 2.5,
      models: { quai: ['gilded-dome', 'iron-tower'], ile: ['gilded-dome', 'church-tower'], soir: ['iron-tower', 'gilded-dome'] } },
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
    { depthMin: 32, depthMax: 46, density: { quai: 3, ile: 4, soir: 3 }, models: SAME(['plane-tree-quay']), scale: [0.85, 1.2] },
  ],
  idle: [
    { model: 'quay', depth: 26, spacing: 40 },
    { model: 'quay-lamp', depth: 27.6, spacing: 30, chance: 0.5 },
    { model: 'mooring-post', depth: 26.4, spacing: 12, chance: 0.6 },
    { model: 'haussmann', depth: 60, spacing: 17, chance: 0.8 },
  ],
  themes: [
    { name: 'quai', ground: { base: '#3f5a5c', stripes: ['#3f5a5c'], water: true } },
    { name: 'ile', ground: { base: '#3a5560', stripes: ['#3a5560'], water: true } },
    { name: 'soir', ground: { base: '#3d4f5a', stripes: ['#3d4f5a'], water: true } },
  ],
  themeCycle: ['quai', 'ile', 'soir'],
  haze: 0.35,
  light: [
    { at: 0.0, sky: '#9fb6cf', horizon: '#ecdccb', sun: '#ffe6c8', sunIntensity: 2.0, sunElevation: 22 },
    { at: 0.5, sky: '#8fb2d6', horizon: '#e2e4e0', sun: '#fff4e2', sunIntensity: 2.2, sunElevation: 38 },
    { at: 0.85, sky: '#8a9fc0', horizon: '#f0c99a', sun: '#ffc88a', sunIntensity: 1.8, sunElevation: 12 },
    { at: 1.0, sky: '#6f7fa8', horizon: '#f3a774', sun: '#ff9e60', sunIntensity: 1.3, sunElevation: 3 },
  ],
  title: { template: 'station-board' },
  fx: { cycle: ['clean', 'prism', 'trip', 'fold', 'kaleido', 'thermal', 'echo', 'liquid'], bySection: { breakdown: 'liquid', intro: 'clean' } },
  sectionEvents: { onNewSection: 'stone-bridge', onBreakdown: 'barge' },
  window: { width: 2.6, height: 1.15, bottom: -0.5, pillar: 0.1, distance: 1.0, frame: '#39434c', wall: '#e9e5dc' },
};
