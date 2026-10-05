// The other window. A second pass-by spawner, mirrored to the far side of the carriage, plays the
// same score into invented worlds that alternate by section (see packs/other-side.ts). When the
// world is space, a starfield dissolves in over the real sky on that side, with a floor of stars.
// On breakdowns and drops the disco takes over: the non-Gondry view's backdrops (render/visualiser.ts)
// fill that side of the sky and the floor, on the same score, while the scenery keeps passing in
// trippy paint. The intro and the last stretch stay the ride itself.
// Only ever on the far side: the main window never sees any of it.

import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { Spawner, type GazeSource } from './spawner';
import { makeSceneryMaterial, makeSpaceMaterial, U } from './shaders';
import type { Pack } from '../packs/types';
import type { CameraRig } from './rig';
import { sectionAt, type Score } from '../score/types';
import { Visualiser } from './visualiser';

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
  private disco: Visualiser;
  private discoReveal = uniform(0);
  private discoFloor: THREE.Mesh | null = null;
  private discoAlways = false;

  /** `minTrip` > 0: a permanently psychedelic version of the world (the starship's other side). */
  constructor(private pack: Pack, private rig: CameraRig, private score: Score, camera: THREE.PerspectiveCamera, private minTrip = 0) {
    // ?side=provence (or cosmos) pins the far window's world; ?side=disco keeps the disco on.
    const side = new URLSearchParams(location.search).get('side');
    if (side && pack.themes.some(t => t.name === side)) this.pack = pack = { ...pack, themeCycle: [side as any], themeBySection: {} };
    this.discoAlways = side === 'disco';
    // Its own copy of the scenery material: in space the paint is always a little psychedelic.
    this.material = makeSceneryMaterial({ trip: this.trip });
    (this.material as any).side = THREE.DoubleSide; // the mirror flips triangle winding
    this.spawner = new Spawner(pack, rig, score, camera, this.material);
    this.spawner.group.scale.z = -1;
    this.group.add(this.spawner.group);
    // Space: half a sphere of stars on the far side, and a starry floor to hide the fields.
    const spaceMat = makeSpaceMaterial(this.reveal);
    this.space = new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24, 0, Math.PI), spaceMat);
    // phi 0..π is already the +z half.
    this.space.frustumCulled = false;
    this.space.renderOrder = -6;
    const floorMat = makeSpaceMaterial(this.reveal);
    floorMat.side = THREE.DoubleSide;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(4800, 2400).rotateX(-Math.PI / 2).translate(0, 0.12, 1200 + 3.3), floorMat);
    this.floor.frustumCulled = false;
    this.group.add(this.space, this.floor);
    this.disco = this.makeDisco(score, camera);
  }

  /** The disco: a non-Gondry show on the far half of the sky (and a floor wearing it, on the train). */
  private makeDisco(score: Score, camera: THREE.PerspectiveCamera) {
    const v = new Visualiser(this.pack, score, camera, { reveal: this.discoReveal });
    this.group.add(v.group);
    if (this.pack.vehicle !== 'ship') {
      if (!this.discoFloor) {
        this.discoFloor = new THREE.Mesh(new THREE.PlaneGeometry(4800, 2400).rotateX(-Math.PI / 2).translate(0, 0.14, 1200 + 3.3), v.farFloorMaterial());
        this.discoFloor.frustumCulled = false;
        this.discoFloor.renderOrder = -5;
        this.group.add(this.discoFloor);
      } else this.discoFloor.material = v.farFloorMaterial();
    }
    return v;
  }

  /**
   * Is the far side a disco at time s? Only on the song's big moments: breakdowns and drops (as
   * sections, or as a break or drop the parser marked), never in the intro or the last stretch, so
   * the ride starts and ends as itself.
   */
  private discoAt(s: number) {
    if (this.discoAlways) return true;
    const sc = this.score;
    const { section: sec, index } = sectionAt(sc, s);
    if (!sec || sec.label === 'intro' || sec.label === 'outro' || index === 0) return false;
    if (sc.final && s > sc.track.durationSec - 15) return false;
    if (sec.label === 'breakdown' || sec.label === 'drop') return true;
    for (const m of sc.moments ?? []) {
      if (m.t > s) break;
      if (m.kind === 'drop' && s < m.t + 8) return true;
      if (m.kind === 'break' && s < m.t + Math.max(4, m.dur ?? 0)) return true;
    }
    return false;
  }

  setScore(score: Score, camera: THREE.PerspectiveCamera) {
    this.score = score;
    this.group.remove(this.spawner.group);
    this.spawner.reset(-1e9);
    this.spawner = new Spawner(this.pack, this.rig, score, camera, this.material, this.spawner.pools);
    this.spawner.group.scale.z = -1;
    this.group.add(this.spawner.group);
    this.spawner.refreshLeads();
    this.group.remove(this.disco.group);
    this.disco = this.makeDisco(score, camera);
  }

  /** Objects hidden until the train leaves for space (for shader warm-up). */
  get hidden(): THREE.Object3D[] { return [this.space, this.floor, ...this.disco.meshes, ...(this.discoFloor ? [this.discoFloor] : [])]; }

  reset(s: number) { this.spawner.reset(s); this.disco.reset(s); }

  update(s: number, dt: number, gaze: GazeSource, frontier: number, running: boolean, trainX: number) {
    this.gaze ??= new MirroredGaze(gaze, THREE.MathUtils.degToRad(this.pack.rig.maxYaw));
    this.spawner.update(s, dt, this.gaze, frontier, running);
    const cosmos = running && this.spawner.themeAt(s) === 'cosmos';
    const k = 1 - Math.exp(-dt / 1.2);
    this.reveal.value += ((cosmos ? 1.05 : -0.05) - this.reveal.value) * k;
    // The disco paints the passing scenery too: the trippy surfaces, in the show's colours.
    this.trip.value = Math.max(U.trip.value, U.tripFar.value, this.reveal.value * 0.3, this.discoReveal.value * 0.6, this.minTrip);
    this.space.visible = this.floor.visible = this.reveal.value > 0.01;
    this.space.position.x = this.floor.position.x = trainX;
    // The disco fades in and out with its parts of the song; it only runs while it shows.
    const disco = running && this.discoAt(s);
    this.discoReveal.value += ((disco ? 1.05 : -0.05) - this.discoReveal.value) * k;
    this.discoReveal.value = Math.max(0, Math.min(1, this.discoReveal.value));
    const on = this.discoReveal.value > 0.01;
    this.disco.group.visible = on;
    if (this.discoFloor) { this.discoFloor.visible = on; this.discoFloor.position.x = trainX; }
    if (on || disco) this.disco.update(s, dt, gaze, frontier, running);
  }

  dispose() { this.spawner.reset(-1e9); }
}
