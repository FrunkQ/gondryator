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

  // --- events that pass over / along the train ------------------------------------------
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
