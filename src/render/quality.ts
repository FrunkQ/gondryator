// The detail governor's settings: how much the rides draw, shared by everything that spawns.
// World.adaptQuality moves the level with the frame rate (resolution first, then detail), and a
// light machine (the dynamometer, ui/dyno.ts) starts lower. Each knob is cheap to change mid-ride:
// nothing here rebuilds a shader.
//   3 everything   2 fewer particles   1 fewer particles, thinner background scenery
//   0 the bare ride: a fifth of the particles, half the background
export const QUALITY = { level: 3, particles: 1, density: 1 };

const LEVELS = [
  { particles: 0.2, density: 0.5 },
  { particles: 0.4, density: 0.7 },
  { particles: 0.65, density: 1 },
  { particles: 1, density: 1 },
];

export function setQualityLevel(level: number) {
  QUALITY.level = Math.max(0, Math.min(3, Math.round(level)));
  Object.assign(QUALITY, LEVELS[QUALITY.level]);
}

/** Keep this many of n (particles), at least one. */
export const fewer = (n: number) => Math.max(1, Math.round(n * QUALITY.particles));

/** Whether a background object keyed by `h` (any stable hash) is drawn at this density. */
export const keep = (h: number) => ((h >>> 0) % 1000) / 1000 < QUALITY.density;
