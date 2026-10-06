// Procedural, original low-poly models. Every model is one merged geometry with vertex colours,
// standing on y=0, centred on x=0 (the travel axis) and z=0 (depth axis, +z towards the train).
// Packs refer to models by name; glTF models can be registered under the same names later.
// The helpers (box, cyl, sphere, lathe, T(SURF.x, ...) and so on) live in model-kit.ts.

import * as THREE from 'three/webgpu';
import { SURF, T, T1, box, cyl, cone, sphere, roof, lathe, cypress, merge, windowsOnFace, canopy, rockBlob, colorize, tmpM, tmpQ, tmpE, type Part } from './model-kit';
import { SPOOKY_MODELS } from './models-spooky';
import { FAIR_MODELS } from './models-fair';

export const MODELS: Record<string, () => THREE.BufferGeometry> = {
  ...SPOOKY_MODELS,
  ...FAIR_MODELS,
  // --- trackside -----------------------------------------------------------------
  'catenary-pole': () => merge([
    box(0.32, 7.6, 0.32, 0, 3.8, 0, 0x6f7377),
    box(0.16, 0.16, 3.0, 0, 7.0, 1.4, 0x5d6166),
    box(0.1, 0.1, 2.6, 0, 6.3, 1.2, 0x5d6166, [0.42, 0, 0]),
    cyl(0.07, 0.07, 0.5, 0, 6.65, 2.6, 0x9a6b4a, 6),
    box(0.7, 0.4, 0.7, 0, 0.2, 0, 0x8c8a84),
  ]),
  // --- the rest of the lineside kit, so each stretch of line has its own poles ------------------
  // A lower-quadrant semaphore signal (country lines): a white mast with a ladder, the red arm with
  // its white band lowered at a slant (line clear), the lamp and its coloured spectacle glass.
  'semaphore': () => merge([
    ...T(SURF.paint, box(0.24, 6.4, 0.24, 0, 3.2, 0, 0xe8e4da), cyl(0.05, 0.16, 0.5, 0, 6.65, 0, 0x2d2f33, 6)),
    ...T(SURF.metal, box(0.06, 5.2, 0.05, 0.26, 2.6, 0.12, 0x55595e), box(0.06, 5.2, 0.05, 0.5, 2.6, 0.12, 0x55595e)),
    ...[0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8].map(y => box(0.3, 0.04, 0.05, 0.38, y, 0.12, 0x55595e)),
    ...T(SURF.paint, box(1.7, 0.32, 0.06, -0.95, 5.55, 0.16, 0xb3342a, [0, 0, -0.55]), box(0.22, 0.34, 0.07, -1.4, 5.8, 0.17, 0xf2efe6, [0, 0, -0.55])),
    T1(SURF.glow, cyl(0.1, 0.1, 0.05, 0, 0, 0, 0x6fe08a, 10).rotateX(Math.PI / 2).translate(0.05, 5.6, 0.22)),
    box(0.2, 0.26, 0.2, 0.05, 5.6, 0.05, 0x2d2f33),
    box(0.8, 0.3, 0.8, 0, 0.15, 0, 0x8c8a84),
  ]),
  // A colour-light signal (busy lines): a slim post, a black head with its hood, one green aspect lit.
  'colour-signal': () => merge([
    ...T(SURF.metal, box(0.2, 4.4, 0.2, 0, 2.2, 0, 0x6f7377), box(0.6, 0.06, 0.7, 0, 3.9, 0.25, 0x6f7377)),
    box(0.5, 1.5, 0.34, 0, 4.9, 0.1, 0x1c1d20), box(0.62, 1.62, 0.04, 0, 4.9, 0.28, 0x2a2b2f),
    ...[[5.35, 0x3a1412], [4.9, 0x3a3212], [4.45, 0x6fffa0]].map(([y, c]) => T1(y === 4.45 ? SURF.glow : SURF.paint, cyl(0.13, 0.13, 0.05, 0, 0, 0, c, 10).rotateX(Math.PI / 2).translate(0, y, 0.3))),
    box(0.7, 0.3, 0.7, 0, 0.15, 0, 0x8c8a84),
  ]),
  // A wooden telegraph pole with two crossarms of insulators: the old country line beside the track.
  'telegraph-pole': () => merge([
    ...T(SURF.wood, cyl(0.12, 0.17, 7.4, 0, 3.7, 0, 0x6e5a44, 8), box(0.14, 0.14, 1.9, 0, 6.9, 0, 0x5f4c38), box(0.14, 0.14, 1.5, 0, 6.3, 0, 0x5f4c38)),
    ...[-0.8, -0.3, 0.3, 0.8].map(z => cyl(0.05, 0.06, 0.16, 0, 7.05, z, 0xe9ece6, 6)),
    ...[-0.6, -0.2, 0.2, 0.6].map(z => cyl(0.05, 0.06, 0.16, 0, 6.45, z, 0xe9ece6, 6)),
  ]),
  // A station-approach lamp: a slim green post, a swan-neck arm and a lit lantern facing the line.
  'lamp-post': () => merge([
    ...T(SURF.metal, cyl(0.07, 0.11, 5.2, 0, 2.6, 0, 0x2f4a3a, 8), box(0.08, 0.08, 0.9, 0, 5.15, 0.42, 0x2f4a3a), cyl(0.2, 0.14, 0.1, 0, 5.0, 0.0, 0x2f4a3a, 8)),
    box(0.34, 0.12, 0.34, 0, 5.1, 0.85, 0x2f4a3a),
    T1(SURF.glow, box(0.26, 0.32, 0.26, 0, 4.88, 0.85, 0xffe2a0)),
  ]),
  // A grey-green lineside relay cabinet on a plinth, with a cable trough running off.
  'relay-cabinet': () => merge([
    ...T(SURF.metal, box(1.3, 1.5, 0.6, 0, 0.95, 0, 0x7b8a78), box(1.4, 0.1, 0.7, 0, 1.75, 0, 0x6a7768)),
    box(1.5, 0.2, 0.8, 0, 0.1, 0, 0x8c8a84), box(0.4, 0.2, 2.4, 0.4, 0.1, 1.4, 0x9a968c),
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
  // Foreground variety: gardens, trees, lock-ups and little buildings, so the near window is not
  // all sheds and warehouses.
  'cottage': () => merge([
    T1(SURF.plaster, box(5.5, 3.6, 4.2, 0, 1.8, 0, 0xf1e6cf)), roof(6, 4.8, 2, 0, 3.6, 0, 0x6e4b3a),
    T1(SURF.brick, box(0.7, 2.2, 0.7, 1.8, 5, -0.6, 0x9b5a44)),
    T1(SURF.wood, box(1, 2, 0.08, -1.2, 1, 2.12, 0x3f5e74)), box(1.8, 0.15, 1.2, -1.2, 2.3, 2.6, 0x6e4b3a),
    ...windowsOnFace(5.5, 3.6, 2.1, 1, 3, 0.9, 0x55606a),
    ...T(SURF.foliage, box(5.5, 0.9, 0.7, 0, 0.45, 3.4, 0x58753a)),
  ]),
  'garages': () => {
    const parts: Part[] = [T1(SURF.concrete, box(12, 2.6, 5, 0, 1.3, 0, 0xb9b4aa)), T1(SURF.concrete, box(12.4, 0.25, 5.4, 0, 2.7, 0, 0x8e8a83))];
    const doors = [0x5f7d8c, 0x9c4a3c, 0x6d7a4a, 0xc9b27a, 0x5f7d8c];
    for (let i = 0; i < 5; i++) parts.push(T1(SURF.metal, box(2, 2.1, 0.06, -4.8 + i * 2.4, 1.05, 2.52, doors[i])));
    return merge(parts);
  },
  'allotment': () => {
    const parts: Part[] = [];
    for (let i = 0; i < 5; i++) parts.push(...T(SURF.foliage, box(5, 0.35, 0.5, -1, 0.18, -2 + i * 1.1, i % 2 ? 0x6f9a44 : 0x8aa84e)));
    // A little greenhouse and a water butt.
    parts.push(T1(SURF.glass, box(2.4, 2, 3, 3.6, 1, 0, 0xa8c4c8)), roof(2.6, 3.2, 0.7, 3.6, 2, 0, 0xcfe0e2));
    parts.push(cyl(0.4, 0.4, 1, -4.2, 0.5, 2, 0x2f5a3a, 10));
    for (const x of [-4.6, 5.2]) for (const z of [-2.8, 2.8]) parts.push(T1(SURF.wood, box(0.1, 1.1, 0.1, x, 0.55, z, 0x6a5038)));
    return merge(parts);
  },
  'tree-clump': () => merge([
    cyl(0.25, 0.4, 3.8, -1.6, 1.9, 0, 0x5b4632, 7), ...canopy(-1.6, 5, 0, 2.8, 0x56783b, 41),
    cyl(0.18, 0.3, 2.6, 1.8, 1.3, 0.8, 0x5b4632, 7), ...canopy(1.8, 3.6, 0.8, 2, 0x6b8a45, 43),
    ...canopy(0.3, 1, 1.6, 1.4, 0x5f7d3e, 47, 0.6),
  ]),
  // A field hedge with a gap and an oak at the end: the foreground is mostly green in real life.
  'hedge': () => merge([
    ...T(SURF.foliage, box(7, 1.7, 1.3, -4.5, 0.85, 0, 0x4f6b34)), ...T(SURF.foliage, box(6, 1.5, 1.2, 5.2, 0.75, 0.1, 0x587638)),
    T1(SURF.wood, box(2, 1.1, 0.08, 0.4, 0.75, 0.3, 0x8a7458)), T1(SURF.wood, box(0.15, 1.3, 0.15, -0.7, 0.65, 0.3, 0x5a4632)),
    cyl(0.3, 0.45, 4, 8.6, 2, -0.4, 0x5b4632, 7), ...canopy(8.6, 5.6, -0.4, 3, 0x4f7036, 71),
    ...canopy(-8.5, 1.2, 0.2, 1.2, 0x5f7d3e, 73, 0.7),
  ]),
  // A back garden: lawn, a picket fence, flower beds, an apple tree and the washing out.
  'garden': () => {
    const parts: Part[] = [T1(SURF.grass, box(11, 0.08, 7, 0, 0.04, 0, 0x7fa04e))];
    for (let x = -5.25; x <= 5.3; x += 0.75) parts.push(T1(SURF.paint, box(0.1, 0.9, 0.06, x, 0.45, 3.4, 0xf2f0e8)));
    parts.push(T1(SURF.paint, box(10.6, 0.08, 0.05, 0, 0.7, 3.42, 0xf2f0e8)), T1(SURF.paint, box(10.6, 0.08, 0.05, 0, 0.3, 3.42, 0xf2f0e8)));
    const blooms = [0xd8486a, 0xf0c03a, 0x8a5cc8, 0xf08a3a, 0xe8e0f0];
    for (let i = 0; i < 5; i++) parts.push(...T(SURF.foliage, box(1.6, 0.45, 0.8, -4.2 + i * 2.1, 0.25, 2.5, blooms[i])));
    parts.push(cyl(0.18, 0.25, 2.2, 3.5, 1.1, -1.5, 0x5b4632, 7), ...canopy(3.5, 3.2, -1.5, 1.7, 0x5c8a3a, 81));
    // The washing line: two poles, a line, and whatever is drying today.
    parts.push(T1(SURF.metal, box(0.08, 2.2, 0.08, -4.5, 1.1, -1, 0x9a9a96)), T1(SURF.metal, box(0.08, 2.2, 0.08, 0.5, 1.1, -1, 0x9a9a96)));
    parts.push(box(5, 0.03, 0.03, -2, 2.1, -1, 0xd8d8d0));
    const wash = [0xffffff, 0x4f86c6, 0xe85a5a, 0xf5d24a, 0xffffff, 0x6cc08a];
    wash.forEach((c, i) => parts.push(T1(SURF.paint, box(0.55, 0.6 + (i % 3) * 0.15, 0.03, -4 + i * 0.8, 1.75 - (i % 3) * 0.07, -1, c))));
    return merge(parts);
  },
  'birch-clump': () => {
    const parts: Part[] = [];
    const xs = [-1.4, -0.2, 1.1, 2];
    xs.forEach((x, i) => {
      const h = 5 + (i % 2) * 1.6;
      parts.push(T1(SURF.paint, cyl(0.12, 0.18, h, x, h / 2, (i % 3) * 0.6 - 0.6, 0xe9e6dc, 6)));
      parts.push(...canopy(x, h + 0.4, (i % 3) * 0.6 - 0.6, 1.3, 0x9cb85a, 60 + i, 1.3));
    });
    return merge(parts);
  },
  'hoarding': () => merge([
    T1(SURF.wood, box(0.25, 5, 0.25, -3, 2.5, 0, 0x4d4036)), T1(SURF.wood, box(0.25, 5, 0.25, 3, 2.5, 0, 0x4d4036)),
    // A blank poster panel in bold blocks of colour (no words, no logos).
    T1(SURF.paint, box(7, 3, 0.15, 0, 3.5, 0.15, 0xf2d24b)), T1(SURF.paint, box(3.2, 3, 0.16, -1.9, 3.5, 0.17, 0xe0563f)),
    T1(SURF.paint, box(1.6, 1.6, 0.17, 1.8, 3.9, 0.18, 0x2f6fb0)),
  ]),
  'terrace': () => {
    const parts: Part[] = [];
    const walls = [0xb87a5c, 0xc99a74, 0xa86a50, 0xd2b08a];
    const doors = [0x2f4f6f, 0x8a2f2f, 0x2f6a4a, 0x111111];
    for (let i = 0; i < 4; i++) {
      const x = -6 + i * 4;
      parts.push(T1(SURF.brick, box(4, 6, 6, x, 3, 0, walls[i])));
      parts.push(T1(SURF.wood, box(1, 2.1, 0.08, x - 0.9, 1.05, 3.04, doors[i])));
      parts.push(...windowsOnFace(4, 6, 3.0, 2, 1, 0.6, 0x4d5b66).map(p => p));
      parts.push(T1(SURF.brick, box(0.5, 1.2, 0.8, x + 1.4, 7.4, -1, 0x8a4a35)));
    }
    parts.push(roof(16.4, 6.6, 2.2, 0, 6, 0, 0x5d4f4a));
    return merge(parts);
  },
  'barn': () => merge([
    T1(SURF.wood, box(9, 5, 7, 0, 2.5, 0, 0x9e3b2c)), roof(9.6, 7.6, 3, 0, 5, 0, 0x5b5148),
    T1(SURF.wood, box(3.2, 3.6, 0.1, 0, 1.8, 3.52, 0xe8dcc8)), T1(SURF.wood, box(2.8, 3.2, 0.12, 0, 1.8, 3.56, 0x9e3b2c)),
    T1(SURF.straw, cyl(0.9, 0.9, 1.6, 5.8, 0.9, 2, 0xd9b45a, 12)),
  ]),
  'gasholder': () => {
    const parts: Part[] = [T1(SURF.metal, cyl(7, 7, 5, 0, 2.5, 0, 0x7f8a7e, 24))];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      parts.push(T1(SURF.metal, box(0.35, 14, 0.35, Math.cos(a) * 7.6, 7, Math.sin(a) * 7.6, 0x8e5a4a)));
    }
    for (const y of [5, 9.5, 14]) parts.push(T1(SURF.metal, cyl(7.8, 7.8, 0.3, 0, y, 0, 0x8e5a4a, 24)));
    return merge(parts);
  },
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
    cyl(0.25, 0.35, 3.2, -7, 1.6, 1, 0x4a3828, 7), ...canopy(-7, 4.4, 1, 2.3, 0x4f6e36, 31),
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
  // A windbreak of Italian cypresses: flame-shaped, leafy, slightly different heights.
  // A hedgerow of field trees, oak and ash of different sizes: the countryside's skyline.
  'tree-line': () => {
    const parts: Part[] = [...T(SURF.foliage, box(22, 1.4, 1.4, 0, 0.7, 0, 0x4d6a33))];
    [[-9, 1.1], [-5.5, 0.8], [-1.5, 1.25], [2.5, 0.9], [6, 1.15], [9.5, 0.75]].forEach(([x, k], i) => {
      parts.push(cyl(0.22 * k, 0.4 * k, 4 * k, x, 2 * k, 0, 0x5b4632, 7));
      parts.push(...canopy(x, 4.6 * k + 1, 0, 2.6 * k, [0x4f7036, 0x5c7d3c, 0x47652f][i % 3], 90 + i));
    });
    return merge(parts);
  },
  // Fields: stripes of crop with a hedge behind, a gate, and the odd bale or scarecrow.
  'field': () => {
    const crops = [0xd9c25a, 0x8fae4c, 0xc9b066, 0x6f9440];
    const parts: Part[] = [];
    for (let i = 0; i < 8; i++) parts.push(T1(SURF.grass, box(18, 0.12 + (i % 2) * 0.1, 0.9, 0, 0.08, -3.6 + i * 1.05, crops[(i >> 1) % crops.length])));
    parts.push(...T(SURF.foliage, box(18, 1.5, 1.1, 0, 0.75, -5, 0x4f6b34)));
    parts.push(T1(SURF.wood, box(2.4, 1.1, 0.08, 5, 0.6, 4.6, 0x8a7458)), T1(SURF.wood, box(0.15, 1.3, 0.15, 3.7, 0.65, 4.6, 0x5a4632)));
    parts.push(cyl(0.7, 0.7, 1.2, -6, 0.6, 1, 0xd8c070, 12), cyl(0.7, 0.7, 1.2, -4.4, 0.6, 1.6, 0xcfb866, 12));
    // The scarecrow, arms out.
    parts.push(T1(SURF.wood, box(0.12, 2.2, 0.12, 2, 1.1, -1, 0x5a4632)), T1(SURF.wood, box(1.6, 0.1, 0.1, 2, 1.7, -1, 0x5a4632)));
    parts.push(T1(SURF.paint, box(0.6, 0.7, 0.3, 2, 1.55, -1, 0x7a3b3b)), sphere(0.22, 2, 2.15, -1, 0xd8c8a0, 1, 1, 1, 8), cone(0.4, 0.3, 2, 2.4, -1, 0x6b5a3a, 8));
    return merge(parts);
  },
  'cypress-row': () => merge([
    ...cypress(-3.2, 0.85, 0x2f4a2a, 3), ...cypress(0, 1.05, 0x34502d, 5), ...cypress(3.1, 0.92, 0x2b4527, 8),
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
  'cypress': () => merge(cypress(0, 0.85, 0x2d4628, 2)),
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
      return [cyl(0.04, 0.05, h, x, h / 2, z, 0x4e6b2a, 4), T1(SURF.glow, cyl(0.32, 0.32, 0.08, 0, 0, 0, 0x8a6a10, 10).rotateX(Math.PI / 2.4).translate(x, h, z + 0.1)), cyl(0.14, 0.14, 0.1, 0, 0, 0, 0x3a2410, 8).rotateX(Math.PI / 2.4).translate(x, h, z + 0.15)];
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
    ...[-1, 1].map(sx => T1(SURF.metal, cyl(0.6, 0.8, 0.5, 0, 0, 0, 0x6f767e, 10).rotateZ(sx * Math.PI / 2).translate(sx * 2.35, 3.4, 0))),
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
    ...[-1, 1].map(sy => T1(SURF.glow, cyl(0.9, 1.2, 0.6, 0, 0, 0, 0x7fd8ff, 12).rotateZ(-Math.PI / 2).translate(-11.3, 6 + sy * 1.2, 0))),
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
  // Held notes. Segments overlap so a row of them reads as one shape; scaled in height by pitch.
  'ridge': () => merge([
    T1(SURF.rock, sphere(10, 0, 0, 0, 0x8f897d, 1.25, 1.5, 0.9, 12)),
    T1(SURF.stone, sphere(5.2, 0, 11.2, 0, 0xf4f3ee, 1.5, 0.55, 1.0, 10)),
  ]),
  'ridge-low': () => merge([T1(SURF.grass, sphere(8, 0, 0, 0, 0x7d8f50, 1.3, 1, 1, 12))]),
  'lavender-ridge': () => merge([T1(SURF.lavender, sphere(7, 0, 0, 0, 0x8d78c4, 1.4, 0.9, 1, 12))]),
  'light-ribbon': () => merge([
    T1(SURF.glow, colorize(new THREE.CylinderGeometry(0.28, 0.28, 9.6, 8, 1).rotateZ(Math.PI / 2), 0xbfe8ff)),
    T1(SURF.glass, colorize(new THREE.CylinderGeometry(0.7, 0.7, 9.4, 10, 1).rotateZ(Math.PI / 2), 0x6fb8ff)),
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

  // --- the starship's far side: a reef adrift in space, and a crystal canyon ----------------
  // A jellyfish: a glowing bell with a frilled rim and long trailing tentacles.
  'jellyfish': () => {
    const parts: Part[] = [
      T1(SURF.glow, colorize(new THREE.SphereGeometry(2.4, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1).translate(0, 9, 0), 0xff8ad8, 0.6)),
      T1(SURF.glass, colorize(new THREE.SphereGeometry(1.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 9.1, 0), 0xffd0f0, 0.7)),
      T1(SURF.glow, colorize(new THREE.TorusGeometry(2.35, 0.12, 6, 32).rotateX(Math.PI / 2).translate(0, 9, 0), 0xffe0ff)),
    ];
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2, r = 1.6 + (i % 3) * 0.25, len = 4 + (i % 4) * 1.3;
      const g = new THREE.CylinderGeometry(0.03, 0.09, len, 4, 1).translate(0, -len / 2, 0).rotateZ(Math.sin(i * 2.3) * 0.12).translate(Math.cos(a) * r, 9, Math.sin(a) * r);
      parts.push(T1(SURF.glow, colorize(g, i % 2 ? 0x8ad8ff : 0xff9ae0, 0.4)));
    }
    return merge(parts);
  },
  // An anemone: a bed of soft tapering stalks, each with a glowing bead at the tip.
  'anemone': () => {
    const parts: Part[] = [T1(SURF.rock, rockBlob(1.8, 21, 0x4a3a5a, 0, 0.6, 0, [1.4, 0.5, 1.2]))];
    for (let i = 0; i < 14; i++) {
      const a = i * 2.39996, r = 0.3 + Math.sqrt(i / 14) * 1.5, h = 2.2 + ((i * 7) % 5) * 0.45;
      const lean = (r / 1.8) * 0.5;
      const g = new THREE.CylinderGeometry(0.06, 0.16, h, 5, 1).translate(0, h / 2, 0).rotateZ(-Math.cos(a) * lean).rotateX(Math.sin(a) * lean).translate(Math.cos(a) * r, 0.8, Math.sin(a) * r);
      parts.push(T1(SURF.paint, colorize(g, 0x5ad8b8, 0.5)));
      const tip = new THREE.Vector3(0, h, 0).applyEuler(new THREE.Euler(Math.sin(a) * lean, 0, -Math.cos(a) * lean)).add(new THREE.Vector3(Math.cos(a) * r, 0.8, Math.sin(a) * r));
      parts.push(T1(SURF.glow, sphere(0.16, tip.x, tip.y, tip.z, i % 3 ? 0xfff27a : 0xff7ac8, 1, 1, 1, 6)));
    }
    return merge(parts);
  },
  // A coral fan: a flat lattice of branches, edge-on to nothing, facing the window.
  'coral-fan': () => {
    const parts: Part[] = [];
    const branch = (x: number, y: number, a: number, len: number, depth: number) => {
      const g = new THREE.CylinderGeometry(0.06 + depth * 0.03, 0.09 + depth * 0.04, len, 4, 1).translate(0, len / 2, 0).rotateZ(a).translate(x, y, 0);
      parts.push(T1(depth > 1 ? SURF.paint : SURF.glow, colorize(g, depth > 1 ? 0xe0603a : 0xffa070, 0.6)));
      if (depth <= 0) return;
      const ex = x - Math.sin(a) * len, ey = y + Math.cos(a) * len;
      branch(ex, ey, a + 0.42, len * 0.72, depth - 1);
      branch(ex, ey, a - 0.42, len * 0.72, depth - 1);
    };
    branch(0, 0, 0, 3.2, 4);
    return merge(parts);
  },
  // A space whale: a long smooth body, a fluked tail, long fins, and a line of lights down its side.
  'space-whale': () => {
    const parts: Part[] = [
      T1(SURF.paint, colorize(new THREE.CapsuleGeometry(3.4, 18, 8, 16).rotateZ(Math.PI / 2).scale(1, 0.85, 0.9).translate(0, 14, 0), 0x3a4f78, 0.5)),
      T1(SURF.paint, colorize(new THREE.CapsuleGeometry(2.6, 14, 6, 14).rotateZ(Math.PI / 2).scale(1, 0.6, 0.8).translate(1, 12.4, 0), 0xb8c4d8, 0.8)),
      // Flukes and fins: flattened, swept.
      T1(SURF.paint, box(4.5, 0.4, 7, -14.5, 14.6, 0, 0x34466c, [0, 0, 0.2])),
      T1(SURF.paint, box(6, 0.35, 2.4, 3, 11.6, 3.6, 0x34466c, [0.5, 0.4, -0.25])),
      T1(SURF.paint, box(6, 0.35, 2.4, 3, 11.6, -3.6, 0x34466c, [-0.5, -0.4, -0.25])),
    ];
    for (let i = 0; i < 12; i++) parts.push(T1(SURF.glow, sphere(0.26, -9 + i * 1.6, 13.6 + Math.sin(i * 0.5) * 0.3, 2.95, i % 2 ? 0x8ae8ff : 0xffe07a, 1, 1, 1, 6)));
    parts.push(T1(SURF.glow, sphere(0.45, 9.6, 15, 2.2, 0xffffff, 1, 1, 1, 8)));
    return merge(parts);
  },
  // A geode: a split rock, its open face full of glowing crystal points.
  'geode': () => {
    const parts: Part[] = [T1(SURF.rock, rockBlob(3.2, 31, 0x5a5048, 0, 4, -0.8, [1.2, 1, 0.7]))];
    for (let i = 0; i < 16; i++) {
      const a = i * 2.39996, r = Math.sqrt(i / 16) * 2.6;
      const g = new THREE.OctahedronGeometry(0.35 + (i % 4) * 0.12, 0).scale(1, 2.2, 1).rotateX(Math.PI / 2 - 0.3).translate(Math.cos(a) * r, 4 + Math.sin(a) * r * 0.9, 1.2);
      parts.push(T1(i % 3 ? SURF.glass : SURF.glow, colorize(g, i % 2 ? 0xb07aff : 0x7af0ff)));
    }
    return merge(parts);
  },
  // A lantern buoy: a little floating paper lantern on a tether.
  'lantern-buoy': () => merge([
    T1(SURF.glow, sphere(0.42, 0, 2.6, 0, 0xffc070, 1, 1.3, 1, 10)),
    T1(SURF.metal, cyl(0.2, 0.2, 0.12, 0, 3.2, 0, 0x5a4636, 8)),
    T1(SURF.metal, cyl(0.015, 0.015, 2, 0, 1.0, 0, 0x8a8a8a, 3)),
  ]),
  // --- the starship's rare finds -------------------------------------------------------------
  // A derelict: a broken hull drifting, its ribs showing.
  'derelict': () => {
    const parts: Part[] = [
      T1(SURF.metal, box(14, 4.4, 5.6, -3, 8, 0, 0x6a6e72, [0, 0, 0.12])),
      T1(SURF.paint, box(14.1, 0.6, 5.65, -3, 7, 0, 0x8a3a2a, [0, 0, 0.12])),
    ];
    for (let i = 0; i < 6; i++) parts.push(T1(SURF.metal, colorize(new THREE.TorusGeometry(2.8, 0.18, 4, 12, Math.PI * 1.2).rotateY(Math.PI / 2).translate(6 + i * 1.6, 8.6 + i * 0.2, 0), 0x55595d)));
    parts.push(T1(SURF.glow, box(0.4, 0.4, 0.1, -6, 9, 2.85, 0xff5a3a)));
    return merge(parts);
  },
  // A solar sail: a vast square of shimmering foil on four booms, a tiny probe at its heart.
  'solar-sail': () => merge([
    T1(SURF.glass, colorize(new THREE.PlaneGeometry(26, 26).rotateZ(Math.PI / 4).translate(0, 22, 0), 0xe8d8ff, 1)),
    ...[0, 1, 2, 3].map(k => T1(SURF.metal, box(0.15, 18.4, 0.15, 0, 22, 0.1, 0xd0d0d0, [0, 0, k * Math.PI / 2]))),
    T1(SURF.glow, sphere(0.7, 0, 22, 0.4, 0xfff0c0, 1, 1, 1, 10)),
  ]),
  // A deep-space listening post: three dishes on a little station, turned to the stars.
  'dish-array': () => {
    const parts: Part[] = [T1(SURF.metal, box(10, 1.4, 4, 0, 6, 0, 0x9da2a8))];
    for (const x of [-3.5, 0, 3.5]) {
      parts.push(T1(SURF.metal, cyl(0.2, 0.3, 2, x, 7.7, 0, 0x7d8286, 6)));
      parts.push(T1(SURF.paint, colorize(new THREE.SphereGeometry(2.2, 16, 6, 0, Math.PI * 2, 0, 0.9).rotateX(-0.9).translate(x, 9.4, 0.4), 0xf2efe8, 0.85)));
      parts.push(T1(SURF.glow, sphere(0.18, x, 9.9, 1.5, 0xff5a3a, 1, 1, 1, 6)));
    }
    return merge(parts);
  },

  // --- rare finds: the odd surprise in the main window (Layer.rare) -------------------------
  // A tower mill: a tapering stone body, a boat-shaped cap and four lattice sails facing the line.
  'windmill': () => {
    const parts: Part[] = [
      T1(SURF.stone, lathe([[3.4, 0], [3.2, 4], [2.6, 12], [2.3, 14]], 0xe2d8c4, 14)),
      T1(SURF.wood, sphere(2.7, 0, 14.4, 0, 0x5a4636, 1, 0.75, 1.25, 10)),
      T1(SURF.wood, box(1.2, 2.2, 0.08, 0, 1.1, 3.25, 0x4a3a2c)),
      T1(SURF.glass, box(0.8, 1.1, 0.1, 0, 6, 3.05, 0x3a3f44)), T1(SURF.glass, box(0.7, 1, 0.1, 0, 10, 2.7, 0x3a3f44)),
      T1(SURF.metal, colorize(new THREE.CylinderGeometry(0.35, 0.35, 1.6, 8).rotateX(Math.PI / 2).translate(0, 14.6, 2.8), 0x3c3c3c)),
    ];
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + i * Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
      const sail = new THREE.BoxGeometry(1.7, 11, 0.12).translate(0.5, 6.2, 0).rotateZ(a - Math.PI / 2).translate(0, 14.6, 3.5);
      parts.push(T1(SURF.wood, colorize(sail, 0xf0ebe0, 0.95)));
      parts.push(T1(SURF.wood, box(0.25, 0.25, 0.25, c * 0.4, 14.6 + sn * 0.4, 3.5, 0x3c2f24)));
    }
    return merge(parts);
  },
  // A round dovecote with a pointed cap and rows of little doors.
  'dovecote': () => merge([
    T1(SURF.stone, cyl(1.9, 2.1, 5, 0, 2.5, 0, 0xd9cdb5, 14)), cone(2.5, 2.6, 0, 6.3, 0, 0x9a5a3e, 14),
    ...[0.6, 1.3, 2].map(dy => box(0.4, 0.4, 0.1, 0, 3 + dy, 2.02, 0x2e2a26)),
    T1(SURF.metal, cyl(0.04, 0.04, 1.2, 0, 8.2, 0, 0x3a3a3a, 4)),
  ]),
  // A Victorian glasshouse: a white frame, glass sides and a glass ridge roof.
  'greenhouse': () => {
    const parts: Part[] = [
      T1(SURF.glass, box(9, 2.4, 4, 0, 1.4, 0, 0xa8c4c8)),
      T1(SURF.glass, roof(9, 4, 1.6, 0, 2.6, 0, 0xb4cfd2)),
      T1(SURF.brick, box(9.2, 0.6, 4.2, 0, 0.3, 0, 0x9b5a44)),
    ];
    for (let i = 0; i <= 6; i++) parts.push(T1(SURF.paint, box(0.1, 2.5, 4.1, -4.5 + i * 1.5, 1.45, 0, 0xf4f2ec)));
    parts.push(T1(SURF.paint, box(9.1, 0.1, 0.1, 0, 4.2, 0, 0xf4f2ec)));
    parts.push(...T(SURF.foliage, sphere(0.6, -3, 1.2, 1.2, 0x5f8a3e), sphere(0.7, 1.5, 1.3, 1, 0x6e9440), sphere(0.5, 3.4, 1.1, -1, 0x557a36)));
    return merge(parts);
  },
  // Ruined abbey arches: a broken stone wall with tall pointed windows open to the sky.
  'folly': () => {
    const parts: Part[] = [];
    const tops = [9, 11, 10.5, 7, 4];
    for (let i = 0; i < 5; i++) {
      const x = -10 + i * 5;
      parts.push(T1(SURF.stone, box(1.6, tops[i], 1.4, x, tops[i] / 2, 0, 0xc9bda5)));
      if (i < 4 && tops[i + 1] > 6) {
        // An arch between two piers: two leaning stones meeting in a point.
        parts.push(T1(SURF.stone, box(0.9, 3, 1.2, x + 1.6, 7.6, 0, 0xbfb39a, [0, 0, -0.55])));
        parts.push(T1(SURF.stone, box(0.9, 3, 1.2, x + 3.4, 7.6, 0, 0xbfb39a, [0, 0, 0.55])));
      }
    }
    parts.push(T1(SURF.stone, box(24, 1.2, 1.6, -0.5, 0.6, 0, 0xb5a98f)));
    parts.push(...canopy(8, 2.6, 1.6, 1.8, 0x5d7a3a, 41), ...canopy(-12, 1.6, -1.2, 1.4, 0x67843f, 43));
    return merge(parts);
  },
  // A fairground big wheel, cabins round the rim, on an A-frame.
  'big-wheel': () => {
    const R = 14, cy = R + 3;
    const parts: Part[] = [
      T1(SURF.paint, colorize(new THREE.TorusGeometry(R, 0.3, 6, 48).translate(0, cy, 0.8), 0xf2efe8)),
      T1(SURF.paint, colorize(new THREE.TorusGeometry(R, 0.3, 6, 48).translate(0, cy, -0.8), 0xf2efe8)),
      T1(SURF.metal, colorize(new THREE.CylinderGeometry(0.6, 0.6, 2.4, 10).rotateX(Math.PI / 2).translate(0, cy, 0), 0x8e9193)),
    ];
    for (const sz of [-1.6, 1.6]) for (const sx of [-1, 1]) {
      const leg = new THREE.BoxGeometry(0.6, cy / Math.cos(0.32), 0.6).translate(0, cy / Math.cos(0.32) / 2, 0).rotateZ(sx * 0.32).translate(-sx * Math.tan(0.32) * cy, 0, sz);
      parts.push(T1(SURF.metal, colorize(leg, 0xd8d6d0)));
    }
    const cabins = [0xd9534f, 0x3f7fbf, 0xf0c040, 0x5aa05a];
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8;
      const x = Math.cos(a) * R, y = cy + Math.sin(a) * R;
      parts.push(T1(SURF.paint, colorize(new THREE.BoxGeometry(0.15, R, 0.15).translate(0, R / 2, 0).rotateZ(a - Math.PI / 2).translate(0, cy, 0.8), 0xe4e1da)));
      parts.push(T1(SURF.paint, box(1.4, 1.5, 1.4, x, y - 1.2, 0, cabins[i % 4])));
    }
    return merge(parts);
  },
  // A tall guyed radio mast with red and white bands.
  'radio-mast': () => {
    const parts: Part[] = [];
    for (let i = 0; i < 7; i++) parts.push(T1(SURF.paint, cyl(0.55 - i * 0.04, 0.6 - i * 0.04, 8, 0, 4 + i * 8, 0, i % 2 ? 0xf2efe8 : 0xc23b2e, 6)));
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI * 2 / 3;
      const len = Math.hypot(40, 24);
      const g = new THREE.CylinderGeometry(0.05, 0.05, len, 3, 1).translate(0, len / 2, 0)
        .rotateZ(Math.atan2(24, 40)).translate(24, 0, 0).rotateY(a);
      parts.push(T1(SURF.metal, colorize(g, 0x6e7275)));
    }
    parts.push(T1(SURF.concrete, box(4, 2.6, 3, 4, 1.3, -3, 0xbab5aa)));
    return merge(parts);
  },
  // A hilltop observatory: a white drum and a dome with its slit open.
  'observatory': () => merge([
    T1(SURF.plaster, cyl(6, 6.2, 7, 0, 3.5, 0, 0xeeebe4, 20)),
    T1(SURF.metal, colorize(new THREE.SphereGeometry(6.1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 7, 0), 0xd4d7da, 0.75)),
    T1(SURF.metal, box(1.6, 6.4, 0.2, 0, 10, 5.3, 0x24282c, [0.75, 0, 0])),
    T1(SURF.plaster, box(10, 4, 6, 9, 2, -2, 0xe6e1d6)), roof(10.4, 6.4, 1.4, 9, 4, -2, 0x8a4a35),
    ...windowsOnFace(10, 4, 1.05, 1, 3, 1.2, 0x3f4a54).map(g => g.translate(9, 0, 0)),
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
    // The screening tower: a hopper on four legs with a funnel underneath (not a floating cone).
    parts.push(T1(SURF.metal, box(5, 5, 5, 4, 13.5, -1, 0xa7a49c)), T1(SURF.metal, cyl(3.2, 0.8, 3.2, 4, 9.4, -1, 0x8c8a84, 12)));
    for (const [dx, dz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) parts.push(T1(SURF.metal, box(0.35, 11, 0.35, 4 + dx, 5.5, -1 + dz, 0x6e7275)));
    parts.push(T1(SURF.metal, box(5.6, 0.25, 5.6, 4, 11, -1, 0x6e7275)));
    // Spoil heaps: soft, slumped mounds with lumpy flanks and a rounded crown, not pyramids.
    const heap = (r: number, h: number, x: number, z: number, color: number, seed: number) => {
      const pts: [number, number][] = [];
      for (let i = 0; i <= 12; i++) {
        const f = i / 12;
        pts.push([r * (1 - f) + 0.01, h * Math.sin(f * Math.PI / 2) ** 0.85]);
      }
      const g = lathe(pts, color, 28);
      // Lumps: push each vertex in and out a little, more on the flanks than at the crown.
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        const a = Math.atan2(vz, vx);
        const n = Math.sin(a * 5 + seed) * 0.5 + Math.sin(a * 11 + seed * 2.3) * 0.3 + Math.sin(vy * 1.7 + a * 3 + seed) * 0.2;
        const k = 1 + n * 0.09 * (1 - vy / h * 0.6);
        p.setXYZ(i, vx * k, vy * (1 + n * 0.05), vz * k * 1.25);
      }
      g.computeVertexNormals();
      g.translate(x, 0, z);
      return T1(SURF.rock, g);
    };
    parts.push(heap(10, 5.5, -20, 4, 0xbdb3a2, 1), heap(8, 4.2, 18, 3, 0xc9bfae, 2), heap(6, 3, 30, -4, 0xa99f8f, 3), heap(4, 2, -8, 7, 0xb3a894, 4));
    return merge(parts);
  },
  // A road bridge over the line that comes down to earth on the far side: the deck runs onto a
  // grassy embankment that ramps down to the fields (it used to stop dead in mid-air).
  'overpass': () => {
    const run = 42, drop = 8.9, a = Math.atan2(drop, run), len = Math.hypot(run, drop);
    const zEnd = -42, zMid = zEnd - run / 2;
    return merge([
      T1(SURF.concrete, box(7, 1.4, 57, 0, 8.2, -13.5, 0xbdb7aa)),
      box(7.2, 1.0, 0.3, 0, 9.4, 15, 0x9d978a),
      ...T(SURF.concrete, box(5, 7.6, 1.6, 0, 3.8, -6.5, 0xb0a998), box(5, 7.6, 1.6, 0, 3.8, 6.5, 0xb0a998)),
      // The abutment the deck lands on, then the bank and its road, sloping down away from the train.
      T1(SURF.concrete, box(8, 8.2, 2, 0, 4.1, zEnd, 0xa9a292)),
      T1(SURF.grass, box(16, 9, len, 0, drop / 2 - 4.4, zMid, 0x6f8a47, [-a, 0, 0])),
      T1(SURF.concrete, box(7, 0.3, len, 0, drop / 2 + 0.15, zMid, 0x9c968a, [-a, 0, 0])),
    ]);
  },
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
