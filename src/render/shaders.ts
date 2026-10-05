// @ts-nocheck -- TSL node typings are too strict for swizzles and number arguments.
// Procedural surface shading (TSL, runs on WebGPU and the WebGL2 fallback). Every scenery model
// carries a per-vertex surface id (`mat`); one shared material turns that id plus the model-space
// position into bricks, corrugated metal, roof tiles, concrete, glass, foliage, wood or straw.
// No textures are downloaded: the patterns are computed per pixel and fade out with distance
// (via screen-space derivatives) so far buildings never shimmer.
//
// The same material carries the "trip" layer: a music-driven, flowing cosine-palette paint that
// the effects director blends in on some sections.

import * as THREE from 'three/webgpu';
import {
  Fn, uniform, attribute, vec2, vec3, vec4, float, mix, select, abs, floor, fract, sin, cos, clamp, smoothstep, step,
  positionGeometry, normalGeometry, positionWorld, normalWorld, vertexColor, fwidth, length, max, min, dot, bumpMap, time,
  mx_noise_float, mx_worley_noise_float, hash, cameraPosition, pow, atan, acos, materialColor, viewportSharedTexture, screenUV, uv, positionLocal, normalLocal,
  asin, texture, exp, normalize, cross, If, Loop, mod, log2, sqrt,
} from 'three/tsl';

/** Uniforms shared by every procedural material and the post effects; the FX director writes them. */
export const U = {
  kick: uniform(0),     // 0..1, decays after each kick
  snare: uniform(0),
  hat: uniform(0),
  energy: uniform(0.5), // section energy 0..1
  trip: uniform(0),     // 0..1 how much the psychedelic paint replaces real surfaces
  tripFar: uniform(0),  // the same, for the far side of a two-window ride (z > the camera) only
  night: uniform(0),    // 0..1 how many windows are lit
  hue: uniform(0),      // palette phase, advances with the music
  beatPhase: uniform(0),// 0..1 within the current beat
  showTime: uniform(0),
  rain: uniform(0),      // 0..1 raindrops on the carriage windows
  speed: uniform(0),     // travel speed, m/s (drops streak backwards)
  // The world's palette (see PALETTES): starts as the rainbow, the FX director moves it per section.
  pa: uniform(new THREE.Vector3(0.5, 0.5, 0.5)), pb: uniform(new THREE.Vector3(0.5, 0.5, 0.5)),
  pc: uniform(new THREE.Vector3(1, 1, 1)), pd: uniform(new THREE.Vector3(0, 0.33, 0.67)),
};

export const SURF = {
  plaster: 0, brick: 1, concrete: 2, metal: 3, tile: 4, glass: 5, foliage: 6, wood: 7, straw: 8, grass: 9, stone: 10, paint: 11,
  gas: 12, rock: 13, glow: 14, lavender: 15,
} as const;

type Vec3 = [number, number, number];
/** A two-colour cosine palette: it swings from `x` to `y` and back. */
const two = (x: Vec3, y: Vec3): [Vec3, Vec3, Vec3, Vec3] => [
  [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2, (x[2] + y[2]) / 2], [(x[0] - y[0]) / 2, (x[1] - y[1]) / 2, (x[2] - y[2]) / 2], [0.5, 0.5, 0.5], [0, 0, 0]];
/**
 * Cosine palettes (Inigo Quilez): colour = a + b * cos(2pi * (c * t + d)). Mostly two- and
 * three-colour harmonies (c at 0.5 sweeps half the hue circle, not all of it): a full rainbow on
 * every scene reads as one look. The rainbow is kept, as one of many. Packs pick theirs by name
 * (pack.palettes); the non-Gondry view uses them all.
 */
export const PALETTES: Record<string, [Vec3, Vec3, Vec3, Vec3]> = {
  embers: [[0.5, 0.25, 0.15], [0.5, 0.3, 0.15], [0.5, 0.5, 0.5], [0, 0.1, 0.2]],
  ocean: [[0.1, 0.35, 0.5], [0.1, 0.3, 0.4], [0.5, 0.5, 0.5], [0.5, 0.55, 0.6]],
  'pink-cyan': [[0.5, 0.4, 0.6], [0.5, 0.4, 0.4], [0.5, 0.5, 0.5], [0, 0.5, 0.25]],
  sunset: [[0.6, 0.35, 0.35], [0.4, 0.3, 0.3], [0.5, 0.5, 0.5], [0, 0.1, 0.35]],
  forest: [[0.3, 0.5, 0.25], [0.25, 0.4, 0.2], [0.5, 0.5, 0.5], [0.2, 0.1, 0.35]],
  'gold-violet': [[0.5, 0.4, 0.5], [0.45, 0.35, 0.45], [0.5, 0.5, 0.5], [0, 0.15, 0.5]],
  ice: [[0.6, 0.75, 0.9], [0.3, 0.25, 0.15], [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]],
  acid: [[0.5, 0.5, 0.4], [0.5, 0.5, 0.4], [0.5, 0.5, 0.5], [0.5, 0, 0.5]],
  'peach-teal': [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 0.7, 0.4], [0, 0.15, 0.2]],
  terracotta: [[0.8, 0.5, 0.4], [0.2, 0.4, 0.2], [2, 1, 1], [0, 0.25, 0.25]],
  ultraviolet: [[0.5, 0.2, 0.6], [0.5, 0.4, 0.4], [0.5, 0.5, 0.5], [0.6, 0.1, 0.3]],
  rainbow: [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0.33, 0.67]],
  // Two-colour ones: a colour and its partner.
  pumpkin: two([1.0, 0.42, 0.05], [0.42, 0.08, 0.62]),
  blood: two([0.9, 0.05, 0.06], [0.16, 0.0, 0.05]),
  toxic: two([0.4, 1.0, 0.2], [0.38, 0.05, 0.58]),
  moonlight: two([0.78, 0.84, 1.0], [0.08, 0.1, 0.28]),
  'cyan-magenta': two([0.1, 0.95, 1.0], [0.95, 0.1, 0.75]),
  'gold-navy': two([1.0, 0.78, 0.25], [0.05, 0.1, 0.4]),
  'lime-blue': two([0.7, 1.0, 0.2], [0.1, 0.25, 0.9]),
  // Moody ones: a colour fading into near-black, so the scene is drenched in one hue at night.
  graveyard: two([0.35, 0.78, 0.22], [0.02, 0.06, 0.03]),
  bruise: two([0.5, 0.16, 0.66], [0.03, 0.0, 0.08]),
  witchlight: two([0.1, 0.72, 0.62], [0.12, 0.02, 0.2]),
  'ember-dusk': two([0.85, 0.32, 0.05], [0.05, 0.03, 0.18]),
  swamp: two([0.48, 0.52, 0.14], [0.06, 0.04, 0.02]),
  'cold-moon': two([0.36, 0.52, 0.74], [0.01, 0.02, 0.06]),
};
/** What a ride cycles through when its pack names none: everything but the rainbow, which is a treat. */
export const DEFAULT_PALETTES = Object.keys(PALETTES).filter(k => !['pumpkin', 'blood', 'toxic', 'moonlight'].includes(k));

/** The palette everything in the world paints with; the FX director sets it per section. */
export const palette = Fn(([t]: [any]) => U.pa.add(U.pb.mul(cos(U.pc.mul(t).add(U.pd).mul(6.28318)))));

/** 2D coordinates on whichever axis-aligned plane the surface mostly faces. */
const planar = (p: any, n: any) => {
  const an = abs(n);
  return select(an.y.greaterThan(max(an.x, an.z)), p.xz, select(an.x.greaterThan(an.z), p.zy, p.xy));
};
/** Horizontal coordinate along a wall (for corrugation and planks). */
const along = (p: any, n: any) => select(abs(n.x).greaterThan(abs(n.z)), p.z, p.x);

/** Pattern contrast that fades as the pattern gets smaller than ~2 pixels. */
const aaFade = (uv: any, cell: number) => clamp(float(1).sub(length(fwidth(uv)).mul(1 / cell).mul(2.2)), 0, 1);

