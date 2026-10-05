import type { Pack } from './types';

// The ghost train: a Halloween fairground ride. You sit in a little open cart on a track that rises
// and falls with the song (rig.coaster): each section has its own height, the track swoops on every
// change, plunges on the drop and bobs on the beat when it's loud. It waits at a bulb-lit
// ghost-train sign while the song is read, and comes back to it at the end.
//
// Out of the main side, the nightmare: a rain of blood, hellish country in the spirit of the old
// Flemish painters (cracked egg huts, giant fruit, fire, a tower with an eye), skittering spiders
// on the hi-hats, burning ruins, volcanoes on the horizon. Out of the other side, every Halloween
// cliché (packs/halloween.ts HALLOWEEN_OTHER): pumpkin patches, a haunted wood, a town street on
// Halloween night, a stormy coast with a lighthouse. Both sides throb on the kick and catch the
// lightning (pack.storm, render/storm.ts). Kick -> fire posts and gibbets, snare -> skull rocks,
// webs and egg huts, hats -> spiders, bass -> hell-mouths and bone arches, melody -> thorn spires
// and pillars of fire at its pitch, pads -> volcanoes and impossible towers. All models original.

const NIGHT = (base: string, stripes: string[]) => ({ base, stripes });

export const HALLOWEEN: Pack = {
  id: 'halloween',
  name: 'Ghost train (Halloween, example 1 shot)',
  credits: 'An original Halloween ride for the Gondryator. All models are procedural.',
  vehicle: 'cart',
  otherSide: 'halloween-other',
  viewpoint: 'fixed-window',
  rig: { type: 'lateral-rail', speed: 17, speedByEnergy: 0.45, eyeHeight: 1.3, maxYaw: 70, lookYaw: 180, startYaw: -16, startPitch: 2, maxPitch: 45, fov: 58,
    coaster: { low: 1.6, high: 15, bump: 0.7 } },
  spawnMode: 'pass-by',
  layers: [
    { id: 'fence', depth: 4.6, depthJitter: 0.6, scale: 0.9, scaleByVel: 0.5,
      models: { nightmare: ['spider', 'spider', 'bone-stake', 'spider', 'candle-stub'], inferno: ['spider', 'candle-stub', 'spider', 'bone-stake'] } },
    { id: 'trackside', depth: 7.2, scale: 0.95, scaleByVel: 0.15,
      models: { nightmare: ['gibbet', 'thorn-pole', 'flame-post'], inferno: ['flame-post', 'flame-post', 'thorn-pole'] } },
    { id: 'near', depth: 19, depthJitter: 3, scale: 0.9, scaleByVel: 0.3,
      models: {
        nightmare: ['skull-rock', 'web', 'egg-hut', 'dead-tree', 'giant-fruit', 'web', 'skull-rock', 'dead-tree'],
        inferno: ['burnt-house', 'fire-pit', 'skull-rock', 'egg-hut', 'burnt-house', 'giant-fruit'],
      },
      rare: { chance: 0.04, models: { nightmare: ['eye-tower', 'haunted-castle'], inferno: ['eye-tower'] } },
      tints: { nightmare: ['#ffffff', '#e8d8e0', '#d8e0d0'], inferno: ['#ffffff', '#ffd8c8'] } },
    { id: 'mid', depth: 38, depthJitter: 4, scale: 0.9, scaleByVel: 0.25,
      models: { nightmare: ['bone-arch', 'eye-tower', 'dead-tree', 'hell-mouth', 'dead-tree'], inferno: ['hell-mouth', 'burning-ruin', 'burnt-house', 'bone-arch'] },
      tints: { nightmare: ['#ffffff', '#e0d8e8'], inferno: ['#ffffff', '#ffe0d0'] } },
    { id: 'row', depth: 62, depthJitter: 3, scale: 0.9, scaleByVel: 0.1, pitchCenter: 64, heightPerSemitone: 0.07,
      models: { nightmare: ['thorn-spire', 'dead-tree', 'thorn-spire'], inferno: ['flame-pillar', 'thorn-spire', 'flame-pillar'] } },
    { id: 'far', depth: 170, depthJitter: 30, scale: 1, scaleByVel: 0.3,
      models: { nightmare: ['hell-tower', 'volcano', 'hell-tower'], inferno: ['volcano', 'hell-tower', 'volcano'] },
      rare: { chance: 0.08, models: { nightmare: ['haunted-castle'], inferno: ['haunted-castle'] } } },
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
    { depthMin: 12, depthMax: 120, density: { nightmare: 3, inferno: 2 },
      models: { nightmare: ['dead-tree', 'dead-tree', 'bone-stake', 'web'], inferno: ['dead-tree', 'fire-pit', 'candle-stub'] }, scale: [0.8, 1.4] },
  ],
  ridges: [
    { pitch: 'leadPitch', depth: 190, spacing: 9, minDur: 0.45, pitchCenter: 69, heightPerSemitone: 0.06, minScale: 0.35, maxScale: 2.2,
      models: { nightmare: ['lava-ridge'], inferno: ['lava-ridge'] }, tints: { nightmare: ['#3a2c34'], inferno: ['#40261e'] } },
    { pitch: 'bassPitch', depth: 135, spacing: 8, minDur: 0.5, pitchCenter: 40, heightPerSemitone: 0.07, minScale: 0.3, maxScale: 2,
      models: { nightmare: ['ridge-low'], inferno: ['ridge-low'] }, tints: { nightmare: ['#3a3040'], inferno: ['#40261e'] } },
  ],
  idle: [
    { model: 'candle-stub', depth: 4.6, spacing: 14, jitter: 6, chance: 0.6 },
    { model: 'spider', depth: 4.6, spacing: 9, jitter: 4, chance: 0.5 },
    { model: 'dead-tree', depth: 19, spacing: 36, jitter: 18, chance: 0.7 },
    { model: 'hell-tower', depth: 170, spacing: 240, jitter: 80, chance: 0.7 },
  ],
  themes: [
    { name: 'nightmare', ground: NIGHT('#1e1a1c', ['#231d20', '#1a1618', '#2a2026', '#1c1a1a', '#26201c']) },
    { name: 'inferno', ground: NIGHT('#24120e', ['#2e140e', '#1c0c0a', '#3a1a10', '#22100c', '#401c0e']) },
  ],
  themeCycle: ['nightmare', 'inferno'],
  themeBySection: { intro: 'nightmare', breakdown: 'inferno', drop: 'inferno', outro: 'nightmare' },
  // Midnight all the way: a low moon on the horizon, a bruised sky, thick murk.
  light: [
    { at: 0.0, sky: '#0c0814', horizon: '#2a1424', sun: '#e8dcc0', sunIntensity: 0.6, sunElevation: 2, fog: 0.0042 },
    { at: 0.5, sky: '#100818', horizon: '#3a1420', sun: '#ffd8b0', sunIntensity: 0.7, sunElevation: 3, fog: 0.0036 },
    { at: 1.0, sky: '#08060e', horizon: '#20101e', sun: '#d8d0c0', sunIntensity: 0.5, sunElevation: 1, fog: 0.0045 },
  ],
  storm: { rain: '#8a0a14', lightning: 0.8, pulse: '#a01020' },
  palettes: ['pumpkin', 'blood', 'toxic', 'moonlight', 'ultraviolet', 'embers'],
  title: { template: 'ghost-gate' },
  end: { template: 'ghost-gate' },
  // The main side stays as it is; the other window's looks are the darker ones.
  fx: { cycle: ['clean', 'film', 'echo', 'thermal', 'glitch', 'crt', 'liquid'], bySection: { intro: 'clean', breakdown: 'echo' } },
  window: { width: 2.1, height: 1.1, bottom: -0.47, pillar: 0.26, distance: 1.0, frame: '#6a2c12', wall: '#3a1a40' },
};

