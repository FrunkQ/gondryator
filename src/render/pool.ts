// Instanced-mesh pools: one InstancedMesh per model, fixed capacity, no allocation per frame.

import * as THREE from 'three/webgpu';
import { getModel } from './models';
import { makeSceneryMaterial } from './shaders';
import { FLAGS } from './flags';

export interface PooledObject {
  model: string;
  slot: number; // index inside the instanced mesh, -1 when free
  // World placement.
  x: number; y: number; z: number;
  sx: number; sy: number; sz: number;
  rotY: number;
  color: THREE.Color;
  // Animation
  grow: number; // 0..1 spawn-in animation progress (1 = done)
  vx: number; // world velocity along x (moving objects like the passing train)
  t0: number; // show time the x refers to (for movers)
  // Bookkeeping for the spawner
  tag: number;
}

let sharedScenery: THREE.Material | undefined;
const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);

export class Pools {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private owners = new Map<string, PooledObject[]>();
  private material: THREE.Material;
  private capacity: number;
  private free: PooledObject[] = [];

  constructor(capacity = 160) {
    this.capacity = capacity;
    this.material = sharedScenery ??= FLAGS.procedural ? makeSceneryMaterial() : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  }

  private mesh(model: string): THREE.InstancedMesh {
    let m = this.meshes.get(model);
    if (!m) {
      const cap = model === 'fence-post' || model === 'marker-post' || model === 'vine-stake' || model === 'catenary-pole' ? this.capacity * 2 : this.capacity;
      m = new THREE.InstancedMesh(getModel(model), this.material, cap);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      this.meshes.set(model, m);
      this.owners.set(model, []);
      this.group.add(m);
    }
    return m;
  }

  /** Pre-create meshes so the first spawn of a model does not hitch. */
  warm(models: string[]) { for (const m of models) this.mesh(m); }

  acquire(model: string): PooledObject | null {
    const m = this.mesh(model);
    const owners = this.owners.get(model)!;
    if (m.count >= m.instanceMatrix.count) return null;
    const o = this.free.pop() ?? {
      model, slot: -1, x: 0, y: 0, z: 0, sx: 1, sy: 1, sz: 1, rotY: 0, color: new THREE.Color(1, 1, 1), grow: 1, vx: 0, t0: 0, tag: 0,
    };
    o.model = model;
    o.slot = m.count;
    o.grow = 1; o.vx = 0; o.t0 = 0; o.rotY = 0; o.y = 0;
    o.color.setRGB(1, 1, 1);
    owners[o.slot] = o;
    m.count++;
    return o;
  }

  release(o: PooledObject) {
    if (o.slot < 0) return;
    const m = this.meshes.get(o.model)!;
    const owners = this.owners.get(o.model)!;
    const last = m.count - 1;
    if (o.slot !== last) {
      const moved = owners[last];
      owners[o.slot] = moved;
      moved.slot = o.slot;
      this.write(moved);
    }
    owners.length = last;
    m.count = last;
    o.slot = -1;
    this.free.push(o);
  }

  write(o: PooledObject) {
    const m = this.meshes.get(o.model)!;
    const g = o.grow >= 1 ? 1 : easeOutBack(o.grow);
    p.set(o.x, o.y, o.z);
    q.setFromAxisAngle(yAxis, o.rotY);
    s.set(o.sx * Math.max(0.001, g), o.sy * Math.max(0.001, g), o.sz * Math.max(0.001, g));
    m4.compose(p, q, s);
    m.setMatrixAt(o.slot, m4);
    m.setColorAt(o.slot, o.color);
  }

  flush() {
    for (const m of this.meshes.values()) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  get activeCount() {
    let n = 0;
    for (const m of this.meshes.values()) n += m.count;
    return n;
  }
}

function easeOutBack(x: number) {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
