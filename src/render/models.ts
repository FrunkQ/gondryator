// Procedural, original low-poly models. Every model is one merged geometry with vertex colours,
// standing on y=0, centred on x=0 (the travel axis) and z=0 (depth axis, +z towards the train).
// Packs refer to models by name; glTF models can be registered under the same names later.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURF } from './shaders';

type Part = THREE.BufferGeometry;
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();

/** Guess a surface from a colour; models override it with T() where the guess is wrong. */
function guessSurface(c: THREE.Color): number {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const h = hsl.h * 360;
  if (hsl.s > 0.18 && h > 65 && h < 170) return SURF.foliage;
  if (hsl.s > 0.35 && (h < 28 || h > 340)) return SURF.brick;
  if (hsl.l < 0.33 && h > 15 && h < 45) return SURF.wood;
  if (hsl.s < 0.14) return hsl.l > 0.62 ? SURF.plaster : hsl.l > 0.5 ? SURF.concrete : SURF.metal;
  return SURF.plaster;
}

/** Force a surface id on parts. */
function T(mat: number, ...parts: Part[]): Part[] {
  for (const g of parts) (g.getAttribute('mat').array as Float32Array).fill(mat);
  return parts;
}
const T1 = (mat: number, part: Part) => T(mat, part)[0];

function colorize(g: THREE.BufferGeometry, hex: number, shadeBottom = 0.85): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const pos = g.getAttribute('position');
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const h = Math.max(1e-3, bb.max.y - bb.min.y);
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    // Cheap ambient occlusion: darker towards the bottom of each part.
    const k = shadeBottom + (1 - shadeBottom) * ((pos.getY(i) - bb.min.y) / h);
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.setAttribute('mat', new THREE.BufferAttribute(new Float32Array(pos.count).fill(guessSurface(c)), 1));
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rot?: [number, number, number]): Part {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.applyMatrix4(tmpM.makeRotationFromEuler(tmpE.set(...rot)));
  g.translate(x, y, z);
  return colorize(g, color);
}
function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, color: number, seg = 10): Part {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
  g.translate(x, y, z);
  return colorize(g, color);
}
function cone(r: number, h: number, x: number, y: number, z: number, color: number, seg = 10): Part {
  const g = new THREE.ConeGeometry(r, h, seg, 1);
  g.translate(x, y, z);
  return colorize(g, color, 0.7);
}
function sphere(r: number, x: number, y: number, z: number, color: number, sx = 1, sy = 1, sz = 1, seg = 8): Part {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1));
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return colorize(g, color, 0.65);
}
/** Gable roof prism along x. */
function roof(w: number, d: number, h: number, x: number, y: number, z: number, color: number): Part {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0); shape.lineTo(d / 2, 0); shape.lineTo(0, h); shape.lineTo(-d / 2, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  g.translate(x, y, z);
  const out = colorize(g, color, 0.9);
  const c = new THREE.Color(color), hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return T1(hsl.s > 0.25 ? SURF.tile : SURF.metal, out);
}
function lathe(points: [number, number][], color: number, seg = 16): Part {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return colorize(g, color, 0.8);
}

function merge(parts: Part[]): THREE.BufferGeometry {
  // ExtrudeGeometry/Lathe are non-indexed or indexed inconsistently; normalise.
  const norm = parts.map(p => {
    const q = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'mat') q.deleteAttribute(k);
    if (!q.getAttribute('normal')) q.computeVertexNormals();
    return q;
  });
  const g = mergeGeometries(norm, false)!;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/** Windows as thin dark panels on the +z face of a block. */
function windowsOnFace(w: number, h: number, zFace: number, rows: number, cols: number, y0: number, color = 0x2c3540): Part[] {
  const out: Part[] = [];
  const cw = w / cols, rh = (h - y0) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    out.push(T1(SURF.glass, box(cw * 0.5, rh * 0.45, 0.08, -w / 2 + cw * (c + 0.5), y0 + rh * (r + 0.5), zFace + 0.04, color)));
  }
  return out;
}

