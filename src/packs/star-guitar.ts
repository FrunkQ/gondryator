import type { Pack } from './types';

// Pack 1: a homage to Michel Gondry's video for The Chemical Brothers' "Star Guitar" (2002).
// All models are original and procedural. Kick -> catenary poles, snare -> sheds and walls,
// hats -> fence posts, bass -> warehouses and farmhouses, lead -> a row of buildings whose
// heights follow the melody, pads -> silos, cooling towers and church towers on the horizon.
export const STAR_GUITAR: Pack = {
  id: 'star-guitar',
  name: 'Star Guitar (train window)',
  credits: "In homage to Michel Gondry's Star Guitar for The Chemical Brothers (2002). All scenery is original.",
  inspiration: { title: 'The Chemical Brothers - Star Guitar (Official Music Video)', url: 'https://www.youtube.com/watch?v=0S43IwBF0uM' },
  vehicle: 'train',
  otherSide: 'other-side',
  viewpoint: 'fixed-window',
  rig: { type: 'lateral-rail', speed: 24, speedByEnergy: 0.25, eyeHeight: 2.7, maxYaw: 70, lookYaw: 180, startYaw: -16, startPitch: 2, maxPitch: 28, fov: 52 },
  spawnMode: 'pass-by',
  layers: [
    { id: 'fence', depth: 4.6, depthJitter: 0.1, scale: 0.9, scaleByVel: 0.3,
      models: { industrial: ['fence-post'], town: ['marker-post', 'fence-post'], country: ['vine-stake', 'fence-post'] } },
    { id: 'trackside', depth: 7.2, scale: 0.92, scaleByVel: 0.12,
      models: { industrial: ['catenary-pole'], town: ['catenary-pole'], country: ['catenary-pole'] } },
    { id: 'near', depth: 19, depthJitter: 3, scale: 0.8, scaleByVel: 0.3,
      models: {
        // Mostly green, with a building now and then (repeats weight the pick: same sound, same object).
        industrial: ['tree-clump', 'shed', 'hedge', 'birch-clump', 'container', 'allotment', 'tree-clump', 'hedge', 'garages', 'birch-clump', 'signal-box', 'hedge'],
        town: ['tree-clump', 'garden', 'hedge', 'cottage', 'birch-clump', 'allotment', 'tree-clump', 'garden', 'wall-house', 'hedge', 'birch-clump', 'hoarding'],
        // The countryside is fields, hedges and copses; the odd hut.
        country: ['field', 'tree-clump', 'hedge', 'hay-bales', 'field', 'birch-clump', 'hedge', 'tree-clump', 'field', 'stone-hut'],
      },
      tints: { industrial: ['#ffffff', '#d8e0e6', '#e8ddd0'], town: ['#ffffff', '#ffe9d6', '#f0f4ff'], country: ['#ffffff', '#f6ead2'] } },
    { id: 'mid', depth: 38, depthJitter: 3, scale: 0.9, scaleByVel: 0.25, lengthByDur: 0.85,
      models: { industrial: ['warehouse', 'tree-clump', 'tank', 'birch-clump', 'gravel-works', 'hedge', 'gasholder', 'tree-clump', 'terrace'], town: ['apartment', 'tree-clump', 'terrace', 'garden', 'warehouse', 'birch-clump'], country: ['tree-clump', 'field', 'hedge', 'farmhouse', 'tree-clump', 'field', 'birch-clump', 'barn', 'hedge', 'viaduct'] },
      tints: { industrial: ['#ffffff', '#dfe3e0', '#f2e6dc'], town: ['#ffffff', '#ffe4c8', '#ffd9cc', '#f7f0d8'], country: ['#ffffff', '#ffeccc'] } },
    { id: 'row', depth: 62, depthJitter: 2, scale: 1, scaleByVel: 0.1, pitchCenter: 64, heightPerSemitone: 0.09,
      models: { industrial: ['factory-block', 'town-block'], town: ['town-block'], country: ['tree-line', 'cypress-row', 'tree-line'] },
      tints: { industrial: ['#ffffff', '#e6e2da'], town: ['#ffffff', '#ffe0c0', '#ffd0c0', '#fff2c8', '#e8f0ff'], country: ['#ffffff', '#fff0d0'] } },
    { id: 'far', depth: 170, depthJitter: 30, scale: 1, scaleByVel: 0.3,
      models: { industrial: ['cooling-tower', 'silo', 'chimney', 'pylon', 'water-tower'], town: ['church-tower', 'water-tower', 'silo', 'pylon'], country: ['hill', 'church-tower', 'water-tower'] } },
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
    { depthMin: 12, depthMax: 120, density: { industrial: 2.2, town: 2.8, country: 5 },
      models: { industrial: ['tree', 'bush', 'birch-clump', 'bush'], town: ['plane-tree', 'tree', 'bush', 'birch-clump'], country: ['tree', 'cypress', 'bush', 'plane-tree', 'tree-clump'] }, scale: [0.8, 1.3] },
    { depthMin: 600, depthMax: 900, density: { industrial: 0.35, town: 0.35, country: 0.5 },
      models: { industrial: ['far-hill'], town: ['far-hill'], country: ['far-hill'] }, scale: [0.7, 1.4] },
  ],
  // Held and sliding notes: the melody as a mountain ridge on the horizon, the bass as low hills.
  ridges: [
    { pitch: 'leadPitch', depth: 190, spacing: 9, minDur: 0.45, pitchCenter: 69, heightPerSemitone: 0.06, minScale: 0.35, maxScale: 2.2,
      models: { industrial: ['ridge'], town: ['ridge'], country: ['ridge'] }, tints: { industrial: ['#d8d2c4'], town: ['#ffffff'], country: ['#f0f4e8'] } },
    { pitch: 'bassPitch', depth: 135, spacing: 8, minDur: 0.5, pitchCenter: 40, heightPerSemitone: 0.07, minScale: 0.3, maxScale: 2,
      models: { industrial: ['ridge-low'], town: ['ridge-low'], country: ['ridge-low'] }, tints: { industrial: ['#c8c4a8'], town: ['#ffffff'], country: ['#ffffff'] } },
  ],
  idle: [
    { model: 'catenary-pole', depth: 7.2, spacing: 48 },
    { model: 'fence-post', depth: 4.6, spacing: 6 },
    { model: 'shed', depth: 19, spacing: 70, jitter: 30, chance: 0.5 },
    { model: 'warehouse', depth: 40, spacing: 90, jitter: 40, chance: 0.6 },
    { model: 'silo', depth: 170, spacing: 260, jitter: 80, chance: 0.7 },
  ],
  themes: [
    { name: 'industrial', ground: { base: '#a39d88', stripes: ['#9c9783', '#aea791', '#a0a07c', '#b4ab90', '#93997a'] } },
    { name: 'town', ground: { base: '#a4a678', stripes: ['#98a46c', '#b6ae82', '#c0b48e', '#9cab74'] } },
    { name: 'country', ground: { base: '#a8aa68', stripes: ['#c4b670', '#98a85c', '#d2bd7e', '#8aa058', '#a597ba'], rows: true } },
  ],
  themeCycle: ['industrial', 'town', 'country'],
  themeBySection: { breakdown: 'country', intro: 'industrial' },
  haze: 0.6,
  light: [
    { at: 0.0, sky: '#9fb6cf', horizon: '#ecdccb', sun: '#ffdcb8', sunIntensity: 2.0, sunElevation: 14, fog: 0.0016 },
    { at: 0.3, sky: '#8fb2d6', horizon: '#dfe4e6', sun: '#fff4e2', sunIntensity: 2.2, sunElevation: 35 },
    { at: 0.6, sky: '#86aed8', horizon: '#e2e2d8', sun: '#fff2d8', sunIntensity: 2.3, sunElevation: 48, fog: 0.0012 },
    { at: 0.85, sky: '#8a9fc0', horizon: '#f0c99a', sun: '#ffc88a', sunIntensity: 1.8, sunElevation: 15 },
    { at: 1.0, sky: '#6f7fa8', horizon: '#f3a774', sun: '#ff9e60', sunIntensity: 1.3, sunElevation: 4, fog: 0.0018 },
  ],
  title: { template: 'station-board' },
  // The main window stays photographic, like the original; the looks bloom as you turn round to the
  // other window, and only show out of it (see FxDirector.split).
  fx: { cycle: ['clean', 'prism', 'hyper', 'trip', 'fold', 'tunnel', 'kaleido', 'thermal', 'echo', 'liquid'], bySection: { breakdown: 'liquid', intro: 'clean' } },
  sectionEvents: { onNewSection: 'overpass', onBreakdown: 'train-car' },
  window: { width: 2.1, height: 1.1, bottom: -0.47, pillar: 0.26, distance: 1.0, frame: '#7d8483', wall: '#c4bdac' },
};
