import type { Pack } from './types';

// Pack 2: a homage to Michel Gondry's video for Daft Punk's "Around the World" (1997).
// Perform mode: a fixed cast on a round stage acts out the score, one troupe per instrument,
// filmed by a camera on a slow orbit. All characters are original: no helmets, no likenesses.
export const AROUND_THE_WORLD: Pack = {
  id: 'around-the-world',
  name: 'Around the World (stage)',
  credits: "In homage to Michel Gondry's video for Daft Punk's Around the World (1997). All characters are original.",
  inspiration: { title: 'Daft Punk - Around The World (Official Music Video Remastered)', url: 'https://www.youtube.com/watch?v=K0HSD_i2DvA' },
  viewpoint: 'wraparound',
  rig: { type: 'orbit', orbitRadius: 21, orbitPeriod: 84, lookAtY: 2.2, speed: 0, eyeHeight: 7, maxYaw: 45, maxPitch: 25, fov: 48 },
  spawnMode: 'perform',
  layers: [],
  mapping: [
    { match: { stem: 'drums', kind: 'kick' }, layer: 'stompers', tier: 1, role: 'stomp' },
    { match: { stem: 'drums', kind: 'snare' }, layer: 'stompers', tier: 2, role: 'clap' },
    { match: { stem: 'drums', kind: 'hat' }, layer: 'hoppers', tier: 3 },
    { match: { stem: 'bass', kind: 'note' }, layer: 'climbers', tier: 2 },
    { match: { stem: 'other', kind: 'note', minDur: 1.2 }, layer: 'swimmers', tier: 2 },
    { match: { stem: 'vocals', kind: 'note' }, layer: 'walkers', tier: 1 },
    { match: { stem: 'other', kind: 'note' }, layer: 'walkers', tier: 1 },
  ],
  troupes: [
    // Drums: heavy, padded figures in the middle, stomping on kicks and clapping on snares.
    { id: 'stompers', style: 'stompers', count: 4, body: '#e8e2d6', accent: '#ff7a3c', at: { angle: 0, radius: 2.4, spread: 1.3 }, label: 'drums' },
    // Bass: thin figures on a staircase behind the centre, one step per bass note, height = pitch.
    { id: 'climbers', style: 'climbers', count: 4, body: '#2f8a6e', accent: '#a6ffd8', at: { angle: 180, radius: 6.5, spread: 0.95 }, label: 'bass' },
    // Lead: tin-toy robots with lamp eyes circling the stage, a step per note, arms by pitch.
    { id: 'walkers', style: 'walkers', count: 6, body: '#b9bcc6', accent: '#ffe066', at: { angle: 0, radius: 5.2, spread: 0 }, label: 'lead' },
    // Pads: swimmers in caps, arms turning in a slow wave, lifted by each chord.
    { id: 'swimmers', style: 'swimmers', count: 5, body: '#1f3c8c', accent: '#f3f3f3', at: { angle: 90, radius: 8.6, spread: 1.2 }, label: 'pads' },
    // Hats: a line of skinny dancers in visors; each hat hops the next one along.
    { id: 'hoppers', style: 'hoppers', count: 7, body: '#d23b6a', accent: '#111111', at: { angle: 270, radius: 8.6, spread: 0.9 }, label: 'hats' },
  ],
  stage: { floor: '#231f2c', ring: ['#ff5ea8', '#5ee0ff', '#ffd25e', '#9a7bff'], screen: '#15131c' },
  ambient: [],
  themes: [{ name: 'industrial', ground: { base: '#231f2c', stripes: ['#231f2c'] } }],
  themeCycle: ['industrial'],
  light: [
    { at: 0.0, sky: '#120f1c', horizon: '#2a2140', sun: '#ffe9f0', sunIntensity: 2.4, sunElevation: 62, fog: 0.004 },
    { at: 0.5, sky: '#0f1424', horizon: '#20304a', sun: '#e8f4ff', sunIntensity: 2.6, sunElevation: 70, fog: 0.004 },
    { at: 1.0, sky: '#1a0f1c', horizon: '#41203a', sun: '#ffd6c8', sunIntensity: 2.2, sunElevation: 55, fog: 0.005 },
  ],
  title: { template: 'station-board' },
  fx: { cycle: ['prism', 'trip', 'kaleido', 'fold', 'echo', 'thermal', 'liquid'], bySection: { breakdown: 'liquid' } },
  window: { width: 0, height: 0, bottom: 0, pillar: 0, distance: 0, frame: '#000000', wall: '#000000' },
};