/** A leafy crown: overlapping blobs of different sizes around a centre, darker underneath. */
function canopy(x: number, y: number, z: number, r: number, color: number, seed: number, flat = 0.85): Part[] {
  let k = seed * 9301 + 49297;
  const rnd = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
  const out: Part[] = [sphere(r * 0.8, x, y, z, color, 1, flat, 1, 9)];
  const c = new THREE.Color(color);
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2, e = (rnd() - 0.3) * 0.9;
    const d = r * (0.45 + rnd() * 0.35);
    const shade = c.clone().multiplyScalar(0.8 + rnd() * 0.35 + (e > 0 ? 0.1 : -0.1));
    out.push(sphere(r * (0.4 + rnd() * 0.25), x + Math.cos(a) * d, y + e * r * 0.7, z + Math.sin(a) * d, shade.getHex(), 1, flat, 1, 7));
  }
  return T(SURF.foliage, ...out);
}

/** A lumpy rock: an icosphere with its vertices pushed in and out (deterministic). */
function rockBlob(r: number, seed: number, color: number, x: number, y: number, z: number, stretch: [number, number, number] = [1.3, 0.8, 1]): Part {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const n = Math.sin(vx * 3.1 + seed) * Math.cos(vy * 2.7 + seed * 1.7) * Math.sin(vz * 3.7 + seed * 0.3);
    const k = 1 + 0.35 * n;
    pos.setXYZ(i, vx * k * stretch[0], vy * k * stretch[1], vz * k * stretch[2]);
  }
  g.computeVertexNormals();
  g.translate(x, y, z);
  return colorize(g, color, 0.7);
}

