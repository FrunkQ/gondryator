// @ts-nocheck -- TSL node typings are too strict for swizzles and number arguments.
// The effects layer: a post-processing pipeline (bloom, kaleidoscope, liquid warp, RGB split,
// false-colour, echo trails, film grain) plus a director that drives it, and the surface "trip"
// paint, from the score. Each section of the track gets a look from the pack's cycle; kicks punch
// and bloom, snares split the colours, the palette rolls with the music.

import * as THREE from 'three/webgpu';
import {
  pass, uniform, Fn, vec2, vec3, vec4, float, screenUV, mix, abs, atan, cos, sin, length, mod, fract, floor, step,
  mx_noise_float, select, mrt, output, emissive, normalView, directionToColor, colorToDirection, sample, luminance, hash, dot, clamp, smoothstep, convertToTexture, max, pow, time, interleavedGradientNoise, screenCoordinate,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { U, palette, PALETTES, DEFAULT_PALETTES } from './shaders';
import { clean, feedback } from './feedback';
import { sampleEnvelope, subPartAt, type Score } from '../score/types';

export type FxLook = 'clean' | 'prism' | 'trip' | 'kaleido' | 'liquid' | 'thermal' | 'echo' | 'fold' | 'hyper' | 'tunnel' | 'crt' | 'film' | 'glitch';
export const FX_LOOKS: FxLook[] = ['clean', 'prism', 'trip', 'kaleido', 'liquid', 'thermal', 'echo', 'fold', 'hyper', 'tunnel', 'crt', 'film', 'glitch'];

interface Weights { crt?: number; film?: number; dmosh?: number; fold?: number; rain?: number; hyper?: number; tunnel?: number; kal: number; liquid: number; rgb: number; thermal: number; trip: number; echo: number; bloom: number; punch: number }
const LOOKS: Record<FxLook, Weights> = {
  clean:   { kal: 0, liquid: 0,   rgb: 0.12, thermal: 0, trip: 0,    echo: 0,    bloom: 0.25, punch: 0.25 },
  prism:   { kal: 0, liquid: 0,   rgb: 1,    thermal: 0, trip: 0.3,  echo: 0.15, bloom: 0.8,  punch: 0.7 },
  trip:    { kal: 0, liquid: 0.2, rgb: 0.4,  thermal: 0, trip: 1,    echo: 0.25, bloom: 1,    punch: 0.6 },
  kaleido: { kal: 1, liquid: 0.1, rgb: 0.4,  thermal: 0, trip: 0.55, echo: 0,    bloom: 0.8,  punch: 0.5 },
  liquid:  { rain: 1, kal: 0, liquid: 1,   rgb: 0.3,  thermal: 0, trip: 0.45, echo: 0.6,  bloom: 0.6,  punch: 0.3 },
  thermal: { kal: 0, liquid: 0.1, rgb: 0.6,  thermal: 1, trip: 0,    echo: 0.2,  bloom: 0.5,  punch: 0.9 },
  echo:    { kal: 0, liquid: 0.3, rgb: 0.5,  thermal: 0, trip: 0.2,  echo: 1,    bloom: 0.7,  punch: 0.5 },
  // The world folds sideways: one half becomes a mirror of the other, leaning slowly.
  fold:    { fold: 1, kal: 0, liquid: 0.15, rgb: 0.5, thermal: 0, trip: 0.4, echo: 0.2, bloom: 0.8, punch: 0.6 },
  // Hyperspace: stars stream out of the centre and everything smears towards it on the kick.
  hyper:   { hyper: 1, kal: 0, liquid: 0, rgb: 0.7, thermal: 0, trip: 0.35, echo: 0.35, bloom: 1, punch: 1 },
  // Wormhole: the world itself is wrapped into a tunnel you fall down, ringed in the palette.
  tunnel:  { tunnel: 1, kal: 0, liquid: 0.1, rgb: 0.5, thermal: 0, trip: 0.6, echo: 0.3, bloom: 0.9, punch: 0.6 },
  // An old cathode-ray tube: scanlines, a shadow mask, rounded glass corners, fat bloom.
  crt:     { crt: 1, kal: 0, liquid: 0, rgb: 0.6, thermal: 0, trip: 0, echo: 0.35, bloom: 1, punch: 0.6 },
  // Old film: black and white or sepia, grain, flicker, scratches and dust, the frame weaving in the gate.
  film:    { film: 1, kal: 0, liquid: 0, rgb: 0, thermal: 0, trip: 0, echo: 0.25, bloom: 0.7, punch: 0.3 },
  // Datamosh: blocks of the picture tear sideways and smear on the snare, colours crushed to bits.
  glitch:  { dmosh: 1, kal: 0, liquid: 0, rgb: 0.9, thermal: 0, trip: 0, echo: 0.2, bloom: 0.8, punch: 0.8 },
};

const W = {
  film: uniform(0), dmosh: uniform(0), crt: uniform(0), crtOn: uniform(1), crtPitch: uniform(3), crtRoll: uniform(0), crtMode: uniform(0), fold: uniform(0), hyper: uniform(0), tunnel: uniform(0), warp: uniform(0), kal: uniform(0), liquid: uniform(0), rgb: uniform(0), thermal: uniform(0), echo: uniform(0), bloom: uniform(0.25), punch: uniform(0),
  glitch: uniform(0), aspect: uniform(16 / 9), kalRot: uniform(0), segments: uniform(6),
  /** Motion blur: screen-space smear per metre of depth (uv * m), from travel speed and shutter. */
  blurK: uniform(0), blurDir: uniform(new THREE.Vector2(1, 0)),
  /** Video feedback (render/feedback.ts): how much survives, zoom and turn per frame, colour drift. */
  fbAmount: uniform(0), fbZoom: uniform(1), fbTurn: uniform(0), fbHue: uniform(0),
  /** The trip look's sky paint, 0..1. */
  trip: uniform(0),
  /**
   * Two-window rides keep one window clean: with split on, the looks only show on pixels that
   * look out of the far side (yaw is the camera's, tanH the tangent of half the horizontal field
   * of view), so nothing psychedelic spills onto the main window while you turn.
   */
  split: uniform(0), yaw: uniform(0), tanH: uniform(1), warpAll: uniform(0),
};

/** 1 where this pixel looks out of the far window (or everywhere, without a split), else 0. */
const farSide = Fn(() => {
  const pixYaw = W.yaw.add(atan(screenUV.x.sub(0.5).mul(2.0).mul(W.tanH), float(1)));
  return mix(float(1), smoothstep(0.05, -0.3, cos(pixYaw)), W.split);
});

/** Builds the post pipeline for a scene + camera. Returns null if the backend cannot do it. */
export const FX_UNIFORMS = W;

export function makePipeline(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, opts: { ao?: boolean } = {}) {
  const pipe = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  // Emissive gets its own target so only lights, lit windows and trip glows bloom (not the bright sky).
  scenePass.setMRT(opts.ao ? mrt({ output, emissive, normal: directionToColor(normalView) }) : mrt({ output, emissive }));
  const emissiveTex = scenePass.getTextureNode('emissive');
  let src = scenePass.getTextureNode('output');
  if (opts.ao) {
    // Ground-truth ambient occlusion at half resolution: contact shadows where walls meet ground.
    const nrm = scenePass.getTextureNode('normal');
    const aoPass = ao(scenePass.getTextureNode('depth'), sample(uv => colorToDirection(nrm.sample(uv))), camera);
    aoPass.resolutionScale = 0.5;
    aoPass.radius.value = 1.2;
    const lit = scenePass.getTextureNode('output');
    src = convertToTexture(vec4(lit.rgb.mul(mix(float(1), aoPass.getTextureNode().sample(screenUV).r, 0.85)), 1));
  }

  const warped = Fn(() => {
    const uv0 = screenUV;
    const S = farSide();
    const wAll = mix(S, float(1), W.warpAll);
    // Kick punch: a quick zoom towards the centre.
    const zoom = float(1).sub(U.kick.mul(W.punch).mul(0.035));
    let u = uv0.sub(0.5).mul(zoom).add(0.5);
    // Wormhole: angle round the centre and inverse distance become the coordinates, so the
    // scene is wrapped round a tunnel that streams towards you.
    const tc = u.sub(0.5).mul(vec2(W.aspect, 1));
    const tr = length(tc);
    // (The angle runs -1..1 round the circle: the mirrored wrap below folds it so -1 and 1 land on
    // the same column, where 0..1 left a seam from the centre to the left edge.)
    const ut = vec2(atan(tc.y, tc.x).div(3.14159).add(U.showTime.mul(0.02)), float(0.22).div(tr.add(0.04)).add(U.showTime.mul(0.45)));
    u = mix(u, ut, W.tunnel.mul(smoothstep(0.02, 0.2, tr))); // (the tunnel's far end is all aliasing: left plain)
    // Kaleidoscope: fold the angle into mirrored wedges around the centre.
    const c = u.sub(0.5).mul(vec2(W.aspect, 1));
    const r = length(c);
    const seg = float(6.28318).div(W.segments);
    const a0 = atan(c.y, c.x).add(W.kalRot);
    const a = abs(mod(a0, seg).sub(seg.mul(0.5)));
    const uk = vec2(cos(a), sin(a)).mul(r).div(vec2(W.aspect, 1)).mul(float(0.9).add(U.kick.mul(0.06))).add(0.5);
    u = mix(u, uk, W.kal);
    // Fold: mirror one side of the picture onto the other about an upright line that leans and
    // drifts with the music. (A horizontal fold left a seam along the horizon; upright, it reads
    // as a mirror standing in the world.)
    const tilt = sin(U.showTime.mul(0.3)).mul(0.08).add(U.kick.mul(0.01));
    const vx = float(0.5).add(sin(U.showTime.mul(0.11)).mul(0.06)).add(u.y.sub(0.5).mul(tilt));
    const uf = vec2(select(u.x.greaterThan(vx), vx.mul(2.0).sub(u.x), u.x), u.y);
    u = mix(u, uf, W.fold);
    // Liquid: noise displacement that flows with time and swells with energy.
    const t = U.showTime.mul(0.35);
    const n = vec2(mx_noise_float(vec3(u.mul(3.0), t)), mx_noise_float(vec3(u.mul(3.0).add(17.0), t)));
    u = u.add(n.mul(W.liquid).mul(float(0.018).add(U.energy.mul(0.02)).add(U.snare.mul(0.015))));
    // Glitch at section changes: horizontal slices jump sideways.
    const slice = floor(uv0.y.mul(24.0));
    const jump = hash(slice.add(floor(time.mul(30.0)))).sub(0.5).mul(W.glitch).mul(0.08);
    u = vec2(u.x.add(jump), u.y);
    // Datamosh: a few blocks tear sideways, more on the snare; some freeze, smearing one row down
    // the block; whole bands slip on the kick.
    const dm = W.dmosh.mul(S);
    const blk = floor(uv0.mul(vec2(14.0, 22.0)));
    const tick = floor(time.mul(8.0));
    const bh = hash(blk.dot(vec2(1.0, 37.0)).add(tick.mul(7.0)));
    const tear = step(float(0.86).sub(U.snare.mul(0.25)), bh);
    u = vec2(u.x.add(hash(blk.y.add(tick)).sub(0.5).mul(0.2).mul(tear).mul(dm)), u.y);
    const freeze = step(0.94, hash(blk.dot(vec2(13.0, 5.0)).add(tick))).mul(dm);
    u = vec2(u.x, mix(u.y, blk.y.add(0.98).div(22.0), freeze));
    const band = floor(uv0.y.mul(6.0));
    u = vec2(u.x.add(step(0.7, hash(band.add(tick))).mul(U.kick).mul(0.05).mul(dm)), u.y);
    // Film: the frame weaves in the gate.
    const fw = W.film.mul(S);
    u = u.add(vec2(hash(floor(time.mul(24.0))).sub(0.5).mul(0.002), hash(floor(time.mul(24.0)).add(3.0)).sub(0.5).mul(0.005)).mul(fw));
    // Mirror at the edges so warps never sample outside the frame.
    u = abs(fract(u.mul(0.5)).mul(2.0).sub(1.0)).oneMinus();
    // RGB split, radial, kicked by snares.
    const off = u.sub(0.5).mul(W.rgb.mul(float(0.004).add(U.snare.mul(0.012))).add(W.glitch.mul(0.01)));
    // Motion blur from the train's travel: near things smear sideways, far things stay sharp.
    const viewZ = scenePass.getViewZNode();
    // (the carriage itself, within a few metres, travels with the camera and stays sharp)
    const smear = clamp(W.blurK.div(max(viewZ.negate(), 0.5)), 0, 0.05).mul(smoothstep(2.5, 3.5, viewZ.negate()));
    const blurStep = W.blurDir.mul(smear).div(5.0);
    // Warp: a zoom smear towards the centre (a section jump, or the hyperspace look on the kick).
    const zb = W.warp.mul(0.22).add(W.hyper.mul(float(0.02).add(U.kick.mul(0.06))));
    // The clean view (the main window of a two-window ride): only the motion blur, and the warp
    // jump when it shows from every window. The two are blended as colours, not coordinates, so
    // the seam between the windows is a soft crossfade rather than a smear.
    const zc = W.warp.mul(W.warpAll).mul(0.22);
    const clean = vec3(0).toVar();
    const acc = vec3(0).toVar();
    for (let i = 0; i < 6; i++) {
      const o = blurStep.mul(i - 2.5).sub(u.sub(0.5).mul(zb.mul(i / 5)));
      acc.addAssign(vec3(src.sample(u.add(off).add(o)).r, src.sample(u.add(o)).g, src.sample(u.sub(off).add(o)).b));
      clean.addAssign(src.sample(uv0.add(blurStep.mul(i - 2.5)).sub(uv0.sub(0.5).mul(zc.mul(i / 5)))).rgb);
    }
    // Trip looks repaint the sky: a rolling sunburst in the palette, spinning with the kicks.
    const skyMask = smoothstep(1500.0, 2500.0, viewZ.negate()).mul(W.trip);
    const sc = uv0.sub(vec2(0.5, 0.35)).mul(vec2(W.aspect, 1));
    const rays = sin(atan(sc.y, sc.x).mul(14.0).add(W.kalRot.mul(3.0))).mul(0.5).add(0.5);
    const skyCol = pow(palette(length(sc).mul(1.4).sub(U.showTime.mul(0.15)).add(U.hue).add(rays.mul(0.12))), vec3(1.8)).mul(float(1.4).add(rays.mul(0.8)).add(U.kick.mul(1.5)));
    // Star streaks pouring out of the centre: fast and long in a warp jump.
    const sc2 = uv0.sub(0.5).mul(vec2(W.aspect, 1));
    const rr = length(sc2);
    const lanes = atan(sc2.y, sc2.x).mul(150.0 / 6.28318);
    const lane = floor(lanes);
    const lh = hash(lane);
    const head = fract(lh.mul(13.7).add(time.mul(float(0.25).add(lh.mul(0.6))).mul(float(1).add(W.warp.mul(5.0)))) ).mul(1.3);
    const len = float(0.015).add(W.warp.mul(0.4)).add(W.hyper.mul(0.05).add(U.kick.mul(W.hyper).mul(0.08)));
    const thin = smoothstep(0.5, 0.15, abs(fract(lanes).sub(0.5)));
    const streak = smoothstep(head.sub(len), head, rr).mul(float(1).sub(smoothstep(head, head.add(0.003), rr))).mul(smoothstep(0.55, 0.56, hash(lane.add(7.0)))).mul(smoothstep(0.02, 0.12, rr)).mul(thin);
    const streakCol = mix(vec3(0.75, 0.9, 1.0), palette(lh.add(U.hue)), 0.45).mul(streak).mul(W.warp.mul(wAll).mul(1.6).add(W.hyper.mul(S).mul(0.6)));
    const flash = pow(W.warp.mul(wAll), 4.0).mul(0.45);
    return vec4(mix(clean.div(6.0), mix(acc.div(6.0), skyCol, skyMask), S).add(streakCol).add(flash), 1);
  })();

  const warpedTex = convertToTexture(warped);
  const glow = bloom(emissiveTex, 1.0, 0.5, 0.0);
  const bloomed = warpedTex.add(glow.mul(mix(float(LOOKS.clean.bloom), W.bloom, farSide()).mul(float(0.6).add(U.kick.mul(1.4)))));
  // Echo trails are our own feedback with no zoom or turn: three's AfterImageNode kept any NaN
  // that got into its buffer for good (NaN times its damping stays NaN), which showed as a blob
  // stuck in the middle of the screen on WebGPU. Ours cleans what it keeps every frame.
  const echo = feedback(vec4(clean(bloomed.rgb), 1), { amount: W.echo.mul(0.8).mul(farSide()), zoom: float(1), turn: float(0), hue: float(0), aspect: W.aspect });
  const trails = feedback(echo, { amount: W.fbAmount.mul(farSide()), zoom: W.fbZoom, turn: W.fbTurn, hue: W.fbHue, aspect: W.aspect });

  const graded = Fn(() => {
    let c = trails.rgb;
    // False colour: luminance through the cosine palette, posterised a little.
    const l = luminance(c);
    const th = palette(floor(l.mul(7.0)).div(7.0).mul(1.1).add(U.hue));
    c = mix(c, th.mul(float(0.5).add(l)), W.thermal.mul(farSide()));
    // CRT: scanlines every three pixels, an RGB shadow mask, a little flicker, and the dark rounded
    // corners of the glass. Brightened to make up for the lines, so it glows rather than dims.
    const crt = W.crt.mul(farSide()).mul(W.crtOn);
    // Scanlines whose pitch changes with the music and which fatten on the kick; a bright band
    // rolling down the tube; the mask flares on the hats.
    const scan = float(0.6).sub(U.kick.mul(0.15)).add(pow(abs(sin(screenCoordinate.y.mul(3.14159).div(W.crtPitch))), 2.0).mul(float(0.55).add(U.kick.mul(0.2))));
    const rollY = fract(screenUV.y.add(W.crtRoll));
    const roll = float(1.0).add(smoothstep(0.08, 0.0, abs(rollY.sub(0.5))).mul(0.25));
    const col = mod(floor(screenCoordinate.x), 3.0);
    const mk = float(0.15).add(U.hat.mul(0.12));
    const mask = select(col.lessThan(1.0), vec3(mk.add(1.0), mk.oneMinus(), mk.oneMinus()), select(col.lessThan(2.0), vec3(mk.oneMinus(), mk.add(1.0), mk.oneMinus()), vec3(mk.oneMinus(), mk.oneMinus(), mk.add(1.0))));
    const cq = abs(screenUV.sub(0.5)).mul(2.0);
    const corner = smoothstep(0.1, 0.06, length(max(cq.sub(vec2(0.9, 0.86)), vec2(0.0))));
    const flicker = float(1.0).add(sin(time.mul(61.0)).mul(0.015));
    // Colour: VHS (a little oversaturated, lifted blacks, a tracking band of noise wandering down),
    // or green or amber phosphor, with the odd line smearing bright across the screen.
    const lum = luminance(c);
    const tr = fract(time.mul(0.05));
    const track = smoothstep(0.025, 0.0, abs(screenUV.y.sub(tr))).mul(hash(screenCoordinate.xy.add(fract(time).mul(911.0)))).mul(0.25);
    const vhs = mix(vec3(lum), c, 1.3).add(vec3(0.015, 0.0, 0.035)).add(track);
    const row = floor(screenCoordinate.y.div(W.crtPitch));
    const smear = step(0.985, hash(vec2(row, floor(time.mul(9.0))))).mul(0.35).add(1.0);
    const mono = lum.mul(1.4).mul(smear).add(0.02);
    const tint = select(W.crtMode.lessThan(0.5), vhs, select(W.crtMode.lessThan(1.5), vec3(0.3, 1.0, 0.4).mul(mono), vec3(1.0, 0.6, 0.12).mul(mono)));
    c = mix(c, tint.mul(scan).mul(mask).mul(roll).mul(1.35).mul(flicker).mul(corner), crt);
    // Datamosh colour: torn blocks crushed to a few levels per channel.
    const dmc = W.dmosh.mul(farSide());
    const crush = floor(c.mul(4.0)).div(4.0);
    const blk = floor(screenUV.mul(vec2(14.0, 22.0)));
    const crushed = step(0.9, hash(blk.dot(vec2(3.0, 41.0)).add(floor(time.mul(8.0)))));
    c = mix(c, crush.mul(1.2), crushed.mul(dmc));
    // Old film: monochrome (silver or sepia, swapping now and then), flickering exposure, a fine
    // scratch running down, dust specks, heavy grain and a dark iris round the edge.
    const fm = W.film.mul(farSide());
    const fl = luminance(c);
    const reel = step(0.5, hash(floor(time.mul(0.1))));
    const tone = mix(vec3(1.0, 0.97, 0.9), vec3(1.15, 0.9, 0.6), reel);
    const exposure = float(0.92).add(hash(floor(time.mul(24.0))).mul(0.16)).add(U.kick.mul(0.1));
    const sx = hash(floor(time.mul(2.0))).mul(0.9).add(0.05).add(sin(time.mul(7.0)).mul(0.004));
    const scratch = smoothstep(0.0015, 0.0, abs(screenUV.x.sub(sx))).mul(step(0.4, hash(floor(time.mul(2.0)).add(9.0)))).mul(0.5);
    const speck = step(0.9993, hash(floor(screenCoordinate.xy.div(3.0)).add(floor(time.mul(24.0)).mul(17.0))));
    const grain = interleavedGradientNoise(screenCoordinate.xy.add(fract(time.mul(24.0)).mul(311.0))).sub(0.5).mul(0.14);
    const fd = screenUV.sub(0.5).mul(vec2(W.aspect, 1.0));
    const iris = smoothstep(1.0, 0.45, length(fd));
    const film = tone.mul(pow(fl.mul(1.15), 1.2).mul(exposure).add(grain).add(scratch)).sub(speck.mul(0.6)).mul(iris);
    c = mix(c, film, fm);
    // Vignette and film grain: the photographic finish.
    const d = screenUV.sub(0.5);
    c = c.mul(float(1).sub(dot(d, d).mul(0.9)));
    c = c.add(interleavedGradientNoise(screenCoordinate.xy.add(vec2(fract(time.mul(7.13)).mul(97.0), fract(time.mul(3.71)).mul(61.0)))).sub(0.5).mul(0.02));
    return vec4(max(c, vec3(0)), 1);
  })();

  pipe.outputNode = graded;
  return pipe;
}

const CRT_PIN = new URLSearchParams(location.search).has('crtmode') ? Number(new URLSearchParams(location.search).get('crtmode')) : null;

/** A repeatable 0..1 number from an integer. */
function hashNum(n: number) { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); }

