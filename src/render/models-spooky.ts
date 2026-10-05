// The Halloween ride's models: a ghost train through a graveyard at midnight on one side, and on the
// other a hellscape in the spirit of the old Flemish painters (giant fruit, cracked egg dwellings,
// odd towers, burning ruins), all invented here. Procedural, original and low-poly, like models.ts:
// one merged geometry each, standing on y=0, centred on x=0 and z=0, face towards +z.
// SURF.glow is self-lit, so fire, embers, eyes and candle flames burn through the night.

import * as THREE from 'three/webgpu';
import { SURF, T, T1, box, cyl, cone, sphere, roof, lathe, canopy, rockBlob, colorize, merge, tmpM, tmpQ, tmpE, type Part } from './model-kit';

// --- palette -----------------------------------------------------------------------------------
const CHAR = 0x1c1816;      // charcoal
const SOOT = 0x2a2422;
const IRON = 0x34302e;
const BONE = 0xd8cfb4;
const BONE_DK = 0xb3a88c;
const SOCKET = 0x120d0c;
const BLOOD = 0x6a1a18;     // dried blood
const SICK = 0x6f7a32;      // sickly green
const ROCK = 0x3a3230;
const ROCK_RED = 0x4a2a26;
const DEADWOOD = 0x2b221d;
const FIRE_R = 0xd8300c;
const FIRE_O = 0xff6a14;
const FIRE_Y = 0xffc040;
const EMBER = 0xff4a10;

// --- helpers -----------------------------------------------------------------------------------
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** Orient a Y-up geometry (base at its origin) so it runs from `a` along `dir`. */
function orient(g: THREE.BufferGeometry, a: THREE.Vector3, dir: THREE.Vector3): THREE.BufferGeometry {
  tmpQ.setFromUnitVectors(UP, dir.clone().normalize());
  g.applyMatrix4(tmpM.makeRotationFromQuaternion(tmpQ));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** A tapered cylinder from a to b (radius r0 at a, r1 at b). */
function limb(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, color: number, seg = 5): Part {
  const d = b.clone().sub(a), len = Math.max(1e-3, d.length());
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1).translate(0, len / 2, 0);
  return colorize(orient(g, a, d), color, 0.8);
}

/** A cone with its base at `a`, pointing along `dir`. */
function spike(a: THREE.Vector3, dir: THREE.Vector3, r: number, len: number, color: number, seg = 5): Part {
  const g = new THREE.ConeGeometry(r, len, seg, 1).translate(0, len / 2, 0);
  return colorize(orient(g, a, dir), color, 0.7);
}

/** A licking flame standing at (x, y, z): red-orange outside, a yellow heart poking out of the top. */
function flame(x: number, y: number, z: number, r: number, h: number, lean = 0, seg = 6): Part[] {
  const outer = new THREE.ConeGeometry(r, h, seg, 1).translate(0, h / 2, 0).rotateZ(lean).translate(x, y, z);
  const inner = new THREE.ConeGeometry(r * 0.55, h * 1.12, seg, 1).translate(0, h * 0.56, 0).rotateZ(lean * 1.2).translate(x, y, z + r * 0.25);
  return [T1(SURF.glow, colorize(outer, FIRE_O, 0.55)), T1(SURF.glow, colorize(inner, FIRE_Y, 0.8))];
}

/** A little skull: cranium, cheeks, jaw, dark sockets and nose on +z. */
function skull(x: number, y: number, z: number, s: number, color = BONE): Part[] {
  return [
    T1(SURF.paint, sphere(0.5 * s, x, y + 0.1 * s, z, color, 1, 0.95, 1.05, 8)),
    T1(SURF.paint, box(0.6 * s, 0.32 * s, 0.6 * s, x, y - 0.32 * s, z + 0.12 * s, color)),
    T1(SURF.paint, box(0.5 * s, 0.14 * s, 0.48 * s, x, y - 0.52 * s, z + 0.16 * s, BONE_DK)),
    T1(SURF.stone, sphere(0.14 * s, x - 0.19 * s, y, z + 0.44 * s, SOCKET, 1, 1, 0.6, 6)),
    T1(SURF.stone, sphere(0.14 * s, x + 0.19 * s, y, z + 0.44 * s, SOCKET, 1, 1, 0.6, 6)),
    T1(SURF.stone, box(0.08 * s, 0.12 * s, 0.06 * s, x, y - 0.17 * s, z + 0.43 * s, SOCKET)),
  ];
}

/** The spider, built at any scale (the web borrows a small one). */
function spiderParts(s: number, x = 0, y = 0, z = 0): Part[] {
  const P = (px: number, py: number, pz: number) => V(x + px * s, y + py * s, z + pz * s);
  const parts: Part[] = [
    T1(SURF.paint, sphere(0.3 * s, x, y + 0.36 * s, z - 0.26 * s, 0x1c1512, 1, 0.85, 1.2, 9)),
    T1(SURF.paint, sphere(0.17 * s, x, y + 0.32 * s, z + 0.1 * s, 0x2a1d16, 1, 0.85, 1.1, 8)),
    // A pale mark on the back, just enough to catch the eye.
    T1(SURF.paint, sphere(0.08 * s, x, y + 0.6 * s, z - 0.24 * s, BLOOD, 1, 0.4, 1.6, 6)),
    T1(SURF.glow, sphere(0.04 * s, x - 0.06 * s, y + 0.38 * s, z + 0.27 * s, 0xff2a10, 1, 1, 1, 6)),
    T1(SURF.glow, sphere(0.04 * s, x + 0.06 * s, y + 0.38 * s, z + 0.27 * s, 0xff2a10, 1, 1, 1, 6)),
    T1(SURF.glow, sphere(0.025 * s, x - 0.11 * s, y + 0.42 * s, z + 0.24 * s, 0xff6a20, 1, 1, 1, 4)),
    T1(SURF.glow, sphere(0.025 * s, x + 0.11 * s, y + 0.42 * s, z + 0.24 * s, 0xff6a20, 1, 1, 1, 4)),
  ];
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) {
    const z0 = 0.2 - k * 0.135;
    const hip = P(sx * 0.1, 0.32, z0 * 0.6 + 0.05);
    const knee = P(sx * 0.42, 0.64, z0 * 1.7);
    const foot = P(sx * 0.7, 0, z0 * 3.1);
    parts.push(T1(SURF.paint, limb(hip, knee, 0.035 * s, 0.03 * s, 0x231915, 4)));
    parts.push(T1(SURF.paint, limb(knee, foot, 0.03 * s, 0.012 * s, 0x231915, 4)));
  }
  return parts;
}

