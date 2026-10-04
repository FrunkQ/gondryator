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
  asin, texture, exp, normalize, cross,
} from 'three/tsl';

/** Uniforms shared by every procedural material and the post effects; the FX director writes them. */
export const U = {
  kick: uniform(0),     // 0..1, decays after each kick
  snare: uniform(0),
  hat: uniform(0),
  energy: uniform(0.5), // section energy 0..1
  trip: uniform(0),     // 0..1 how much the psychedelic paint replaces real surfaces
  night: uniform(0),    // 0..1 how many windows are lit
  hue: uniform(0),      // palette phase, advances with the music
  beatPhase: uniform(0),// 0..1 within the current beat
  showTime: uniform(0),
  rain: uniform(0),      // 0..1 raindrops on the carriage windows
  speed: uniform(0),     // travel speed, m/s (drops streak backwards)
};

export const SURF = {
  plaster: 0, brick: 1, concrete: 2, metal: 3, tile: 4, glass: 5, foliage: 6, wood: 7, straw: 8, grass: 9, stone: 10, paint: 11,
  gas: 12, rock: 13, glow: 14, lavender: 15,
} as const;

/** Inigo Quilez's cosine palette: smooth rainbow-ish ramps from one phase value. */
export const palette = Fn(([t]: [any]) => {
  const a = vec3(0.5, 0.5, 0.5), b = vec3(0.5, 0.5, 0.5), c = vec3(1.0, 1.0, 1.0), d = vec3(0.0, 0.33, 0.67);
  return a.add(b.mul(cos(c.mul(t).add(d).mul(6.28318))));
});

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
  m.colorNode = vec4(mix(field.mul(detail), tripCol, U.trip.mul(0.85)), 1);
  m.normalNode = bumpMap(n2.mul(near).add(tufts.mul(near)), 0.08);
  m.emissiveNode = tripCol.mul(U.trip).mul(U.kick.mul(0.5));
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
export function makeGrassMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.85 });
  const q = uv();
  const blade = abs(fract(q.x.mul(5.0)).mul(2.0).sub(1.0)).oneMinus();          // 0 at gaps, 1 at blade centre
  const tall = hash(floor(q.x.mul(5.0)).add(positionWorld.x.mul(0.37).floor())).mul(0.5).add(0.5);
  m.opacityNode = step(q.y, blade.mul(tall).mul(1.15));
  const wp = positionWorld;
  const tint = mx_noise_float(vec3(wp.x.mul(0.15), 0, wp.z.mul(0.15))).mul(0.5).add(0.5);
  const base = mix(vec3(0.16, 0.22, 0.06), vec3(0.42, 0.42, 0.14), tint);
  m.colorNode = mix(base.mul(0.5), base.mul(1.25), q.y);
  // Sway in the wind (and with the music in trip looks).
  const sway = sin(U.showTime.mul(2.2).add(wp.x.mul(0.6))).mul(0.08).add(U.kick.mul(U.trip).mul(0.2));
  m.positionNode = positionLocal.add(vec3(sway.mul(q.y), 0, sway.mul(q.y).mul(0.5)));
  return m;
}

/** The sky beyond the other window when the train crosses into space: stars of several sizes,
 * slow nebula clouds in the palette, and a dissolve edge that eats the real sky away. */