export function makeSceneryMaterial(opts: { trip?: any } = {}): THREE.MeshStandardNodeMaterial {
  const TRIP = opts.trip ?? U.trip;
  const m = new THREE.MeshStandardNodeMaterial();
  // vertexColors stays off: colorNode multiplies the baked vertex colour itself so the trip layer
  // can replace it; three still multiplies instanceColor (per-object tints) on top.
  const id = attribute('mat', 'float');
  const p = positionGeometry, n = normalGeometry;
  const is = (k: number) => step(abs(id.sub(k)), 0.5);

  const uv = planar(p, n);
  const big = mx_noise_float(p.mul(0.35)).mul(0.5).add(0.5);      // 0..1 blotches
  const fine = mx_noise_float(p.mul(6.0));                         // -1..1 grain
  const fadeFine = aaFade(p.xy, 0.15);

  // --- bricks: 0.25 x 0.075 m, stretcher bond, mortar joints, per-brick colour
  const bUV = vec2(uv.x.div(0.25), uv.y.div(0.075));
  const bRow = floor(bUV.y);
  const bCellX = bUV.x.add(fract(bRow.mul(0.5)));
  const bId = vec2(floor(bCellX), bRow);
  const bF = vec2(fract(bCellX), fract(bUV.y));
  const mortar = float(1).sub(smoothstep(0.0, 0.07, bF.x).mul(smoothstep(1.0, 0.93, bF.x)).mul(smoothstep(0.0, 0.14, bF.y)).mul(smoothstep(1.0, 0.86, bF.y)));
  const bFade = aaFade(bUV, 1);
  const brickVar = hash(bId.x.add(bId.y.mul(57.0))).mul(0.3).add(0.82);
  const brickCol = mix(float(1), mix(brickVar, float(1.25), mortar), bFade);
  const brickH = mortar.oneMinus().mul(bFade);

  // --- stone: irregular cells
  const wor = mx_worley_noise_float(p.mul(1.6));
  const stoneEdge = smoothstep(0.08, 0.0, wor).mul(aaFade(p.xy, 0.6));
  const stoneCol = float(0.88).add(hash(floor(p.mul(1.6)).dot(vec3(1, 17, 113))).mul(0.18)).sub(stoneEdge.mul(0.25));

  // --- corrugated metal on walls, standing seams on roofs; rust in blotches
  const corr = sin(along(p, n).mul(6.28318 / 0.16));
  const corrFade = aaFade(p.xy, 0.16).mul(float(1).sub(abs(n.y)));
  const rust = smoothstep(0.62, 0.85, big.add(fine.mul(0.15)));
  const metalCol = float(0.92).add(corr.mul(0.08).mul(corrFade));
  const metalH = corr.mul(corrFade);

  // --- roof tiles: rows down the slope, staggered, per-tile shade
  const tUV = vec2(uv.x.div(0.3), uv.y.div(0.22));
  const tRow = floor(tUV.y);
  const tId = vec2(floor(tUV.x.add(fract(tRow.mul(0.5)))), tRow);
  const tF = fract(tUV.y);
  const tFade = aaFade(tUV, 1);
  const tileCol = mix(float(1), hash(tId.x.add(tId.y.mul(31.0))).mul(0.25).add(0.82).mul(float(0.75).add(tF.mul(0.3))), tFade);
  const tileH = tF.mul(tFade);

  // --- concrete: formwork panels, blotches, pits
  const cUV = vec2(uv.x.div(3.0), uv.y.div(1.5));
  const cF = vec2(fract(cUV.x), fract(cUV.y));
  const joint = float(1).sub(smoothstep(0.0, 0.01, cF.x).mul(smoothstep(0.0, 0.02, cF.y))).mul(aaFade(cUV, 1));
  const concCol = float(0.86).add(big.mul(0.2)).add(fine.mul(0.04).mul(fadeFine)).sub(joint.mul(0.18));

  // --- plaster / render: soft blotches and rain streaks down from the top
  const streak = smoothstep(0.3, 0.9, mx_noise_float(vec3(p.x.mul(3.0), p.y.mul(0.25), p.z.mul(3.0))));
  const plasterCol = float(0.86).add(big.mul(0.16)).sub(streak.mul(0.16)).add(fine.mul(0.05).mul(fadeFine));

  // --- glass: per-window cell; some windows lit at night, curtains vary
  const winCell = floor(p.mul(vec3(0.9, 0.9, 0.9)));
  const winRnd = hash(winCell.dot(vec3(7.1, 113.3, 41.7)));
  const lit = step(float(1).sub(U.night.mul(0.7)), winRnd);

  // --- foliage: clumps of leaves
  const leaf = mx_worley_noise_float(p.mul(2.2));
  const leafCol = float(0.65).add(leaf.mul(0.7)).add(fine.mul(0.08)).mul(float(0.9).add(big.mul(0.2)));
  // --- wood: grain along the length
  const grain = sin(p.y.mul(30.0).add(mx_noise_float(p.mul(vec3(4, 0.5, 4))).mul(5.0))).mul(0.06).mul(fadeFine);
  // --- straw / hay: fibres
  const fibre = mx_noise_float(p.mul(vec3(30, 3, 30))).mul(0.12).mul(fadeFine);
  // --- grass: hills, mown stripes
  const grassCol = float(0.85).add(big.mul(0.25)).add(sin(p.x.mul(0.25).add(big.mul(2.0))).mul(0.05));

  // --- gas giant: latitude bands that swirl; rocky moons: craters; lavender: purple flower spikes
  const lat = p.y.mul(0.08).add(mx_noise_float(p.mul(0.05)).mul(1.4));
  const gasCol = float(0.75).add(sin(lat.mul(9.0)).mul(0.2)).add(sin(lat.mul(23.0).add(1.0)).mul(0.08));
  const crater = mx_worley_noise_float(p.mul(0.12));
  // Big craters for moons, small pits for asteroids, and a mottled tone so rocks never look banded.
  const pits = mx_worley_noise_float(p.mul(0.9));
  const mottle = mx_noise_float(p.mul(0.45)).mul(0.5).add(0.5);
  const rockCol = float(0.55).add(smoothstep(0.05, 0.3, crater).mul(0.25)).add(smoothstep(0.02, 0.18, pits).mul(0.2)).add(mottle.mul(0.18)).add(fine.mul(0.06).mul(fadeFine));
  const spikes = mx_noise_float(p.mul(vec3(9.0, 2.0, 9.0))).mul(0.5).add(0.5);
  const lavCol = float(0.7).add(spikes.mul(0.5));
  const patternF = float(1)
    .add(is(SURF.brick).mul(brickCol.sub(1)))
    .add(is(SURF.stone).mul(stoneCol.sub(1)))
    .add(is(SURF.metal).mul(metalCol.sub(1)))
    .add(is(SURF.tile).mul(tileCol.sub(1)))
    .add(is(SURF.concrete).mul(concCol.sub(1)))
    .add(is(SURF.plaster).mul(plasterCol.sub(1)))
    .add(is(SURF.foliage).mul(leafCol.sub(1)))
    .add(is(SURF.wood).mul(grain))
    .add(is(SURF.straw).mul(fibre))
    .add(is(SURF.grass).mul(grassCol.sub(1)))
    .add(is(SURF.gas).mul(gasCol.sub(1)))
    .add(is(SURF.rock).mul(rockCol.sub(1)))
    .add(is(SURF.lavender).mul(lavCol.sub(1)));

  const base = vertexColor().rgb;
  let real: any = base.mul(patternF);
  // Rust streaks on walls, less on roofs (which the rain washes).
  real = mix(real, vec3(0.22, 0.1, 0.04), is(SURF.metal).mul(rust).mul(float(0.5).sub(abs(n.y).mul(0.35))));
  // Glass: dark, slightly blue, with curtains of varied colour behind.
  real = mix(real, vec3(0.25, 0.27, 0.3).add(winRnd.mul(0.1)), is(SURF.glass));

  // --- the trip layer: flowing bands of colour in world space, pulsing on kicks
  const wp = positionWorld;
  const flow = mx_noise_float(wp.mul(0.02).add(vec3(0, U.showTime.mul(0.05), 0)));
  const bands = wp.y.mul(0.08).add(flow.mul(1.5)).add(U.hue).add(dot(wp.xz, vec2(0.004, 0.002)));
  const trippy = pow(palette(bands), vec3(2.2)).mul(float(0.45).add(U.kick.mul(0.25)));
  // Stripes ride up the buildings with the beat.
  const stripe = smoothstep(0.42, 0.5, fract(wp.y.mul(0.25).sub(U.beatPhase))).mul(smoothstep(0.58, 0.5, fract(wp.y.mul(0.25).sub(U.beatPhase))));
  const tripCol = mix(trippy, palette(bands.add(0.5)), stripe.mul(0.7));
  m.colorNode = mix(real, tripCol, TRIP);

  m.roughnessNode = float(0.9)
    .sub(is(SURF.metal).mul(float(0.5).sub(rust.mul(0.35))))
    .sub(is(SURF.glass).mul(0.86))
    .sub(is(SURF.tile).mul(0.25))
    .sub(is(SURF.paint).mul(0.55))
    .add(is(SURF.foliage).mul(0.05))
    .add(TRIP.mul(0.3)).min(1);
  m.metalnessNode = is(SURF.metal).mul(float(0.55).sub(rust.mul(0.45))).add(is(SURF.glass).mul(0.9)).mul(float(1).sub(TRIP));

  const height = float(0)
    .add(is(SURF.brick).mul(brickH))
    .add(is(SURF.stone).mul(stoneEdge.oneMinus()))
    .add(is(SURF.metal).mul(metalH.mul(0.5)))
    .add(is(SURF.tile).mul(tileH))
    .add(is(SURF.concrete).mul(joint.oneMinus().add(fine.mul(0.2).mul(fadeFine))))
    .add(is(SURF.foliage).mul(leaf))
    .add(is(SURF.plaster).mul(fine.mul(0.15).mul(fadeFine)))
    .add(is(SURF.rock).mul(smoothstep(0.0, 0.25, crater).mul(0.6).add(smoothstep(0.0, 0.15, pits).mul(0.4))))
    .add(is(SURF.lavender).mul(spikes));
  m.normalNode = bumpMap(height, 0.035);
  // Trip looks make the scenery dance: a squash on the kick and a wobble that travels up.
  // (positionLocal is already in world-aligned mesh space here, ground at y = 0, so only shear
  // and squash about the ground: no scaling about the far-away mesh origin.)
  const h = positionLocal.y.max(0);
  const lean = sin(U.beatPhase.mul(6.28318).add(positionLocal.x.mul(0.02))).mul(0.05).mul(TRIP);
  const sq = U.kick.mul(0.12).mul(TRIP);
  m.positionNode = vec3(positionLocal.x.add(h.mul(lean)), positionLocal.y.sub(h.mul(sq)), positionLocal.z.add(h.mul(lean).mul(0.4)));

  // Lit windows at dusk; in trip mode surfaces glow with the kick.
  const winGlow = vec3(1.0, 0.72, 0.42).mul(lit).mul(is(SURF.glass)).mul(U.night).mul(1.6);
  const tripGlow = tripCol.mul(TRIP).mul(float(0.12).add(U.kick.mul(1.2)).add(stripe.mul(1.5)));
  // Glowing parts (beacons, comet tails, stars) light themselves.
  // Lamps and signs: lit by day, blazing at night.
  const selfGlow = base.mul(is(SURF.glow)).mul(float(0.7).add(U.night.mul(1.5)));
  m.emissiveNode = winGlow.add(tripGlow).add(selfGlow);
  return m;
}

/** The ground: the themed field texture with grass and soil detail, plus the trip paint. */
export function makeGroundMaterial(map: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ map, roughness: 1, metalness: 0 });
  const wp = positionWorld;
  const d = length(cameraPosition.xz.sub(wp.xz));
  const near = smoothstep(120, 10, d);
  const n1 = mx_noise_float(vec3(wp.x.mul(0.08), 0, wp.z.mul(0.08))).mul(0.5).add(0.5);
  const n2 = mx_noise_float(vec3(wp.x.mul(1.3), 0, wp.z.mul(1.3)));
  const tufts = mx_worley_noise_float(vec3(wp.x.mul(3.0), 0, wp.z.mul(3.0)));
  const detail = float(0.82).add(n1.mul(0.3)).add(n2.mul(0.06).mul(near)).add(tufts.mul(0.12).mul(near));
  const { texture: _t } = { texture: null };
  void _t;
  const flow = mx_noise_float(vec3(wp.x.mul(0.01), U.showTime.mul(0.08), wp.z.mul(0.01)));
  const rings = length(wp.xz.sub(cameraPosition.xz)).mul(0.03).sub(U.showTime.mul(0.5)).add(flow);
  const tripCol = pow(palette(rings.add(U.hue)), vec3(2.2)).mul(float(0.35).add(U.kick.mul(0.4)));
  // Grade the pastel field colours towards real grass and soil: richer and darker.
  const field = pow(materialColor.rgb, vec3(1.5)).mul(vec3(0.95, 1.05, 0.8));
  // One ground runs under both windows: on a two-window ride only the far side takes the paint.
  const trip = max(U.trip, U.tripFar.mul(smoothstep(0.0, 4.0, wp.z.sub(cameraPosition.z))));
  m.colorNode = vec4(mix(field.mul(detail), tripCol, trip.mul(0.85)), 1);
  m.normalNode = bumpMap(n2.mul(near).add(tufts.mul(near)), 0.08);
  m.emissiveNode = tripCol.mul(trip).mul(U.kick.mul(0.5));
  return m;
}

/** Stage floor for perform packs: polished dark floor with a tile grid that lights up on the beat. */
export function makeDanceFloorMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.2 });
  const wp = positionWorld;
  const cell = floor(wp.xz.div(1.2));
  const f = fract(wp.xz.div(1.2));
  const edge = float(1).sub(smoothstep(0.0, 0.04, f.x).mul(smoothstep(1.0, 0.96, f.x)).mul(smoothstep(0.0, 0.04, f.y)).mul(smoothstep(1.0, 0.96, f.y)));
  const r = hash(cell.x.add(cell.y.mul(91.0)));
  const ring = floor(length(cell).mul(0.5));
  const wave = fract(ring.mul(0.17).sub(U.showTime.mul(0.5)).add(r.mul(0.2)));
  const on = step(0.78, fract(r.add(floor(U.hue.mul(8.0)).mul(0.37)))).mul(U.kick.mul(0.8).add(0.2)).add(smoothstep(0.9, 1.0, wave).mul(U.energy));
  const col = palette(r.add(U.hue).add(ring.mul(0.05)));
  m.colorNode = mix(vec3(0.06, 0.055, 0.07), vec3(0.6), edge.mul(0.2));
  m.emissiveNode = col.mul(on).mul(float(1).sub(edge)).mul(1.4);
  m.roughnessNode = float(0.18).add(edge.mul(0.5)).add(mx_noise_float(wp.mul(2.0)).mul(0.05));
  return m;
}

/** Carriage window glass: a faint sky sheen and dust, plus raindrops that refract the view and
 * streak backwards with the train's speed. */
export function makeWindowGlassMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const p = uv().mul(vec2(1.25, 0.82)); // metres on the pane
  const t = U.showTime;
  // Two layers: small beads that sit still, larger drops that run sideways and down.
  const beads = mx_worley_noise_float(vec3(p.mul(26.0), 0.0));
  const beadMask = smoothstep(0.3, 0.16, beads).mul(step(0.45, hash(floor(p.mul(26.0)).dot(vec2(1.0, 57.0)))));
  const run = vec2(p.x.mul(9.0).add(t.mul(U.speed).mul(0.06)), p.y.mul(14.0).add(t.mul(0.7)));
  const streak = mx_worley_noise_float(vec3(run.x, run.y.mul(0.35), 0.0));
  const streakMask = smoothstep(0.22, 0.08, streak);
  const drops = beadMask.max(streakMask).mul(U.rain);
  // Refraction: drops act as little lenses, flipping and shrinking what is behind them.
  const lens = vec2(beads.sub(0.15), streak.sub(0.15)).mul(0.06);
  const behind = viewportSharedTexture(screenUV.sub(lens.mul(drops))).rgb;
  const dust = mx_noise_float(vec3(p.mul(6.0), 1.0)).mul(0.5).add(0.5);
  const sheen = vec3(0.75, 0.85, 1.0).mul(float(0.03).add(dust.mul(0.03)));
  // A bright rim on the upper edge of each drop catches the sky.
  const rim = smoothstep(0.3, 0.24, beads).sub(smoothstep(0.24, 0.18, beads)).max(0).mul(beadMask).mul(U.rain);
  m.colorNode = behind.mul(float(1).sub(drops.mul(0.25))).add(sheen).add(drops.mul(0.05)).add(rim.mul(0.6));
  m.opacityNode = clamp(drops.add(0.08).add(U.rain.mul(0.06)), 0, 1);
  return m;
}