export const MODELS: Record<string, () => THREE.BufferGeometry> = {
  // --- trackside -----------------------------------------------------------------
  'catenary-pole': () => merge([
    box(0.32, 7.6, 0.32, 0, 3.8, 0, 0x6f7377),
    box(0.16, 0.16, 3.0, 0, 7.0, 1.4, 0x5d6166),
    box(0.1, 0.1, 2.6, 0, 6.3, 1.2, 0x5d6166, [0.42, 0, 0]),
    cyl(0.07, 0.07, 0.5, 0, 6.65, 2.6, 0x9a6b4a, 6),
    box(0.7, 0.4, 0.7, 0, 0.2, 0, 0x8c8a84),
  ]),
  'fence-post': () => merge(T(SURF.wood, box(0.12, 1.25, 0.12, 0, 0.62, 0, 0xb9b2a3), box(0.14, 0.12, 0.14, 0, 1.3, 0, 0x8b8476))),
  'marker-post': () => merge([box(0.14, 1.1, 0.14, 0, 0.55, 0, 0xe9e5dc), box(0.16, 0.22, 0.16, 0, 1.1, 0, 0xb3453a)]),
  'vine-stake': () => merge([box(0.08, 1.1, 0.08, 0, 0.55, 0, 0x7a5a3c), sphere(0.45, 0, 0.9, 0, 0x5f7a3a, 1, 0.6, 1, 6)]),

  // --- near structures (snare) ----------------------------------------------------
  'shed': () => merge([
    ...T(SURF.metal, box(4.5, 3, 3.2, 0, 1.5, 0, 0x8a9399)), roof(4.8, 3.6, 1.0, 0, 3, 0, 0x5b6268),
    T1(SURF.wood, box(1.2, 2.2, 0.06, -0.8, 1.1, 1.62, 0x5d4a37)),
  ]),
  'container': () => merge([
    ...T(SURF.metal, box(6, 2.6, 2.4, 0, 1.3, 0, 0x9c4f36),
    ...Array.from({ length: 10 }, (_, i) => box(0.08, 2.4, 0.04, -2.7 + i * 0.6, 1.3, 1.22, 0x7a3a28))),
  ]),
  'wall-house': () => merge([
    T1(SURF.brick, box(5, 4.2, 4, 0, 2.1, 0, 0xb87a5c)), roof(5.4, 4.6, 1.6, 0, 4.2, 0, 0x8a4a35),
    ...windowsOnFace(5, 4.2, 2.0, 2, 2, 0.6, 0x4d5b66),
  ]),
  'stone-hut': () => merge([T1(SURF.stone, box(3.5, 2.6, 3, 0, 1.3, 0, 0xc8b89a)), roof(3.8, 3.3, 1.1, 0, 2.6, 0, 0xa8573a)]),
  'hay-bales': () => merge([
    ...[-1.3, 0, 1.3].map(x => T1(SURF.straw, colorize(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 12).rotateX(Math.PI / 2).translate(x, 0.75, 0), 0xd9b56a))),
    ...T(SURF.straw, colorize(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 12).rotateX(Math.PI / 2).translate(-0.65, 2.1, 0), 0xcfa95c),
    colorize(new THREE.CylinderGeometry(0.75, 0.75, 1.2, 12).rotateX(Math.PI / 2).translate(0.65, 2.1, 0), 0xd4ae63)),
  ]),
  'signal-box': () => merge([
    T1(SURF.brick, box(3, 3.4, 3, 0, 1.7, 0, 0xa8644a)), T1(SURF.wood, box(3.3, 1.8, 3.3, 0, 4.3, 0, 0x8e9a8f)), roof(3.6, 3.6, 1, 0, 5.2, 0, 0x6c4b3c),
    ...windowsOnFace(3.3, 5.0, 1.66, 1, 3, 3.6, 0x37444d),
  ]),

  // --- mid distance (bass) -----------------------------------------------------------
  'warehouse': () => merge([
    ...T(SURF.metal, box(14, 7, 10, 0, 3.5, 0, 0xa7aaa6), box(14.4, 0.5, 10.4, 0, 7.2, 0, 0x7b7f80),
    ...[-4.5, 0, 4.5].map(x => box(3, 4, 0.08, x, 2, 5.04, 0x5e6a73))),
    T1(SURF.glass, box(14, 0.6, 0.06, 0, 5.8, 5.04, 0x6d7a84)),
  ]),
  'apartment': () => merge([
    box(12, 14, 9, 0, 7, 0, 0xd9cdb6), box(12.3, 0.4, 9.3, 0, 14.2, 0, 0x9d8f7a),
    ...windowsOnFace(12, 14, 4.5, 5, 6, 1.2, 0x56636e),
  ]),
  'farmhouse': () => merge([
    box(10, 5.5, 7, 0, 2.75, 0, 0xe6c999), roof(10.6, 7.6, 2.4, 0, 5.5, 0, 0xb4583a),
    box(4, 3.5, 5, 6.8, 1.75, 0, 0xdcc08f), roof(4.3, 5.4, 1.4, 6.8, 3.5, 0, 0xa9533a),
    ...windowsOnFace(10, 5.5, 3.5, 2, 4, 0.8, 0x5a5048),
    cone(1.1, 9, -7, 4.8, 1, 0x2f4a2a), cyl(0.2, 0.2, 0.6, -7, 0.3, 1, 0x4a3828),
  ]),
  'tank': () => merge([T1(SURF.metal, cyl(5, 5, 6, 0, 3, 0, 0xc4c6c3, 20)), cyl(5.2, 5.2, 0.4, 0, 6.2, 0, 0x9da2a3, 20), box(0.3, 6.4, 0.3, 5.1, 3.2, 0, 0x6f7377)]),
  'viaduct': () => merge([
    ...T(SURF.brick, box(20, 1.4, 6, 0, 9, 0, 0xa86f55),
    ...[-7, 0, 7].map(x => box(1.6, 8.4, 4, x, 4.2, 0, 0xa06a52))),
  ]),

  // --- lead row (heights follow pitch) -------------------------------------------------
  'town-block': () => merge([
    box(7, 10, 7, 0, 5, 0, 0xe8dcc4), box(7.4, 0.4, 7.4, 0, 10.2, 0, 0xa0563d),
    ...windowsOnFace(7, 10, 3.5, 4, 3, 1.0, 0x4f5c66),
  ]),
  'factory-block': () => merge([
    T1(SURF.brick, box(8, 10, 8, 0, 5, 0, 0xa5654c)),
    ...[-2.5, 0, 2.5].map(x => roof(1.2, 8, 1.2, x, 10, 0, 0x8a8c88)),
    T1(SURF.brick, cyl(0.6, 0.8, 6, 2.5, 13, -2, 0x8a6b5c, 8)),
  ]),
  'cypress-row': () => merge([
    cone(1.1, 10, 0, 5.2, 0, 0x2f4a2a, 8), cyl(0.2, 0.2, 0.5, 0, 0.25, 0, 0x4a3828, 6),
  ]),

  // --- far landmarks (pads, long notes) --------------------------------------------------
  'silo': () => merge([
    T1(SURF.concrete, cyl(3, 3, 22, -3.2, 11, 0, 0xcfcbc2, 16)), cone(3.1, 3, -3.2, 23.5, 0, 0xa9a59c, 16),
    T1(SURF.concrete, cyl(3, 3, 22, 3.2, 11, 0, 0xd4d0c7, 16)), cone(3.1, 3, 3.2, 23.5, 0, 0xa9a59c, 16),
    box(1.5, 26, 1.5, 0, 13, 3.2, 0x9b978f),
  ]),
  'cooling-tower': () => merge([
    T1(SURF.concrete, lathe([[16, 0], [13.5, 8], [10.5, 18], [9.6, 25], [10.2, 30], [11, 34]], 0xd9d5cc, 24)),
  ]),
  'pylon': () => {
    const parts: Part[] = [];
    const H = 34;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const g = new THREE.CylinderGeometry(0.25, 0.35, H, 4);
      const ang = Math.atan(2.6 / H);
      g.applyMatrix4(tmpM.makeRotationFromQuaternion(tmpQ.setFromEuler(tmpE.set(-sz * ang, 0, sx * ang))));
      g.translate(sx * 1.4, H / 2, sz * 1.4);
      parts.push(colorize(g, 0x7d8286));
    }
    parts.push(box(14, 0.5, 0.5, 0, H - 3, 0, 0x7d8286), box(10, 0.5, 0.5, 0, H - 9, 0, 0x7d8286), box(0.6, 0.6, 0.6, 0, H, 0, 0x7d8286));
    return merge(parts);
  },
  'church-tower': () => merge([
    T1(SURF.stone, box(6, 22, 6, 0, 11, 0, 0xd8c7a4)), cone(4.6, 7, 0, 25.5, 0, 0x9a5a3e, 4).rotateY(Math.PI / 4),
    box(1.4, 2.8, 0.1, 0, 17, 3.05, 0x3f3a34), box(6.6, 1, 6.6, 0, 22, 0, 0xc2b08c),
  ]),
  'hill': () => merge([T1(SURF.grass, sphere(30, 0, 0, 0, 0x8a9a5b, 1.6, 0.55, 1, 14))]),
  'chimney': () => merge([T1(SURF.brick, cyl(1.4, 2.4, 40, 0, 20, 0, 0xa8644a, 12)), cyl(1.6, 1.6, 1.5, 0, 39, 0, 0x8c4a3c, 12), T1(SURF.metal, box(16, 9, 12, 8, 4.5, -4, 0xa9aaa5))]),

  // --- ambient ------------------------------------------------------------------------
  'tree': () => merge([cyl(0.22, 0.38, 3.4, 0, 1.7, 0, 0x5b4632, 7), cyl(0.08, 0.12, 2, 0.6, 3.6, 0.2, 0x5b4632, 5),
    ...canopy(0, 4.6, 0, 2.6, 0x587a3d, 11)]),
  'plane-tree': () => merge([cyl(0.35, 0.5, 4.5, 0, 2.25, 0, 0x9c917d, 8), ...canopy(0, 6.6, 0, 3.8, 0x6b8a45, 23)]),
  'cypress': () => merge([cone(0.9, 8, 0, 4.4, 0, 0x2d4628, 7), cyl(0.15, 0.15, 0.5, 0, 0.25, 0, 0x4a3828, 5)]),
  'bush': () => merge(canopy(0, 0.8, 0, 1.3, 0x6d8442, 5, 0.6)),
  'far-hill': () => merge([T1(SURF.grass, sphere(120, 0, -10, 0, 0x93a46a, 2.2, 0.45, 1, 16))]),

  // --- the other window: Provence ---------------------------------------------------------
  'poplar': () => merge([cyl(0.18, 0.3, 2.5, 0, 1.25, 0, 0x6b5a45, 6), ...T(SURF.foliage,
    sphere(1.4, 0, 6.5, 0, 0x4f6e32, 1, 3.4, 1, 9), sphere(1.1, 0.4, 9.5, 0.2, 0x5a7a38, 1, 2.6, 1, 8), sphere(0.9, -0.3, 4.2, -0.2, 0x46642c, 1, 1.8, 1, 7))]),
  'lavender-row': () => merge([
    ...[-4, -2, 0, 2, 4].map(z => T1(SURF.lavender, colorize(new THREE.CylinderGeometry(0.55, 0.55, 12, 10, 1).rotateZ(Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.2, z), 0x8f78c9, 0.6))),
    ...[-3, -1, 1, 3].map(z => box(12, 0.02, 1.2, 0, 0.01, z, 0x9b7d5a)),
  ]),
  'chateau': () => merge([
    box(14, 9, 8, 0, 4.5, 0, 0xe8dcc0), ...T(SURF.tile, roof(14.4, 8.6, 4, 0, 9, 0, 0x55606e)),
    ...[-7.5, 7.5].flatMap(x => [cyl(2.4, 2.4, 13, x, 6.5, 0, 0xe2d4b6, 14), T1(SURF.tile, cone(2.8, 6, x, 16, 0, 0x4d5866, 14))]),
    ...windowsOnFace(14, 9, 4.0, 2, 5, 1.2, 0x3a4450),
  ]),
  'sunflowers': () => merge([
    ...Array.from({ length: 18 }, (_, i) => {
      const x = (i % 6) * 1.6 - 4, z = Math.floor(i / 6) * 1.6 - 1.6, h = 1.6 + ((i * 7) % 5) * 0.12;
      return [cyl(0.04, 0.05, h, x, h / 2, z, 0x4e6b2a, 4), T1(SURF.glow, cyl(0.32, 0.32, 0.08, x, h, z + 0.1, 0x8a6a10, 10).rotateX(Math.PI / 2.4)), cyl(0.14, 0.14, 0.1, x, h, z + 0.15, 0x3a2410, 8).rotateX(Math.PI / 2.4)];
    }).flat(),
  ]),

  // --- the other window: Cosmos -------------------------------------------------------------
  'asteroid': () => merge([T1(SURF.rock, rockBlob(1.6, 7, 0x8a8076, 0, 3.2, 0))]),
  'beacon': () => merge([T1(SURF.glow, sphere(0.18, 0, 1.6, 0, 0x6fd8ff, 1, 1, 1, 8)), T1(SURF.metal, cyl(0.03, 0.03, 1.2, 0, 0.9, 0, 0x7d8286, 4))]),
  'satellite': () => merge([
    T1(SURF.metal, box(1.6, 1.6, 1.6, 0, 7, 0, 0xc9b26a)),
    ...[-1, 1].map(sx => T1(SURF.glass, box(4, 0.06, 1.6, sx * 2.9, 7, 0, 0x2a3a7a))),
    T1(SURF.glow, sphere(0.15, 0, 8.1, 0, 0xff4f6b, 1, 1, 1, 6)),
  ]),
  'space-station': () => merge([
    T1(SURF.metal, colorize(new THREE.TorusGeometry(6, 0.7, 10, 40).rotateX(Math.PI / 2.6).translate(0, 16, 0), 0xd6d8dc)),
    ...[0, 1, 2, 3].map(k => T1(SURF.metal, colorize(new THREE.CylinderGeometry(0.18, 0.18, 12, 6).rotateZ(Math.PI / 2).rotateY(k * Math.PI / 4).rotateX(Math.PI / 2.6 - Math.PI / 2).translate(0, 16, 0), 0xa9adb3))),
    T1(SURF.glow, sphere(1.6, 0, 16, 0, 0xffd27a, 1, 1, 1, 12)),
  ]),
  'crystal': () => merge([T1(SURF.glass, colorize(new THREE.OctahedronGeometry(2.2, 0).scale(1, 3.5, 1).translate(0, 9, 0), 0x6fb8ff)),
    T1(SURF.glow, colorize(new THREE.OctahedronGeometry(0.7, 0).scale(1, 3, 1).translate(0, 9, 0), 0x9fe8ff))]),
  'gas-giant': () => merge([T1(SURF.gas, sphere(38, 0, 75, 0, 0xd99a5e, 1, 0.94, 1, 32))]),
  'ringed-planet': () => merge([
    T1(SURF.gas, sphere(26, 0, 85, 0, 0xe0c890, 1, 0.95, 1, 28)),
    T1(SURF.rock, colorize(new THREE.RingGeometry(34, 52, 64, 1).rotateX(-Math.PI / 2.3).translate(0, 85, 0), 0xcab89a)),
  ]),
  'moon': () => merge([T1(SURF.rock, sphere(14, 0, 45, 0, 0xb8b4ac, 1, 1, 1, 20))]),

  // Train window, Cosmos: a comet streaking along the line, and halo gates standing in the void.
  'comet': () => merge([
    T1(SURF.glow, sphere(1.6, 0, 42, 0, 0xdff4ff, 1, 1, 1, 12)),
    T1(SURF.glow, colorize(new THREE.ConeGeometry(1.5, 26, 12, 1, true).rotateZ(-Math.PI / 2).translate(-13.5, 42, 0), 0x7fc8ff)),
    T1(SURF.glow, colorize(new THREE.ConeGeometry(0.7, 40, 8, 1, true).rotateZ(-Math.PI / 2).translate(-20, 42.6, -0.5), 0xff9fe0)),
  ]),
  'halo-gate': () => merge([
    T1(SURF.metal, colorize(new THREE.TorusGeometry(4.2, 0.35, 10, 48).translate(0, 7, 0), 0xb9c0c8)),
    T1(SURF.glow, colorize(new THREE.TorusGeometry(3.7, 0.12, 6, 48).translate(0, 7, 0), 0x8fe8ff)),
    ...[0, 1, 2, 3, 4, 5].map(k => T1(SURF.glow, sphere(0.28, Math.cos(k * Math.PI / 3) * 4.2, 7 + Math.sin(k * Math.PI / 3) * 4.2, 0.3, 0xff6fd8, 1, 1, 1, 6))),
  ]),

  // --- the starship: everything floats, around an eye height of 4 m ------------------------------
  // Kick: a lattice strut with a light ring at eye level, the space version of the catenary pole.
  'gate-strut': () => {
    const p: Part[] = [];
    for (const sx of [-0.45, 0.45]) p.push(T1(SURF.metal, box(0.22, 34, 0.22, sx, 3, 0, 0x8d949c)));
    for (let y = -13; y < 20; y += 1.6) p.push(T1(SURF.metal, box(1.2, 0.08, 0.08, 0, y, 0, 0x6f767e, [0, 0, 0.6])));
    p.push(T1(SURF.glow, cyl(0.62, 0.62, 0.22, 0, 4.4, 0, 0x6fd8ff, 16)));
    p.push(T1(SURF.metal, cyl(0.7, 0.7, 0.12, 0, 4.2, 0, 0x5b6168, 16)));
    p.push(T1(SURF.glow, sphere(0.2, 0, 20.2, 0, 0xff4f6b, 1, 1, 1, 6)), T1(SURF.glow, sphere(0.2, 0, -14.2, 0, 0xff4f6b, 1, 1, 1, 6)));
    return merge(p);
  },
  // Hats: little navigation lights ticking past below the canopy.
  'nav-light': () => merge([
    T1(SURF.glow, colorize(new THREE.OctahedronGeometry(0.22, 0).translate(0, 1.9, 0), 0x9ff0ff)),
    T1(SURF.metal, box(0.7, 0.04, 0.04, 0, 1.9, 0, 0x7d8286)),
  ]),
  // Snare: cargo pods and tumbling rocks.
  'cargo-pod': () => merge([
    T1(SURF.paint, box(4.2, 2.2, 2.2, 0, 3.4, 0, 0xd8d2c4)),
    T1(SURF.paint, box(4.25, 0.4, 2.25, 0, 3.4, 0, 0xe0703a)),
    ...[-1, 1].map(sx => T1(SURF.metal, cyl(0.6, 0.8, 0.5, sx * 2.35, 3.4, 0, 0x6f767e, 10).rotateZ(Math.PI / 2))),
    T1(SURF.glow, sphere(0.14, 0, 4.6, 1.0, 0x7fff9f, 1, 1, 1, 6)),
  ]),
  'asteroid-big': () => merge([T1(SURF.rock, rockBlob(3.2, 3, 0x7d746a, 0, 6, 0, [1.05, 0.9, 1])), T1(SURF.rock, rockBlob(0.9, 11, 0x8a8076, 4.5, 9.5, 1, [1, 0.9, 1.1]))]),
  'asteroid-high': () => merge([T1(SURF.rock, rockBlob(2.2, 5, 0x857b70, 0, 15, 0, [1, 0.85, 1.1]))]),
  'asteroid-low': () => merge([T1(SURF.rock, rockBlob(2.6, 9, 0x6f675e, 0, -7, 0, [0.9, 1, 1.1]))]),
  // Bass: freighters, their length set by how long the note holds.
  'freighter': () => merge([
    T1(SURF.metal, box(22, 4.6, 6, 0, 6, 0, 0xb4b8bc)),
    T1(SURF.paint, box(22.1, 0.7, 6.05, 0, 4.4, 0, 0x3e5f86)),
    T1(SURF.metal, box(4, 3, 4, -7, 9.8, 0, 0x9da2a8)),
    T1(SURF.glow, box(3.4, 0.4, 0.1, -7, 10.4, 2.02, 0xfff0c8)),
    ...[-3, 0, 3, 6].map(x => T1(SURF.paint, box(2.6, 2.4, 6.4, x, 9.5, 0, [0xc0582f, 0x6f8fa8, 0xd8b04a, 0x7a8a5a][(x + 3) / 3]))),
    ...[-1, 1].map(sy => T1(SURF.glow, cyl(0.9, 1.2, 0.6, -11.3, 6 + sy * 1.2, 0, 0x7fd8ff, 12).rotateZ(Math.PI / 2))),
    ...Array.from({ length: 9 }, (_, i) => T1(SURF.glow, box(0.5, 0.25, 0.05, -9 + i * 2.2, 7.2, 3.03, 0xffe7b8))),
  ]),
  'star-dock': () => merge([
    T1(SURF.metal, cyl(3, 3, 18, 0, 12, 0, 0xc9ccd0, 16)),
    T1(SURF.metal, colorize(new THREE.TorusGeometry(9, 0.9, 10, 40).rotateX(Math.PI / 2).translate(0, 12, 0), 0xd6d8dc)),
    ...[0, 1, 2].map(k => T1(SURF.metal, box(18, 0.4, 0.4, 0, 12, 0, 0xa9adb3, [0, k * Math.PI / 3, 0]))),
    ...Array.from({ length: 12 }, (_, i) => T1(SURF.glow, sphere(0.3, Math.cos(i * Math.PI / 6) * 9, 12.9, Math.sin(i * Math.PI / 6) * 9, 0xffd27a, 1, 1, 1, 6))),
    T1(SURF.glow, cyl(3.05, 3.05, 0.5, 0, 16, 0, 0x8fe8ff, 16)),
  ]),
  // Melody: spires of light whose height follows the pitch.
  'light-spire': () => merge([
    T1(SURF.glass, colorize(new THREE.OctahedronGeometry(1.4, 0).scale(1, 10, 1).translate(0, 4, 0), 0x6fb8ff)),
    T1(SURF.glow, colorize(new THREE.OctahedronGeometry(0.5, 0).scale(1, 9, 1).translate(0, 4, 0), 0xbfe8ff)),
    T1(SURF.glow, sphere(0.6, 0, 18.5, 0, 0xffffff, 1, 1, 1, 8)),
  ]),
  // Section change: a ring gate the ship flies straight through.
  'ring-gate': () => merge([
    T1(SURF.metal, colorize(new THREE.TorusGeometry(12, 1.1, 12, 64).rotateY(Math.PI / 2).translate(0, 4, 0), 0xc4c9cf)),
    T1(SURF.glow, colorize(new THREE.TorusGeometry(10.6, 0.22, 6, 64).rotateY(Math.PI / 2).translate(0, 4, 0), 0x8fe8ff)),
    ...Array.from({ length: 8 }, (_, i) => T1(SURF.glow, box(0.5, 1.4, 1.4, 0.9, 4 + Math.sin(i * Math.PI / 4) * 12, Math.cos(i * Math.PI / 4) * 12, 0xff6fd8))),
  ]),
  // Breakdown: a star-liner convoy glides past, close enough to touch.
  'star-liner': () => merge([
    T1(SURF.paint, colorize(new THREE.CapsuleGeometry(1.5, 21, 6, 14).rotateZ(Math.PI / 2).translate(0, 4.2, 0), 0xe8e6e0)),
    T1(SURF.glow, box(19, 0.5, 3.04, 0, 4.6, 0, 0xffe7b8)),
    T1(SURF.paint, box(20, 0.3, 3.06, 0, 3.5, 0, 0x2a7a8e)),
    T1(SURF.metal, box(3, 1.6, 0.2, -8, 6.1, 0, 0x9da2a8)),
  ]),

  // --- events that pass over / along the train ------------------------------------------
  // A French château d'eau: a concrete bowl on a column, seen over the fields.
  'water-tower': () => merge([
    T1(SURF.concrete, cyl(1.3, 1.6, 22, 0, 11, 0, 0xd2cec4, 14)),
    T1(SURF.concrete, lathe([[1.3, 21], [5.5, 25], [7, 28.5], [7, 31], [6.6, 31.6], [0.1, 32]], 0xdcd8cf, 24)),
    T1(SURF.paint, cyl(7.05, 7.05, 0.6, 0, 30.2, 0, 0x6f8fa8, 24)),
  ]),
  // The gravel works: conveyor gantries climbing to a hopper, and the heaps they make.
  'gravel-works': () => {
    const parts: Part[] = [];
    const belt = (len: number, ang: number, x: number, z: number, rotY: number) => {
      const g = new THREE.BoxGeometry(len, 0.5, 1.1).translate(len / 2, 0, 0);
      g.applyMatrix4(tmpM.makeRotationFromQuaternion(tmpQ.setFromEuler(tmpE.set(0, rotY, ang))));
      g.translate(x, 0.6, z);
      parts.push(T1(SURF.metal, colorize(g, 0x8e9193)));
      const top = Math.sin(ang) * len;
      for (let k = 1; k <= 3; k++) {
        const f = k / 4, h = top * f;
        parts.push(T1(SURF.metal, box(0.25, h, 0.25, x + Math.cos(rotY) * Math.cos(ang) * len * f, h / 2, z - Math.sin(rotY) * Math.cos(ang) * len * f, 0x6e7275)));
      }
    };
    belt(26, 0.42, -18, 0, 0);
    belt(20, 0.5, 12, -6, Math.PI * 0.85);
    parts.push(T1(SURF.metal, box(5, 6, 5, 4, 13, -1, 0xa7a49c)), T1(SURF.metal, cone(2.6, 3, 4, 8.5, -1, 0x8c8a84, 8)));
    parts.push(...T(SURF.rock, cone(9, 7, -20, 3.5, 4, 0xbdb3a2, 14), cone(7, 5.5, 18, 2.75, 3, 0xc9bfae, 14), cone(5, 4, 30, 2, -4, 0xa99f8f, 12)));
    return merge(parts);
  },
  'overpass': () => merge([
    T1(SURF.concrete, box(7, 1.4, 70, 0, 8.2, -20, 0xbdb7aa)),
    box(7.2, 1.0, 0.3, 0, 9.4, 15, 0x9d978a), box(7.2, 1.0, 0.3, 0, 9.4, -55, 0x9d978a),
    ...T(SURF.concrete, box(5, 7.6, 1.6, 0, 3.8, -6.5, 0xb0a998), box(5, 7.6, 1.6, 0, 3.8, 6.5, 0xb0a998)),
  ]),
  'train-car': () => merge([
    ...T(SURF.paint, box(24, 3.4, 2.9, 0, 2.6, 0, 0xc9cdd0)), T1(SURF.glass, box(24.05, 0.8, 2.95, 0, 3.0, 0, 0x2e3a45)),
    ...T(SURF.paint, box(24.1, 0.35, 2.96, 0, 1.6, 0, 0xc0582f)), T1(SURF.metal, box(23, 0.8, 2.4, 0, 0.6, 0, 0x34383b)),
  ]),
};

const cache = new Map<string, THREE.BufferGeometry>();
export function getModel(name: string): THREE.BufferGeometry {
  let g = cache.get(name);
  if (!g) {
    const make = MODELS[name] ?? MODELS['shed'];
    g = make();
    cache.set(name, g);
  }
  return g;
}
