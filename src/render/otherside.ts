// The other window. A second pass-by spawner, mirrored to the far side of the carriage, plays the
// same score into invented worlds that alternate by section (see packs/other-side.ts). When the
// world is space, a starfield dissolves in over the real sky on that side, with a floor of stars.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { Spawner, type GazeSource } from './spawner';
import { makeSceneryMaterial, makeSpaceMaterial, U } from './shaders';
import type { Pack } from '../packs/types';
import type { CameraRig } from './rig';
import type { Score } from '../score/types';

/** The viewer's gaze seen from the mirrored side: facing +z is facing the other window. */
class MirroredGaze implements GazeSource {
  constructor(private g: GazeSource, private limit: number) {}
  private map(y: number) { const m = Math.PI - y; return m > Math.PI ? m - 2 * Math.PI : m; }
  get yaw() { const y = this.map(this.g.yaw); return Math.max(-this.limit, Math.min(this.limit, y)); }
  get pitch() { return this.g.pitch; }
  get yawVel() { return Math.abs(this.map(this.g.yaw)) < this.limit ? -this.g.yawVel : 0; }
  predictYaw(a: number) { const y = this.map(this.g.predictYaw(a)); return Math.max(-this.limit, Math.min(this.limit, y)); }
}

/** The main window's gaze, held still while the viewer is looking out of the other side. */
export class ClampedGaze implements GazeSource {
  constructor(private g: GazeSource, public limit: number) {}
  get yaw() { return Math.max(-this.limit, Math.min(this.limit, this.g.yaw)); }
  get pitch() { return this.g.pitch; }
  get yawVel() { return Math.abs(this.g.yaw) < this.limit ? this.g.yawVel : 0; }
  predictYaw(a: number) { return Math.max(-this.limit, Math.min(this.limit, this.g.predictYaw(a))); }
}

export class OtherSide {
  readonly group = new THREE.Group();
  spawner: Spawner;
  private space: THREE.Mesh;
  private floor: THREE.Mesh;
  private reveal = uniform(0);
  private trip = uniform(0);
  private material: THREE.Material;
  private gaze: MirroredGaze | null = null;

  constructor(private pack: Pack, private rig: CameraRig, score: Score, camera: THREE.PerspectiveCamera) {
    // Its own copy of the scenery material: in space the paint is always a little psychedelic.
    this.material = makeSceneryMaterial({ trip: this.trip });
    (this.material as any).side = THREE.DoubleSide; // the mirror flips triangle winding
    this.spawner = new Spawner(pack, rig, score, camera, this.material);
    this.spawner.group.scale.z = -1;
    this.group.add(this.spawner.group);
    // Space: half a sphere of stars on the far side, and a starry floor to hide the fields.
    const spaceMat = makeSpaceMaterial(this.reveal);
    this.space = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24, 0, Math.PI), spaceMat);
    this.space.rotation.y = -Math.PI / 2; // the half that faces +z
    this.space.frustumCulled = false;
    this.space.renderOrder = -6;
    const floorMat = makeSpaceMaterial(this.reveal);
    floorMat.side = THREE.DoubleSide;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(4800, 2400).rotateX(-Math.PI / 2).translate(0, 0.12, 1200 + 3.3), floorMat);
    this.floor.frustumCulled = false;
    this.group.add(this.space, this.floor);
  }

  setScore(score: Score, camera: THREE.PerspectiveCamera) {
    this.group.remove(this.spawner.group);
    this.spawner.reset(-1e9);
    this.spawner = new Spawner(this.pack, this.rig, score, camera, this.material);
    this.spawner.group.scale.z = -1;
    this.group.add(this.spawner.group);
    this.spawner.refreshLeads();
  }

  reset(s: number) { this.spawner.reset(s); }

  update(s: number, dt: number, gaze: GazeSource, frontier: number, running: boolean, trainX: number) {
    this.gaze ??= new MirroredGaze(gaze, THREE.MathUtils.degToRad(this.pack.rig.maxYaw));
    this.spawner.update(s, dt, this.gaze, frontier, running);
    const cosmos = running && this.spawner.themeAt(s) === 'cosmos';
    const k = 1 - Math.exp(-dt / 1.2);
    this.reveal.value += ((cosmos ? 1.05 : -0.05) - this.reveal.value) * k;
    this.trip.value = Math.max(U.trip.value, this.reveal.value * 0.45);
    this.space.visible = this.floor.visible = this.reveal.value > 0.01;
    this.space.position.x = this.floor.position.x = trainX;
  }

  dispose() { this.spawner.reset(-1e9); }
}