export function makeSpaceMaterial(reveal: any): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: true });
  const d = positionLocal.normalize();
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
  m.colorNode = col.add(vec3(1.0, 0.55, 0.9).mul(edge).mul(3.0));
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
export function makeVisualiserMaterial(V: any): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
  const d = positionLocal.normalize();
  const az = atan(d.x, d.z.negate());             // 0 ahead (-z), +/- pi behind
  const el = asin(clamp(d.y, -1.0, 1.0));          // -pi/2 .. pi/2
  const t = U.showTime.mul(V.shape.w);
  const F = V.shape.x;
  // Symmetry: mirror the sky about the horizon (layers.w).
  const elM = mix(el, abs(el), V.layers.w);
  // Kaleidoscope: fold the azimuth into mirrored segments.
  const segs = max(V.shape.z, 1.0);
  const seg = fract(az.div(6.28318).mul(segs).add(0.5));
  const azK = select(V.shape.z.greaterThan(0.5), abs(seg.sub(0.5)).mul(6.28318).div(segs), az);
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
  const tunnel = sin(acos(clamp(dot(d, V.gaze), -1.0, 1.0)).mul(F).mul(3.0).sub(t.mul(3.0)).add(azK.mul(2.0)));
  const v = plasma.mul(V.mixes.x).add(rings.mul(V.mixes.y)).add(tunnel.mul(V.mixes.z))
    .add(V.mixes.w).add(U.hue.mul(0.5)).add(mx_noise_float(d.mul(2.0).add(t.mul(0.1))).mul(0.25));
  const pal = V.pa.add(V.pb.mul(cos(V.pc.mul(v).add(V.pd).mul(6.28318))));
  const glow = float(0.1).add(U.energy.mul(0.12)).add(U.kick.mul(0.28)).add(V.rise.mul(0.25)).add(V.bright.mul(0.08));
  // Contrast: thin bright filaments over darkness, and drifting black voids, so it reads as a
  // pattern rather than a wash.
  const fil = pow(sin(v.mul(9.0)).mul(0.5).add(0.5), 3.0);
  const voids = smoothstep(0.35, 0.75, mx_noise_float(d.mul(1.3).add(vec3(0.0, t.mul(0.08), 0.0))).mul(0.5).add(0.5));
  const base = pow(pal, vec3(2.2)).mul(glow).mul(fil.mul(0.85).add(0.15)).mul(voids.mul(0.85).add(0.15));
  // Bass: rings blasting out from wherever you are looking.
  const ang = acos(clamp(dot(d, V.gaze), -1.0, 1.0));
  const ring = (p: any) => { const x = ang.sub(p.mul(2.2)).div(0.07); return exp(x.mul(x).negate()).mul(exp(p.mul(-1.6))); };
  const bass = ring(V.pulse0).add(ring(V.pulse1)).add(ring(V.pulse2)).add(ring(V.pulse3));
  const bassCol = V.pa.add(V.pb.mul(cos(V.pc.mul(v.add(0.5)).add(V.pd).mul(6.28318)))).mul(bass).mul(1.4);
  // Melody: a wave of light round the horizon. Ahead of your gaze is what is coming, behind it what has played.
  const rel = atan(sin(az.sub(V.gazeAz)), cos(az.sub(V.gazeAz)));
  const w = texture(V.wave, vec2(rel.div(6.28318).add(0.5), 0.5));
  const target = w.r.sub(0.5).mul(1.6);
  const near = abs(el.sub(target));
  const waveA = smoothstep(0.035, 0.0, near).mul(1.6).add(smoothstep(0.22, 0.0, near).mul(0.3)).mul(w.g);
  const waveCol = palette(rel.div(6.28318).add(U.hue)).mul(0.6).add(0.4).mul(waveA);
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
  const right = normalize(vec3(V.gaze.z.negate(), 0.0, V.gaze.x));
  const up = normalize(vec3(V.gaze.y.negate().mul(V.gaze.x), V.gaze.x.mul(V.gaze.x).add(V.gaze.z.mul(V.gaze.z)), V.gaze.y.negate().mul(V.gaze.z)));
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
  const shapeCol = palette(qr.mul(0.8).add(U.hue).add(V.mixes.w)).mul(shapes).mul(float(0.9).add(U.kick.mul(0.8)));
  // Band ribbons round the horizon (layers.y): drums low, bass in the middle, the rest high, each as
  // thick as its stem is loud and rippling with it.
  const ribbon = (y: number, lvl: any, freq: number, colShift: number) => {
    const yy = float(y).add(sin(az.mul(freq).add(U.showTime.mul(1.3 + freq * 0.2))).mul(lvl.mul(0.12)));
    const a = smoothstep(lvl.mul(0.05).add(0.004), 0.0, abs(el.sub(yy)));
    return V.pa.add(V.pb.mul(cos(V.pc.mul(float(colShift).add(az.div(6.28318))).add(V.pd).mul(6.28318)))).mul(a).mul(lvl);
  };
  const ribbons = ribbon(-0.35, V.bands.x, 6.0, 0.0).add(ribbon(-0.05, V.bands.y, 3.0, 0.33)).add(ribbon(0.3, V.bands.z, 9.0, 0.66)).mul(1.4);
  const paletteAt = (x: any) => V.pa.add(V.pb.mul(cos(V.pc.mul(x).add(V.pd).mul(6.28318))));
  // Starfield (3): stars streaming out of your gaze, faster with the energy.
  const lanes = qa.mul(90.0 / 6.28318), lane = floor(lanes), lh = hash(lane);
  const head = fract(lh.mul(13.7).add(U.showTime.mul(float(0.15).add(lh.mul(0.3)).mul(float(0.6).add(U.energy).add(V.rise))))).mul(2.4);
  const streak = smoothstep(head.sub(float(0.04).add(U.kick.mul(0.08))), head, qr).mul(float(1).sub(smoothstep(head, head.add(0.01), qr)))
    .mul(step(0.6, hash(lane.add(3.0)))).mul(smoothstep(0.5, 0.1, abs(fract(lanes).sub(0.5)))).mul(step(0.0, dot(d, V.gaze)));
  const stars = mix(vec3(0.8, 0.9, 1.0), paletteAt(lh), 0.4).mul(streak).mul(1.6);
  // Kick tunnel (4): a polygon ring flung outwards from your gaze on every kick.
  const kx = qr.sub(V.kickT.mul(1.8)).div(0.03);
  const kx2 = qr.sub(V.kickT.mul(1.8)).sub(0.35).div(0.02);
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
  const hgt = float(0.03).add(V.bands.y.mul(float(0.12).add(mx_noise_float(vec2(az.mul(3.0), U.showTime.mul(0.15))).mul(0.5).add(0.5).mul(0.3))));
  const outline = smoothstep(0.012, 0.0, abs(el.sub(hgt)));
  const hatch = smoothstep(0.15, 0.0, abs(fract(az.mul(40.0)).sub(0.5))).mul(step(el, hgt)).mul(step(-0.02, el)).mul(0.35);
  const mountains = paletteAt(el.mul(2.0).add(0.2)).mul(outline.add(hatch)).mul(float(0.6).add(V.bands.y));
  // Note circle (13): the twelve note names in a ring round your gaze; each lights as it is played.
  const pcIdx = floor(qa.div(6.28318).add(0.5).mul(12.0));
  const act = texture(V.notes, vec2(pcIdx.add(0.5).div(16.0), 0.5)).r;
  const band = smoothstep(0.08, 0.0, abs(qr.sub(0.75))).mul(smoothstep(0.45, 0.4, abs(fract(qa.div(6.28318).add(0.5).mul(12.0)).sub(0.5))));
  const circle = palette(pcIdx.div(12.0)).mul(band).mul(act.mul(1.8).add(0.05)).mul(step(0.0, dot(d, V.gaze)));
  // Aurora (14): curtains of light across the sky, swaying with the pads.
  const ax = az.mul(3.0).add(mx_noise_float(vec2(az.mul(1.5), U.showTime.mul(0.08))).mul(1.5));
  const curtain = pow(abs(sin(ax.mul(4.0).add(U.showTime.mul(0.2)))), 6.0).mul(smoothstep(0.12, 0.45, el)).mul(smoothstep(1.3, 0.6, el));
  const aurora = mix(vec3(0.1, 1.0, 0.6), paletteAt(el.add(az.div(6.28318))), 0.5).mul(curtain).mul(V.pad.mul(1.4).add(0.1));
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
  const fractCol = paletteAt(fract3.y.mul(1.5).add(U.hue).add(V.mixes.w)).mul(kFil.mul(1.3).add(kDot.mul(0.5)))
    .mul(float(0.55).add(U.kick.mul(0.5)).add(V.rise.mul(0.4)));
  // The mix: each element times its weight (E0..E3 hold the 16 weights; see visualiser.ts ELEMENTS).
  const col = base.mul(V.E0.x).add(shapeCol.mul(V.E0.y)).add(ribbons.mul(V.E0.z)).add(stars.mul(V.E0.w))
    .add(kickCol.mul(V.E1.x)).add(vec3(0.85, 0.9, 1.0).mul(bolt).mul(V.E1.y)).add(vec3(sparks).mul(V.E1.z)).add(floorCol.mul(V.E1.w))
    .add(bassCol.mul(V.E2.x)).add(mountains.mul(V.E2.y))
    .add(waveCol.mul(V.E2.w)).add(circle.mul(V.E3.y))
    .add(aurora.mul(V.E3.z)).add(nebula.mul(V.E3.w))
    .add(fractCol.mul(V.E4.x));
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
    .mul(float(1.0).sub(V.tension.mul(0.35))).add(V.release.mul(0.6));
  const satCol = max(mix(vec3(grey), col, sat), vec3(0.0));
  const icy = vec3(0.35, 0.62, 1.0).mul(grey).mul(1.4);
  const thawed = mix(icy, satCol, min(smoothstep(0.25, 0.9, V.arc).add(V.release.mul(0.4)), 1.0));
  const arcCol = mix(satCol, thawed, V.journey.z).mul(level);
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
  const r = length(positionLocal.xy);
  if (style === 'flat') m.colorNode = vec3(0.9);
  else if (style === 'spike') m.colorNode = vec3(smoothstep(0.25, 0.0, r).mul(1.8).add(smoothstep(1.0, 0.0, r).mul(0.8)));
  else {
    const heart = smoothstep(0.35, 0.0, r).mul(1.6);
    const petal = smoothstep(1.0, 0.3, r).mul(0.7);
    const veins = sin(atan(positionLocal.y, positionLocal.x).mul(18.0)).mul(0.15).add(0.85);
    m.colorNode = vec3(heart.add(petal.mul(veins)));
  }
  return m;
}

export { min, pow, normalWorld };