/** Drives the uniforms from the score, every frame. */
export class FxDirector {
  look: FxLook = 'clean';
  locked: FxLook | null = null;
  /** A look chosen by the show itself (the visualiser's scenes); the X key still wins. */
  override: FxLook | null = null;
  /**
   * Two windows (Star Guitar, the starship): the looks only show out of the far window, and the
   * main window stays true. Set every frame with the camera's yaw and horizontal half field of view.
   */
  split = false;
  view = { yaw: 0, tanH: 1 };
  private cur: Weights = { film: 0, dmosh: 0, crt: 0, fold: 0, rain: 0, hyper: 0, tunnel: 0, ...LOOKS.clean };
  private ptr = 0;
  private lastS = -Infinity;
  private kick = 0; private snare = 0; private hat = 0;
  private secIdx = -1;
  private glitch = 0;
  private kicks = 0;
  private crtOn = 1;
  private warp = 0;
  private hue = 0;
  /** The warp jump shows from every window (the starship), not just where the looks show. */
  warpAll = false;
  /** 0..1, the current warp jump: the world widens the field of view with it. */
  get warpLevel() { return FX_UNIFORMS.warp.value; }

  private palettes: string[];
  private palTarget = PALETTES.rainbow;
  constructor(private cycle: FxLook[], private bySection: Partial<Record<string, FxLook>> = {}, palettes?: string[]) {
    this.palettes = (palettes ?? DEFAULT_PALETTES).filter(n => PALETTES[n]);
    if (!this.palettes.length) this.palettes = DEFAULT_PALETTES;
    this.palTarget = PALETTES[this.palettes[0]];
  }