/** Grass tufts beside the line: crossed cards cut into blades, swaying, catching the low sun. */
/** `dark` < 1: dead, dark grass for a night ride. */
export function makeGrassMaterial(dark = 1): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.85 });
  const q = uv();
  const blade = abs(fract(q.x.mul(5.0)).mul(2.0).sub(1.0)).oneMinus();          // 0 at gaps, 1 at blade centre
  const tall = hash(floor(q.x.mul(5.0)).add(positionWorld.x.mul(0.37).floor())).mul(0.5).add(0.5);
  m.opacityNode = step(q.y, blade.mul(tall).mul(1.15));
  const wp = positionWorld;
  const tint = mx_noise_float(vec3(wp.x.mul(0.15), 0, wp.z.mul(0.15))).mul(0.5).add(0.5);
  const base = dark < 1 ? mix(vec3(0.07, 0.06, 0.05), vec3(0.16, 0.13, 0.12), tint).mul(dark / 0.4) : mix(vec3(0.16, 0.22, 0.06), vec3(0.42, 0.42, 0.14), tint);
  m.colorNode = mix(base.mul(0.5), base.mul(1.25), q.y);
  // Sway in the wind (and with the music in trip looks).
  const sway = sin(U.showTime.mul(2.2).add(wp.x.mul(0.6))).mul(0.08).add(U.kick.mul(U.trip).mul(0.2));
  m.positionNode = positionLocal.add(vec3(sway.mul(q.y), 0, sway.mul(q.y).mul(0.5)));
  return m;
}

/** The sky beyond the other window when the train crosses into space: stars of several sizes,
 * slow nebula clouds in the palette, and a dissolve edge that eats the real sky away. */
/**
 * `floor`: the plane under it. It mirrors the sky (so the nebula and stars go on below the
 * horizon, like a dark glassy lake), with a grid of light lines fixed to the world, so they stream
 * past as the train moves and keep the ride feeling fast.
 */
export function makeSpaceMaterial(reveal: any, floor_ = false): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ side: floor_ ? THREE.DoubleSide : THREE.BackSide, fog: false, depthWrite: true });
  const look = positionWorld.sub(cameraPosition).normalize();
  const d = floor_ ? vec3(look.x, look.y.negate(), look.z) : positionLocal.normalize();
  const stars = (k: number, th: number) => {
    const c = floor(d.mul(k));
    const h = hash(c.dot(vec3(1.0, 57.0, 113.0)));
    const f = fract(d.mul(k)).sub(0.5);
    return step(th, h).mul(smoothstep(0.35, 0.0, length(f)));
  };
  const twinkle = sin(U.showTime.mul(3.0).add(hash(floor(d.mul(400.0)).dot(vec3(3, 7, 11))).mul(40.0))).mul(0.3).add(0.7);
  const field = stars(400, 0.985).mul(twinkle).add(stars(160, 0.992).mul(1.6)).add(stars(60, 0.996).mul(3.0));
  const neb = mx_noise_float(d.mul(2.2).add(vec3(0, U.showTime.mul(0.01), 0))).mul(0.5).add(0.5);
  const neb2 = mx_noise_float(d.mul(5.0).add(7.0)).mul(0.5).add(0.5);
  const cloud = pow(neb.mul(neb2), 2.2).mul(1.6);
  const tint = pow(palette(neb.mul(0.6).add(U.hue).add(0.55)), vec3(2.0));
  const col = vec3(0.004, 0.006, 0.015).add(tint.mul(cloud).mul(float(0.5).add(U.kick.mul(0.4)))).add(vec3(field));
  // Dissolve: noise threshold sweeps with `reveal`, with a hot glowing edge.
  const n = mx_noise_float(d.mul(6.0)).mul(0.5).add(0.5);
  const edge = smoothstep(0.06, 0.0, abs(n.sub(reveal)));
  let out = col;
  if (floor_) {
    // The mirror matches the sky exactly at the horizon (so there is no seam), then darkens
    // towards your feet.
    const near = smoothstep(0.0, 0.45, look.y.negate());
    const p = positionWorld;
    // Lines across the track every 24 m (they rush past), and along it every 30 m (lanes).
    const across = smoothstep(0.06, 0.0, abs(fract(p.x.div(24.0)).sub(0.5)).sub(0.47));
    const along = smoothstep(0.05, 0.0, abs(fract(p.z.div(30.0)).sub(0.5)).sub(0.48));
    const grid = max(across, along.mul(0.6));
    const fade = smoothstep(900.0, 60.0, length(p.sub(cameraPosition)));
    const glow = pow(palette(U.hue.add(p.x.mul(0.002))), vec3(1.6)).mul(grid).mul(fade).mul(float(0.55).add(U.kick.mul(0.9)));
    out = col.mul(float(1).sub(near.mul(0.75))).add(glow);
  }
  m.colorNode = out.add(vec3(1.0, 0.55, 0.9).mul(edge).mul(3.0));
  m.opacityNode = step(n, reveal);
  m.alphaTest = 0.5;
  return m;
}

/**
 * The starship's sky, all the way round. Out of the main canopy: deep space, stars and slow
 * nebulae. Out of the other side (+z): a psychedelic vortex that spins and pulses with the music.
 */
export function makeShipSkyMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const d = positionLocal.normalize();
  const stars = (k: number, th: number) => {
    const c = floor(d.mul(k));
    const h = hash(c.dot(vec3(1.0, 57.0, 113.0)));
    const f = fract(d.mul(k)).sub(0.5);
    return step(th, h).mul(smoothstep(0.35, 0.0, length(f)));
  };
  const twinkle = sin(U.showTime.mul(3.0).add(hash(floor(d.mul(420.0)).dot(vec3(3, 7, 11))).mul(40.0))).mul(0.3).add(0.7);
  const field = stars(420, 0.982).mul(twinkle).add(stars(170, 0.991).mul(1.5)).add(stars(64, 0.996).mul(3.2));
  // Real side: two nebulae (teal and rose) with dark dust lanes through them.
  const n1 = mx_noise_float(d.mul(1.7).add(vec3(3.1, 0, U.showTime.mul(0.004)))).mul(0.5).add(0.5);
  const n2 = mx_noise_float(d.mul(4.3).add(9.0)).mul(0.5).add(0.5);
  const lanes = smoothstep(0.42, 0.62, mx_noise_float(d.mul(7.0).add(2.0)).mul(0.5).add(0.5));
  const glowA = pow(n1.mul(n2), 2.4).mul(2.2);
  const glowB = pow(smoothstep(0.35, 0.9, mx_noise_float(d.mul(2.6).add(5.0)).mul(0.5).add(0.5)), 2.0).mul(0.9);
  const neb = vec3(0.12, 0.55, 0.7).mul(glowA).add(vec3(0.75, 0.22, 0.45).mul(glowB)).mul(float(1).sub(lanes.mul(0.7)));
  const real = vec3(0.003, 0.004, 0.012).add(neb.mul(float(0.55).add(U.kick.mul(0.12)))).add(vec3(field));
  // Trip side: a vortex centred on the other window.
  const ang = atan(d.y, d.x);
  const rad = acos(clamp(d.z, -1.0, 1.0));
  const swirl = rad.mul(3.2).sub(U.showTime.mul(0.35)).add(ang.mul(0.477));
  const bands = sin(swirl.mul(12.566)).mul(0.5).add(0.5);
  const rays = sin(ang.mul(12.0).add(U.showTime.mul(0.6)).add(rad.mul(4.0))).mul(0.5).add(0.5);
  const trip = pow(palette(swirl.add(U.hue).add(rays.mul(0.15))), vec3(1.8))
    .mul(float(0.18).add(bands.mul(0.32)).add(U.kick.mul(0.45)).add(rays.mul(0.1)))
    .add(vec3(field).mul(0.6));
  const side = smoothstep(-0.2, 0.3, d.z);
  m.colorNode = mix(real, trip, side);
  return m;
}

/** The starship's canopy: almost nothing, a faint sheen and a lattice that shimmers on the kick. */
export function makeCanopyMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const p = uv().mul(vec2(60.0, 90.0));
  const row = floor(p.y);
  const q = vec2(p.x.add(row.mul(0.5)), p.y);
  const f = fract(q).sub(0.5);
  const cell = max(abs(f.x), abs(f.y));
  const lattice = smoothstep(0.44, 0.5, cell);
  // The lattice shows towards the canopy's edges and frame; the middle stays clear.
  const edge = smoothstep(0.05, 0.0, uv().x).add(smoothstep(0.95, 1.0, uv().x)).add(smoothstep(0.04, 0.0, abs(uv().x.sub(0.5))).mul(0.4));
  const pulse = float(0.25).add(U.kick.mul(0.9)).add(U.hat.mul(0.2));
  const sweep = smoothstep(0.08, 0.0, abs(fract(uv().y.mul(2.0).sub(U.showTime.mul(0.25))).sub(0.5))).mul(0.3);
  const tint = mix(vec3(0.45, 0.85, 1.0), pow(palette(uv().y.add(U.hue)), vec3(1.5)), U.trip.mul(0.8));
  const a = lattice.mul(clamp(edge, 0, 1)).mul(pulse.add(sweep)).mul(0.35);
  // Additive: the canopy can only ever add light, so the view through it is never dimmed.
  m.blending = THREE.AdditiveBlending;
  m.colorNode = tint.mul(a.add(0.012));
  return m;
}

/** The starship's console: rows of buttons blinking along with the track. */
export function makeConsoleMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ color: 0x2a2f36, roughness: 0.45, metalness: 0.6 });
  const p = positionLocal.xz.mul(vec2(7.0, 9.0));
  const cell = floor(p);
  const h = hash(cell.dot(vec2(1.0, 57.0)));
  const f = fract(p).sub(0.5);
  const key = smoothstep(0.36, 0.3, max(abs(f.x), abs(f.y)));
  const lit = step(0.5, hash(cell.dot(vec2(3.0, 11.0)).add(floor(U.showTime.mul(float(1.5).add(h.mul(4.0)))))));
  const col = pow(palette(h.mul(0.8).add(U.hue.mul(0.5))), vec3(1.6));
  const top = smoothstep(0.5, 0.8, normalLocal.y);
  m.emissiveNode = col.mul(key).mul(top).mul(lit.mul(float(0.7).add(U.kick.mul(1.6))).add(0.08));
  return m;
}

/**
 * The non-Gondry view's sky: a whole sphere of classic 2D effects in angle space (azimuth,
 * elevation), each fed by a different stream of the score. `V` holds the scene's uniforms (see
 * render/visualiser.ts, which writes them every frame):
 *   palette a, b, c, d   cosine palette of the current scene
 *   shape (vec4)         plasma frequency, swirl, kaleidoscope segments (0 = off), drift speed
 *   mixes (vec4)         weights of plasma, rings round the zenith, tunnel stripes, phase offset
 *   gaze (vec3)          where the viewer looks: the bass pulses blast out from there
 *   pulse0..3            seconds since the last four bass notes (big = none)
 *   boltAz, boltT, boltSeed  lightning on the snare: where, how long ago, which shape
 *   wave (texture)       the melody's pitch over the next/last few seconds, laid round the horizon
 *   crash                0..1 flash when the scene is torn down for a fresh one
 *   rise, bright         build-ups and brightness
 */
/**
 * `far`: the disco on the far side of a train or starship: drawn by direction from the camera (so
 * a floor plane can wear it too), faded in by `far.reveal`.
 */
/** How long a cued firework's rocket climbs before it bursts on its hit, seconds. */
export const SHELL_RISE = 1.3;

