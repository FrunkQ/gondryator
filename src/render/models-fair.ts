// Halloween night, the friendly cliché: pumpkin patches, a haunted forest, a town street dressed up
// for trick-or-treat and a stormy coast with a lighthouse. Procedural, original and low-poly, like
// models.ts: one merged geometry each, standing on y=0, centred on x=0 and z=0, face towards +z.
// SURF.glow is self-lit, so carved faces, lit windows, lamps and ghosts shine through the night.

import * as THREE from 'three/webgpu';
import { SURF, T, T1, box, cyl, cone, sphere, roof, lathe, canopy, rockBlob, colorize, merge, windowsOnFace, tmpM, tmpQ, tmpE, type Part } from './model-kit';

// Kept for parity with the other model files (some helpers are unused here).
void canopy; void windowsOnFace;

// --- palette -----------------------------------------------------------------------------------
const PUMPKIN = 0xe0701c;
const PUMPKIN_DK = 0xc85a16;
const PUMPKIN_LT = 0xec8a2c;
const STALK = 0x4f5a26;
const CARVED = 0xffa526;      // candle-lit carving
const LAMP = 0xffd27a;
const WINDOW_LIT = 0xffb85a;
const WINDOW_DARK = 0x161a22;
const IRON = 0x16161a;
const BARK = 0x2b241f;
const STONE = 0x6c6c6a;
const ROOF_DK = 0x262230;
const LEAF = 0x23361e;
const SOCKET = 0x0b0a0c;

const UP = new THREE.Vector3(0, 1, 0);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function rng(seed: number) {
  let k = Math.abs(Math.floor(seed * 9301 + 49297)) % 233280;
  return () => ((k = (k * 9301 + 49297) % 233280) / 233280);
}

/** Apply a rotation (Euler) then a translation to a group of parts, in place. */
function place(parts: Part[], rx: number, ry: number, rz: number, x: number, y: number, z: number): Part[] {
  tmpQ.setFromEuler(tmpE.set(rx, ry, rz));
  tmpM.compose(V(x, y, z), tmpQ, V(1, 1, 1));
  for (const p of parts) p.applyMatrix4(tmpM);
  return parts;
}

/** A tapered cylinder from a to b. */
function stick(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, color: number, mat: number = SURF.wood, seg = 5): Part {
  const d = b.clone().sub(a);
  const len = Math.max(1e-3, d.length());
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1).translate(0, len / 2, 0);
  g.applyQuaternion(tmpQ.setFromUnitVectors(UP, d.normalize()));
  g.translate(a.x, a.y, a.z);
  return T1(mat, colorize(g, color, 0.9));
}

/** Gnarled bare branches, recursively; branch tips go into `tips`. Spreads mostly along x so the silhouette reads. */
function branches(parts: Part[], tips: THREE.Vector3[], p: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number, rnd: () => number, color = BARK) {
  // Each branch is two segments with a kink, so nothing is ruler-straight.
  const kink = dir.clone().add(V((rnd() - 0.5) * 0.5, 0, (rnd() - 0.5) * 0.3)).normalize();
  const mid = p.clone().addScaledVector(dir, len * 0.5);
  const end = mid.clone().addScaledVector(kink, len * 0.5);
  parts.push(stick(p, mid, r, r * 0.85, color), stick(mid, end, r * 0.85, r * 0.65, color));
  if (depth <= 0) { tips.push(end); return; }
  const n = 2 + (rnd() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const side = (i / Math.max(1, n - 1) - 0.5) * 2;
    const d = kink.clone().add(V(side * 0.9 + (rnd() - 0.5) * 0.6, (rnd() - 0.3) * 0.4, (rnd() - 0.5) * 0.7));
    if (d.y < 0.12) d.y = 0.12;
    d.normalize();
    branches(parts, tips, end, d, len * (0.66 + rnd() * 0.12), r * 0.62, depth - 1, rnd, color);
  }
}

// --- pumpkins ----------------------------------------------------------------------------------
/** A ribbed pumpkin body of radius r, centred at the origin, darker in the grooves. Bottom at -0.85·r·sq. */
function pumpkinBody(r: number, sq: number, color: number, lobes = 10): Part {
  const g = r < 0.6 ? new THREE.SphereGeometry(r, 16, 9) : new THREE.SphereGeometry(r, 20, 12);
  const pos = g.getAttribute('position');
  const ribs: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const rib = 0.5 + 0.5 * Math.cos(lobes * (a - Math.PI / 2));
    const hr = Math.min(1, Math.hypot(x, z) / r);
    const k = 0.9 + 0.1 * rib;
    x *= k; z *= k;
    y *= sq;
    y *= y > 0 ? 0.72 + 0.28 * hr : 0.85 + 0.15 * hr;
    pos.setXYZ(i, x, y, z);
    ribs.push(rib);
  }
  g.computeVertexNormals();
  colorize(g, color, 0.7);
  const col = g.getAttribute('color').array as Float32Array;
  for (let i = 0; i < ribs.length; i++) {
    const m = 0.62 + 0.38 * ribs[i];
    col[i * 3] *= m; col[i * 3 + 1] *= m; col[i * 3 + 2] *= m;
  }
  return T1(SURF.paint, g);
}

/** Wrap an extruded flat shape onto the front of an ellipsoid (radius r, height squash sq). */
function wrapFront(g: THREE.BufferGeometry, depth: number, r: number, sq: number, proud: number, sink: number) {
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), t = pos.getZ(i) / depth;
    const s = r * Math.sqrt(Math.max(0.05, 1 - (x / r) ** 2 - (y / (r * sq)) ** 2));
    pos.setZ(i, s - sink + t * (sink + proud));
  }
  g.computeVertexNormals();
  return g;
}

function shapeOf(pts: [number, number][]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}

/** A carved face for a pumpkin of radius r: triangle eyes, a nose and a jagged grin, glowing, on +z. */
function carvedFace(r: number, sq: number, color = CARVED, style = 0): Part[] {
  const out: Part[] = [];
  const ext = (pts: [number, number][]) => {
    const g = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: 1, bevelEnabled: false });
    wrapFront(g, 1, r, sq, r * 0.04, r * 0.18);
    out.push(T1(SURF.glow, colorize(g, color, 1)));
  };
  const e = r * 0.2, ey = r * sq * 0.2, ex = r * 0.32;
  for (const sgn of [-1, 1]) {
    // Slanted triangles: the inner corner sits lower, for a mischievous look.
    const cx = sgn * ex;
    ext(style === 1
      ? [[cx - e, ey - e * 0.5], [cx + e, ey - e * 0.5], [cx, ey + e * 0.9]]
      : [[cx - e, ey + e * (sgn > 0 ? -0.6 : 0.2)], [cx + e, ey + e * (sgn > 0 ? 0.2 : -0.6)], [cx + sgn * e * 0.25, ey + e * 0.9]]);
  }
  const n = r * 0.08;
  ext([[-n, -n * 0.2], [n, -n * 0.2], [0, n * 1.3]]);
  // The grin: a smile whose top edge has two teeth hanging down and one tooth pushing up from below.
  const W = r * 0.52, H = r * sq * 0.3, my = -r * sq * 0.3;
  const yt = (u: number) => (0.5 * u * u - 0.1) * H + my;
  const yb = (u: number) => (-0.9 * (1 - u * u) + 0.4 * u * u) * H + my;
  const pts: [number, number][] = [];
  const top = (u: number) => pts.push([u * W, yt(u)]);
  const tooth = (c: number) => {
    pts.push([(c - 0.08) * W, yt(c - 0.08)], [(c - 0.08) * W, yt(c) - 0.36 * H], [(c + 0.08) * W, yt(c) - 0.36 * H], [(c + 0.08) * W, yt(c + 0.08)]);
  };
  for (const u of [-1, -0.75, -0.5]) top(u);
  tooth(-0.32);
  for (const u of [-0.15, 0, 0.15]) top(u);
  tooth(0.32);
  for (const u of [0.5, 0.75]) top(u);
  pts.push([W, yt(1)]);
  for (const u of [0.8, 0.55, 0.3, 0.12]) pts.push([u * W, yb(u)]);
  pts.push([0.07 * W, yb(0) + 0.32 * H], [-0.07 * W, yb(0) + 0.32 * H]);
  for (const u of [-0.12, -0.3, -0.55, -0.8]) pts.push([u * W, yb(u)]);
  ext(pts);
  return out;
}