  /**
   * The palette for a section: a returning part of the song (same group) gets its colours back, a
   * new part the next palette along from a song-seeded start, so a song keeps its own colours.
   */
  private paletteFor(sc: Score, idx: number, sub = 0) {
    const P = this.palettes, seed = (sc.track.hash ?? '').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const byGroup = new Map<number, number>();
    let fresh = 0, pick = seed % P.length;
    for (let i = 0; i <= idx; i++) {
      const g = sc.sections[i].group;
      if (g !== undefined && byGroup.has(g)) pick = byGroup.get(g)!;
      else { pick = (seed + fresh++ * 5) % P.length; if (g !== undefined) byGroup.set(g, pick); }
    }
    // Sub-parts step on through the palettes from the section's own, so a returning part brings
    // back the same run of colours.
    return PALETTES[P[(pick + sub * 3) % P.length]];
  }

  setScore(score: Score | null) { this.score = score; this.ptr = 0; this.lastS = -Infinity; this.secIdx = -1; this.subIdx = 0; }
  private subIdx = 0;

  /** A returning part of the song (same group) gets its look back; a new part, the next in the cycle. */
  private lookFor(secs: Score['sections'], idx: number): FxLook {
    const byGroup = new Map<number, FxLook>();
    let fresh = 0, look: FxLook = 'clean';
    for (let i = 0; i <= idx; i++) {
      const sec = secs[i], g = sec.group;
      const forced = this.bySection[sec.label];
      if (forced) look = forced;
      else if (g !== undefined && byGroup.has(g)) look = byGroup.get(g)!;
      else { look = this.cycle[(g === undefined ? i : fresh++) % this.cycle.length]; if (g !== undefined) byGroup.set(g, look); }
    }
    return look;
  }
  private score: Score | null = null;