export function makeVisualiserMaterial(V: any, far?: { reveal: any; floor?: boolean }): THREE.MeshBasicNodeMaterial {
  // (The floor writes depth, so the ground under it stays hidden.)
  const m = new THREE.MeshBasicNodeMaterial({ side: far?.floor ? THREE.DoubleSide : THREE.BackSide, fog: false, depthWrite: !!far?.floor });
  const d = far ? positionWorld.sub(cameraPosition).normalize() : positionLocal.normalize();
  if (far) { m.transparent = true; m.opacityNode = far.reveal; }
  const az = atan(d.x, d.z.negate());             // 0 ahead (-z), +/- pi behind
  // Patterns use the azimuth mirrored about the front-back line: the raw angle jumps from +pi to
  // -pi right behind you, which showed as a seam; |az| meets itself there, so nothing can tear.
  // A soft fold (not a hard abs) so the mirror line straight ahead is not a crease either.
  const azP = sqrt(az.mul(az).add(0.0016)).sub(0.04);
  const el = asin(clamp(d.y, -1.0, 1.0));          // -pi/2 .. pi/2
  // The pattern's clock: visualiser.ts advances it, faster as the song winds up for a lift.
  const t = V.phase;
  const F = V.shape.x;
  // Symmetry: mirror the sky about the horizon (layers.w).
  // Smoothly, so the fold at the horizon does not show as a horizontal seam.
  const elM = mix(el, sqrt(el.mul(el).add(0.0025)).sub(0.05), V.layers.w);
  // Kaleidoscope: fold the azimuth into mirrored segments.
  const segs = max(floor(V.shape.z.add(0.5)), 1.0);
  const seg = fract(az.div(6.28318).mul(segs).add(0.5));
  const azK = select(V.shape.z.greaterThan(0.5), abs(seg.sub(0.5)).mul(6.28318).div(segs), azP);
  // Swirl: the further from the horizon, the more it turns.
  const azS = azK.add(elM.mul(V.shape.y).add(sin(t.mul(0.3)).mul(V.shape.y).mul(0.5)));
  // Sub breathe (element 10): the whole pattern swells with the bass.
  const breathe = float(1.0).add(V.E2.z.mul(V.bands.y).mul(0.35));
  const px0 = azS.mul(F).mul(breathe), py0 = elM.mul(F).mul(1.3).mul(breathe);
  // Deep kaleidoscope (fold.x levels, 0..5): fold the pattern's plane over and over, turning and
  // stretching between folds, so one plasma becomes a mandala of mandalas. fold.y is the turn per
  // level, fold.z the stretch, fold.w how far each level slides (it drifts with the music).
  const folded = Fn(() => {
    const pt = vec2(px0, py0).toVar();
    for (let i = 0; i < 5; i++) {
      const on = step(float(i + 0.5), V.fold.x);
      const an = V.fold.y.mul(i + 1).add(sin(t.mul(0.21 * (i + 1))).mul(0.3));
      const ca = cos(an), sa = sin(an);
      const fo = abs(pt);
      const ro = vec2(fo.x.mul(ca).sub(fo.y.mul(sa)), fo.x.mul(sa).add(fo.y.mul(ca)));
      const nx = ro.mul(V.fold.z).sub(vec2(V.fold.w.add(U.kick.mul(0.25)), V.fold.w.mul(0.6)));
      pt.assign(mix(pt, nx, on));
    }
    return pt;
  })();
  const px = folded.x, py = folded.y;
  const plasma = sin(px.add(t))
    .add(sin(py.sub(t.mul(1.1))))
    .add(sin(px.add(py).mul(0.7).add(t.mul(0.7))))
    .add(sin(length(vec2(px, py.mul(2.0))).mul(1.5).sub(t.mul(1.3)).add(U.kick.mul(1.5))))
    .mul(0.25);
  const rings = sin(elM.mul(F).mul(4.0).sub(t.mul(2.0)).add(U.kick.mul(2.0)));
  // The outline of everything pulsing out from your gaze (pulseShape: sides, star, spin, lobes):
  // a radius multiplier by the angle round the gaze, so rings become polygons, stars or blobs.
  const right = normalize(vec3(V.gaze.z.negate(), 0.0, V.gaze.x));
  const up = normalize(vec3(V.gaze.y.negate().mul(V.gaze.x), V.gaze.x.mul(V.gaze.x).add(V.gaze.z.mul(V.gaze.z)), V.gaze.y.negate().mul(V.gaze.z)));
  const PS = V.pulseShape;
  const th = atan(dot(d, up), dot(d, right)).add(U.showTime.mul(PS.z));
  const pn = max(PS.x, 3.0), psec = float(6.28318).div(pn);
  const ploc = abs(fract(th.div(psec)).sub(0.5)).mul(psec);
  const pPoly = cos(psec.mul(0.5)).div(cos(ploc)).mul(float(1.0).sub(PS.y.mul(abs(ploc).div(psec.mul(0.5)).oneMinus()).mul(0.45)));
  const pMul = mix(float(1.0), pPoly, step(2.5, PS.x)).mul(float(1.0).add(sin(th.mul(PS.w).add(U.showTime)).mul(0.16).mul(step(0.5, PS.w))));
  const tunnel = sin(acos(clamp(dot(d, V.gaze), -1.0, 1.0)).div(pMul).mul(F).mul(3.0).sub(t.mul(3.0)).add(azK.mul(2.0)));
  const v = plasma.mul(V.mixes.x).add(rings.mul(V.mixes.y)).add(tunnel.mul(V.mixes.z))
    .add(V.mixes.w).add(U.hue.mul(0.5)).add(mx_noise_float(d.mul(2.0).add(t.mul(0.1))).mul(0.25));
  // Every element colours itself from the scene's palette, so a scene reads as one colour story.
  const paletteAt = (x: any) => V.pa.add(V.pb.mul(cos(V.pc.mul(x).add(V.pd).mul(6.28318))));
  const pal = paletteAt(v);
  const glow = float(0.1).add(U.energy.mul(0.12)).add(U.kick.mul(0.28)).add(V.rise.mul(0.25)).add(V.bright.mul(0.08));
  // Contrast: thin bright filaments over darkness, and drifting black voids, so it reads as a
  // pattern rather than a wash.
  const fil = pow(sin(v.mul(9.0)).mul(0.5).add(0.5), 3.0);
  const voids = smoothstep(0.35, 0.75, mx_noise_float(d.mul(1.3).add(vec3(0.0, t.mul(0.08), 0.0))).mul(0.5).add(0.5));
  const base = pow(pal, vec3(2.2)).mul(glow).mul(fil.mul(0.85).add(0.15)).mul(voids.mul(0.85).add(0.15));
  // Bass: rings blasting out from wherever you are looking.
  const ang = acos(clamp(dot(d, V.gaze), -1.0, 1.0));
  const ring = (p: any) => { const x = ang.sub(p.mul(2.2).mul(pMul)).div(0.07); return exp(x.mul(x).negate()).mul(exp(p.mul(-1.6))); };
  const rings4 = ring(V.pulse0).add(ring(V.pulse1)).add(ring(V.pulse2)).add(ring(V.pulse3));
  // Horizon (bassMode 1): each bass note sends a waveform line off the horizon, rolling down over
  // the floor towards you and fading, a stack of them like an old Fairlight's waterfall display.
  const wline = (p: any, k: number) => {
    const y = float(0.04).sub(p.mul(0.5));
    const wav = sin(az.mul(7.0 + k * 3).add(p.mul(4.0)).add(k * 1.7)).mul(0.5).add(sin(az.mul(19.0 + k * 5).sub(p.mul(6.0))).mul(0.25));
    const x = el.sub(y.add(wav.mul(0.07).mul(exp(p.mul(-1.2))))).div(0.009);
    return exp(x.mul(x).negate()).mul(exp(p.mul(-1.4)));
  };
  const horizon = wline(V.pulse0, 0).add(wline(V.pulse1, 1)).add(wline(V.pulse2, 2)).add(wline(V.pulse3, 3))
    .add(exp(abs(el).mul(-60.0)).mul(0.15));
  // Several circles (bassMode 2): 2, 4 or 6 centres round your gaze, each pulsing on the bass.
  let multi = float(0);
  for (let k = 0; k < 6; k++) {
    const on = step(float(k + 0.5), V.bassMode.y);
    const a = float(6.28318 * k).div(max(V.bassMode.y, 1.0)).add(U.showTime.mul(0.15));
    const c = normalize(V.gaze.mul(0.84).add(right.mul(cos(a)).add(up.mul(sin(a))).mul(0.54)));
    const ca = acos(clamp(dot(d, c), -1.0, 1.0));
    const cr = (p: any) => { const x = ca.sub(p.mul(0.9).mul(pMul)).div(0.04); return exp(x.mul(x).negate()).mul(exp(p.mul(-2.2))); };
    multi = multi.add(cr(V.pulse0).add(cr(V.pulse1)).add(cr(V.pulse2)).mul(on));
  }
  // Road (bassMode 3): a road on the floor running off to the horizon where you look; each bass
  // note is a bar of light racing down it towards you, and the kerbs glow with the bass.
  const gdir = normalize(vec2(V.gaze.x, V.gaze.z).add(vec2(0.0001, 0.0)));
  const gp = d.xz.div(max(d.y.negate(), 0.015)).mul(2.7);
  const along = dot(gp, gdir), across = gp.x.mul(gdir.y).sub(gp.y.mul(gdir.x));
  const onRoad = smoothstep(-0.01, -0.06, d.y).mul(step(0.0, along));
  const bar = (p: any) => { const x = along.sub(float(60.0).mul(exp(p.mul(-2.6)))).div(along.mul(0.04).add(0.2)); return exp(x.mul(x).negate()).mul(exp(p.mul(-1.0))); };
  const road = bar(V.pulse0).add(bar(V.pulse1)).add(bar(V.pulse2)).add(bar(V.pulse3)).mul(smoothstep(1.6, 1.2, abs(across)))
    .add(smoothstep(0.12, 0.0, abs(abs(across).sub(1.6))).mul(V.bands.y.mul(0.8).add(0.15)))
    .add(smoothstep(0.08, 0.0, abs(across)).mul(step(0.5, fract(along.mul(0.15).add(U.showTime.mul(2.0))))).mul(0.3))
    .mul(onRoad).mul(smoothstep(400.0, 20.0, along));
  // Filter swell (bassMode 4): no shape at all, the whole sky swells and opens up on each bass
  // note, brightest round the horizon, like a filter sweeping open.
  const swellP = (p: any) => exp(p.mul(-3.5));
  const swell = swellP(V.pulse0).add(swellP(V.pulse1)).add(swellP(V.pulse2)).add(swellP(V.pulse3))
    .mul(float(0.12).add(exp(abs(el).mul(-3.0)).mul(0.35)));
  const bm = V.bassMode.x;
  const inMode = (lo: number, hi: number) => step(float(lo), bm).mul(step(bm, float(hi)));
  const bass = rings4.mul(inMode(-1, 0.5)).add(horizon.mul(inMode(0.5, 1.5))).add(multi.mul(inMode(1.5, 2.5)))
    .add(road.mul(inMode(2.5, 3.5))).add(swell.mul(inMode(3.5, 9)));
  const bassCol = V.pa.add(V.pb.mul(cos(V.pc.mul(v.add(0.5)).add(V.pd).mul(6.28318)))).mul(bass).mul(1.4);
  // Melody: a wave of light round the horizon. Ahead of your gaze is what is coming, behind it what has played.
  const rel = atan(sin(az.sub(V.gazeAz)), cos(az.sub(V.gazeAz)));
  const w = texture(V.wave, vec2(rel.div(6.28318).add(0.5), 0.5));
  const target = w.r.sub(0.5).mul(1.6);
  const near = abs(el.sub(target));
  const waveA = smoothstep(0.035, 0.0, near).mul(1.6).add(smoothstep(0.22, 0.0, near).mul(0.3)).mul(w.g);
  const waveCol = paletteAt(rel.div(6.28318).mul(0.5).add(U.hue.mul(0.3))).mul(0.7).add(0.3).mul(waveA);
  // Lightning on the snare: a jagged bolt from the zenith down at boltAz.
  const dAz = atan(sin(az.sub(V.boltAz)), cos(az.sub(V.boltAz)));
  const jag = mx_noise_float(vec2(el.mul(9.0), V.boltSeed)).mul(0.12).add(mx_noise_float(vec2(el.mul(31.0), V.boltSeed.add(7.0))).mul(0.035));
  const boltLine = exp(abs(dAz.sub(jag)).mul(-90.0)).mul(smoothstep(-0.6, 0.2, el));
  const bolt = boltLine.mul(exp(V.boltT.mul(-9.0))).mul(1.8).add(exp(V.boltT.mul(-14.0)).mul(0.12));
  // Hats: sparks.
  const cell = floor(d.mul(160.0));
  const spark = step(0.985, hash(cell.dot(vec3(1.0, 57.0, 113.0)))).mul(smoothstep(0.4, 0.0, length(fract(d.mul(160.0)).sub(0.5))));
  const sparks = spark.mul(U.hat.mul(1.6).add(0.08));
  // Vector shapes hung in front of you (layers.x): nested spinning polygons or stars, drawn on
  // the plane facing your gaze, punching outwards on the kick. poly = (sides, nesting, spin, starriness).
  const fwd = max(dot(d, V.gaze), 0.001);
  const q = vec2(dot(d, right), dot(d, up)).div(fwd);
  const qa = atan(q.y, q.x), qr = length(q);
  let shapes = float(0);
  for (let i = 0; i < 5; i++) {
    const n = V.poly.x;
    const turn = U.showTime.mul(V.poly.z).mul(i % 2 ? -1.0 : 1.0).add(i * 0.4);
    const sector = float(6.28318).div(n);
    const aa = qa.add(turn);
    const local = abs(fract(aa.div(sector)).sub(0.5)).mul(sector);
    // Polygon edge distance, bent towards a star by poly.w.
    const edge = cos(sector.mul(0.5)).div(cos(local)).mul(float(1.0).sub(V.poly.w.mul(abs(local).div(sector.mul(0.5)).oneMinus()).mul(0.45)));
    const size = float(0.18 + i * 0.22).mul(float(1.0).add(U.kick.mul(0.25))).mul(step(float(i), V.poly.y));
    const dist = abs(qr.sub(size.mul(edge)));
    shapes = shapes.add(smoothstep(0.012, 0.0, dist).mul(step(0.01, size)).mul(1.0 - i * 0.12));
  }
  const shapeCol = paletteAt(qr.mul(0.5).add(V.mixes.w)).mul(shapes).mul(float(0.7).add(U.kick.mul(0.6)));
  // Band ribbons round the horizon (layers.y): drums low, bass in the middle, the rest high, each as
  // thick as its stem is loud and rippling with it.
  const ribbon = (y: number, lvl: any, freq: number, colShift: number) => {
    const yy = float(y).add(sin(az.mul(freq).add(U.showTime.mul(1.3 + freq * 0.2))).mul(lvl.mul(0.12)));
    const a = smoothstep(lvl.mul(0.05).add(0.004), 0.0, abs(el.sub(yy)));
    return V.pa.add(V.pb.mul(cos(V.pc.mul(float(colShift).add(azP.div(6.28318))).add(V.pd).mul(6.28318)))).mul(a).mul(lvl);
  };
  const ribbons = ribbon(-0.35, V.bands.x, 6.0, 0.0).add(ribbon(-0.05, V.bands.y, 3.0, 0.33)).add(ribbon(0.3, V.bands.z, 9.0, 0.66)).mul(1.4);
  // Starfield (3): stars streaming out of your gaze, faster with the energy.
  const lanes = qa.mul(90.0 / 6.28318), lane = floor(lanes), lh = hash(lane);
  const head = fract(lh.mul(13.7).add(U.showTime.mul(float(0.15).add(lh.mul(0.3)).mul(float(0.6).add(U.energy).add(V.rise))))).mul(2.4);
  const streak = smoothstep(head.sub(float(0.04).add(U.kick.mul(0.08))), head, qr).mul(float(1).sub(smoothstep(head, head.add(0.01), qr)))
    .mul(step(0.6, hash(lane.add(3.0)))).mul(smoothstep(0.5, 0.1, abs(fract(lanes).sub(0.5)))).mul(step(0.0, dot(d, V.gaze)));
  const stars = mix(vec3(0.8, 0.9, 1.0), paletteAt(lh), 0.4).mul(streak).mul(1.6);
  // Kick tunnel (4): a polygon ring flung outwards from your gaze on every kick.
  const kx = qr.sub(V.kickT.mul(1.8).mul(pMul)).div(0.03);
  const kx2 = qr.sub(V.kickT.mul(1.8).add(0.35).mul(pMul)).div(0.02);
  const kickRing = exp(kx.mul(kx).negate()).mul(exp(V.kickT.mul(-1.8))).add(exp(kx2.mul(kx2).negate()).mul(exp(V.kickT.mul(-2.5))).mul(0.5));
  const kickCol = paletteAt(V.kickT.add(U.hue)).mul(kickRing).mul(1.5).mul(step(0.0, dot(d, V.gaze)));
  // Drum floor (7): a grid on the ground streaming towards you; cells flash with the drums.
  const below = smoothstep(-0.02, -0.12, d.y);
  const fp = d.xz.div(max(d.y.negate(), 0.02)).mul(2.0).add(vec2(0.0, U.showTime.mul(3.0)));
  const fl = fract(fp), fc = floor(fp);
  const lines = smoothstep(0.06, 0.0, min(min(fl.x, fl.y), min(fl.x.oneMinus(), fl.y.oneMinus())));
  const lit = step(float(1.0).sub(V.bands.x.mul(0.6)).sub(U.kick.mul(0.25)), hash(fc.dot(vec2(1.0, 57.0)).add(floor(U.showTime.mul(4.0)))));
  const fade = smoothstep(-0.02, -0.4, d.y);
  const floorCol = paletteAt(hash(fc.dot(vec2(7.0, 3.0))).add(U.hue)).mul(lit.mul(0.8).add(lines.mul(0.6))).mul(below).mul(fade.mul(0.8).add(0.2));
  // Bass mountains (9): a wireframe range on the horizon as tall as the bass is loud.
  const hgt = float(0.03).add(V.bands.y.mul(float(0.12).add(mx_noise_float(vec2(azP.mul(3.0), U.showTime.mul(0.15))).mul(0.5).add(0.5).mul(0.3))));
  const outline = smoothstep(0.012, 0.0, abs(el.sub(hgt)));
  const hatch = smoothstep(0.15, 0.0, abs(fract(azP.mul(40.0)).sub(0.5))).mul(step(el, hgt)).mul(smoothstep(-0.06, 0.0, el)).mul(0.35);
  const mountains = paletteAt(el.mul(2.0).add(0.2)).mul(outline.add(hatch)).mul(float(0.6).add(V.bands.y));
  // Note circle (13): the twelve note names in a ring round your gaze; each lights as it is played.
  const pcIdx = floor(qa.div(6.28318).add(0.5).mul(12.0));
  const act = texture(V.notes, vec2(pcIdx.add(0.5).div(16.0), 0.5)).r;
  const band = smoothstep(0.08, 0.0, abs(qr.sub(0.75))).mul(smoothstep(0.45, 0.4, abs(fract(qa.div(6.28318).add(0.5).mul(12.0)).sub(0.5))));
  const circle = palette(pcIdx.div(12.0)).mul(band).mul(act.mul(1.8).add(0.05)).mul(step(0.0, dot(d, V.gaze)));
  // Aurora (14): curtains of light across the sky, swaying with the pads.
  const ax = azP.mul(3.0).add(mx_noise_float(vec2(azP.mul(1.5), U.showTime.mul(0.08))).mul(1.5));
  const curtain = pow(abs(sin(ax.mul(4.0).add(U.showTime.mul(0.2)))), 6.0).mul(smoothstep(0.12, 0.45, el)).mul(smoothstep(1.3, 0.6, el));
  const aurora = mix(vec3(0.1, 1.0, 0.6), paletteAt(el.add(azP.div(6.28318))), 0.5).mul(curtain).mul(V.pad.mul(1.4).add(0.1));
  // Nebula (15): soft clouds that bloom with the pads.
  const neb = pow(mx_noise_float(d.mul(1.8).add(U.showTime.mul(0.02))).mul(0.5).add(0.5).mul(mx_noise_float(d.mul(4.2).add(3.0)).mul(0.5).add(0.5)), 2.0);
  const nebula = paletteAt(neb.add(U.hue)).mul(neb).mul(V.pad.mul(1.6).add(0.15));
  // Fractal kaleidoscope (16): a Kali-style fold-and-invert fractal (p = |p| / p.p - c, nine
  // times over), entered through a kaleidoscope of frac.x mirrors round your gaze. Every fold of
  // the formula mirrors all three axes at once, so it is a kaleidoscope of kaleidoscopes. The slice
  // drifts through the fractal over time, the bass breathes its scale and the kick jolts it.
  const rightK = normalize(vec3(V.gaze.z.negate(), 0.0, V.gaze.x).add(vec3(0.0001, 0.0, 0.0)));
  const upK = normalize(cross(rightK, V.gaze));
  const ka = atan(dot(d, upK), dot(d, rightK));
  const kr = acos(clamp(dot(d, V.gaze), -1.0, 1.0));
  const ksec = float(6.28318).div(max(V.frac.x, 1.0));
  const kaF = abs(fract(ka.div(ksec).add(0.5)).sub(0.5)).mul(ksec).add(U.showTime.mul(V.frac.w).mul(0.2));
  const kScale = V.frac.y.mul(float(1.0).add(V.bands.y.mul(0.25)));
  const fract3 = Fn(() => {
    const pp = vec3(cos(kaF).mul(kr), sin(kaF).mul(kr), sin(U.showTime.mul(V.frac.w).mul(0.13)).mul(0.6))
      .mul(kScale).add(vec3(0.0, 0.0, 0.3)).toVar();
    const cc = vec3(V.frac.z, V.frac.z.mul(0.86), V.frac.z.mul(0.62).add(U.kick.mul(0.05)));
    const trapLine = float(9.0).toVar();
    const trapDot = float(9.0).toVar();
    for (let i = 0; i < 9; i++) {
      pp.assign(abs(pp).div(max(dot(pp, pp), 0.02)).sub(cc));
      trapLine.assign(min(trapLine, abs(pp.y)));
      trapDot.assign(min(trapDot, length(pp.xz)));
    }
    return vec2(trapLine, trapDot);
  })();
  const kFil = exp(fract3.x.mul(-28.0)), kDot = exp(fract3.y.mul(-5.0));
  // Kept off the very centre of your gaze, so it frames the view rather than staring back at you.
  const kCentre = smoothstep(0.08, 0.7, kr);
  const fractCol = paletteAt(fract3.y.mul(0.9).add(V.mixes.w)).mul(kFil.mul(0.75).add(kDot.mul(0.25)))
    .mul(float(0.4).add(U.kick.mul(0.3)).add(V.rise.mul(0.25))).mul(kCentre.mul(0.85).add(0.15));
  // The mix: each element times its weight (E0..E3 hold the 16 weights; see visualiser.ts ELEMENTS).
  const col = base.mul(V.E0.x).add(shapeCol.mul(V.E0.y)).add(ribbons.mul(V.E0.z)).add(stars.mul(V.E0.w))
    .add(kickCol.mul(V.E1.x)).add(vec3(0.85, 0.9, 1.0).mul(bolt).mul(V.E1.y)).add(vec3(sparks).mul(V.E1.z)).add(floorCol.mul(V.E1.w))
    .add(bassCol.mul(V.E2.x)).add(mountains.mul(V.E2.y))
    .add(waveCol.mul(V.E2.w)).add(circle.mul(V.E3.y))
    .add(aurora.mul(V.E3.z)).add(nebula.mul(V.E3.w))
    .add(fractCol.mul(V.E4.x))
    .add(moreElements(V, { d, az, azP, el, q, qa, qr, paletteAt, front: step(0.0, dot(d, V.gaze)) }));
  // The song's arc (visualiser.ts updateArc): muted and dim early on, full colour at the climax;
  // greyer and darker while it holds its breath before a drop, then a burst of light as it lets go.
  // Three journeys, one per era (journey = weights of colour rise, complexity bloom, thaw):
  //   colour rise       saturation and light both climb with the arc
  //   complexity bloom  full colour all along; visualiser.ts adds elements and folds instead
  //   thaw              icy monochrome that warms into the scene's palette
  const grey = dot(col, vec3(0.3, 0.5, 0.2));
  const satRise = float(0.25).add(V.arc.mul(0.95));
  const sat = clamp(satRise.mul(V.journey.x).add(V.journey.y).add(V.journey.z)
    .sub(V.tension.mul(0.45)).add(V.release.mul(0.5)), 0.0, 1.3);
  const level = float(0.35).add(V.arc.mul(0.85)).mul(V.journey.x)
    .add(float(0.8).add(V.arc.mul(0.25)).mul(V.journey.y))
    .add(float(0.6).add(V.arc.mul(0.5)).mul(V.journey.z))
    .mul(float(1.0).sub(V.tension.mul(0.35))).add(V.release.mul(0.6))
    // While flowers, bubbles and the like are on, the backdrop steps back so they read on top of it.
    .mul(float(1.0).sub(V.dim));
  const satCol = max(mix(vec3(grey), col, sat), vec3(0.0));
  const icy = vec3(0.35, 0.62, 1.0).mul(grey).mul(1.4);
  const thawed = mix(icy, satCol, min(smoothstep(0.25, 0.9, V.arc).add(V.release.mul(0.4)), 1.0));
  const arcLin = mix(satCol, thawed, V.journey.z).mul(level);
  // A soft shoulder so layered elements never blow out to white: colours stay colours.
  let arcCol = arcLin.div(float(1.0).add(dot(arcLin, vec3(0.3, 0.5, 0.2)).mul(0.8)));
  // Winding up for a lift (V.tension): rings converge on your gaze faster and faster, and the
  // light strobes on the beat, eighths then sixteenths, as the moment nears.
  // Not always rings: the wind-up takes the scene's bass style. Rings (shaped like the pulses) for
  // rings and circles, lines closing in on the horizon for the horizon and the road, a spiral for the swell.
  const angT0 = acos(clamp(dot(d, V.gaze), -1.0, 1.0));
  // The angle round the gaze jumps by a full turn along one line (straight out to the left of your
  // gaze), so the spiral takes a whole number of arms (two) per turn: the jump lands on itself and
  // leaves no seam. The shockwave, a single ring, never spirals.
  const angS = select(bm.lessThan(0.5).or(bm.greaterThan(1.5).and(bm.lessThan(2.5))), angT0.div(pMul),
    select(bm.lessThan(3.5), abs(el).mul(1.3), angT0));
  const angT = angS.add(select(bm.greaterThan(3.5), th.mul(2.0 / (2.5 * 6.28318)), float(0.0)));
  const conv = pow(fract(angT.mul(2.5).add(U.showTime.mul(float(0.6).add(V.tension.mul(3.0))))), 18.0);
  const strobeRate = select(V.tension.greaterThan(0.7), float(4.0), float(2.0));
  const strobe = step(0.5, fract(U.beatPhase.mul(strobeRate))).mul(smoothstep(0.35, 0.9, V.tension));
  // The lift lands (V.releaseT seconds ago): a shockwave out of your gaze.
  const shockX = angS.sub(V.releaseT.mul(2.6)).div(0.09);
  const shock = exp(shockX.mul(shockX).negate()).mul(exp(V.releaseT.mul(-1.2)));
  const windUp = paletteAt(angS.mul(0.3).add(V.mixes.w)).mul(conv.mul(V.tension).mul(0.9)).add(vec3(shock.mul(1.4)));
  arcCol = arcCol.mul(float(1.0).sub(strobe.mul(0.45))).add(windUp);
  // The crash: an inverted flash that tears the old scene down.
  m.colorNode = mix(arcCol, vec3(1.0).sub(arcCol).add(V.crash.mul(0.6)), V.crash.mul(0.85));
  return m;
}