const ALL4 = <T>(v: T) => ({ patch: v, haunted: v, town: v, coast: v });

/** The other side of the ghost train: every Halloween cliché, in the dark. No disco takeover here. */
export const HALLOWEEN_OTHER: Pack = {
  ...HALLOWEEN,
  id: 'halloween-other',
  name: 'The other side of the ghost train',
  farTakeover: false,
  sectionEvents: undefined,
  layers: [
    { id: 'fence', depth: 4.6, depthJitter: 0.4, scale: 0.9, scaleByVel: 0.4,
      models: { patch: ['jack-o-lantern'], haunted: ['gravestone', 'iron-railing', 'gravestone'], town: ['jack-o-lantern', 'iron-railing'], coast: ['gravestone', 'jack-o-lantern'] } },
    { id: 'trackside', depth: 7.2, scale: 0.95, scaleByVel: 0.15,
      models: { patch: ['scarecrow', 'jack-o-lantern'], haunted: ['dead-tree', 'gas-lamp'], town: ['gas-lamp'], coast: ['gas-lamp', 'dead-tree'] } },
    { id: 'near', depth: 19, depthJitter: 3, scale: 0.9, scaleByVel: 0.3,
      models: {
        patch: ['pumpkin-patch', 'pumpkin-patch', 'scarecrow', 'ghost', 'pumpkin-patch', 'haunted-tree'],
        haunted: ['haunted-tree', 'gravestones', 'ghost', 'haunted-tree', 'gravestones'],
        town: ['town-house', 'town-house', 'ghost', 'pumpkin-patch', 'town-house'],
        coast: ['shipwreck', 'ghost', 'gravestones', 'shipwreck'],
      },
      rare: { chance: 0.04, models: ALL4(['bat-tree', 'witch-cottage']) } },
    { id: 'mid', depth: 38, depthJitter: 4, scale: 0.9, scaleByVel: 0.25,
      models: { patch: ['witch-cottage', 'pumpkin-patch', 'haunted-tree'], haunted: ['haunted-house', 'haunted-tree', 'witch-cottage'], town: ['town-house', 'haunted-house', 'town-house'], coast: ['lighthouse', 'sea-cliff', 'shipwreck'] } },
    { id: 'row', depth: 62, depthJitter: 3, scale: 0.9, scaleByVel: 0.1, pitchCenter: 64, heightPerSemitone: 0.07,
      models: { patch: ['giant-pumpkin', 'tall-pine'], haunted: ['tall-pine', 'tall-pine', 'bat-tree'], town: ['town-house'], coast: ['sea-cliff', 'tall-pine'] } },
    { id: 'far', depth: 170, depthJitter: 30, scale: 1, scaleByVel: 0.3,
      models: { patch: ['haunted-castle', 'church-spire'], haunted: ['haunted-castle', 'tall-pine'], town: ['church-spire', 'haunted-castle'], coast: ['lighthouse', 'sea-cliff'] } },
  ],
  ambient: [
    { depthMin: 14, depthMax: 120, density: { patch: 2.5, haunted: 5, town: 1.5, coast: 1 },
      models: { patch: ['dead-tree', 'bat-tree', 'jack-o-lantern'], haunted: ['tall-pine', 'dead-tree', 'bat-tree', 'tall-pine'], town: ['dead-tree', 'gas-lamp'], coast: ['dead-tree'] }, scale: [0.8, 1.4] },
  ],
  ridges: [
    { pitch: 'leadPitch', depth: 190, spacing: 9, minDur: 0.45, pitchCenter: 69, heightPerSemitone: 0.06, minScale: 0.35, maxScale: 2.2,
      models: ALL4(['ridge']), tints: ALL4(['#2a2436']) },
    { pitch: 'bassPitch', depth: 120, spacing: 8, minDur: 0.5, pitchCenter: 40, heightPerSemitone: 0.07, minScale: 0.3, maxScale: 2,
      models: ALL4(['ridge-low']), tints: ALL4(['#242a30']) },
  ],
  idle: [],
  themes: [
    { name: 'patch', ground: NIGHT('#1e1a12', ['#221c10']) },
    { name: 'haunted', ground: NIGHT('#141a14', ['#141a14']) },
    { name: 'town', ground: NIGHT('#1a1a1e', ['#1a1a1e']) },
    { name: 'coast', ground: NIGHT('#10161e', ['#10161e']) },
  ],
  themeCycle: ['haunted', 'patch', 'town', 'coast'],
  themeBySection: { intro: 'haunted', outro: 'patch' },
};