  update(s: number, dt: number, running: boolean, night: number, aspect: number) {
    const sc = this.score;
    // A seek: re-find our place.
    if (sc && (s < this.lastS - 0.05 || s > this.lastS + 1)) {
      let lo = 0, hi = sc.events.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sc.events[m].t <= s) lo = m + 1; else hi = m; }
      this.ptr = lo;
    }
    this.lastS = s;
    const dk = Math.exp(-dt / 0.14), ds = Math.exp(-dt / 0.18), dh = Math.exp(-dt / 0.06);
    this.kick *= dk; this.snare *= ds; this.hat *= dh;
    if (sc && running) {
      const ev = sc.events;
      while (this.ptr < ev.length && ev[this.ptr].t <= s) {
        const e = ev[this.ptr++];
        if (s - e.t > 0.3) continue;
        // Each pulse is set to where it would be had it struck exactly on its note, not on this
        // frame (which comes a little after).
        const late = s - e.t;
        if (e.kind === 'kick') {
          this.kick = Math.max(this.kick, (0.5 + 0.5 * e.vel) * Math.exp(-late / 0.14)); this.hue += 0.015;
          // The CRT plays along: every couple of bars of kicks it may switch off or back on, or
          // change its scanline pitch.
          if (++this.kicks % 8 === 0) {
            const r = hashNum(this.kicks + this.secIdx * 101);
            if (r < 0.3) this.crtOn = this.crtOn ? 0 : 1;
            else if (r < 0.7) W.crtPitch.value = [2, 3, 4, 6][Math.floor(r * 40) % 4];
            // ...or change its colours: mostly VHS colour, now and then an old green or amber
            // monochrome screen with its smeary phosphor.
            else W.crtMode.value = r < 0.85 ? 0 : r < 0.93 ? 1 : 2;
          }
        }
        else if (e.kind === 'snare') this.snare = Math.max(this.snare, (0.4 + 0.6 * e.vel) * Math.exp(-late / 0.18));
        else if (e.kind === 'hat') this.hat = Math.max(this.hat, e.vel * Math.exp(-late / 0.06));
      }
    }
    // Section look.
    let energy = 0.5, label = 'intro', idx = 0;
    if (sc && running) {
      for (let i = 0; i < sc.sections.length; i++) if (sc.sections[i].t <= s) idx = i;
      const sec = sc.sections[idx];
      if (sec) { energy = sec.energy; label = sec.label; }
      if (idx !== this.secIdx) {
        if (this.secIdx >= 0 && sec) { const late = s - sec.t; this.glitch = Math.exp(-late / 0.12); this.warp = Math.exp(-late / 0.55); }
        this.secIdx = idx;
        this.subIdx = 0;
        this.look = this.lookFor(sc.sections, idx);
        this.palTarget = this.paletteFor(sc, idx);
      }
      // A long section changes as it goes (sub-parts of eight bars): new colours on each, and on
      // every other one the next look along as well, with a little glitch to mark it.
      const { sub } = subPartAt(sc, s);
      if (sub !== this.subIdx) {
        this.subIdx = sub;
        this.palTarget = this.paletteFor(sc, idx, sub);
        if (sub % 2 === 0 && !this.bySection[label]) {
          const i = this.cycle.indexOf(this.lookFor(sc.sections, idx));
          this.look = this.cycle[(Math.max(0, i) + sub / 2) % this.cycle.length];
          this.glitch = 0.6;
        }
      }
    } else this.look = 'clean';
    if (this.override && running) this.look = this.override;
    const target = { film: 0, dmosh: 0, crt: 0, fold: 0, rain: 0, hyper: 0, tunnel: 0, ...LOOKS[this.locked ?? this.look] };
    if (label === 'breakdown') target.rain = 1;
    // (A new look snaps in under the section's warp and glitch, so it is there on the beat.)
    const k = 1 - Math.exp(-dt / (this.warp > 0.4 || this.glitch > 0.4 ? 0.2 : 0.8));
    for (const key of Object.keys(target) as (keyof Weights)[]) this.cur[key] += (target[key] - this.cur[key]) * k;
    this.glitch *= Math.exp(-dt / 0.12);
    this.warp *= Math.exp(-dt / 0.55);
    // Beat phase from the tempo map.
    let phase = 0;
    if (sc && sc.beats.length) {
      let lo = 0, hi = sc.beats.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (sc.beats[m].t <= s) lo = m + 1; else hi = m; }
      const b0 = sc.beats[Math.max(0, lo - 1)], b1 = sc.beats[Math.min(sc.beats.length - 1, lo)];
      if (b1.t > b0.t) phase = Math.min(1, Math.max(0, (s - b0.t) / (b1.t - b0.t)));
    }
    const bright = sc && running ? sampleEnvelope(sc.envelopes.bright, s) : 0.3;
    this.hue += dt * (0.01 + 0.03 * energy * this.cur.trip + 0.04 * bright);
    U.kick.value = this.kick; U.snare.value = this.snare; U.hat.value = this.hat;
    // With a split, the weights stay whole and the shaders mask them to the far window per pixel.
    const split = this.split && !this.locked;
    const a = 1;
    W.split.value = split ? 1 : 0; W.yaw.value = this.view.yaw; W.tanH.value = this.view.tanH;
    W.warpAll.value = this.warpAll ? 1 : 0;
    // The trip look's sunburst repaints the sky. The visualiser (which sets override) is all sky,
    // so there it would cover the whole show with one rainbow star: it keeps its own colours.
    W.trip.value = this.override ? 0 : this.cur.trip;
    U.energy.value = energy; U.night.value = night;
    // Surfaces in the world: the main side's scenery stays real, the far side takes the paint.
    U.trip.value = split ? 0 : this.cur.trip; U.tripFar.value = split ? this.cur.trip : 0;
    U.hue.value = this.hue; U.beatPhase.value = phase; U.showTime.value = s;
    // The palette eases to the section's over a second or so.
    const kp = 1 - Math.exp(-dt / 0.7);
    const [pa, pb, pc, pd] = this.palTarget;
    for (const [u, v] of [[U.pa, pa], [U.pb, pb], [U.pc, pc], [U.pd, pd]] as const) {
      const x = u.value as THREE.Vector3;
      x.set(x.x + (v[0] - x.x) * kp, x.y + (v[1] - x.y) * kp, x.z + (v[2] - x.z) * kp);
    }
    // Rain on the glass: a breakdown's weather shows on every window, the liquid look's only far side.
    W.crt.value = this.cur.crt ?? 0; W.film.value = this.cur.film ?? 0; W.dmosh.value = this.cur.dmosh ?? 0;
    // The tube eases on and off rather than cutting, and its rolling band runs faster on the kick.
    W.crtOn.value += (this.crtOn - W.crtOn.value) * (1 - Math.exp(-dt / 0.08));
    W.crtRoll.value = (W.crtRoll.value + dt * (0.15 + this.kick * 0.9)) % 1;
    W.hyper.value = (this.cur.hyper ?? 0) * a; W.tunnel.value = (this.cur.tunnel ?? 0) * a;
    // A build-up charges the warp: the smear and the field of view swell as it climbs, then the
    // section change fires the full jump.
    const rise = sc && running ? sampleEnvelope(sc.envelopes.rise, s) : 0;
    W.warp.value = Math.max(this.warp, rise * 0.22);
    W.kal.value = this.cur.kal * a; W.liquid.value = this.cur.liquid * a; W.rgb.value = this.cur.rgb * a; W.thermal.value = this.cur.thermal * a;
    W.echo.value = this.cur.echo * a; W.bloom.value = LOOKS.clean.bloom + (this.cur.bloom - LOOKS.clean.bloom) * a;
    // Monochrome phosphor glows on: the trails lengthen while it shows. (?crtmode=1 pins green, 2 amber.)
    if (CRT_PIN !== null) W.crtMode.value = CRT_PIN;
    if (W.crt.value > 0 && W.crtMode.value > 0.5 && this.crtOn) W.echo.value = Math.max(W.echo.value, 0.85); W.fold.value = (this.cur.fold ?? 0) * a; U.rain.value = label === 'breakdown' || !split ? this.cur.rain ?? 0 : 0;
    W.punch.value = this.cur.punch * a; W.glitch.value = this.glitch * a;
    W.aspect.value = aspect; W.kalRot.value += dt * (0.1 + this.kick * 0.6);
    W.segments.value = 6 + 2 * (this.secIdx % 3);
    // Feedback: eased, with a kick that pushes the zoom and the turn.
    const kf = 1 - Math.exp(-dt / 0.5);
    for (const key of ['amount', 'zoom', 'turn', 'hue'] as const) this.fb[key] += (this.feedback[key] - this.fb[key]) * kf;
    W.fbAmount.value = this.fb.amount;
    W.fbZoom.value = this.fb.zoom + (this.fb.zoom - 1) * this.kick * 1.5;
    W.fbTurn.value = this.fb.turn * (1 + this.kick);
    W.fbHue.value = this.fb.hue;
  }

  /** Feedback trails wanted by the show (the visualiser's scenes); eased towards each frame. */
  feedback = { amount: 0, zoom: 1, turn: 0, hue: 0 };
  private fb = { amount: 0, zoom: 1, turn: 0, hue: 0 };

  /** Tear the picture apart for a moment (a scene change in the visualiser). */
  crash() { this.glitch = 1; this.warp = Math.max(this.warp, 0.7); }

  /** Cycles a forced look (keyboard X): auto -> each look -> auto. */
  cycleLock(): string {
    const i = this.locked ? FX_LOOKS.indexOf(this.locked) : -1;
    this.locked = i + 1 < FX_LOOKS.length ? FX_LOOKS[i + 1] : null;
    return this.locked ?? 'auto';
  }
}