/**
 * The sprites the visualiser's spawners throw into the sky (flowers, bubbles, starbursts, confetti,
 * snowflakes): additive, coloured per instance. 'petal' is bright at the heart with veins, 'flat'
 * is an even glow (rings, confetti), 'spike' fades from a hot centre out along the arms.
 */
export function makeSpriteMaterial(style: 'petal' | 'flat' | 'spike' = 'petal'): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.blending = THREE.AdditiveBlending;
  // positionGeometry, not positionLocal: on an instanced mesh positionLocal is already moved by
  // the instance matrix, so the shape would be lost (that is why the flowers were slivers).
  const r = length(positionGeometry.xy);
  if (style === 'flat') m.colorNode = vec3(0.9);
  else if (style === 'spike') m.colorNode = vec3(smoothstep(0.25, 0.0, r).mul(1.8).add(smoothstep(1.0, 0.0, r).mul(0.8)));
  else {
    const heart = smoothstep(0.35, 0.0, r).mul(1.6);
    const petal = smoothstep(1.0, 0.3, r).mul(0.7);
    const veins = sin(atan(positionGeometry.y, positionGeometry.x).mul(18.0)).mul(0.15).add(0.85);
    m.colorNode = vec3(heart.add(petal.mul(veins)));
  }
  return m;
}