/** A whole pumpkin standing on y=0 at (x, z): body, curly stalk, and a carved face if asked. */
function pumpkin(x: number, z: number, r: number, carved: boolean, seed: number, color = PUMPKIN, sq = 0.82, ry = 0): Part[] {
  const rnd = rng(seed);
  const top = r * sq * 0.72;
  const parts: Part[] = [pumpkinBody(r, sq, color)];
  const s0 = V(0, top - r * 0.08, 0), s1 = V((rnd() - 0.5) * r * 0.25, top + r * 0.22, (rnd() - 0.5) * r * 0.1);
  const s2 = s1.clone().add(V(r * 0.14, r * 0.08, 0));
  parts.push(stick(s0, s1, r * 0.1, r * 0.075, STALK, SURF.wood, 6), stick(s1, s2, r * 0.075, r * 0.05, STALK, SURF.wood, 5));
  if (carved) parts.push(...carvedFace(r, sq, CARVED, seed % 2));
  return place(parts, 0, ry, 0, x, r * sq * 0.85, z);
}

function leaf(x: number, y: number, z: number, s: number, ry: number, color = LEAF): Part {
  const g = new THREE.SphereGeometry(s, 7, 4).scale(1, 0.14, 0.75).rotateY(ry).translate(x, y, z);
  return T1(SURF.foliage, colorize(g, color, 0.8));
}

function vine(points: THREE.Vector3[], r = 0.04, color = 0x2c4220): Part {
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 3, r, 4, false);
  return T1(SURF.foliage, colorize(g, color, 0.9));
}

/** A little tendril curl: a shrinking spiral lying on the ground. */
function curl(x: number, z: number, s: number, turn = 1): Part {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, a = t * Math.PI * 3 * turn, rr = s * (1 - t * 0.8);
    pts.push(V(x + Math.cos(a) * rr, 0.08 + t * 0.12, z + Math.sin(a) * rr));
  }
  return vine(pts, 0.018);
}

// --- small helpers for buildings ----------------------------------------------------------------
/** A framed window on a +z face: lit (glow) or dark (glass), with a cross of glazing bars. */
function win(x: number, y: number, z: number, w: number, h: number, lit: boolean, frame = 0x1e1a1c): Part[] {
  const parts: Part[] = [
    T1(SURF.paint, box(w + 0.22, h + 0.22, 0.1, x, y, z + 0.05, frame)),
    T1(lit ? SURF.glow : SURF.glass, box(w, h, 0.06, x, y, z + 0.11, lit ? WINDOW_LIT : WINDOW_DARK)),
  ];
  if (lit) parts.push(T1(SURF.paint, box(0.06, h, 0.04, x, y, z + 0.15, frame)), T1(SURF.paint, box(w, 0.06, 0.04, x, y + h * 0.1, z + 0.15, frame)));
  return parts;
}

/** A cobweb in a corner: spokes fanning out from (x, y) plus two sagging threads across them. dx/dy pick the quadrant. */
function cobweb(x: number, y: number, z: number, s: number, dx: number, dy: number): Part[] {
  const out: Part[] = [];
  const col = 0xcfd4d8;
  const n = 5;
  const tip = (k: number, rr: number) => {
    const a = (k / (n - 1)) * Math.PI / 2;
    return V(x + dx * Math.cos(a) * rr, y + dy * Math.sin(a) * rr, z);
  };
  for (let k = 0; k < n; k++) out.push(stick(V(x, y, z), tip(k, s), 0.012, 0.01, col, SURF.paint, 3));
  for (const f of [0.45, 0.8]) for (let k = 0; k < n - 1; k++) out.push(stick(tip(k, s * f), tip(k + 1, s * f * 0.97), 0.01, 0.01, col, SURF.paint, 3));
  return out;
}

// --- graves -------------------------------------------------------------------------------------
type StoneKind = 'round' | 'cross' | 'obelisk' | 'slab';
/** A headstone at the origin, front face at +z. */
function headstone(kind: StoneKind, color = STONE): Part[] {
  const parts: Part[] = [];
  const dk = 0x3a3a3c;
  if (kind === 'round') {
    parts.push(box(0.8, 0.95, 0.18, 0, 0.475, 0, color));
    parts.push(colorize(new THREE.CylinderGeometry(0.4, 0.4, 0.18, 12).rotateX(Math.PI / 2).translate(0, 0.95, 0), color));
    parts.push(box(0.36, 0.05, 0.02, 0, 0.95, 0.1, dk), box(0.05, 0.3, 0.02, 0, 0.98, 0.1, dk));
    for (const y of [0.62, 0.5, 0.38]) parts.push(box(0.5 - (0.62 - y) * 0.8, 0.035, 0.02, 0, y, 0.1, dk));
  } else if (kind === 'cross') {
    parts.push(box(0.55, 0.22, 0.4, 0, 0.11, 0, color));
    parts.push(box(0.18, 1.35, 0.16, 0, 0.85, 0, color), box(0.72, 0.17, 0.16, 0, 1.15, 0, color));
  } else if (kind === 'obelisk') {
    parts.push(box(0.65, 0.3, 0.65, 0, 0.15, 0, color), box(0.5, 0.15, 0.5, 0, 0.37, 0, color));
    parts.push(colorize(new THREE.CylinderGeometry(0.15, 0.24, 1.6, 4).rotateY(Math.PI / 4).translate(0, 1.24, 0), color));
    parts.push(colorize(new THREE.ConeGeometry(0.16, 0.3, 4).rotateY(Math.PI / 4).translate(0, 2.19, 0), color));
  } else {
    parts.push(box(0.7, 1.0, 0.15, 0, 0.5, 0, color));
    parts.push(roof(0.15, 0.7, 0.28, 0, 0, 0, color).rotateY(Math.PI / 2).translate(0, 1.0, 0));
    parts.push(box(0.4, 0.04, 0.02, 0, 0.75, 0.085, dk), box(0.3, 0.04, 0.02, 0, 0.62, 0.085, dk));
  }
  return T(SURF.stone, ...parts);
}

function mound(x: number, z: number, w: number, l: number, color = 0x2a2e22): Part {
  return T1(SURF.grass, sphere(1, x, 0, z, color, w, 0.22, l, 8));
}

/** A small dead tree, about h metres tall. */
function deadTree(x: number, z: number, h: number, seed: number, tips: THREE.Vector3[] = [], color = BARK): Part[] {
  const rnd = rng(seed);
  const parts: Part[] = [];
  const trunkTop = V(x + (rnd() - 0.5) * h * 0.08, h * 0.42, z);
  parts.push(stick(V(x, 0, z), trunkTop, h * 0.05, h * 0.035, color, SURF.wood, 6));
  branches(parts, tips, trunkTop, V((rnd() - 0.5) * 0.4, 1, 0).normalize(), h * 0.28, h * 0.032, 2, rnd, color);
  return parts;
}

// --- bats ----------------------------------------------------------------------------------------
function bat(x: number, y: number, z: number, s: number, hang: boolean): Part[] {
  const col = 0x0c0a10;
  const parts: Part[] = [];
  if (hang) {
    // Hanging upside down, wings folded round: a little dark teardrop with ears pointing down.
    parts.push(sphere(0.13 * s, x, y - 0.2 * s, z, col, 1, 1.9, 0.9, 6));
    parts.push(stick(V(x, y, z), V(x, y - 0.06 * s, z), 0.015 * s, 0.015 * s, col, SURF.paint, 3));
    for (const sg of [-1, 1]) parts.push(colorize(new THREE.ConeGeometry(0.04 * s, 0.1 * s, 4).rotateZ(Math.PI).translate(x + sg * 0.06 * s, y - 0.45 * s, z), col));
  } else {
    parts.push(sphere(0.1 * s, x, y, z, col, 1, 1.5, 0.9, 6));
    for (const sg of [-1, 1]) {
      const w: [number, number][] = [[0.05, 0.06], [0.25, 0.2], [0.45, 0.25], [0.62, 0.14], [0.54, 0.04], [0.47, -0.07], [0.37, -0.01], [0.27, -0.1], [0.17, -0.03], [0.06, -0.08]];
      const g = new THREE.ExtrudeGeometry(shapeOf(w.map(([a, b]) => [sg * a * s, b * s] as [number, number])), { depth: 0.02 * s, bevelEnabled: false });
      g.rotateZ(sg * 0.25).translate(x, y, z);
      parts.push(colorize(g, col, 1));
      parts.push(colorize(new THREE.ConeGeometry(0.035 * s, 0.09 * s, 4).translate(x + sg * 0.05 * s, y + 0.18 * s, z), col));
    }
  }
  return T(SURF.paint, ...parts);
}

