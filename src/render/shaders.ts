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
  mx_noise_float, mx_worley_noise_float, hash, cameraPosition, pow, materialColor, viewportSharedTexture, screenUV, uv, positionLocal, normalLocal,
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
  const rockCol = float(0.7).add(smoothstep(0.05, 0.3, crater).mul(0.35)).add(fine.mul(0.05).mul(fadeFine));
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
    .add(is(SURF.rock).mul(smoothstep(0.0, 0.25, crater)))
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
  const selfGlow = base.mul(is(SURF.glow)).mul(float(0.9).add(U.night.mul(2.4)));
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

/** The trippy window's ground: rings of colour pulsing out from the viewer on the beat. */
export function makeTripFloorMaterial(): THREE.MeshBasicNodeMaterial {
  const m = new THREE.MeshBasicNodeMaterial({ fog: false });
  const wp = positionWorld;
  const flow = mx_noise_float(vec3(wp.x.mul(0.012), U.showTime.mul(0.1), wp.z.mul(0.012)));
  const rings = length(wp.xz.sub(cameraPosition.xz)).mul(0.025).sub(U.showTime.mul(0.45)).add(flow.mul(1.5));
  const stripe = smoothstep(0.42, 0.5, fract(rings.mul(3.0))).mul(smoothstep(0.58, 0.5, fract(rings.mul(3.0))));
  const col = pow(palette(rings.add(U.hue)), vec3(2.0));
  m.colorNode = col.mul(float(0.25).add(U.kick.mul(0.35))).add(col.mul(stripe).mul(float(0.6).add(U.kick)));
  return m;
}

/** River water: the theme colour, rippled, glossy enough to carry the sky and the quays. */
export function makeWaterMaterial(map: THREE.Texture): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ map, roughness: 0.14, metalness: 0.1 });
  const wp = positionWorld;
  const d = length(cameraPosition.xz.sub(wp.xz));
  const near = smoothstep(220, 8, d);
  const t = U.showTime;
  // Two scales of ripple drifting with the current, plus a long swell.
  const r1 = mx_noise_float(vec3(wp.x.mul(0.35).add(t.mul(0.4)), t.mul(0.3), wp.z.mul(0.7)));
  const r2 = mx_noise_float(vec3(wp.x.mul(1.6).add(t.mul(0.9)), t.mul(0.8), wp.z.mul(2.2)));
  const swell = sin(wp.x.mul(0.05).add(wp.z.mul(0.11)).add(t.mul(0.6))).mul(0.5);
  const flow = mx_noise_float(vec3(wp.x.mul(0.01), t.mul(0.08), wp.z.mul(0.01)));
  const rings = length(wp.xz.sub(cameraPosition.xz)).mul(0.03).sub(t.mul(0.5)).add(flow);
  const tripCol = pow(palette(rings.add(U.hue)), vec3(2.2)).mul(float(0.35).add(U.kick.mul(0.4)));
  const water = pow(materialColor.rgb, vec3(1.4)).mul(float(0.85).add(r1.mul(0.08)));
  m.colorNode = vec4(mix(water, tripCol, U.trip.mul(0.85)), 1);
  m.normalNode = bumpMap(r1.mul(0.6).add(r2.mul(0.25).mul(near)).add(swell), 0.12);
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

export { min, pow, normalWorld };