/**
 * The second set of sky elements (slots 21..50; visualiser.ts ELEMENTS has the list).
 * Each one is only worked out while its weight is above zero (one branch per element), so a big
 * library costs nothing while it waits its turn. Inspirations: classic music visualisers (the bar
 * spectrum, Milkdrop's caustics), the demoscene (checker tunnels, copper bars, rotozoomers,
 * metaballs, Julia sets, truchet tiles, fire) and club lighting (lasers, the glitterball).
 */
function moreElements(V: any, g: any) {
  // (an Fn, because If and Loop need a shader function to put their branches in)
  return Fn(() => moreElementsBody(V, g))();
}

function moreElementsBody(V: any, g: any) {
  // Shared inputs are worked out up front: a node first used inside one element's branch would
  // only be computed there, and every later branch would read it as zero.
  const { paletteAt } = g;
  const d = g.d.toVar(), azP = g.azP.toVar(), el = g.el.toVar(), q = g.q.toVar(), qa = g.qa.toVar(), qr = g.qr.toVar(), front = g.front.toVar();
  const az = g.az.toVar();
  const out = vec3(0.0).toVar();
  const E = [V.E0, V.E1, V.E2, V.E3, V.E4, V.E5, V.E6, V.E7, V.E8, V.E9, V.E10, V.E11, V.E12];
  const w = (i: number) => E[i >> 2][['x', 'y', 'z', 'w'][i & 3]];
  const on = (i: number, build: () => any) => {
    If(w(i).greaterThan(0.001), () => { out.addAssign(build().mul(w(i))); });
  };
  const T = U.showTime;
  // 42 Sine scroller: the song's name round the horizon, every letter riding a sine wave that
  // swings wider with the melody, scrolling past.
  on(42, () => {
    const u = az.div(6.28318).mul(2.0).add(T.mul(0.035));
    const yc = float(0.22).add(sin(u.mul(40.0).add(T.mul(3.0))).mul(float(0.05).add(V.bands.z.mul(0.08))));
    const v = el.sub(yc).div(0.16).add(0.5);
    const inside = step(0.0, v).mul(step(v, 1.0));
    const tx = texture(V.scroll, vec2(fract(u), v.oneMinus()));
    const shine = float(0.8).add(U.kick.mul(0.5));
    return tx.rgb.mul(tx.a).mul(inside).mul(shine).mul(1.6).add(paletteAt(u.add(T.mul(0.1))).mul(tx.a).mul(inside).mul(0.3));
  });
  // 21 Spectrum: the classic bar analyser round the horizon, with its reflection below.
  on(21, () => {
    const sb = azP.div(3.14159).mul(48.0), sbi = floor(sb);
    const k = mod(sbi, 3.0);
    const lv = select(k.lessThan(0.5), V.bands.x, select(k.lessThan(1.5), V.bands.y, V.bands.z))
      .mul(float(0.55).add(hash(sbi.add(floor(T.mul(7.0)))).mul(0.45)));
    const h = float(0.03).add(lv.mul(0.45));
    const ae = abs(el);
    const bar = step(ae, h).mul(smoothstep(0.5, 0.36, abs(fract(sb).sub(0.5))));
    const seg = step(0.3, fract(ae.mul(60.0)));
    return paletteAt(sbi.div(48.0).add(U.hue.mul(0.5))).mul(bar).mul(seg).mul(mix(float(0.3), float(1.0), smoothstep(-0.08, 0.08, el))).mul(ae.div(h).add(0.4));
  });
  // 22 Checker tunnel: falling down a chequered tube round your gaze; the kick shoves you on.
  on(22, () => {
    const tu = qa.div(6.28318).mul(10.0).add(T.mul(0.08));
    const tv = float(0.6).div(qr.add(0.04)).add(T.mul(1.6)).add(V.kickT.mul(-0.0)).add(U.kick.mul(0.4));
    const chk = abs(step(0.5, fract(tu)).sub(step(0.5, fract(tv))));
    return paletteAt(floor(tv).mul(0.07).add(U.hue)).mul(chk.mul(0.75).add(0.12)).mul(smoothstep(0.0, 0.5, qr)).mul(front).mul(0.8);
  });
  // 23 Copper bars: Amiga raster bars bouncing up and down the sky.
  on(23, () => {
    const acc = vec3(0.0).toVar();
    for (let i = 0; i < 6; i++) {
      const y = sin(T.mul(0.7 + i * 0.13).add(i * 1.1)).mul(0.55);
      const x = el.sub(y).div(0.05);
      const bar = exp(x.mul(x).negate());
      acc.addAssign(paletteAt(float(i / 6).add(U.hue)).mul(pow(bar, 0.7)).mul(float(0.5).add(bar.mul(0.8))));
    }
    return acc.mul(float(0.6).add(U.kick.mul(0.5)));
  });
  // 24 Synthwave sun: a striped sun sinking into the horizon ahead of you, swelling with the bass.
  on(24, () => {
    const dA = atan(sin(az.sub(V.gazeAz)), cos(az.sub(V.gazeAz)));
    const rho = length(vec2(dA, el.sub(0.14)));
    const R = float(0.3).mul(float(1.0).add(V.bands.y.mul(0.2)).add(U.kick.mul(0.05)));
    const disk = smoothstep(R, R.sub(0.008), rho);
    const cut = mix(float(1.0), step(0.38, fract(float(0.14).sub(el).mul(24.0).sub(T.mul(0.5)))), step(el, 0.14));
    const sun = mix(vec3(1.0, 0.85, 0.25), vec3(1.0, 0.18, 0.55), smoothstep(0.44, -0.16, el)).mul(disk).mul(cut).mul(1.3);
    const halo = exp(rho.sub(R).max(0.0).mul(-7.0)).mul(0.35).mul(float(1.0).sub(disk));
    return sun.add(mix(vec3(1.0, 0.3, 0.6), paletteAt(rho), 0.3).mul(halo)).mul(smoothstep(-0.04, 0.01, el));
  });
  // 25 Metaballs: five blobs orbiting your gaze, swelling with the bass, merging and parting.
  on(25, () => {
    const field = float(0.0).toVar();
    for (let i = 0; i < 5; i++) {
      const c = vec2(cos(T.mul(0.5 + i * 0.11).add(i * 1.3)), sin(T.mul(0.7 + i * 0.13).add(i * 2.1))).mul(0.5);
      const r = float(0.11 + i * 0.01).mul(float(1.0).add(V.bands.y.mul(0.7)).add(U.kick.mul(0.3)));
      const dd = q.sub(c);
      field.addAssign(r.mul(r).div(dot(dd, dd).add(0.0001)));
    }
    const edge = smoothstep(0.25, 0.0, abs(field.sub(1.0)));
    const fill = smoothstep(0.9, 1.6, field);
    return paletteAt(field.mul(0.15).add(U.hue)).mul(edge.mul(1.2).add(fill.mul(0.35))).mul(front);
  });
  // 26 Julia set: its shape is steered by the melody's pitch, so the tune bends the fractal.
  on(26, () => {
    const a = V.pitches.x.mul(0.21).add(T.mul(0.04));
    const c = vec2(cos(a), sin(a)).mul(0.7885);
    const ca = cos(T.mul(0.05)), sa = sin(T.mul(0.05));
    const z = vec2(q.x.mul(ca).sub(q.y.mul(sa)), q.x.mul(sa).add(q.y.mul(ca))).mul(1.5).toVar();
    const n = float(0.0).toVar();
    Loop(28, () => {
      z.assign(vec2(z.x.mul(z.x).sub(z.y.mul(z.y)), z.x.mul(z.y).mul(2.0)).add(c));
      n.addAssign(step(dot(z, z), 4.0));
    });
    const f = n.div(28.0);
    return paletteAt(f.mul(1.5).add(U.hue)).mul(pow(f, 1.6)).mul(1.4).mul(front).mul(smoothstep(1.8, 1.1, qr));
  });
  // 27 Stained glass: cells on the sky with glowing leading; cells flash on the hats.
  on(27, () => {
    const p = d.mul(5.0).add(vec3(0.0, T.mul(0.05), 0.0));
    const f1 = mx_worley_noise_float(p);
    const lead = smoothstep(0.5, 0.8, f1);
    const cellId = floor(p.add(0.5));
    const flash = step(0.82, hash(cellId.dot(vec3(1.0, 57.0, 113.0)).add(floor(T.mul(6.0))))).mul(U.hat.add(0.15));
    return paletteAt(hash(cellId.dot(vec3(7.0, 3.0, 11.0))).add(U.hue)).mul(float(1.0).sub(lead).mul(flash.mul(0.9).add(0.12))).add(vec3(lead.mul(0.25)));
  });
  // 28 Moire: two sets of rings drifting through each other.
  on(28, () => {
    const p1 = vec2(sin(T.mul(0.23)), cos(T.mul(0.17))).mul(0.35), p2 = vec2(cos(T.mul(0.19)), sin(T.mul(0.29))).mul(0.35);
    const m = sin(length(q.sub(p1)).mul(70.0).sub(T.mul(2.0))).mul(sin(length(q.sub(p2)).mul(70.0).sub(T.mul(2.3))));
    return paletteAt(length(q.sub(p1)).add(U.hue)).mul(smoothstep(0.2, 0.9, m)).mul(0.7).mul(front).mul(smoothstep(2.2, 0.6, qr));
  });
  // 29 Lissajous: the oscilloscope classic, its frequencies picked by the melody and bass notes.
  on(29, () => {
    const fa = mod(floor(V.pitches.x), 5.0).add(1.0), fb = mod(floor(V.pitches.y), 4.0).add(1.0);
    const dmin = float(9.0).toVar();
    Loop(120, ({ i }) => {
      const sP = float(i).div(120.0).mul(6.28318);
      const p = vec2(sin(fa.mul(sP).add(T.mul(0.6))), sin(fb.mul(sP))).mul(0.62);
      dmin.assign(min(dmin, length(q.sub(p))));
    });
    return paletteAt(T.mul(0.05).add(U.hue)).mul(smoothstep(0.014, 0.0, dmin).mul(1.6).add(smoothstep(0.08, 0.0, dmin).mul(0.25))).mul(front).mul(float(0.7).add(V.bands.z));
  });
  // 30 Hex pulse: a honeycomb in front of you; each kick sends a ripple out through the cells.
  on(30, () => {
    const hs = q.mul(7.0);
    const r = vec2(1.0, 1.732), h = r.mul(0.5);
    const a = mod(hs, r).sub(h), b = mod(hs.sub(h), r).sub(h);
    const gv = select(dot(a, a).lessThan(dot(b, b)), a, b);
    const id = hs.sub(gv);
    const hd = max(dot(abs(gv), normalize(vec2(1.0, 1.732))), abs(gv).x);
    const x = length(id).div(7.0).sub(V.kickT.mul(1.2)).div(0.09);
    const ring = exp(x.mul(x).negate()).mul(exp(V.kickT.mul(-1.2)));
    return paletteAt(length(id).mul(0.04).add(U.hue)).mul(smoothstep(0.42, 0.5, hd).mul(0.35).add(ring.mul(float(0.5).sub(hd)).mul(2.5))).mul(front);
  });
  // 31 Galaxy: a spiral turning overhead, its stars thickening with the pads.
  on(31, () => {
    const ra = acos(clamp(d.y, -1.0, 1.0));
    const th = atan(d.z, d.x);
    const arms = sin(th.mul(3.0).sub(log2(ra.add(0.02)).mul(4.0)).add(T.mul(0.4)));
    const spiral = pow(arms.mul(0.5).add(0.5), 4.0).mul(smoothstep(1.3, 0.05, ra));
    const dust = step(0.985, hash(floor(d.mul(240.0)).dot(vec3(1.0, 57.0, 113.0)))).mul(spiral.add(0.1));
    return paletteAt(ra.mul(0.6).add(U.hue)).mul(spiral.mul(V.pad.mul(0.8).add(0.35))).add(vec3(dust.mul(1.4)));
  });
  // 32 Lasers: fans of beams from below the horizon, sweeping; the snare fires them.
  on(32, () => {
    const acc = float(0.0).toVar();
    for (let o = -1; o <= 1; o++) {
      const dA = atan(sin(az.sub(V.gazeAz).sub(o * 0.7)), cos(az.sub(V.gazeAz).sub(o * 0.7)));
      const v = vec2(dA, el.add(0.3));
      for (let k = 0; k < 7; k++) {
        const ph = float(-1.0 + k * 0.33).add(sin(T.mul(1.1 + o * 0.3).add(k)).mul(0.25));
        const dist = abs(v.x.mul(cos(ph)).sub(v.y.mul(sin(ph))));
        const along = v.x.mul(sin(ph)).add(v.y.mul(cos(ph)));
        acc.addAssign(exp(dist.mul(-260.0)).mul(step(0.0, along)).mul(smoothstep(1.6, 0.0, along)));
      }
    }
    return paletteAt(el.mul(0.5).add(U.hue)).mul(acc).mul(U.snare.mul(1.6).add(0.25));
  });
  // 33 Truchet: arcs tiled in front of you that flip, tile by tile, on the beat.
  on(33, () => {
    const p = q.mul(6.0);
    const cid = floor(p);
    const flip = step(0.5, hash(cid.dot(vec2(1.0, 57.0)).add(floor(T.mul(2.0)))));
    const f = fract(p);
    const ff = vec2(mix(f.x, float(1.0).sub(f.x), flip), f.y);
    const dd = min(abs(length(ff).sub(0.5)), abs(length(ff.sub(1.0)).sub(0.5)));
    return paletteAt(hash(cid.dot(vec2(3.0, 7.0))).add(U.hue)).mul(smoothstep(0.07, 0.0, dd)).mul(front).mul(smoothstep(2.2, 0.5, qr));
  });
  // 34 Fire: flames licking up from the horizon, as tall as the bass and the energy.
  on(34, () => {
    const n = mx_noise_float(vec3(azP.mul(5.0), el.mul(7.0).sub(T.mul(2.4)), T.mul(0.3)));
    const top = float(0.06).add(V.bands.y.mul(0.25)).add(U.energy.mul(0.15));
    const f = clamp(top.sub(el).div(top).add(n.mul(0.45)), 0.0, 1.0).mul(smoothstep(-0.08, 0.0, el));
    return mix(mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.85, 0.35), f), paletteAt(f.add(U.hue)), 0.25).mul(pow(f, 2.0)).mul(1.5);
  });
  // 35 Caustics: light through water rippling across the sky, brightening with the pads.
  on(35, () => {
    const p = d.xz.div(d.y.add(1.2)).mul(6.0);
    const ii = p.toVar();
    const c = float(1.0).toVar();
    for (let n = 0; n < 4; n++) {
      const tt = T.mul(0.35).mul(1.0 - 3.5 / (n + 1));
      ii.assign(p.add(vec2(cos(tt.sub(ii.x)).add(sin(tt.add(ii.y))), sin(tt.sub(ii.y)).add(cos(tt.add(ii.x))))));
      c.addAssign(float(1.0).div(length(vec2(p.x.div(sin(ii.x.add(tt)).div(0.005)), p.y.div(cos(ii.y.add(tt)).div(0.005))))));
    }
    const cc = pow(abs(float(1.17).sub(pow(c.div(4.0), 1.4))), 8.0);
    return mix(vec3(0.1, 0.5, 0.7), paletteAt(cc.add(U.hue)), 0.5).mul(clamp(cc, 0.0, 2.0)).mul(V.pad.mul(0.8).add(0.3)).mul(smoothstep(-0.2, 0.3, el));
  });
  // 36 Rotozoomer: a plaid that spins and zooms in front of you, kicked round on the beat.
  on(36, () => {
    const an = T.mul(0.3).add(U.beatPhase.mul(0.15));
    const zm = float(1.6).add(sin(T.mul(0.4)).mul(0.8)).add(U.kick.mul(0.3));
    const p = vec2(q.x.mul(cos(an)).sub(q.y.mul(sin(an))), q.x.mul(sin(an)).add(q.y.mul(cos(an)))).mul(zm).mul(4.0);
    const pat = sin(p.x).mul(sin(p.y)).add(sin(p.x.mul(0.5).add(p.y.mul(0.5))).mul(0.5));
    return paletteAt(pat.mul(0.3).add(U.hue)).mul(smoothstep(-0.1, 0.4, pat).mul(0.7).add(0.1)).mul(front).mul(smoothstep(2.4, 0.6, qr));
  });
  // 37 Light rain: columns of falling light, as bright as the melody is loud.
  on(37, () => {
    const cx = azP.div(3.14159).mul(80.0), ci = floor(cx);
    const sp = float(0.25).add(hash(ci).mul(0.5));
    const head = float(1.3).sub(fract(hash(ci.add(5.0)).mul(7.0).add(T.mul(sp).mul(0.5))).mul(2.6));
    const tail = el.sub(head);
    const trail = step(0.0, tail).mul(exp(tail.mul(-5.0))).mul(smoothstep(0.5, 0.25, abs(fract(cx).sub(0.5))));
    const glyph = step(0.35, hash(ci.add(floor(el.mul(40.0))).add(floor(T.mul(3.0)))));
    return mix(vec3(0.3, 1.0, 0.5), paletteAt(ci.mul(0.01).add(U.hue)), 0.5).mul(trail.mul(glyph.mul(0.6).add(0.4))).mul(V.bands.z.mul(1.2).add(0.2));
  });
  // 43 Atom: the atomic age's favourite picture. Three orbits round a nucleus that throbs with the
  // bass; the electrons speed up with the energy and flare on the hats.
  on(43, () => {
    const acc = vec3(0.0).toVar();
    const nucR = float(0.06).mul(float(1.0).add(V.bands.y.mul(0.8)).add(U.kick.mul(0.3)));
    for (let k = 0; k < 3; k++) {
      const ang = T.mul(0.05).add(k * 1.0472);
      const ca = cos(ang), sa = sin(ang);
      const p = vec2(q.x.mul(ca).add(q.y.mul(sa)), q.y.mul(ca).sub(q.x.mul(sa)));
      const e = length(p.div(vec2(0.55, 0.16)));
      const ring = smoothstep(0.07, 0.0, abs(e.sub(1.0)));
      const th = T.mul(float(1.4 + k * 0.35).mul(float(1.0).add(U.energy))).add(k * 2.0);
      const dd = length(p.sub(vec2(cos(th).mul(0.55), sin(th).mul(0.16))));
      const electron = smoothstep(0.028, 0.0, dd).mul(1.6).add(exp(dd.mul(-28.0)).mul(float(0.3).add(U.hat.mul(0.6))));
      acc.addAssign(paletteAt(float(k / 3).add(U.hue)).mul(ring.mul(0.45).add(electron)));
    }
    const nucleus = smoothstep(nucR, nucR.mul(0.5), qr).mul(1.5).add(exp(qr.mul(-9.0)).mul(0.35));
    return acc.add(paletteAt(U.hue.add(0.5)).mul(nucleus)).mul(front);
  });
  // 44 Oil wheel: the 60s liquid light show, coloured oils squeezed between glass on a projector,
  // all the way round you. The bass presses the glass; the blobs swim, merge and split.
  on(44, () => {
    const sw = T.mul(0.12);
    const p = d.mul(float(1.6).add(V.bands.y.mul(0.3)));
    const w1 = vec3(mx_noise_float(p.add(vec3(0.0, sw, 0.0))), mx_noise_float(p.add(vec3(5.2, 1.3, sw))), mx_noise_float(p.add(vec3(sw, 9.1, 2.7))));
    const n = mx_noise_float(p.add(w1.mul(float(1.2).add(V.bands.y.mul(0.9)))).add(vec3(0.0, 0.0, sw)));
    const cells = n.mul(2.4).add(U.hue);
    const f = fract(cells);
    const rim = smoothstep(0.0, 0.07, f).mul(smoothstep(1.0, 0.93, f));
    const lens = float(0.7).add(smoothstep(-0.3, 0.4, n).mul(0.3));
    return pow(paletteAt(floor(cells).mul(0.27).add(U.hue)), vec3(1.8)).mul(1.4).mul(rim).mul(lens).mul(float(0.65).add(V.pad.mul(0.5)).add(U.kick.mul(0.15)));
  });
  // 45 Fireworks: shells going up all round the sky and bursting: rings of stars, peonies with
  // trails, golden willows drooping. A few go up on their own; most are cued (V.shells, set by the
  // visualiser from the score ahead): each rocket leaves the horizon RISE seconds early and bursts
  // exactly on its hit (a section change, a drop, a big snare, a cheering crowd).
  on(45, () => {
    const acc = vec3(0.0).toVar();
    const ce = cos(el);
    // One shell's burst: tau seconds since it burst (bt = 0..1 through its life).
    const burstAt = (dA: any, sEl: any, tau: any, bt: any, seed: any, willow: any, ringK: any, col: any) => {
      const R = float(0.15).add(hash(seed.add(0.31)).mul(0.17)).mul(float(1.0).sub(exp(tau.mul(-3.5))));
      const droop = tau.mul(tau).mul(float(0.02).add(willow.mul(0.05)));
      const v = vec2(dA, el.sub(sEl).add(droop));
      const r = length(v), a = atan(v.y, v.x);
      const N = floor(hash(seed.add(0.7)).mul(14.0)).add(18.0);
      const dAng = abs(fract(a.div(6.28318).mul(N).add(0.5)).sub(0.5)).mul(6.28318).div(N).mul(r);
      const tail = R.mul(mix(mix(float(0.55), float(0.15), willow), float(0.9), ringK));
      const streak = smoothstep(tail, R, r).mul(step(r, R.add(0.004))).mul(smoothstep(0.005, 0.0, dAng));
      const hr = r.sub(R);
      const head = exp(hr.mul(hr).add(dAng.mul(dAng)).mul(-30000.0));
      const crackle = mix(float(1.0), step(0.45, hash(floor(T.mul(25.0)).add(seed.mul(3.0)).add(floor(a.mul(N).div(6.28318))))), smoothstep(0.55, 0.85, bt));
      const live = step(0.0, tau).mul(step(bt, 1.0));
      const fade = pow(float(1.0).sub(clamp(bt, 0.0, 1.0)), 1.6).mul(live);
      const flash = exp(tau.mul(-9.0)).mul(exp(r.mul(-7.0))).mul(0.7).mul(live);
      return col.mul(streak.mul(0.9).add(head.mul(1.8)).mul(crackle).mul(fade).add(flash));
    };
    const rocketAt = (dA: any, rEl: any, on: any) => {
      // The rocket: a hot spark with a short fading trail beneath it.
      const dy = rEl.sub(el);
      const spark = exp(length(vec2(dA, dy)).mul(-260.0)).mul(1.5);
      const trail = exp(abs(dA).mul(-900.0)).mul(smoothstep(0.09, 0.0, dy)).mul(step(0.0, dy)).mul(0.5);
      return vec3(1.0, 0.85, 0.6).mul(spark.add(trail)).mul(on);
    };
    // Ambient shells on their own clocks.
    for (let i = 0; i < 8; i++) {
      const P = 1.4 + ((i * 0.618) % 1) * 1.6;
      const ph = T.div(P).add((i * 0.377) % 1);
      const n = floor(ph), f = fract(ph);
      const sAz = hash(n.mul(13.1).add(i * 7.3)).mul(6.28318).sub(3.14159);
      const sEl = hash(n.mul(5.7).add(i * 3.1)).mul(0.35).add(0.22);
      const kind = hash(n.mul(2.9).add(i * 1.7));
      const willow = step(0.72, kind), ringK = step(kind, 0.3);
      const col = mix(paletteAt(hash(n.mul(9.3).add(i))), vec3(1.0, 0.75, 0.35), willow.mul(0.8));
      const dA = atan(sin(az.sub(sAz)), cos(az.sub(sAz))).mul(ce);
      const lt = clamp(f.div(0.2), 0.0, 1.0);
      const rEl = sEl.mul(float(1.0).sub(float(1.0).sub(lt).mul(float(1.0).sub(lt))));
      acc.addAssign(rocketAt(dA, rEl, step(f, 0.2)));
      acc.addAssign(burstAt(dA, sEl, max(f.sub(0.2), 0.0).mul(P).sub(step(f, 0.2).mul(9.0)), clamp(f.sub(0.2).div(0.8), 0.0, 1.0), n.add(i * 0.31), willow, ringK, col));
    }
    // Cued shells: (burst time, azimuth, elevation, seed).
    for (let i = 0; i < V.shells.length; i++) {
      const sh = V.shells[i];
      const tau = T.sub(sh.x);
      const seed = sh.w;
      const kind = hash(seed.mul(2.9));
      const willow = step(0.72, kind), ringK = step(kind, 0.3);
      const col = mix(paletteAt(hash(seed.mul(9.3))), vec3(1.0, 0.75, 0.35), willow.mul(0.8));
      const dA = atan(sin(az.sub(sh.y)), cos(az.sub(sh.y))).mul(ce);
      const u = clamp(tau.div(SHELL_RISE).add(1.0), 0.0, 1.0);
      const rEl = mix(float(-0.03), sh.z, float(1.0).sub(float(1.0).sub(u).mul(float(1.0).sub(u))));
      acc.addAssign(rocketAt(dA, rEl, step(tau, 0.0).mul(step(float(-SHELL_RISE), tau))));
      acc.addAssign(burstAt(dA, sh.z, tau, tau.div(2.6), seed, willow, ringK, col).mul(1.3));
    }
    return acc.mul(float(0.8).add(U.kick.mul(0.6))).mul(smoothstep(-0.05, 0.02, el));
  });
  // 46 LED wall: a festival screen round the horizon, a coarse grid of LEDs with a new pattern
  // every couple of seconds: chevrons racing, a VU wall, a sweep on the beat, a strobing checker.
  on(46, () => {
    const gx = az.div(6.28318).add(0.5).mul(200.0), gy = el.add(0.02).div(0.5).mul(16.0);
    const inWall = step(0.0, gy).mul(step(gy, 16.0));
    const cx = floor(gx), cy = floor(gy);
    const led = smoothstep(0.45, 0.25, length(fract(vec2(gx, gy)).sub(0.5)));
    const u = cx.div(200.0), v = cy.div(16.0);
    const prog = mod(floor(T.mul(0.5)), 4.0);
    const chev = step(0.5, fract(abs(fract(u.mul(16.0)).sub(0.5)).mul(2.0).add(v.mul(1.5)).sub(T.mul(2.0))));
    const k3 = mod(cx, 3.0);
    const lv = select(k3.lessThan(0.5), V.bands.x, select(k3.lessThan(1.5), V.bands.y, V.bands.z)).mul(float(0.6).add(hash(cx.add(floor(T.mul(8.0)))).mul(0.4)));
    const vu = step(v, lv.mul(1.3));
    const sweep = step(abs(v.sub(U.beatPhase)), 0.12).add(U.kick.mul(0.4));
    const chk = abs(step(0.5, fract(u.mul(20.0))).sub(step(0.5, fract(v.mul(3.0).add(floor(T.mul(2.0)).mul(0.5))))));
    const pat = select(prog.lessThan(0.5), chev, select(prog.lessThan(1.5), vu, select(prog.lessThan(2.5), sweep, chk)));
    const col = paletteAt(u.mul(3.0).add(v.mul(0.3)).add(U.hue));
    return col.mul(pat.mul(float(0.6).add(U.kick.mul(0.8))).add(0.05)).mul(led).mul(inWall).mul(1.3);
  });
  // 47 Twister: the Amiga classic, a square bar twisting like rubber in front of you. The bass
  // wrings it harder; each face takes its own colour, shaded by how square-on it turns.
  on(47, () => {
    const acc = vec3(0.0).toVar();
    const y = q.y;
    const a = T.mul(1.2).add(y.mul(float(1.5).add(sin(T.mul(0.4)).mul(2.0)).add(V.bands.y.mul(2.5))));
    const x = q.x.sub(sin(y.mul(2.0).add(T)).mul(0.22));
    const w = float(0.34).mul(float(1.0).add(U.kick.mul(0.15)));
    for (let k = 0; k < 4; k++) {
      const a1 = a.add(k * 1.5708);
      const x1 = sin(a1).mul(w), x2 = sin(a1.add(1.5708)).mul(w);
      const inside = step(x1, x).mul(step(x, x2));
      const shade = x2.sub(x1).div(w.mul(1.414));
      const tt = x.sub(x1).div(max(x2.sub(x1), 0.0001));
      acc.addAssign(paletteAt(float(k * 0.25).add(U.hue)).mul(k % 2 ? 0.55 : 1.0).mul(inside).mul(float(0.2).add(shade.mul(0.9))).mul(float(0.8).add(sin(tt.mul(3.14159)).mul(0.3))));
    }
    return acc.mul(smoothstep(1.3, 1.1, abs(y))).mul(front).mul(1.2);
  });
  // 48 Kefrens bars: one shaded bar drawn on every line without clearing the screen, each line a
  // little further along a sine, so the bars stack into a snaking ribbon. The melody bends it.
  on(48, () => {
    const col = vec3(0.0).toVar();
    const found = float(0.0).toVar();
    const qk = q.div(1.5);
    const top = float(0.55);
    const r0 = top.sub(qk.y);
    Loop(40, ({ i }) => {
      If(found.lessThan(0.5), () => {
        const rr = r0.sub(float(i).mul(0.02));
        If(rr.greaterThanEqual(0.0), () => {
          const X = sin(rr.mul(5.0).add(T.mul(1.7))).mul(0.42).add(sin(rr.mul(11.0).sub(T.mul(1.1))).mul(float(0.12).add(V.bands.z.mul(0.2))));
          const dx = abs(qk.x.sub(X));
          If(dx.lessThan(0.05), () => {
            const g2 = float(1.0).sub(dx.div(0.05));
            col.assign(paletteAt(rr.mul(0.5).add(U.hue)).mul(float(0.25).add(pow(g2, 0.7).mul(1.1))).add(vec3(pow(g2, 8.0).mul(0.5))));
            found.assign(1.0);
          });
        });
      });
    });
    return col.mul(step(r0, 1.7)).mul(front);
  });
  // 49 Dot sphere: a globe of dots in 3D, spinning and melting into a torus and back; near dots
  // big and bright, far ones small and dim, all pumping on the kick.
  on(49, () => {
    const acc = vec3(0.0).toVar();
    const m = sin(T.mul(0.3)).mul(0.5).add(0.5);
    const ry = T.mul(0.7), rx = T.mul(0.4);
    const cy = cos(ry), sy = sin(ry), cx = cos(rx), sx = sin(rx);
    Loop(96, ({ i }) => {
      const fi = float(i);
      const t = fi.add(0.5).div(96.0);
      const ph = fi.mul(2.39996);
      const z = float(1.0).sub(t.mul(2.0));
      const rs = sqrt(max(float(1.0).sub(z.mul(z)), 0.0));
      const sph = vec3(cos(ph).mul(rs), z, sin(ph).mul(rs));
      const ta = floor(fi.div(8.0)).mul(0.5236), tb = mod(fi, 8.0).mul(0.7854);
      const rr = float(0.7).add(cos(tb).mul(0.3));
      const tor = vec3(cos(ta).mul(rr), sin(tb).mul(0.3), sin(ta).mul(rr));
      const p0 = mix(sph, tor, m);
      const p1 = vec3(p0.x.mul(cy).sub(p0.z.mul(sy)), p0.y, p0.x.mul(sy).add(p0.z.mul(cy)));
      const p = vec3(p1.x, p1.y.mul(cx).sub(p1.z.mul(sx)), p1.y.mul(sx).add(p1.z.mul(cx)));
      const persp = float(1.0).div(float(2.6).sub(p.z));
      const proj = p.xy.mul(persp).mul(3.5);
      const size = persp.mul(0.072).mul(float(1.0).add(U.kick.mul(0.5)));
      const dd = length(q.sub(proj));
      const dotv = smoothstep(size, size.mul(0.3), dd).mul(float(0.35).add(p.z.add(1.0).mul(0.35)));
      acc.assign(max(acc, paletteAt(p.y.mul(0.3).add(U.hue)).mul(dotv).mul(1.5)));
    });
    return acc.mul(front);
  });
  // 50 Unlimited bobs: a shaded ball tracing a figure whose trail never clears, the newest on
  // top, like the old trick of drawing into screens that are never wiped.
  on(50, () => {
    const col = vec3(0.0).toVar();
    const found = float(0.0).toVar();
    const fa = float(1.3).add(mod(floor(V.pitches.x), 3.0).mul(0.1));
    const L = normalize(vec3(-0.5, 0.5, 0.7));
    Loop(48, ({ i }) => {
      If(found.lessThan(0.5), () => {
        const tt = T.sub(float(i).mul(0.035));
        const pos = vec2(sin(tt.mul(fa)).mul(0.8).add(sin(tt.mul(0.37)).mul(0.22)), sin(tt.mul(1.7).add(0.5)).mul(0.6));
        const dv = q.sub(pos).div(0.09);
        const dist = length(dv);
        If(dist.lessThan(1.0), () => {
          const nz = sqrt(max(float(1.0).sub(dist.mul(dist)), 0.0));
          const lit = max(dot(vec3(dv.x, dv.y, nz), L), 0.0);
          col.assign(paletteAt(tt.mul(0.05).add(U.hue)).mul(float(0.2).add(lit.mul(0.9))).add(vec3(pow(lit, 24.0).mul(0.9))));
          found.assign(1.0);
        });
      });
    });
    return col.mul(front);
  });
  // 41 Glitterball: spots of light swept round the room by the ball (the ball itself is a mesh).
  on(41, () => {
    const rot = T.mul(V.glitter.x);
    const rd = vec3(d.x.mul(cos(rot)).sub(d.z.mul(sin(rot))), d.y, d.x.mul(sin(rot)).add(d.z.mul(cos(rot))));
    const cell = floor(rd.mul(18.0));
    const lit = step(0.9, hash(cell.dot(vec3(1.0, 57.0, 113.0))));
    const spot = smoothstep(0.42, 0.1, length(fract(rd.mul(18.0)).sub(0.5)));
    return paletteAt(hash(cell.dot(vec3(5.0, 1.0, 3.0))).add(U.hue)).mul(lit.mul(spot)).mul(float(0.6).add(U.kick.mul(0.8)).add(V.glitter.y));
  });
  return out;
}

