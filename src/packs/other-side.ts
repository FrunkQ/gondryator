import type { Pack } from './types';

// The other window of the Star Guitar carriage. The main window stays faithful to the original
// video; this side is where the train goes somewhere it never could: lavender country under a
// Provençal sky, then out between the planets. Same score, same mapping, same beat-sync, just
// other worlds. It alternates world at every section of the track.
export const OTHER_SIDE: Pack = {
  id: 'other-side',
  name: 'The other window',
  credits: '',
  viewpoint: 'fixed-window',
  rig: { type: 'lateral-rail', speed: 24, eyeHeight: 2.7, maxYaw: 70, maxPitch: 28, fov: 52 },
  spawnMode: 'pass-by',
  layers: [
    { id: 'fence', depth: 4.6, depthJitter: 0.1, scale: 0.9, scaleByVel: 0.3,
      models: { provence: ['vine-stake'], cosmos: ['beacon'] } },
    { id: 'trackside', depth: 7.2, scale: 0.95, scaleByVel: 0.15,
      models: { provence: ['poplar'], cosmos: ['asteroid'] } },
    { id: 'near', depth: 19, depthJitter: 3, scale: 0.9, scaleByVel: 0.3,
      models: { provence: ['sunflowers', 'hay-bales', 'stone-hut'], cosmos: ['satellite', 'asteroid'] },
      tints: { provence: ['#ffffff', '#fff1d6'], cosmos: ['#ffffff', '#ffe0f0', '#e0f0ff'] } },
    { id: 'mid', depth: 38, depthJitter: 3, scale: 1, scaleByVel: 0.25, lengthByDur: 0.85,
      models: { provence: ['lavender-row', 'lavender-row', 'farmhouse'], cosmos: ['space-station'] },
      tints: { provence: ['#ffffff', '#f4e8ff'], cosmos: ['#ffffff', '#ffe6c8'] } },
    { id: 'row', depth: 62, depthJitter: 2, scale: 1, scaleByVel: 0.1, pitchCenter: 64, heightPerSemitone: 0.09,
      models: { provence: ['cypress', 'poplar'], cosmos: ['crystal'] },
      tints: { provence: ['#ffffff'], cosmos: ['#ffffff', '#ffc8f0', '#c8ffe8', '#fff0b0'] } },
    { id: 'far', depth: 170, depthJitter: 30, scale: 1, scaleByVel: 0.3,
      models: { provence: ['chateau', 'church-tower', 'hill'], cosmos: ['gas-giant', 'ringed-planet', 'moon'] },
      tints: { provence: ['#ffffff'], cosmos: ['#ffffff', '#c8d8ff', '#ffd0c0'] } },
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
    { depthMin: 20, depthMax: 140, density: { provence: 3, cosmos: 2.5 },
      models: { provence: ['cypress', 'tree', 'bush'], cosmos: ['asteroid'] }, scale: [0.7, 1.6] },
  ],
  idle: [],
  themes: [
    { name: 'provence', ground: { base: '#a8aa68', stripes: ['#a8aa68'] } },
    { name: 'cosmos', ground: { base: '#000000', stripes: ['#000000'] } },
  ],
  themeCycle: ['provence', 'cosmos'],
  themeBySection: { intro: 'provence' },
  light: [],
  title: { template: 'station-board' },
  window: { width: 1.25, height: 0.82, bottom: -0.32, pillar: 0.5, distance: 0.75, frame: '#7d8483', wall: '#c4bdac' },
};
