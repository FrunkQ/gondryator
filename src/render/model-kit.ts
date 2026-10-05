// The model kit: the helpers every procedural model is built from (models.ts, models-*.ts).
// Procedural, original low-poly models. Every model is one merged geometry with vertex colours,
// standing on y=0, centred on x=0 (the travel axis) and z=0 (depth axis, +z towards the train).
// Packs refer to models by name; glTF models can be registered under the same names later.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURF } from './shaders';
export { SURF };

export type Part = THREE.BufferGeometry;
export const tmpM = new THREE.Matrix4();
export const tmpQ = new THREE.Quaternion();
export const tmpE = new THREE.Euler();

/** Guess a surface from a colour; models override it with T() where the guess is wrong. */
export function guessSurface(c: THREE.Color): number {
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
export function T(mat: number, ...parts: Part[]): Part[] {
  for (const g of parts) (g.getAttribute('mat').array as Float32Array).fill(mat);
  return parts;
}
export const T1 = (mat: number, part: Part) => T(mat, part)[0];

export function colorize(g: THREE.BufferGeometry, hex: number, shadeBottom = 0.85): THREE.BufferGeometry {
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

export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rot?: [number, number, number]): Part {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.applyMatrix4(tmpM.makeRotationFromEuler(tmpE.set(...rot)));
  g.translate(x, y, z);
  return colorize(g, color);
}
export function cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, color: number, seg = 10): Part {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
  g.translate(x, y, z);
  return colorize(g, color);
}
export function cone(r: number, h: number, x: number, y: number, z: number, color: number, seg = 10): Part {
  const g = new THREE.ConeGeometry(r, h, seg, 1);
  g.translate(x, y, z);
  return colorize(g, color, 0.7);
}
export function sphere(r: number, x: number, y: number, z: number, color: number, sx = 1, sy = 1, sz = 1, seg = 8): Part {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1));
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return colorize(g, color, 0.65);
}
/** Gable roof prism along x. */
export function roof(w: number, d: number, h: number, x: number, y: number, z: number, color: number): Part {
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
export function lathe(points: [number, number][], color: number, seg = 16): Part {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return colorize(g, color, 0.8);
}

/** One Italian cypress at x, about 10 m tall at scale 1: a leafy flame, not a cone. */
export function cypress(x: number, scale: number, color: number, seed: number): Part[] {
  const H = 10 * scale, R = 1.15 * scale;
  const flame = lathe([[0, 0.4], [R * 0.75, 0.9], [R, H * 0.28], [R * 0.92, H * 0.55], [R * 0.62, H * 0.8], [R * 0.25, H * 0.95], [0, H]], color, 9);
  flame.translate(x, 0, 0);
  // A few tufts break up the outline.
  let k = seed * 7919 + 13;
  const rnd = () => ((k = (k * 9301 + 49297) % 233280) / 233280);
  const tufts: Part[] = [];
  for (let i = 0; i < 5; i++) {
    const y = H * (0.2 + rnd() * 0.6), r = R * (0.9 - (y / H) * 0.6), a = rnd() * Math.PI * 2;
    tufts.push(sphere(R * 0.45, x + Math.cos(a) * r * 0.7, y, Math.sin(a) * r * 0.7, color, 1, 1.6, 1, 6));
  }
  return [...T(SURF.foliage, flame, ...tufts), cyl(0.18 * scale, 0.22 * scale, 0.6, x, 0.3, 0, 0x4a3828, 6)];
}

export function merge(parts: Part[]): THREE.BufferGeometry {
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
export function windowsOnFace(w: number, h: number, zFace: number, rows: number, cols: number, y0: number, color = 0x2c3540): Part[] {
  const out: Part[] = [];
  const cw = w / cols, rh = (h - y0) / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    out.push(T1(SURF.glass, box(cw * 0.5, rh * 0.45, 0.08, -w / 2 + cw * (c + 0.5), y0 + rh * (r + 0.5), zFace + 0.04, color)));
  }
  return out;
}

/** A leafy crown: overlapping blobs of different sizes around a centre, darker underneath. */
export function canopy(x: number, y: number, z: number, r: number, color: number, seed: number, flat = 0.85): Part[] {
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
export function rockBlob(r: number, seed: number, color: number, x: number, y: number, z: number, stretch: [number, number, number] = [1.3, 0.8, 1]): Part {
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