/** A jagged crack outline, centred on 0, about 1.3 wide and 2.6 tall. */
function crackShape(k: number): THREE.Shape {
  const pts: [number, number][] = [
    [0, 1.3], [0.25, 0.9], [0.5, 1.0], [0.42, 0.5], [0.65, 0.1], [0.38, -0.3], [0.55, -0.8], [0.2, -1.0],
    [0, -0.7], [-0.3, -1.05], [-0.5, -0.6], [-0.38, -0.2], [-0.65, 0.2], [-0.42, 0.6], [-0.55, 0.95], [-0.2, 0.88],
  ];
  const sh = new THREE.Shape();
  pts.forEach(([px, py], i) => (i ? sh.lineTo(px * k, py * k) : sh.moveTo(px * k, py * k)));
  sh.closePath();
  return sh;
}

function extrudeShape(sh: THREE.Shape, depth: number): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
}

/** A twisted dark limb of wood that branches (for the dead tree). */
function branchOut(parts: Part[], a: THREE.Vector3, dir: THREE.Vector3, len: number, r: number, depth: number, rnd: () => number) {
  // Each branch has a kink halfway, so nothing is straight.
  const kink = dir.clone().add(V((rnd() - 0.5) * 0.7, (rnd() - 0.4) * 0.3, (rnd() - 0.5) * 0.7)).normalize();
  const mid = a.clone().addScaledVector(kink, len * 0.5);
  const end = mid.clone().addScaledVector(dir.clone().add(V((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6)).normalize(), len * 0.5);
  parts.push(T1(SURF.wood, limb(a, mid, r, r * 0.8, DEADWOOD, 5)));
  parts.push(T1(SURF.wood, limb(mid, end, r * 0.8, r * 0.62, DEADWOOD, 5)));
  if (depth <= 0) {
    // A clawed twig at the very tip.
    parts.push(T1(SURF.wood, spike(end, dir.clone().add(V((rnd() - 0.5) * 1.4, 0.2, (rnd() - 0.5) * 1.4)), r * 0.6, len * 0.45, DEADWOOD, 4)));
    return;
  }
  const n = 2 + (rnd() < 0.45 ? 1 : 0);
  const out = end.clone().sub(a).normalize();
  for (let i = 0; i < n; i++) {
    const az = rnd() * Math.PI * 2;
    const spread = 0.65 + rnd() * 0.5;
    const d = out.clone().add(V(Math.cos(az) * spread, 0.15 + rnd() * 0.25, Math.sin(az) * spread)).normalize();
    branchOut(parts, end, d, len * (0.62 + rnd() * 0.12), r * 0.6, depth - 1, rnd);
  }
}

// --- models ------------------------------------------------------------------------------------
export const SPOOKY_MODELS: Record<string, () => THREE.BufferGeometry> = {
  // --- fence (hi-hats, 4.6 m) -----------------------------------------------------------------
  // A big spider, red eyes towards the window, knees up.
  'spider': () => merge(spiderParts(1)),

  // A sharpened stake with a bone-white skull jammed on top.
  'bone-stake': () => merge([
    T1(SURF.wood, box(0.12, 1.2, 0.12, 0, 0.6, 0, 0x4a3a2c, [0, 0.4, 0.04])),
    T1(SURF.wood, box(0.2, 0.06, 0.2, 0, 0.35, 0, 0x2e241c, [0, 0.8, 0])),
    ...skull(0, 1.27, 0, 0.32),
  ]),

  // Three fat candle stubs melted together, flames glowing.
  'candle-stub': () => {
    const parts: Part[] = [T1(SURF.paint, sphere(0.32, 0, 0, 0, 0xd2c6a6, 1.3, 0.3, 1, 9))];
    const cs: [number, number, number, number][] = [[-0.14, 0.02, 0.6, 0.1], [0.12, -0.06, 0.42, 0.09], [0.02, 0.15, 0.3, 0.085]];
    cs.forEach(([x, z, h, r], i) => {
      parts.push(T1(SURF.paint, cyl(r, r * 1.08, h, x, h / 2, z, i === 1 ? 0xcfc3a0 : 0xe6dcc2, 9)));
      // Drips down the front.
      parts.push(T1(SURF.paint, sphere(r * 0.35, x + r * 0.4, h * 0.75, z + r * 0.85, 0xeee4cc, 1, 2.2, 1, 5)));
      parts.push(T1(SURF.metal, cyl(0.008, 0.008, 0.05, x, h + 0.02, z, 0x111111, 3)));
      parts.push(T1(SURF.glow, sphere(0.035, x, h + 0.08, z, FIRE_Y, 1, 2.2, 1, 6)));
      parts.push(T1(SURF.glow, sphere(0.05, x, h + 0.06, z, FIRE_O, 1, 1.4, 1, 6)));
    });
    return merge(parts);
  },

  // --- trackside (kick) -----------------------------------------------------------------------
  // An iron post holding up a fire basket.
  'flame-post': () => {
    const parts: Part[] = [
      T1(SURF.metal, cyl(0.09, 0.12, 3.5, 0, 1.75, 0, IRON, 6)),
      T1(SURF.metal, cyl(0.25, 0.32, 0.25, 0, 0.12, 0, IRON, 6)),
      T1(SURF.metal, colorize(new THREE.TorusGeometry(0.3, 0.035, 4, 12).rotateX(Math.PI / 2).translate(0, 3.45, 0), IRON)),
      T1(SURF.metal, colorize(new THREE.TorusGeometry(0.45, 0.035, 4, 12).rotateX(Math.PI / 2).translate(0, 3.95, 0), IRON)),
    ];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      parts.push(T1(SURF.metal, limb(V(c * 0.3, 3.45, s * 0.3), V(c * 0.48, 4.1, s * 0.48), 0.025, 0.025, IRON, 3)));
      parts.push(T1(SURF.metal, spike(V(c * 0.48, 4.1, s * 0.48), V(c * 0.2, 1, s * 0.2), 0.03, 0.12, IRON, 3)));
    }
    parts.push(T1(SURF.glow, rockBlob(0.3, 5, EMBER, 0, 3.6, 0, [1.2, 0.5, 1.2])));
    parts.push(...flame(0, 3.6, 0, 0.32, 0.9), ...flame(0.15, 3.6, 0.1, 0.18, 0.6, -0.3), ...flame(-0.15, 3.6, -0.05, 0.2, 0.7, 0.3));
    return merge(parts);
  },

  // A gibbet: a post, an arm with a brace, and an empty iron cage on a chain.
  'gibbet': () => {
    const px = -0.9;
    const parts: Part[] = [
      T1(SURF.wood, box(0.26, 5, 0.26, px, 2.5, 0, 0x3a2e24)),
      T1(SURF.wood, box(2.3, 0.22, 0.22, px + 1.05, 4.75, 0, 0x3a2e24)),
      T1(SURF.wood, limb(V(px, 3.9, 0), V(px + 0.85, 4.66, 0), 0.08, 0.08, 0x342820, 4)),
      T1(SURF.stone, rockBlob(0.4, 3, ROCK, px, 0.05, 0, [1.3, 0.5, 1.2])),
    ];
    const cx = 0.95, top = 4.64;
    // Chain: a short run of links, alternate ones turned.
    for (let i = 0; i < 5; i++) {
      const g = new THREE.TorusGeometry(0.07, 0.018, 3, 8).scale(1, 1.5, 1);
      if (i % 2) g.rotateY(Math.PI / 2);
      g.translate(cx, top - 0.1 - i * 0.17, 0);
      parts.push(T1(SURF.metal, colorize(g, IRON)));
    }
    const cTop = top - 0.95, cBot = cTop - 1.7, R = 0.42;
    parts.push(T1(SURF.metal, cyl(R, R, 0.06, cx, cBot, 0, IRON, 10)));
    parts.push(T1(SURF.metal, colorize(new THREE.TorusGeometry(R, 0.03, 3, 12).rotateX(Math.PI / 2).translate(cx, cBot + 0.85, 0), IRON)));
    parts.push(T1(SURF.metal, sphere(0.06, cx, cTop + 0.05, 0, IRON, 1, 1, 1, 5)));
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, c = Math.cos(a) * R, s = Math.sin(a) * R;
      parts.push(T1(SURF.metal, limb(V(cx + c, cBot, s), V(cx + c, cTop - 0.4, s), 0.02, 0.02, IRON, 3)));
      parts.push(T1(SURF.metal, limb(V(cx + c, cTop - 0.4, s), V(cx, cTop + 0.05, 0), 0.02, 0.02, IRON, 3)));
    }
    return merge(parts);
  },

  // A twisted black pole bristling with thorns.
  'thorn-pole': () => {
    const rnd = rng(17);
    const parts: Part[] = [];
    let prev = V(0, 0, 0);
    for (let i = 1; i <= 6; i++) {
      const p = V(Math.sin(i * 1.7) * 0.18, i * 5 / 6, Math.cos(i * 1.3) * 0.12);
      const r0 = 0.2 - (i - 1) * 0.028, r1 = 0.2 - i * 0.028;
      parts.push(T1(SURF.wood, limb(prev, p, r0, Math.max(0.03, r1), 0x241a18, 6)));
      for (let k = 0; k < 3; k++) {
        const t = rnd(), at = prev.clone().lerp(p, t);
        const az = rnd() * Math.PI * 2, rr = r0 * 0.8;
        const base = at.clone().add(V(Math.cos(az) * rr, 0, Math.sin(az) * rr));
        parts.push(T1(SURF.wood, spike(base, V(Math.cos(az), 0.25 + rnd() * 0.5, Math.sin(az)), 0.05, 0.35 + rnd() * 0.3, k ? 0x2e201c : BLOOD, 4)));
      }
      prev = p;
    }
    parts.push(T1(SURF.wood, spike(prev, V(0.1, 1, 0), 0.05, 0.4, 0x241a18, 4)));
    return merge(parts);
  },

  // --- near (snare, 19 m) ---------------------------------------------------------------------
  // A great boulder that happens to look like a skull, a faint fire in its eyes.
  'skull-rock': () => {
    const parts: Part[] = [
      T1(SURF.rock, rockBlob(2, 11, 0x5a524a, 0, 2.3, 0, [1.25, 1.0, 0.95])),
      T1(SURF.rock, rockBlob(1.4, 12, 0x4e4740, 0, 0.8, 0.6, [1.5, 0.6, 1.0])),
    ];
    for (const sx of [-1, 1]) {
      parts.push(T1(SURF.rock, sphere(0.62, sx * 0.85, 2.55, 1.9, SOCKET, 1, 1.05, 0.55, 8)));
      parts.push(T1(SURF.glow, sphere(0.16, sx * 0.85, 2.5, 2.2, EMBER, 1, 1, 1, 6)));
    }
    // Nose: a dark upturned triangle.
    const nose = new THREE.ConeGeometry(0.32, 0.6, 3, 1).rotateZ(Math.PI).translate(0, 1.72, 2.05);
    parts.push(T1(SURF.rock, colorize(nose, SOCKET)));
    // A row of worn teeth.
    for (let i = 0; i < 6; i++) parts.push(T1(SURF.stone, box(0.26, 0.4, 0.3, -0.75 + i * 0.3, 1.05, 1.95 - Math.abs(i - 2.5) * 0.05, i % 2 ? 0x8a8072 : 0x9a9080)));
    parts.push(T1(SURF.rock, box(2.1, 0.12, 0.3, 0, 0.82, 1.95, SOCKET)));
    return merge(parts);
  },

  // A burnt-out house: charred posts, broken rafters, a chimney left standing, embers still glowing.
  'burnt-house': () => {
    const parts: Part[] = [];
    const posts: [number, number, number][] = [[-3, -2, 3.2], [3, -2, 2.4], [-3, 2, 2.0], [3, 2, 3.4], [-1, 2, 1.4], [1, -2, 3.0], [1, 2, 2.6]];
    for (const [x, z, h] of posts) parts.push(T1(SURF.wood, box(0.26, h, 0.26, x, h / 2, z, CHAR, [0, 0, (x * 0.013)])));
    parts.push(T1(SURF.wood, box(6.2, 0.22, 0.22, 0, 3.2, -2, CHAR, [0, 0, -0.08])));
    parts.push(T1(SURF.wood, box(4.2, 2.2, 0.15, -0.6, 1.1, -2, SOOT)));
    parts.push(T1(SURF.wood, box(0.15, 1.6, 2.8, -3, 0.8, -0.4, SOOT)));
    parts.push(T1(SURF.wood, box(1.6, 0.9, 0.15, 2.1, 0.45, 2, SOOT)));
    // Broken rafters: a ridge beam sagging, a few leaning, one fallen.
    parts.push(T1(SURF.wood, box(4.5, 0.2, 0.2, -0.6, 4.3, -0.2, CHAR, [0, 0, 0.12])));
    for (const [x, a] of [[-2.4, 0.7], [-0.6, 0.65], [1.2, -0.7]] as [number, number][]) {
      parts.push(T1(SURF.wood, limb(V(x, 3.0, a > 0 ? -2 : 2), V(x + 0.1, 4.3, -0.2), 0.09, 0.07, CHAR, 4)));
    }
    parts.push(T1(SURF.wood, limb(V(2.6, 0.2, 1.4), V(1.0, 2.2, -1.2), 0.1, 0.08, CHAR, 4)));
    // The chimney, still standing.
    parts.push(T1(SURF.brick, box(1, 5.6, 0.9, 2.4, 2.8, -1.5, 0x3e302a)));
    parts.push(T1(SURF.brick, box(1.15, 0.25, 1.05, 2.4, 5.6, -1.5, 0x2e2420)));
    // Embers and flames.
    parts.push(T1(SURF.glow, rockBlob(0.9, 3, EMBER, -1.2, 0, 0.2, [1.4, 0.35, 1.0])));
    parts.push(T1(SURF.glow, rockBlob(0.6, 4, 0xd8300c, 1.3, 0, 0.8, [1.3, 0.35, 1.0])));
    parts.push(...flame(-1.4, 0.1, 0.3, 0.45, 1.6), ...flame(-0.7, 0.1, 0.5, 0.3, 1.0, -0.2), ...flame(1.3, 0.1, 0.9, 0.3, 1.1, 0.15));
    parts.push(T1(SURF.glow, sphere(0.12, 2.4, 0.5, -1.0, FIRE_O, 1, 1, 1, 5)));
    return merge(parts);
  },

  // A giant cracked egg someone lives in: glow inside the crack, a ladder, a tiny flag.
  'egg-hut': () => {
    const parts: Part[] = [
      T1(SURF.plaster, lathe([[0, 0], [1.2, 0.15], [1.75, 0.8], [1.95, 1.8], [1.85, 2.8], [1.5, 3.8], [0.9, 4.6], [0, 5]], 0xe2dac4, 14)),
    ];
    const rim = extrudeShape(crackShape(0.85), 0.45).translate(0, 2.0, 1.55);
    parts.push(T1(SURF.rock, colorize(rim, 0x1a1210, 1)));
    const glow = extrudeShape(crackShape(0.6), 0.05).translate(0, 1.95, 2.0);
    parts.push(T1(SURF.glow, colorize(glow, FIRE_O, 0.7)));
    // Hairline cracks running off the opening.
    parts.push(T1(SURF.rock, limb(V(0.45, 2.9, 1.82), V(0.9, 3.6, 1.38), 0.035, 0.02, 0x2a201c, 3)));
    parts.push(T1(SURF.rock, limb(V(-0.5, 1.2, 1.88), V(-1.0, 0.7, 1.55), 0.035, 0.02, 0x2a201c, 3)));
    // Shards of shell on the ground.
    parts.push(T1(SURF.plaster, box(0.5, 0.06, 0.35, 0.6, 0.04, 2.4, 0xd6cdb4, [0.2, 0.6, 0.1])));
    parts.push(T1(SURF.plaster, box(0.35, 0.06, 0.3, -0.4, 0.04, 2.6, 0xcfc6ac, [-0.1, 1.2, 0])));
    // A ladder leaning on the side.
    const lb = V(1.75, 0, 1.85), lt = V(1.15, 3.4, 1.2);
    for (const off of [-0.2, 0.2]) {
      const o = V(off * 0.7, 0, -off * 0.7);
      parts.push(T1(SURF.wood, limb(lb.clone().add(o), lt.clone().add(o), 0.04, 0.04, 0x5a4636, 4)));
    }
    for (let i = 1; i < 8; i++) {
      const p = lb.clone().lerp(lt, i / 8);
      parts.push(T1(SURF.wood, limb(p.clone().add(V(-0.14, 0, 0.14)), p.clone().add(V(0.14, 0, -0.14)), 0.025, 0.025, 0x5a4636, 3)));
    }
    // A tiny flag on top.
    parts.push(T1(SURF.metal, cyl(0.025, 0.025, 1.0, 0, 5.4, 0, 0x2a2420, 4)));
    parts.push(T1(SURF.paint, box(0.5, 0.3, 0.02, 0.26, 5.72, 0, BLOOD, [0, 0, -0.08])));
    return merge(parts);
  },

  // An enormous, slightly sickly berry on a stalk, seeds and a ragged crown of leaves.
  'giant-fruit': () => {
    const prof: [number, number][] = [[0, 0.9], [0.7, 1.2], [1.4, 1.9], [1.9, 2.9], [2.0, 3.8], [1.7, 4.6], [1.0, 5.0], [0, 5.1]];
    const parts: Part[] = [
      T1(SURF.paint, lathe(prof, 0x8e1f24, 14)),
      T1(SURF.foliage, limb(V(0, 0, 0), V(0.1, 1.2, 0.05), 0.35, 0.22, 0x4a5a26, 6)),
      T1(SURF.rock, rockBlob(0.9, 8, ROCK, 0, 0, 0, [1.4, 0.4, 1.2])),
    ];
    // Roots clawing into the ground.
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.4;
      parts.push(T1(SURF.foliage, limb(V(0, 0.5, 0), V(Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1), 0.12, 0.04, 0x46502a, 4)));
    }
    const radiusAt = (y: number) => {
      for (let i = 1; i < prof.length; i++) if (y <= prof[i][1]) {
        const [r0, y0] = prof[i - 1], [r1, y1] = prof[i];
        return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
      }
      return 0;
    };
    for (let i = 0; i < 44; i++) {
      const y = 1.5 + (i / 44) * 3.2, a = i * 2.39996, r = radiusAt(y) + 0.02;
      parts.push(T1(SURF.paint, sphere(0.08, Math.sin(a) * r, y, Math.cos(a) * r, i % 5 ? 0xd8c890 : SICK, 1, 1.4, 1, 5)));
    }
    // Sickly blotches.
    parts.push(T1(SURF.paint, sphere(0.6, 0.9, 3.4, 1.6, 0x6a5a2a, 1, 0.8, 0.35, 7)));
    parts.push(T1(SURF.paint, sphere(0.45, -1.3, 2.4, 1.15, 0x5e2a20, 1, 0.9, 0.35, 7)));
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const g = new THREE.BoxGeometry(1.5, 0.08, 0.55).translate(0.75, 0, 0).rotateZ(-0.35 - (i % 2) * 0.25).rotateY(a).translate(0, 5.0, 0);
      parts.push(T1(SURF.foliage, colorize(g, i % 2 ? SICK : 0x56632a, 0.9)));
    }
    parts.push(T1(SURF.foliage, limb(V(0, 5.0, 0), V(0.3, 5.9, 0.1), 0.12, 0.06, 0x4a5a26, 5)));
    return merge(parts);
  },

  // A great web strung between two dead posts, its owner waiting near the middle.
  'web': () => {
    const parts: Part[] = [
      T1(SURF.wood, limb(V(-2.7, 0, -0.1), V(-2.5, 5.2, 0), 0.16, 0.08, DEADWOOD, 5)),
      T1(SURF.wood, limb(V(2.7, 0, -0.1), V(2.6, 4.6, 0), 0.16, 0.08, DEADWOOD, 5)),
      T1(SURF.wood, spike(V(-2.55, 3.9, 0), V(-1, 0.8, 0.2), 0.05, 0.7, DEADWOOD, 4)),
      T1(SURF.wood, spike(V(2.62, 3.6, 0), V(1, 0.6, -0.2), 0.05, 0.6, DEADWOOD, 4)),
    ];
    const c = V(0, 2.8, 0.05), N = 12, THREAD = 0xc8cac2, TH = 0.03;
    const reach = (a: number) => {
      // Out to an ellipse that stops at the posts and above the ground.
      const rx = 2.45, ry = 2.3;
      return 1 / Math.sqrt((Math.cos(a) / rx) ** 2 + (Math.sin(a) / ry) ** 2);
    };
    const angles = Array.from({ length: N }, (_, i) => i / N * Math.PI * 2 + Math.sin(i * 3.1) * 0.08);
    const ends = angles.map(a => c.clone().add(V(Math.cos(a) * reach(a), Math.sin(a) * reach(a), 0)));
    ends.forEach(e => parts.push(T1(SURF.paint, limb(c, e, TH, TH, THREAD, 3))));
    // Anchor lines to the posts.
    parts.push(T1(SURF.paint, limb(ends[0], V(2.62, 2.9, 0.05), TH, TH, THREAD, 3)));
    parts.push(T1(SURF.paint, limb(ends[N / 2], V(-2.6, 2.8, 0.05), TH, TH, THREAD, 3)));
    parts.push(T1(SURF.paint, limb(ends[2], V(2.6, 4.5, 0.05), TH, TH, THREAD, 3)));
    parts.push(T1(SURF.paint, limb(ends[4], V(-2.5, 5.0, 0.05), TH, TH, THREAD, 3)));
    // The spiral, sagging a little between spokes.
    for (let ring = 1; ring <= 6; ring++) {
      const f = ring / 6.6;
      for (let i = 0; i < N; i++) {
        const a0 = angles[i], a1 = angles[(i + 1) % N] + (i === N - 1 ? Math.PI * 2 : 0);
        const fs0 = f + (i / N) * 0.06, fs1 = f + ((i + 1) / N) * 0.06;
        const p0 = c.clone().add(V(Math.cos(a0) * reach(a0) * fs0, Math.sin(a0) * reach(a0) * fs0, 0));
        const p1 = c.clone().add(V(Math.cos(a1) * reach(a1) * fs1, Math.sin(a1) * reach(a1) * fs1, 0));
        parts.push(T1(SURF.paint, limb(p0, p1, TH * 0.8, TH * 0.8, THREAD, 3)));
      }
    }
    // The spider, head down, a little off-centre.
    const sp = merge(spiderParts(0.7));
    sp.rotateX(Math.PI / 2).translate(0.5, 3.6, 0.1);
    parts.push(sp);
    return merge(parts);
  },

  // A fire pit: a ring of stones, a heap of glowing coals, flames.
  'fire-pit': () => {
    const parts: Part[] = [];
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      parts.push(T1(SURF.stone, rockBlob(0.3, i + 2, i % 2 ? 0x4e4844 : 0x5e5650, Math.cos(a) * 1.0, 0.12, Math.sin(a) * 1.0, [1.2, 0.7, 1])));
    }
    parts.push(T1(SURF.glow, rockBlob(0.55, 9, EMBER, 0, 0.05, 0, [1.3, 0.4, 1.3])));
    parts.push(T1(SURF.rock, box(0.9, 0.12, 0.12, 0.1, 0.2, 0.3, CHAR, [0, 0.5, 0.2])));
    parts.push(T1(SURF.rock, box(0.8, 0.12, 0.12, -0.1, 0.22, -0.2, CHAR, [0, -0.7, -0.15])));
    parts.push(...flame(0, 0.1, 0, 0.4, 1.4), ...flame(0.3, 0.1, 0.2, 0.25, 0.9, -0.25), ...flame(-0.3, 0.1, 0.15, 0.25, 1.0, 0.25), ...flame(0, 0.1, -0.3, 0.22, 0.8, 0));
    return merge(parts);
  },

  // --- mid (bass, 38 m) -----------------------------------------------------------------------
  // A gaping cave mouth in a rock mound: jagged teeth and a lava-red throat.
  'hell-mouth': () => {
    const parts: Part[] = [
      T1(SURF.rock, rockBlob(4.8, 21, ROCK, 0, 2.6, -2.5, [1.25, 0.95, 0.7])),
      T1(SURF.rock, rockBlob(3, 22, 0x3e3430, 0, 6.2, 1.2, [1.9, 0.55, 0.9])),
      T1(SURF.rock, rockBlob(3, 23, 0x3e3430, 0, 0.2, 1.8, [1.9, 0.35, 0.85])),
      // The throat: a deep red glow behind the jaws, hotter in the middle.
      T1(SURF.glow, sphere(3.2, 0, 3.3, 0.2, 0xb01a08, 1.5, 0.8, 0.6, 12)),
      T1(SURF.glow, sphere(1.6, 0, 3.0, 1.6, FIRE_O, 1.4, 0.7, 0.5, 10)),
    ];
    for (let i = 0; i < 9; i++) {
      const x = -4 + i, l = 1.0 + ((i * 7) % 4) * 0.35 - Math.abs(x) * 0.08;
      parts.push(T1(SURF.paint, spike(V(x, 5.3, 3.0 - Math.abs(x) * 0.12), V(Math.sin(i) * 0.1, -1, 0.1), 0.28, l, BONE_DK, 5)));
    }
    for (let i = 0; i < 8; i++) {
      const x = -3.5 + i, l = 0.8 + ((i * 5) % 3) * 0.35 - Math.abs(x) * 0.06;
      parts.push(T1(SURF.paint, spike(V(x, 1.0, 3.1 - Math.abs(x) * 0.12), V(Math.cos(i) * 0.1, 1, 0.1), 0.26, l, BONE, 5)));
    }
    // A lava tongue spilling out over the lower lip.
    parts.push(T1(SURF.glow, box(1.6, 0.2, 2.4, 0.4, 0.95, 3.4, EMBER, [0.35, 0.1, 0])));
    return merge(parts);
  },

  // An arch of rib bones, a spine along the top and a skull keeping watch.
  'bone-arch': () => {
    const parts: Part[] = [];
    const zs = [-3, -1.5, 0, 1.5, 3];
    zs.forEach((z, i) => {
      const R = 5 - Math.abs(z) * 0.18;
      const g = new THREE.TorusGeometry(R, 0.32, 5, 22, Math.PI).scale(1, 1.4, 1).translate(0, 0, z);
      parts.push(T1(SURF.paint, colorize(g, i % 2 ? BONE_DK : BONE, 0.75)));
      for (const sx of [-1, 1]) parts.push(T1(SURF.paint, sphere(0.55, sx * R, 0.3, z, BONE_DK, 1, 0.8, 1, 7)));
    });
    const top = 7.0;
    parts.push(T1(SURF.paint, colorize(new THREE.CylinderGeometry(0.28, 0.28, 7, 6, 1).rotateX(Math.PI / 2).translate(0, top + 0.2, 0), BONE_DK)));
    for (let i = 0; i < 9; i++) parts.push(T1(SURF.paint, box(0.9, 0.5, 0.45, 0, top + 0.35, -3.4 + i * 0.85, BONE, [0, 0, 0])));
    parts.push(...skull(0, top + 1.2, 3.6, 2.4));
    parts.push(T1(SURF.glow, sphere(0.14, -0.46, top + 1.2, 4.55, EMBER, 1, 1, 1, 6)));
    parts.push(T1(SURF.glow, sphere(0.14, 0.46, top + 1.2, 4.55, EMBER, 1, 1, 1, 6)));
    return merge(parts);
  },

  // A ruined church: a broken tower and nave, empty arches, fire burning inside and out the top.
  'burning-ruin': () => {
    const S = 0x5a524a, S2 = 0x4a433d;
    const parts: Part[] = [];
    const tx = -3;
    // Tower: back and sides full, broken tops.
    parts.push(T1(SURF.stone, box(4.4, 11, 0.7, tx, 5.5, -2, S2)));
    parts.push(T1(SURF.stone, box(0.7, 12, 4.4, tx - 2.2, 6, 0, S)));
    parts.push(T1(SURF.stone, box(0.7, 9.5, 4.4, tx + 2.2, 4.75, 0, S)));
    // Front: piers and lintels round two tall empty windows.
    for (const [x, h] of [[tx - 1.9, 12], [tx, 10.5], [tx + 1.9, 9]] as [number, number][]) parts.push(T1(SURF.stone, box(0.9, h, 0.7, x, h / 2, 2, S)));
    for (const cx of [tx - 0.95, tx + 0.95]) {
      parts.push(T1(SURF.stone, box(1.1, 3, 0.7, cx, 1.5, 2, S)));
      parts.push(T1(SURF.stone, box(0.6, 1.3, 0.6, cx - 0.32, 7.3, 2, S2, [0, 0, -0.6])));
      parts.push(T1(SURF.stone, box(0.6, 1.3, 0.6, cx + 0.32, 7.3, 2, S2, [0, 0, 0.6])));
      parts.push(T1(SURF.stone, box(1.1, 1.0, 0.7, cx, 8.4, 2, S)));
    }
    // Fire inside, seen through the windows, and licking out of the top.
    parts.push(T1(SURF.glow, box(3.2, 8, 3, tx, 4.0, 0, 0xc0300a)));
    parts.push(T1(SURF.glow, box(1.6, 3.4, 0.3, tx, 5, 1.4, FIRE_O)));
    parts.push(...flame(tx, 9, 0, 1.2, 4.2), ...flame(tx + 1.1, 8.6, 0.4, 0.8, 3), ...flame(tx - 1.2, 9.5, -0.5, 0.7, 2.8, 0.25));
    // The nave: a long low broken wall with arches, fire inside too.
    parts.push(T1(SURF.stone, box(6.5, 5.5, 0.6, 2.4, 2.75, -1.6, S2)));
    for (const [x, h] of [[0.2, 6], [2.4, 4.5], [4.6, 3.2], [5.6, 1.6]] as [number, number][]) parts.push(T1(SURF.stone, box(0.8, h, 0.6, x, h / 2, 1.6, S)));
    parts.push(T1(SURF.stone, box(2.6, 0.7, 0.6, 1.3, 4.6, 1.6, S2)));
    parts.push(T1(SURF.stone, box(1.4, 1.2, 0.6, 1.3, 0.6, 1.6, S)));
    parts.push(T1(SURF.stone, box(1.4, 1.2, 0.6, 3.5, 0.6, 1.6, S)));
    parts.push(T1(SURF.glow, box(5, 2.4, 2.4, 2.6, 1.2, 0, 0xa82808)));
    parts.push(...flame(1.3, 2, 0.4, 0.6, 2.4), ...flame(3.6, 1.2, 0.2, 0.7, 2.6, -0.2));
    parts.push(T1(SURF.stone, rockBlob(0.8, 4, S2, 6.4, 0.3, 1.0, [1.4, 0.5, 1])));
    return merge(parts).translate(-1, 0, 0);
  },

  // A crooked stone tower with a single great eye on top, looking at you.
  'eye-tower': () => {
    const parts: Part[] = [];
    const pts = [V(0, 0, 0)];
    for (let i = 1; i <= 6; i++) pts.push(V(Math.sin(i * 1.1) * 0.55 + i * 0.05, i * 1.85, Math.cos(i * 0.9) * 0.25 - 0.2));
    for (let i = 1; i < pts.length; i++) {
      const r0 = 1.7 - (i - 1) * 0.12, r1 = 1.7 - i * 0.12;
      parts.push(T1(SURF.stone, limb(pts[i - 1], pts[i], r0, r1, i % 2 ? 0x4a4540 : 0x423d38, 7)));
      parts.push(T1(SURF.stone, colorize(new THREE.TorusGeometry(r1 + 0.05, 0.12, 3, 7).rotateX(Math.PI / 2).translate(pts[i].x, pts[i].y, pts[i].z), 0x3a3530)));
      if (i % 2 === 0) parts.push(T1(SURF.glow, box(0.35, 0.6, 0.1, pts[i].x - 0.2, pts[i].y - 0.8, pts[i].z + r1 + 0.02, FIRE_O)));
    }
    const t = pts[pts.length - 1];
    // A collar of stone fangs holding the eye.
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      parts.push(T1(SURF.stone, spike(V(t.x + Math.cos(a) * 0.9, t.y, t.z + Math.sin(a) * 0.9), V(Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6), 0.3, 1.5, 0x3a3530, 4)));
    }
    const e = V(t.x, t.y + 1.9, t.z + 0.2);
    parts.push(T1(SURF.paint, sphere(2.0, e.x, e.y, e.z, 0xe8e2d0, 1, 1, 1, 14)));
    parts.push(T1(SURF.glow, sphere(0.95, e.x, e.y, e.z + 1.72, 0xffa020, 1, 1, 0.4, 12)));
    parts.push(T1(SURF.glow, sphere(0.62, e.x, e.y, e.z + 1.92, 0xff5a10, 1, 1, 0.3, 10)));
    parts.push(T1(SURF.stone, box(0.16, 0.95, 0.1, e.x, e.y, e.z + 2.1, SOCKET)));
    // Bloodshot veins.
    const rnd = rng(5);
    for (let i = 0; i < 7; i++) {
      const az = (i / 7) * Math.PI * 2;
      const p0 = V(Math.cos(az) * 0.95, Math.sin(az) * 0.95, 0), p1 = V(Math.cos(az + (rnd() - 0.5) * 0.6) * 1.75, Math.sin(az + (rnd() - 0.5) * 0.6) * 1.75, 0);
      p0.z = Math.sqrt(Math.max(0, 4 - p0.lengthSq())) + 0.02; p1.z = Math.sqrt(Math.max(0, 4 - p1.lengthSq())) + 0.02;
      parts.push(T1(SURF.paint, limb(p0.add(e), p1.add(e), 0.05, 0.03, 0x9a1a14, 3)));
    }
    return merge(parts);
  },

  // --- row (melody; stretched by pitch) -------------------------------------------------------
  // A twisted spire of stacked cones, bristling with thorns.
  'thorn-spire': () => {
    const parts: Part[] = [];
    const rnd = rng(23);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const r = 1.6 * (1 - i / (n + 1)), h = 3.2, y = i * 1.85;
      const g = new THREE.ConeGeometry(r, h, 6, 1).translate(0, h / 2, 0).rotateY(i * 0.55).rotateZ(Math.sin(i * 1.9) * 0.14).translate(Math.sin(i * 1.3) * 0.3, y, 0);
      parts.push(T1(SURF.rock, colorize(g, i % 2 ? 0x3a1614 : 0x241212, 0.6)));
      for (let k = 0; k < 4; k++) {
        const az = k / 4 * Math.PI * 2 + i * 0.8;
        const base = V(Math.sin(i * 1.3) * 0.3 + Math.cos(az) * r * 0.7, y + 0.5 + rnd() * 0.6, Math.sin(az) * r * 0.7);
        parts.push(T1(SURF.rock, spike(base, V(Math.cos(az), 0.5 + rnd() * 0.6, Math.sin(az)), 0.16, 1.0 + rnd() * 0.8, k % 2 ? BLOOD : 0x2a1a18, 4)));
      }
    }
    parts.push(T1(SURF.rock, spike(V(0, 11, 0), V(0.05, 1, 0), 0.25, 1.4, 0x241212, 5)));
    parts.push(T1(SURF.glow, sphere(0.22, 0.05, 12.2, 0, EMBER, 1, 1.4, 1, 6)));
    return merge(parts);
  },

  // A tall column of fire: a red sheath, orange tongues breaking out, a white-hot base.
  'flame-pillar': () => {
    const parts: Part[] = [
      T1(SURF.glow, lathe([[0, 0], [1.6, 0.4], [1.75, 2.5], [1.3, 5.5], [1.35, 7.5], [0.8, 10.2], [0.3, 11.5], [0, 12]], FIRE_R, 9)),
    ];
    const rnd = rng(31);
    for (let i = 0; i < 9; i++) {
      const y = 0.5 + i * 1.15, az = i * 2.4, r = 1.5 - i * 0.1;
      const h = 1.6 + rnd() * 1.4;
      const g = new THREE.ConeGeometry(0.55 - i * 0.03, h, 5, 1).translate(0, h / 2, 0).rotateZ(-0.35).rotateY(-az).translate(Math.cos(az) * r * 0.7, y, Math.sin(az) * r * 0.7);
      parts.push(T1(SURF.glow, colorize(g, i % 3 ? FIRE_O : FIRE_Y, 0.6)));
    }
    parts.push(T1(SURF.glow, sphere(1.3, 0, 0.6, 0.6, 0xffe080, 1.2, 0.6, 1, 9)));
    parts.push(T1(SURF.glow, rockBlob(1.2, 3, EMBER, 0, 0, 0, [1.8, 0.3, 1.6])));
    return merge(parts);
  },

  // --- far (170 m) ----------------------------------------------------------------------------
  // A volcano: a dark cone, a glowing crater and lava running down the front.
  'volcano': () => {
    const prof: [number, number][] = [[30, 0], [24, 6], [16, 18], [9, 29], [6, 35], [5, 34.4], [0, 32.5]];
    const parts: Part[] = [
      T1(SURF.rock, lathe(prof, 0x2e2624, 18)),
      T1(SURF.glow, lathe([[0, 33.6], [5.2, 34.3], [5.0, 34.6], [0, 34.0]], 0xff5a14, 14)),
      T1(SURF.rock, rockBlob(5, 7, 0x3a302c, -18, 2, 8, [1.6, 0.7, 1])),
      T1(SURF.rock, rockBlob(4, 8, 0x342a26, 16, 2, 10, [1.6, 0.6, 1])),
    ];
    const radiusAt = (y: number) => {
      for (let i = 1; i < 5; i++) if (y <= prof[i][1]) {
        const [r0, y0] = prof[i - 1], [r1, y1] = prof[i];
        return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
      }
      return 6;
    };
    // Lava streaks from the lip down the face, wandering a little.
    for (const [az0, len] of [[0.12, 26], [-0.35, 16], [0.55, 12]] as [number, number][]) {
      let prev: THREE.Vector3 | null = null;
      for (let k = 0; k <= 6; k++) {
        const y = 34.5 - (k / 6) * len, az = az0 + Math.sin(k * 1.4 + az0 * 5) * 0.05;
        const r = radiusAt(y) + 0.5;
        const p = V(Math.sin(az) * r, y, Math.cos(az) * r);
        if (prev) parts.push(T1(SURF.glow, limb(prev, p, 0.9 - k * 0.05, 1.0 - k * 0.05, k < 2 ? FIRE_O : EMBER, 4)));
        prev = p;
      }
    }
    return merge(parts);
  },

  // A towering fantasy of odd stacked forms: a bulb, a ring, a cracked dome, a curling horn.
  'hell-tower': () => {
    const parts: Part[] = [
      T1(SURF.stone, lathe([[5, 0], [4.2, 3], [3, 8], [2.4, 12], [2.6, 13]], 0x5a3a34, 12)),
      T1(SURF.stone, rockBlob(3.5, 3, ROCK, 0, 0.5, 0, [2.2, 0.5, 1.8])),
      // The bulb.
      T1(SURF.paint, sphere(5, 0, 17, 0, 0x7a4a40, 1, 1.05, 1, 14)),
      T1(SURF.metal, colorize(new THREE.TorusGeometry(5.6, 0.6, 6, 22).rotateX(Math.PI / 2).translate(0, 22, 0), 0x3a2e2a)),
      T1(SURF.stone, cyl(1.6, 2.4, 6, 0, 25, 0, 0x5a3a34, 10)),
      // The cracked dome.
      T1(SURF.plaster, colorize(new THREE.SphereGeometry(4.2, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 28, 0), 0xc8b8a0, 0.7)),
      T1(SURF.stone, cyl(4.4, 4.4, 0.6, 0, 28, 0, 0x4a3430, 14)),
    ];
    // Glowing windows round the bulb and the trunk.
    for (const [y, r, az] of [[17, 5, 0], [15, 4.9, 0.6], [18.5, 4.8, -0.5], [6, 3.7, 0.2], [10, 2.9, -0.3]] as [number, number, number][]) {
      const g = new THREE.BoxGeometry(0.8, 1.4, 0.3).rotateY(az).translate(Math.sin(az) * r, y, Math.cos(az) * r);
      parts.push(T1(SURF.glow, colorize(g, FIRE_O, 0.8)));
    }
    // Cracks over the front of the dome, one of them glowing.
    const onDome = (az: number, el: number, r = 4.25) => V(Math.sin(az) * Math.cos(el) * r, 28 + Math.sin(el) * r, Math.cos(az) * Math.cos(el) * r);
    const cracks: [number, number][][] = [
      [[-0.2, 1.3], [0.05, 1.0], [-0.1, 0.7], [0.15, 0.4], [0.05, 0.08]],
      [[0.5, 1.1], [0.7, 0.8], [0.6, 0.45], [0.85, 0.15]],
    ];
    cracks.forEach((cr, ci) => {
      for (let i = 1; i < cr.length; i++) {
        parts.push(T1(ci ? SURF.stone : SURF.glow, limb(onDome(...cr[i - 1]), onDome(...cr[i]), 0.18, 0.14, ci ? SOCKET : EMBER, 4)));
      }
    });
    // A horn curling up out of the dome.
    let prev = V(0, 31.5, 0);
    for (let i = 1; i <= 7; i++) {
      const t = i / 7;
      const p = V(3.2 * t * t, 31.5 + 11 * t, -0.8 * t * t);
      parts.push(T1(SURF.paint, limb(prev, p, 1.7 * (1 - (i - 1) / 7) + 0.05, 1.7 * (1 - t) + 0.05, i % 2 ? 0xc8b8a0 : 0xa89878, 7)));
      prev = p;
    }
    return merge(parts);
  },

  // --- ambient --------------------------------------------------------------------------------
  // A bare, gnarled dead tree.
  'dead-tree': () => {
    const parts: Part[] = [];
    const rnd = rng(39);
    branchOut(parts, V(0, 0, 0), V(0.08, 1, 0.03).normalize(), 3.2, 0.38, 3, rnd);
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + 0.5;
      parts.push(T1(SURF.wood, limb(V(0, 0.6, 0), V(Math.cos(a) * 0.9, -0.05, Math.sin(a) * 0.9), 0.22, 0.06, DEADWOOD, 4)));
    }
    return merge(parts);
  },

  // --- ridges ---------------------------------------------------------------------------------
  // A dark ridge, cracked along its crest with glowing lava (a held melody line).
  'lava-ridge': () => {
    const parts: Part[] = [T1(SURF.rock, sphere(10, 0, 0, 0, ROCK_RED, 1.25, 1.5, 0.9, 12))];
    const A = 12.5, B = 15, C = 9;
    const pt = (x: number, f: number) => {
      const y = B * Math.sqrt(Math.max(0, 1 - (x / A) ** 2)) * f;
      const z = C * Math.sqrt(Math.max(0, 1 - (x / A) ** 2 - (y / B) ** 2));
      return V(x, y, z + 0.15);
    };
    for (const [f0, w] of [[0.9, 0.45], [0.72, 0.28]] as [number, number][]) {
      let prev: THREE.Vector3 | null = null;
      for (let i = 0; i <= 12; i++) {
        const x = -10 + i * (20 / 12), f = f0 + (i % 2 ? 0.04 : -0.03);
        const p = pt(x, f);
        if (prev) parts.push(T1(SURF.glow, limb(prev, p, w, w, i % 3 ? EMBER : FIRE_O, 4)));
        prev = p;
      }
    }
    return merge(parts);
  },
};