// --- models ---------------------------------------------------------------------------------------
export const FAIR_MODELS: Record<string, () => THREE.BufferGeometry> = {
  // A carved jack-o'-lantern, grinning at the train.
  'jack-o-lantern': () => merge(pumpkin(0, 0, 0.42, true, 3, PUMPKIN, 0.85)),

  // A section of black cemetery railing: spear-tipped bars between two square posts on a stone kerb.
  'iron-railing': () => {
    const parts: Part[] = [T1(SURF.stone, box(3.3, 0.25, 0.32, 0, 0.125, 0, 0x4a4a4c))];
    for (const x of [-1.55, 1.55]) {
      parts.push(T1(SURF.stone, box(0.3, 1.9, 0.3, x, 1.2, 0, 0x55555a)), T1(SURF.stone, box(0.38, 0.12, 0.38, x, 2.18, 0, 0x4a4a4c)));
      parts.push(T1(SURF.stone, sphere(0.14, x, 2.36, 0, 0x55555a, 1, 1, 1, 8)));
    }
    parts.push(T1(SURF.metal, box(2.9, 0.06, 0.05, 0, 0.45, 0, IRON)), T1(SURF.metal, box(2.9, 0.06, 0.05, 0, 1.45, 0, IRON)));
    for (let i = 0; i < 18; i++) {
      const x = -1.33 + i * (2.66 / 17), h = 1.55 + (i % 2) * 0.12;
      parts.push(T1(SURF.metal, cyl(0.02, 0.02, h, x, 0.25 + h / 2, 0, IRON, 4)));
      parts.push(T1(SURF.metal, cone(0.05, 0.16, x, 0.25 + h + 0.08, 0, IRON, 4)));
      // Little loops between the lower rails on every other bar.
      if (i % 2 === 0 && i < 17) parts.push(T1(SURF.metal, colorize(new THREE.TorusGeometry(0.06, 0.012, 3, 8).translate(x + 0.074, 0.6, 0), IRON)));
    }
    return merge(parts);
  },

  // A rounded headstone, leaning a little, with a grassy mound in front.
  'gravestone': () => merge([
    ...place(headstone('round', 0x727270), -0.06, 0.08, 0.09, 0, 0, 0),
    mound(0, 0.85, 0.45, 0.75),
  ]),

  // A Victorian gas lamp: black fluted post, a ladder bar, and a warm four-sided lantern.
  'gas-lamp': () => {
    const parts: Part[] = [
      T1(SURF.metal, cyl(0.16, 0.25, 0.7, 0, 0.35, 0, IRON, 8)),
      T1(SURF.metal, cyl(0.11, 0.13, 0.14, 0, 0.77, 0, IRON, 8)),
      T1(SURF.metal, cyl(0.06, 0.085, 2.5, 0, 2.05, 0, IRON, 8)),
      T1(SURF.metal, cyl(0.09, 0.09, 0.1, 0, 3.25, 0, IRON, 8)),
      T1(SURF.metal, box(0.7, 0.05, 0.05, 0, 3.15, 0, IRON)),
      T1(SURF.metal, sphere(0.045, -0.35, 3.15, 0, IRON, 1, 1, 1, 6)), T1(SURF.metal, sphere(0.045, 0.35, 3.15, 0, IRON, 1, 1, 1, 6)),
      T1(SURF.metal, cyl(0.2, 0.07, 0.25, 0, 3.43, 0, IRON, 8)),
      T1(SURF.glow, colorize(new THREE.CylinderGeometry(0.27, 0.19, 0.55, 4, 1).rotateY(Math.PI / 4).translate(0, 3.83, 0), LAMP, 0.9)),
      T1(SURF.metal, colorize(new THREE.ConeGeometry(0.4, 0.32, 4).rotateY(Math.PI / 4).translate(0, 4.27, 0), IRON)),
      T1(SURF.metal, cyl(0.06, 0.08, 0.12, 0, 4.48, 0, IRON, 6)),
      T1(SURF.metal, sphere(0.06, 0, 4.58, 0, IRON, 1, 1, 1, 6)),
    ];
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      parts.push(stick(V(sx * 0.19, 3.55, sz * 0.19), V(sx * 0.27, 4.11, sz * 0.27), 0.018, 0.018, IRON, SURF.metal, 3));
    }
    return merge(parts);
  },

  // A scarecrow: a sack head with a stitched face, a floppy pointed hat, a ragged coat and straw everywhere.
  'scarecrow': () => {
    const COAT = 0x3a3a2c, STRAW = 0xb8963a, SACK = 0xa08a5c, STITCH = 0x1a1410;
    const parts: Part[] = [
      stick(V(0, 0, -0.05), V(0, 2.45, -0.05), 0.08, 0.07, 0x4a3828),
      T1(SURF.wood, box(2.1, 0.1, 0.1, 0, 2.05, -0.05, 0x4a3828)),
      T1(SURF.straw, sphere(0.31, 0, 2.52, 0, SACK, 1, 1.08, 1, 10)),
      T1(SURF.straw, cyl(0.12, 0.16, 0.14, 0, 2.22, 0, 0x7a6a44, 8)),
      // Coat, sleeves and patches.
      T1(SURF.paint, box(0.78, 0.92, 0.36, 0, 1.68, 0, COAT)),
      T1(SURF.paint, box(0.88, 0.32, 0.32, -0.8, 2.03, -0.02, COAT, [0, 0, 0.06])),
      T1(SURF.paint, box(0.88, 0.32, 0.32, 0.8, 2.03, -0.02, COAT, [0, 0, -0.06])),
      T1(SURF.paint, box(0.2, 0.18, 0.02, 0.18, 1.55, 0.19, 0x6a3a2a)),
      T1(SURF.paint, box(0.16, 0.14, 0.02, -0.7, 2.0, 0.15, 0x4a5a3a)),
      // Hat: a wide brim and a floppy, bent cone.
      T1(SURF.paint, cyl(0.5, 0.52, 0.05, 0, 2.8, 0, 0x1e1a20, 12)),
      T1(SURF.paint, colorize(new THREE.ConeGeometry(0.29, 0.8, 9).rotateZ(0.4).translate(0.14, 3.17, 0), 0x231e26)),
      T1(SURF.paint, cyl(0.3, 0.3, 0.07, 0, 2.86, 0, 0x5a2a20, 10)),
    ];
    // Ragged hems.
    for (let i = 0; i < 5; i++) parts.push(T1(SURF.paint, box(0.13, 0.15 + (i % 3) * 0.09, 0.3, -0.3 + i * 0.15, 1.18 - (i % 3) * 0.045, 0, COAT)));
    for (const sg of [-1, 1]) for (let i = 0; i < 2; i++) parts.push(T1(SURF.paint, box(0.12, 0.2 + i * 0.08, 0.28, sg * (1.0 + i * 0.12), 1.8 - i * 0.04, 0, COAT)));
    // Stitched face: X eyes and a stitched grin.
    for (const ex of [-0.11, 0.11]) for (const rz of [0.75, -0.75]) parts.push(T1(SURF.paint, box(0.13, 0.025, 0.03, ex, 2.6, 0.29, STITCH, [0, 0, rz])));
    parts.push(T1(SURF.paint, box(0.26, 0.022, 0.03, 0, 2.42, 0.29, STITCH, [0, 0, 0])));
    for (let i = 0; i < 5; i++) parts.push(T1(SURF.paint, box(0.018, 0.08, 0.03, -0.1 + i * 0.05, 2.42, 0.29, STITCH)));
    // Straw tufts poking out of the cuffs, the hem and the neck.
    const rnd = rng(17);
    for (const sg of [-1, 1]) for (let i = 0; i < 4; i++) {
      parts.push(stick(V(sg * 1.2, 2.03, 0), V(sg * (1.45 + rnd() * 0.12), 1.85 + rnd() * 0.3, (rnd() - 0.5) * 0.3), 0.04, 0.006, STRAW, SURF.straw, 4));
    }
    for (let i = 0; i < 6; i++) parts.push(stick(V(-0.25 + i * 0.1, 1.2, 0), V(-0.3 + i * 0.12 + (rnd() - 0.5) * 0.1, 0.9 - rnd() * 0.15, (rnd() - 0.5) * 0.2), 0.04, 0.006, STRAW, SURF.straw, 4));
    for (let i = 0; i < 4; i++) parts.push(stick(V(0, 2.2, 0), V((rnd() - 0.5) * 0.5, 2.2 + rnd() * 0.12, 0.2 + rnd() * 0.1), 0.03, 0.005, STRAW, SURF.straw, 4));
    return merge(parts);
  },

  // A pumpkin patch: nine pumpkins of all sizes on dark soil, three of them carved and lit, vines curling between.
  'pumpkin-patch': () => {
    const parts: Part[] = [T1(SURF.rock, box(6.8, 0.1, 3.8, 0, 0.0, 0, 0x2a1d14))];
    const list: [number, number, number, boolean, number][] = [
      [-2.5, 0.5, 0.55, true, PUMPKIN], [-1.3, -0.7, 0.4, false, PUMPKIN_DK], [-0.2, 0.9, 0.72, true, PUMPKIN_LT],
      [1.0, -0.4, 0.48, false, PUMPKIN], [2.1, 0.6, 0.52, false, PUMPKIN_DK], [2.85, -0.9, 0.33, false, PUMPKIN_LT],
      [-3.0, -1.0, 0.36, false, 0xd8621a], [0.4, -1.3, 0.3, false, 0xb8a070], [1.65, 1.35, 0.42, true, PUMPKIN],
    ];
    list.forEach(([x, z, r, carved, col], i) => parts.push(...pumpkin(x, z, r, carved, 11 + i * 7, col, 0.8, carved ? (i - 4) * 0.08 : i * 0.9)));
    // Two long vines wandering across, with tendril curls and leaves along them.
    const rnd = rng(23);
    for (const [z0, ph] of [[-0.2, 0], [0.4, 2]]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 10; i++) { const x = -3.2 + i * 0.64; pts.push(V(x, 0.09, z0 + Math.sin(x * 1.7 + ph) * 0.55)); }
      parts.push(vine(pts, 0.04));
      for (let i = 1; i < 10; i += 2) {
        const p = pts[i];
        parts.push(leaf(p.x + 0.15, 0.14, p.z + (rnd() - 0.5) * 0.5, 0.32 + rnd() * 0.12, rnd() * 3, i % 4 ? LEAF : 0x2c3a1c));
        if (i % 4 === 1) parts.push(curl(p.x - 0.2, p.z + 0.25, 0.14 + rnd() * 0.06, rnd() < 0.5 ? 1 : -1));
      }
    }
    return merge(parts);
  },

  // A huddle of old graves: rounded stones, a cross, an obelisk, a slab, all leaning, and a dead sapling.
  'gravestones': () => {
    const parts: Part[] = [];
    const stones: [StoneKind, number, number, number, number, number, number][] = [
      // kind, x, z, tilt z, tilt x, turn, colour
      ['round', -2.6, 0.4, 0.12, -0.05, 0.1, 0x6e6e6c],
      ['cross', -1.3, -0.5, -0.1, 0.06, -0.15, 0x5e6062],
      ['slab', 0.0, 0.6, 0.05, -0.1, 0.05, 0x7a7874],
      ['obelisk', 1.3, -0.6, -0.04, 0.03, 0.3, 0x646568],
      ['round', 2.6, 0.5, -0.16, 0.04, -0.2, 0x5a5c60],
      ['cross', 0.9, 1.4, 0.2, -0.08, 0.15, 0x6a6a68],
    ];
    for (const [k, x, z, rz, rx, ry, col] of stones) {
      parts.push(...place(headstone(k, col), rx, ry, rz, x, 0, z));
      if (k !== 'obelisk') parts.push(mound(x, z + 0.75, 0.4, 0.65));
    }
    parts.push(...deadTree(-3.3, -1.1, 3.4, 5));
    parts.push(T1(SURF.grass, box(7.4, 0.06, 3.6, 0, 0.0, 0.1, 0x262a1e)));
    return merge(parts);
  },

  // A gnarled old tree with a face in its trunk: two hollow eyes and a mouth with an ember glow inside.
  'haunted-tree': () => {
    const g = new THREE.CylinderGeometry(0.42, 0.95, 5, 12, 8);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x), r = Math.hypot(x, z);
      const yy = y + 2.5;
      // Twist up the trunk, with knotty bulges; the face side (+z) is kept smooth.
      const front = Math.max(0, Math.sin(a));
      const k = 1 + (0.16 * Math.sin(a * 3 + yy * 1.7) + 0.08 * Math.sin(a * 5 - yy * 3)) * (1 - front * 0.8 * (yy > 1.2 && yy < 3.6 ? 1 : 0));
      const tw = a + yy * 0.18;
      pos.setXYZ(i, Math.cos(tw) * r * k, yy, Math.sin(tw) * r * k);
    }
    g.computeVertexNormals();
    const parts: Part[] = [T1(SURF.wood, colorize(g, 0x332a22, 0.6))];
    // Roots.
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.4;
      parts.push(stick(V(Math.cos(a) * 0.5, 0.6, Math.sin(a) * 0.5), V(Math.cos(a) * 1.7, -0.05, Math.sin(a) * 1.5), 0.32, 0.06, 0x2e2620));
    }
    // The face: hollow eyes and a ragged mouth glowing faintly from within.
    for (const sx of [-0.24, 0.24]) {
      parts.push(T1(SURF.paint, sphere(0.15, sx, 3.05, 0.66, SOCKET, 1.1, 1.4, 0.5, 8)));
      parts.push(T1(SURF.glow, sphere(0.035, sx * 0.95, 3.0, 0.72, 0x7a3a10, 1, 1, 0.6, 5)));
    }
    parts.push(T1(SURF.paint, sphere(0.26, 0, 2.38, 0.74, SOCKET, 1.2, 0.75, 0.45, 9)));
    parts.push(T1(SURF.glow, sphere(0.2, 0, 2.36, 0.78, 0x8a3c12, 1.1, 0.55, 0.3, 8)));
    parts.push(T1(SURF.wood, sphere(0.14, 0, 2.75, 0.74, 0x3a2e24, 1, 0.7, 0.6, 6)));   // a knot of a nose
    // Twisted bare branches, reaching out like arms.
    const rnd = rng(31);
    const tips: THREE.Vector3[] = [];
    branches(parts, tips, V(0, 4.8, 0), V(0.1, 1, 0).normalize(), 1.7, 0.36, 3, rnd);
    branches(parts, tips, V(-0.3, 3.7, 0), V(-1, 0.6, 0.15).normalize(), 1.6, 0.22, 2, rnd);
    branches(parts, tips, V(0.3, 4.2, 0), V(1, 0.5, -0.1).normalize(), 1.5, 0.2, 2, rnd);
    return merge(parts);
  },

  // A tall, narrow, crooked terraced house on Halloween night: lit windows, a pumpkin on the step, cobwebs.
  'town-house': () => {
    const BRICK = 0x4e2c28, TRIM = 0x2a2226;
    const house: Part[] = [
      T1(SURF.brick, box(4.2, 6.7, 5, 0, 3.05, 0, BRICK)),
      T1(SURF.stone, box(4.3, 0.18, 5.1, 0, 2.3, 0, 0x5a5652)), T1(SURF.stone, box(4.3, 0.18, 5.1, 0, 4.4, 0, 0x5a5652)),
      roof(4.7, 5.6, 3.0, 0, 6.4, 0, ROOF_DK),
      T1(SURF.brick, box(0.7, 2.3, 0.7, -1.35, 8.9, -0.7, 0x4a2a26)),
      T1(SURF.brick, cyl(0.12, 0.12, 0.4, -1.5, 10.2, -0.7, 0x6a3a2a, 6)), T1(SURF.brick, cyl(0.12, 0.12, 0.3, -1.2, 10.15, -0.7, 0x6a3a2a, 6)),
      // A dormer with a lit attic window.
      T1(SURF.plaster, box(1.2, 1.2, 1.3, 0.7, 7.55, 1.45, 0x3a3236)),
      roof(1.45, 1.5, 0.6, 0.7, 8.15, 1.45, ROOF_DK),
      ...win(0.7, 7.55, 2.1, 0.6, 0.7, true, TRIM),
      // The door with a fanlight, and a door frame.
      T1(SURF.paint, box(1.3, 2.5, 0.12, -1.1, 1.25, 2.52, TRIM)),
      T1(SURF.wood, box(0.95, 2.0, 0.08, -1.1, 1.1, 2.6, 0x4a1a1e)),
      T1(SURF.glow, box(0.9, 0.3, 0.06, -1.1, 2.3, 2.6, WINDOW_LIT)),
      T1(SURF.metal, sphere(0.05, -0.75, 1.1, 2.66, 0xb08a3a, 1, 1, 1, 5)),
      // Windows: some lit, some dark.
      ...win(0.95, 1.35, 2.5, 1.2, 1.4, true, TRIM),
      ...win(-1.0, 3.35, 2.5, 0.9, 1.35, true, TRIM),
      ...win(1.0, 3.35, 2.5, 0.9, 1.35, false, TRIM),
      ...win(-1.0, 5.35, 2.5, 0.9, 1.25, false, TRIM),
      ...win(1.0, 5.35, 2.5, 0.9, 1.25, true, TRIM),
      ...cobweb(-1.7, 2.45, 2.62, 0.55, 1, -1),
      ...cobweb(1.95, 6.35, 2.56, 0.5, -1, -1),
    ];
    // The whole house leans a little, as old terraces do.
    place(house, 0, 0, 0.022, 0, 0, 0);
    return merge([
      ...house,
      T1(SURF.stone, box(1.7, 0.22, 0.7, -1.1, 0.11, 2.9, 0x55524e)),
      ...place(pumpkin(0, 0, 0.24, true, 7, PUMPKIN, 0.85), 0, 0.15, 0, -0.45, 0.22, 2.95),
      ...pumpkin(0.4, 2.9, 0.18, false, 9, PUMPKIN_DK),
    ]);
  },

  // A sheet ghost floating above the ground: a bell with a wavy hem, stubby arms and two dark eyes.
  'ghost': () => {
    const pts: [number, number][] = [[1.0, 0], [0.84, 0.3], [0.72, 0.8], [0.67, 1.3], [0.63, 1.7], [0.54, 2.1], [0.34, 2.4], [0.001, 2.52]];
    const g = lathe(pts, 0xd6eedf, 20);
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (y < 0.5) {
        const a = Math.atan2(z, x), f = 1 - y / 0.5;
        pos.setY(i, y + 0.16 * Math.sin(a * 7) * f);
      }
    }
    g.computeVertexNormals();
    g.translate(0, 1.5, 0);
    const parts: Part[] = [T1(SURF.glow, g)];
    for (const sg of [-1, 1]) {
      parts.push(T1(SURF.glow, colorize(new THREE.SphereGeometry(0.22, 8, 5).scale(1.6, 0.7, 0.8).rotateZ(sg * -0.5).translate(sg * 0.78, 2.85, 0.1), 0xcfe8d8, 0.8)));
      parts.push(T1(SURF.paint, sphere(0.12, sg * 0.21, 3.38, 0.56, SOCKET, 0.85, 1.4, 0.4, 8)));
    }
    parts.push(T1(SURF.paint, sphere(0.11, 0, 3.0, 0.6, SOCKET, 1, 1.35, 0.4, 8)));
    return merge(place(parts, 0, 0, 0.07, 0, 0, 0));
  },

  // A shipwreck on the shore: a broken hull on its side, bare ribs at the stern, a snapped mast.
  'shipwreck': () => {
    const HULL = 0x3a2c22, RIB = 0x2e241c;
    // The hull as half a lathed spindle: bow at -x, broken off jaggedly at +1.5.
    const prof: [number, number][] = [[0.01, -5], [0.9, -4.2], [1.5, -3], [1.82, -1.5], [1.9, 0], [1.86, 1.5]];
    const hg = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14, 0, Math.PI);
    const hp = hg.getAttribute('position');
    for (let i = 0; i < hp.count; i++) {
      if (hp.getY(i) > 1.4) {
        const a = Math.atan2(hp.getX(i), hp.getZ(i));
        hp.setY(i, 1.5 + 0.45 * Math.sin(a * 9) + 0.25 * Math.sin(a * 4 + 1));
      }
    }
    hg.computeVertexNormals();
    hg.rotateZ(-Math.PI / 2);
    const ship: Part[] = [T1(SURF.wood, colorize(hg, HULL, 0.7))];
    // Ribs, some broken short.
    const ribs: [number, number, number][] = [[2.1, 1.8, 1], [2.9, 1.7, 0.75], [3.7, 1.55, 1], [4.4, 1.35, 0.55]];
    for (const [x, R, arc] of ribs) {
      const t = new THREE.TorusGeometry(R, 0.1, 4, 10, Math.PI * arc).rotateY(Math.PI / 2).rotateX(Math.PI).translate(x, 0, 0);
      ship.push(T1(SURF.wood, colorize(t, RIB, 0.8)));
    }
    ship.push(T1(SURF.wood, box(9.4, 0.28, 0.28, -0.3, -1.88, 0, RIB)));
    for (const sz of [-1, 1]) ship.push(T1(SURF.wood, box(6.2, 0.16, 0.16, -1.7, 0, sz * 1.86, RIB)));
    for (const x of [-2.6, -0.6, 1.0]) ship.push(T1(SURF.wood, box(0.2, 0.2, 3.7, x, 0, 0, RIB)));
    // The mast, snapped off, with a lantern still glowing green.
    ship.push(stick(V(-0.8, -1.7, 0), V(-0.8, 3.2, 0), 0.2, 0.15, 0x2a2018));
    ship.push(stick(V(-0.8, 3.2, 0), V(-0.72, 3.75, 0.03), 0.15, 0.02, 0x2a2018));
    ship.push(T1(SURF.wood, box(2.4, 0.1, 0.1, -0.8, 2.4, 0, 0x2a2018)));
    ship.push(T1(SURF.glow, sphere(0.16, -0.25, 2.2, 0.2, 0x7aff9a, 1, 1.3, 1, 6)));
    // Tip it onto its side, keel towards the viewer, half sunk in the sand.
    place(ship, -1.0, 0, 0, -0.4, 1.25, 0);
    return merge([
      ...ship,
      T1(SURF.rock, sphere(1, -0.5, 0, 0.3, 0x4a4234, 6.2, 0.45, 2.8, 10)),
      stick(V(3.4, 0.15, 2.4), V(6.0, 0.25, 1.1), 0.14, 0.12, 0x2a2018),
      T1(SURF.rock, rockBlob(0.6, 4, 0x2c2a2e, 4.6, 0.2, -1.4)),
    ]);
  },

  // A witch's cottage: crooked walls, a tall tilted roof, a round lit window, a broom, and a bubbling cauldron.
  'witch-cottage': () => {
    const WALL = 0x3a2c26, BEAM = 0x1e1612;
    const roofG = new THREE.ConeGeometry(3.5, 5, 4).rotateY(Math.PI / 4).scale(1, 1, 0.85);
    const rp = roofG.getAttribute('position');
    for (let i = 0; i < rp.count; i++) { const y = rp.getY(i) + 2.5; rp.setX(i, rp.getX(i) + 0.32 * y * y / 5); }
    roofG.computeVertexNormals();
    roofG.translate(-0.2, 3.1 + 2.5, 0);
    const cottage: Part[] = [
      T1(SURF.wood, box(4.6, 3.4, 3.8, 0, 1.5, 0, WALL)),
      T1(SURF.tile, colorize(roofG, 0x2c2436, 0.75)),
      // Timber frame on the front.
      T1(SURF.wood, box(4.6, 0.16, 0.1, 0, 3.0, 1.95, BEAM)), T1(SURF.wood, box(4.6, 0.16, 0.1, 0, 0.15, 1.95, BEAM)),
      T1(SURF.wood, box(0.16, 3.0, 0.1, -2.2, 1.55, 1.95, BEAM)), T1(SURF.wood, box(0.16, 3.0, 0.1, 2.2, 1.55, 1.95, BEAM)),
      T1(SURF.wood, box(0.14, 2.0, 0.1, 0.0, 1.6, 1.95, BEAM, [0, 0, 0.5])),
      // Round lit window.
      T1(SURF.glow, colorize(new THREE.CylinderGeometry(0.48, 0.48, 0.08, 14).rotateX(Math.PI / 2).translate(1.15, 1.95, 1.97), 0xffb040, 1)),
      T1(SURF.wood, colorize(new THREE.TorusGeometry(0.5, 0.07, 4, 14).translate(1.15, 1.95, 2.0), BEAM)),
      T1(SURF.wood, box(0.06, 0.95, 0.05, 1.15, 1.95, 2.02, BEAM)), T1(SURF.wood, box(0.95, 0.06, 0.05, 1.15, 1.95, 2.02, BEAM)),
      // A crooked door, a little lit window beside it.
      T1(SURF.wood, box(0.95, 2.0, 0.1, -1.1, 1.0, 1.96, 0x241810, [0, 0, 0.05])),
      ...win(-0.1, 2.3, 1.9, 0.3, 0.45, false, BEAM),
      // A crooked chimney.
      T1(SURF.stone, box(0.65, 2.0, 0.65, -1.5, 4.5, -0.7, 0x3a3634, [0, 0, -0.12])),
      T1(SURF.stone, box(0.55, 1.2, 0.55, -1.35, 5.9, -0.7, 0x34302e, [0, 0, 0.15])),
    ];
    place(cottage, 0, 0, -0.035, 0, 0.05, 0);
    const parts: Part[] = [...cottage];
    // The broom leaning by the door.
    parts.push(stick(V(1.95, 0.55, 2.12), V(2.35, 2.4, 2.0), 0.035, 0.03, 0x5a4030));
    parts.push(stick(V(1.85, 0, 2.15), V(1.97, 0.62, 2.11), 0.2, 0.05, 0x9a7a3a, SURF.straw, 7));
    // The cauldron: black pot on three legs, a green glowing brew, bubbles and a little fire underneath.
    const cx = -0.4, cz = 3.4;
    parts.push(T1(SURF.metal, sphere(0.62, cx, 0.8, cz, 0x141414, 1, 0.8, 1, 12)));
    parts.push(T1(SURF.metal, colorize(new THREE.TorusGeometry(0.5, 0.07, 5, 14).rotateX(Math.PI / 2).translate(cx, 1.22, cz), 0x1c1c1c)));
    parts.push(T1(SURF.glow, cyl(0.48, 0.48, 0.05, cx, 1.18, cz, 0x6aff4a, 14)));
    for (const [bx, bz, br] of [[0.15, 0.1, 0.09], [-0.18, -0.05, 0.07], [0.02, -0.2, 0.06], [-0.05, 0.22, 0.05]]) {
      parts.push(T1(SURF.glow, sphere(br, cx + bx, 1.25, cz + bz, 0x9aff7a, 1, 1, 1, 5)));
    }
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.5;
      parts.push(stick(V(cx + Math.cos(a) * 0.45, 0.6, cz + Math.sin(a) * 0.45), V(cx + Math.cos(a) * 0.62, 0, cz + Math.sin(a) * 0.62), 0.05, 0.04, 0x141414, SURF.metal, 4));
    }
    parts.push(T1(SURF.glow, cone(0.18, 0.4, cx + 0.05, 0.2, cz + 0.05, 0xff7a20, 5)), T1(SURF.glow, cone(0.12, 0.3, cx - 0.12, 0.15, cz - 0.05, 0xffb030, 5)));
    parts.push(T1(SURF.wood, box(0.9, 0.1, 0.1, cx, 0.05, cz, 0x3a2a1c, [0, 0.6, 0])), T1(SURF.wood, box(0.9, 0.1, 0.1, cx, 0.05, cz, 0x3a2a1c, [0, -0.6, 0])));
    return merge(parts);
  },

  // A crooked Victorian mansion: a tower with a witch's-hat roof, gables, a porch, a few lit windows.
  'haunted-house': () => {
    const SIDING = 0x36323e, TRIM = 0x1c1a20, ROOFC = 0x221e2a;
    const main: Part[] = [
      T1(SURF.wood, box(11, 7.5, 7, -1.5, 3.75, 0, SIDING)),
      T1(SURF.stone, box(11.2, 0.6, 7.2, -1.5, 0.3, 0, 0x3a3836)),
      T1(SURF.paint, box(11.2, 0.25, 7.2, -1.5, 3.75, 0, TRIM)),
      roof(11.8, 7.8, 4.2, -1.5, 7.5, 0, ROOFC),
      // A front gable over the left bay, and a small one on the right.
      T1(SURF.wood, roof(0.3, 4.6, 3.2, 0, 0, 0, SIDING).rotateY(Math.PI / 2).translate(-4.6, 7.5, 3.45)),
      T1(SURF.tile, roof(4.2, 5.4, 3.5, 0, 0, 0, ROOFC).rotateY(Math.PI / 2).translate(-4.6, 7.45, 1.5)),
      T1(SURF.wood, roof(0.3, 3.0, 2.0, 0, 0, 0, SIDING).rotateY(Math.PI / 2).translate(1.6, 7.5, 3.45)),
      T1(SURF.tile, roof(4.0, 3.6, 2.2, 0, 0, 0, ROOFC).rotateY(Math.PI / 2).translate(1.6, 7.45, 1.6)),
      // Round attic window in the big gable.
      T1(SURF.glow, colorize(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 12).rotateX(Math.PI / 2).translate(-4.6, 8.7, 3.62), WINDOW_LIT, 1)),
      T1(SURF.paint, colorize(new THREE.TorusGeometry(0.55, 0.08, 4, 12).translate(-4.6, 8.7, 3.66), TRIM)),
      // Chimneys.
      T1(SURF.brick, box(0.8, 3.2, 0.8, -6, 10, -1.2, 0x3e2826)), T1(SURF.brick, box(0.8, 2.6, 0.8, 2.6, 9.6, -1.6, 0x3e2826)),
      // Door.
      T1(SURF.wood, box(1.3, 2.4, 0.1, -1.5, 1.8, 3.52, 0x2a1414)),
      T1(SURF.glow, box(1.1, 0.35, 0.06, -1.5, 3.25, 3.54, WINDOW_LIT)),
    ];
    // Windows: two floors across the front.
    const lit = [true, false, false, false, false, true, false, false];
    const cols = [-6.0, -4.0, 0.6, 2.6];
    cols.forEach((x, i) => {
      main.push(...win(x, 2.2, 3.5, 0.9, 1.7, lit[i], TRIM));
      main.push(...win(x, 5.6, 3.5, 0.9, 1.7, lit[i + 4], TRIM));
    });
    main.push(...win(-1.5, 5.6, 3.5, 0.8, 1.5, false, TRIM));
    // The porch.
    main.push(T1(SURF.wood, box(5.2, 0.45, 2.2, -1.5, 0.6, 4.6, 0x2c2826)));
    main.push(T1(SURF.tile, box(5.6, 0.22, 2.6, -1.5, 3.2, 4.65, ROOFC, [0.18, 0, 0])));
    for (const x of [-3.8, -2.4, -0.6, 0.8]) main.push(T1(SURF.paint, cyl(0.1, 0.1, 2.5, x, 2.05, 5.55, 0x4a4650, 6)));
    main.push(T1(SURF.paint, box(5.0, 0.08, 0.06, -1.5, 1.4, 5.55, 0x4a4650)));
    for (let i = 0; i < 3; i++) main.push(T1(SURF.wood, box(1.6, 0.15, 0.35, -1.5, 0.08 + i * 0.15, 6.05 - i * 0.3, 0x2c2826)));
    place(main, 0, 0, 0.012, 0, 0, 0);
    // The tower, leaning the other way, with its tall crooked witch's hat.
    const hat = new THREE.ConeGeometry(2.9, 5.2, 8);
    const hp = hat.getAttribute('position');
    for (let i = 0; i < hp.count; i++) { const t = (hp.getY(i) + 2.6) / 5.2; hp.setX(i, hp.getX(i) - 1.1 * t * t); }
    hat.computeVertexNormals();
    hat.translate(0, 10 + 2.6, 0);
    const tower: Part[] = [
      T1(SURF.wood, box(3.6, 10, 3.6, 0, 5, 0, SIDING)),
      T1(SURF.paint, box(3.9, 0.3, 3.9, 0, 10, 0, TRIM)),
      T1(SURF.tile, colorize(hat, ROOFC, 0.8)),
      T1(SURF.metal, cyl(0.04, 0.04, 1.0, -1.1, 15.6, 0, 0x2a2a2a, 4)),
      ...win(0, 2.2, 1.8, 0.8, 1.6, false, TRIM),
      ...win(0, 5.6, 1.8, 0.8, 1.6, false, TRIM),
      ...win(0, 8.4, 1.8, 0.9, 1.5, true, TRIM),
    ];
    place(tower, 0, 0, -0.02, 5.6, 0, 0.9);
    return merge([...main, ...tower]);
  },

  // A lighthouse on its rock: red and white bands, a gallery, and a bright lamp throwing a long beam along +x.
  'lighthouse': () => {
    const RED = 0x8a2a24, WHITE = 0xe8e2d4;
    const parts: Part[] = [
      T1(SURF.rock, rockBlob(4.2, 7, 0x2c2a2e, 0, 0.6, 0, [1.4, 0.65, 1.1])),
      T1(SURF.rock, rockBlob(2.4, 9, 0x34323a, 3.6, 0.2, 1.5)),
      T1(SURF.stone, cyl(2.6, 2.8, 1.2, 0, 2.6, 0, 0x5a5654, 14)),
    ];
    const bands = 5, y0 = 3.2, y1 = 16.2, h = (y1 - y0) / bands;
    for (let i = 0; i < bands; i++) {
      const ra = 2.2 - (i / bands) * 0.85, rb = 2.2 - ((i + 1) / bands) * 0.85;
      parts.push(T1(SURF.paint, cyl(rb, ra, h, 0, y0 + h * (i + 0.5), 0, i % 2 ? WHITE : RED, 14)));
    }
    for (const [y, x] of [[6.0, 0], [9.5, 0.3], [13, 0]]) parts.push(...win(x, y, 1.95 - (y - 3.2) * 0.065, 0.35, 0.6, y === 9.5, 0x2a2a2a));
    // Gallery and railing.
    parts.push(T1(SURF.metal, cyl(2.0, 1.6, 0.4, 0, 16.4, 0, 0x2a2a2c, 14)));
    parts.push(T1(SURF.metal, colorize(new THREE.TorusGeometry(1.9, 0.04, 3, 18).rotateX(Math.PI / 2).translate(0, 17.4, 0), 0x2a2a2c)));
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; parts.push(T1(SURF.metal, cyl(0.03, 0.03, 0.85, Math.cos(a) * 1.9, 17.0, Math.sin(a) * 1.9, 0x2a2a2c, 3))); }
    // Lamp room: glazing, the bright lamp, a red cap and a ball on top.
    parts.push(T1(SURF.glass, cyl(1.1, 1.1, 2.0, 0, 17.6, 0, 0x8a9aa0, 10)));
    parts.push(T1(SURF.glow, sphere(0.75, 0, 17.6, 0, 0xfff2b0, 1, 1.1, 1, 10)));
    parts.push(T1(SURF.paint, colorize(new THREE.SphereGeometry(1.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1).translate(0, 18.6, 0), RED, 0.8)));
    parts.push(T1(SURF.metal, cyl(0.05, 0.05, 0.9, 0, 20.2, 0, 0x2a2a2c, 4)), T1(SURF.metal, sphere(0.22, 0, 20.75, 0, 0x2a2a2c, 1, 1, 1, 6)));
    // The beam: a long thin open cone of light, apex at the lamp, sweeping along +x.
    parts.push(T1(SURF.glow, colorize(new THREE.ConeGeometry(1.5, 16, 10, 1, true).rotateZ(Math.PI / 2).translate(8.4, 17.6, 0), 0xfff3c0, 1)));
    // The keeper's cottage.
    parts.push(T1(SURF.plaster, box(3.2, 2.4, 2.6, -3.6, 2.6, 1.0, 0xd8d2c4)), roof(3.4, 2.9, 1.2, -3.6, 3.8, 1.0, 0x5a2a24));
    parts.push(...win(-3.6, 2.6, 2.3, 0.6, 0.7, true, 0x2a2a2a));
    return merge(parts);
  },

  // A jagged dark headland, rising to the right, surf breaking white at its foot.
  'sea-cliff': () => {
    const parts: Part[] = [];
    const rocks: [number, number, number, number, [number, number, number], number][] = [
      [-12, 2, 5, 0x2b2a30, [1.5, 0.8, 1.1], 1], [-6.5, 4, 6.5, 0x35333b, [1.2, 1.0, 1.1], 2], [0, 6, 7.5, 0x2b2a30, [1.1, 1.2, 1], 3],
      [6, 7, 7, 0x302e36, [1.0, 1.4, 1], 4], [11.5, 5.5, 6, 0x232227, [1.0, 1.3, 1], 5], [14.5, 1.5, 3.5, 0x2b2a30, [1, 1, 1], 6],
    ];
    for (const [x, y, r, c, st, s] of rocks) parts.push(T1(SURF.rock, rockBlob(r, s, c, x, y, 0, st)));
    // Jagged teeth along the top.
    for (const [x, y, r, s] of [[-3, 11, 2.2, 11], [3.5, 15, 2.4, 12], [8, 15.5, 2, 13], [12, 12, 1.8, 14], [-8.5, 8.5, 1.8, 15]]) {
      parts.push(T1(SURF.rock, rockBlob(r, s, 0x26252b, x, y, 0.5, [0.6, 2.0, 0.6])));
    }
    // A sea stack offshore.
    parts.push(T1(SURF.rock, rockBlob(1.8, 21, 0x232227, 10.5, 2.5, 7, [0.7, 2.0, 0.7])));
    // A few patches of dark turf on the tops.
    parts.push(T1(SURF.grass, sphere(3, 1, 13.4, -1, 0x26301f, 1.4, 0.25, 1, 8)), T1(SURF.grass, sphere(2.5, -6.5, 10.2, -1, 0x26301f, 1.3, 0.25, 1, 8)));
    // Surf: white foam at the foot, and spray.
    const rnd = rng(41);
    for (let i = 0; i < 9; i++) {
      const x = -14 + i * 3.5 + rnd(), z = 5.2 + rnd() * 1.5;
      parts.push(T1(SURF.paint, rockBlob(1.2 + rnd() * 0.6, 30 + i, 0xdfe8ea, x, 0.15, z, [2.0, 0.22, 0.7])));
      if (i % 2) parts.push(T1(SURF.paint, sphere(0.5 + rnd() * 0.4, x + 0.5, 0.9 + rnd(), z - 0.5, 0xeef4f6, 1.2, 1, 1, 6)));
    }
    parts.push(T1(SURF.paint, rockBlob(1.0, 50, 0xdfe8ea, 10.5, 0.15, 8.6, [2.2, 0.25, 0.9])));
    return merge(parts);
  },

  // A giant carved pumpkin, big as a cottage, grinning out of its leaves.
  'giant-pumpkin': () => merge([
    ...pumpkin(0, 0, 3.6, true, 4, PUMPKIN, 0.9),
    leaf(-3.4, 0.25, 2.0, 1.6, 0.5), leaf(3.3, 0.25, 1.6, 1.4, -0.6), leaf(-1.5, 0.2, -3.2, 1.5, 2.2), leaf(2.2, 0.2, -3.0, 1.3, 1.1),
    vine([V(-5.5, 0.12, 2.4), V(-4.2, 0.12, 3.0), V(-2.5, 0.12, 3.6), V(-0.8, 0.12, 3.4), V(-0.3, 0.2, 2.9)], 0.12),
    curl(-5.3, 3.0, 0.4), curl(4.5, 2.6, 0.45, -1),
  ]),

  // A tall, dark, ragged conifer for the haunted forest.
  'tall-pine': () => {
    const parts: Part[] = [cyl(0.2, 0.32, 3.5, 0, 1.75, 0, 0x2a2018, 7)];
    const rnd = rng(13);
    const tiers = 6;
    for (let i = 0; i < tiers; i++) {
      const r = 2.7 * (1 - i / (tiers + 1)) + 0.3, h = 3.2 - i * 0.15;
      const g = new THREE.ConeGeometry(r, h, 9, 1);
      const pos = g.getAttribute('position');
      for (let j = 0; j < pos.count; j++) {
        const y = pos.getY(j);
        if (y < -h / 2 + 0.01) {
          const x = pos.getX(j), z = pos.getZ(j);
          const a = Math.atan2(z, x), step = Math.round(((a + Math.PI) / (Math.PI * 2)) * 9);
          const k = 1 + (step % 2) * 0.32 + Math.sin(step * 2.3 + i) * 0.08;
          pos.setXYZ(j, x * k, y - (k - 1) * 0.9, z * k);
        }
      }
      g.computeVertexNormals();
      g.rotateY(rnd() * Math.PI).translate((rnd() - 0.5) * 0.2, 2.6 + i * 1.55 + h / 2, 0);
      parts.push(T1(SURF.foliage, colorize(g, i % 2 ? 0x16241c : 0x1a2a20, 0.6)));
    }
    parts.push(stick(V(0, 11.5, 0), V(0.1, 12.6, 0), 0.08, 0.01, 0x16241c, SURF.foliage, 4));
    return merge(parts);
  },

  // A dark castle on a rocky hill: round towers with pointed roofs, battlements, a keep, lit windows, a flag.
  'haunted-castle': () => {
    const ST = 0x45434c, ST_DK = 0x3a3840, RF = 0x221e2a;
    const parts: Part[] = [
      T1(SURF.rock, rockBlob(15, 3, 0x2a2a2e, 0, 3, 0, [1.9, 0.75, 1.1])),
      T1(SURF.rock, rockBlob(9, 5, 0x302e34, -15, 2, 3, [1.3, 0.8, 1])),
      T1(SURF.rock, rockBlob(8, 8, 0x26262a, 16, 1.5, 2, [1.3, 0.8, 1])),
      // Curtain wall with battlements and a gate.
      T1(SURF.stone, box(32, 12, 3, 0, 14, 4, ST)),
      T1(SURF.paint, box(4, 5, 0.2, 0, 10.5, 5.55, 0x0c0a0e)),
      T1(SURF.paint, colorize(new THREE.CylinderGeometry(2, 2, 0.2, 12).rotateX(Math.PI / 2).translate(0, 13, 5.55), 0x0c0a0e)),
      // The keep.
      T1(SURF.stone, box(13, 20, 9, 2, 18, -4, ST_DK)),
    ];
    const merlons = (x0: number, x1: number, y: number, z: number, d: number) => {
      for (let x = x0; x <= x1 + 1e-6; x += 2) parts.push(T1(SURF.stone, box(1.1, 1.3, d, x, y + 0.65, z, ST)));
    };
    merlons(-15, 15, 20, 4, 3.2);
    merlons(-4, 8, 28, -4, 9.2);
    // Towers: corners, inner pair and the tall one.
    const towers: [number, number, number, number, number][] = [
      // x, z, radius, top, roof height
      [-17, 4, 3.3, 26, 8], [17, 4, 3.3, 25, 8], [-8, -3, 2.8, 31, 8], [11, -3, 2.6, 33, 7.5], [-2, -6, 2.6, 36, 8.5],
    ];
    for (const [x, z, r, top, rh] of towers) {
      const bottom = 6, h = top - bottom;
      parts.push(T1(SURF.stone, cyl(r, r * 1.08, h, x, bottom + h / 2, z, ST, 12)));
      parts.push(T1(SURF.stone, cyl(r * 1.15, r * 1.15, 0.6, x, top - 0.3, z, ST_DK, 12)));
      parts.push(T1(SURF.tile, cone(r * 1.25, rh, x, top + rh / 2, z, RF, 12)));
      parts.push(T1(SURF.glow, box(0.6, 1.2, 0.2, x, top - 3.5, z + r, (x * 7) % 3 ? WINDOW_LIT : WINDOW_DARK)));
      if (x !== -2) parts.push(T1(SURF.glass, box(0.6, 1.2, 0.2, x, top - 8, z + r, WINDOW_DARK)));
    }
    // A flag on the tallest tower.
    parts.push(T1(SURF.metal, cyl(0.1, 0.1, 3.5, -2, 36 + 8.5 + 1.2, -6, 0x2a2a2c, 4)));
    parts.push(T1(SURF.paint, box(2.6, 1.4, 0.08, -0.7, 36 + 8.5 + 2.2, -6, 0x6a1a1a, [0, 0.2, -0.08])));
    // Lit windows on the keep.
    const lit = [true, false, false, true, false, true];
    for (let i = 0; i < 6; i++) {
      const x = -2 + (i % 3) * 4, y = 21 + Math.floor(i / 3) * 4;
      parts.push(T1(lit[i] ? SURF.glow : SURF.glass, box(0.9, 1.8, 0.2, x, y, 0.55, lit[i] ? WINDOW_LIT : WINDOW_DARK)));
    }
    for (const x of [-10, -5, 6, 11]) parts.push(T1(SURF.glass, box(0.5, 1.2, 0.2, x, 17, 5.55, WINDOW_DARK)));
    parts.push(T1(SURF.glow, box(0.5, 1.2, 0.2, -5, 17, 5.58, WINDOW_LIT)));
    return merge(parts);
  },

  // A dark gothic church: a long nave with lancet windows, a square tower, a tall spire and a lit rose window.
  'church-spire': () => {
    const ST = 0x45434c, ST_DK = 0x37353d, RF = 0x26242e;
    const tx = -7.5, tz = 0.5;
    const parts: Part[] = [
      T1(SURF.stone, box(16, 9, 8, 3.5, 4.5, 0, ST)),
      roof(16.4, 8.8, 6.5, 3.5, 9, 0, RF),
      T1(SURF.stone, box(5.6, 17, 5.6, tx, 8.5, tz, ST_DK)),
      T1(SURF.stone, box(6.0, 0.5, 6.0, tx, 17.1, tz, ST)),
      T1(SURF.tile, colorize(new THREE.ConeGeometry(3.4, 17, 8).rotateY(Math.PI / 8).translate(tx, 17.3 + 8.5, tz), RF, 0.75)),
      T1(SURF.metal, cyl(0.08, 0.08, 1.8, tx, 34.6 + 0.4, tz, 0x2a2a2c, 4)),
      T1(SURF.metal, box(0.9, 0.12, 0.12, tx, 35.2, tz, 0x2a2a2c)),
      // Door.
      T1(SURF.wood, box(1.8, 3.2, 0.1, tx, 1.6, tz + 2.82, 0x241612)),
      T1(SURF.wood, box(1.27, 1.27, 0.1, tx, 3.2, tz + 2.82, 0x241612, [0, 0, Math.PI / 4])),
      // Belfry louvres.
      T1(SURF.paint, box(1.6, 2.4, 0.1, tx, 14.6, tz + 2.83, 0x101014)),
    ];
    // Pinnacles on the tower corners.
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(T1(SURF.stone, cone(0.4, 2.4, tx + sx * 2.7, 18.5, tz + sz * 2.7, ST, 4)));
    // The rose window: a glowing disc, a dark ring and spokes of tracery.
    const ry = 9.6, rz = tz + 2.85;
    parts.push(T1(SURF.glow, colorize(new THREE.CylinderGeometry(1.5, 1.5, 0.1, 16).rotateX(Math.PI / 2).translate(tx, ry, rz), 0xffb860, 1)));
    parts.push(T1(SURF.glow, colorize(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 10).rotateX(Math.PI / 2).translate(tx, ry, rz + 0.02), 0xd86a8a, 1)));
    parts.push(T1(SURF.stone, colorize(new THREE.TorusGeometry(1.55, 0.14, 4, 18).translate(tx, ry, rz + 0.04), ST_DK)));
    for (let i = 0; i < 8; i++) parts.push(T1(SURF.stone, box(0.08, 3.0, 0.08, tx, ry, rz + 0.08, ST_DK, [0, 0, i * Math.PI / 8])));
    // Lancet windows and buttresses along the nave.
    for (let i = 0; i < 5; i++) {
      const x = -2.5 + i * 3;
      const lit = i !== 2;
      parts.push(T1(lit ? SURF.glow : SURF.glass, box(0.9, 3.6, 0.1, x, 4.6, 4.03, lit ? 0xc87a3a : WINDOW_DARK)));
      parts.push(T1(lit ? SURF.glow : SURF.glass, box(0.64, 0.64, 0.1, x, 6.4, 4.03, lit ? 0xc87a3a : WINDOW_DARK, [0, 0, Math.PI / 4])));
      parts.push(T1(SURF.stone, box(0.7, 7, 1.2, x + 1.5, 3.5, 4.3, ST_DK)));
      parts.push(T1(SURF.stone, box(0.7, 1.6, 1.2, x + 1.5, 7.3, 4.0, ST_DK, [-0.5, 0, 0])));
    }
    return merge(parts);
  },

  // A dead tree where the bats roost: bare crooked branches, bats hanging upside down, two flitting round.
  'bat-tree': () => {
    const rnd = rng(77);
    const parts: Part[] = [stick(V(0, 0, 0), V(0.2, 4.2, 0), 0.5, 0.34, BARK, SURF.wood, 8)];
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * Math.PI * 2 + 0.3;
      parts.push(stick(V(Math.cos(a) * 0.3, 0.5, Math.sin(a) * 0.3), V(Math.cos(a) * 1.3, -0.05, Math.sin(a) * 1.1), 0.22, 0.05, BARK));
    }
    const tips: THREE.Vector3[] = [];
    branches(parts, tips, V(0.2, 4.2, 0), V(0, 1, 0), 2.4, 0.32, 3, rnd);
    // Bats hang from the outer branches, picked spread out along x.
    const perches = tips.slice().sort((a, b) => a.x - b.x);
    const pick = [0.1, 0.25, 0.42, 0.6, 0.78, 0.92].map(f => perches[Math.floor(f * (perches.length - 1))]);
    for (const p of pick) parts.push(...bat(p.x, p.y - 0.02, p.z, 1.6, true));
    parts.push(...bat(-2.6, 9.6, 0.8, 2.2, false), ...bat(3.0, 10.4, 0.5, 1.8, false));
    return merge(parts);
  },
};