/**
 * A glitterball: flat mirror facets that flash white as they catch a few lights circling round,
 * and otherwise show a dim, tinted reflection of the room.
 */
export function makeGlitterMaterial(opts: { tint?: any; flash?: any } = {}): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial();
  const tintU = opts.tint ?? vec3(0.35, 0.3, 0.5), flashU = opts.flash ?? float(0.0);
  const n = normalize(normalWorld);
  const v = normalize(positionWorld.sub(cameraPosition));
  const r = v.sub(n.mul(dot(v, n).mul(2.0)));
  const t = time.mul(0.9);
  const lamp = (a: any, b: any, c: any) => pow(max(dot(r, normalize(vec3(a, b, c))), 0.0), 60.0);
  const glint = lamp(cos(t), 0.5, sin(t)).add(lamp(cos(t.mul(1.3).add(2.1)), -0.2, sin(t.mul(1.3).add(2.1)))).add(lamp(cos(t.mul(0.7).add(4.0)), 0.8, sin(t.mul(0.7).add(4.0))));
  const tint = vec3(tintU).add(vec3(0.25, 0.1, 0.35).mul(r.y.mul(0.5).add(0.5)));
  // A sparkle per facet: hash of the facet's (flat) normal, twinkling with time.
  const tw = smoothstep(0.93, 1.0, fract(hash(floor(n.mul(40.0)).dot(vec3(1.0, 57.0, 113.0))).add(time.mul(0.4))));
  m.colorNode = tint.mul(0.5).add(glint.mul(vec3(1.0).add(vec3(tintU).mul(2.0))).mul(float(3.0).add(flashU.mul(4.0)))).add(tw.mul(1.4));
  return m;
}

export { min, pow, normalWorld };
