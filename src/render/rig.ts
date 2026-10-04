// Camera rigs (spec section 9). A rig answers two questions:
//   pose(s):              where is the camera, and which way is "straight out", at show time s?
//   placeFor(t, d, yaw):  where must an object at depth d be so that at time t it sits in the
//                         frame at view angle `yaw` (radians, + = towards travel)?
// Spawning, look-around and steering are all built on those two, so a new rig (dolly-forward,
// locked-off, orbit) plugs in without touching the spawner.

import * as THREE from 'three/webgpu';
import type { RigSpec } from '../packs/types';
import type { Score } from '../score/types';
import { sectionAt } from '../score/types';

export interface CameraRig {
  readonly spec: RigSpec;
  /** True once the title run has started (the train has left the first station). */
  readonly departed: boolean;
  /** Title phase: start moving (p = seconds since load). */
  depart(p: number): void;
  /** Position along the path during the title phase. */
  titleTravel(p: number): number;
  /** Title clock time at which the title run comes to rest (at the song's name board). */
  titleArrival(): number;
  /** The music will start `rampSec` from now (title clock p). */
  go(pNow: number, rampSec: number): void;
  /** Start running at once (pack switched mid-track). */
  goImmediate(): void;
  attachScore(score: Score): void;
  setAspect(aspect: number): void;
  /** Position along the travel path at show time s (s < 0 during the run-in to the music). */
  travel(s: number): number;
  /** Camera holder position and base orientation at show time s (eye height is added by the world). */
  pose(s: number, pos: THREE.Vector3, quat: THREE.Quaternion): void;
  placeFor(t: number, depth: number, yaw: number, out: THREE.Vector3): void;
  /** View angle (radians, ahead of the gaze) at which an object sits when its sound plays. */
  hitAngle?(): number;
  /** Seconds before t that an object at this depth can first come into view. */
  leadTime(depth: number): number;
  /** Show time at which the camera reaches travel position x (for themed ground and ambient). */
  timeAtTravel(x: number): number;
  speedAt(s: number): number;
}

const DT = 0.05;
export const MAX_LEAD = 9.5;

/** Steady sideways motion past a window (Star Guitar). Travel is +x, the window faces -z. */
export class LateralRail implements CameraRig {
  readonly spec: RigSpec;
  private score: Score | null = null;
  private xs: number[] = [0];
  private vs: number[] = [0];
  /** Title-phase clock and run-in. */
  idleSpeed = 5;
  private goX = 0;
  private rampSec = 4;
  private going = false;
  private x0 = 0;
  private halfFovH = 0.7;

  constructor(spec: RigSpec) { this.spec = spec; }

  setAspect(aspect: number) {
    const vf = THREE.MathUtils.degToRad(this.spec.fov);
    this.halfFovH = Math.atan(Math.tan(vf / 2) * aspect);
  }

  /**
   * Title phase: the train pulls out of the first station, rolls up to the board with the song's
   * name and draws to a stop there. It waits while the score and the shaders get ready, so any
   * loading happens while standing still. p = seconds since load.
   */
  private departAt: number | null = null;
  /** Metres from the first station to the name board. */
  titleStop = 30;
  private static readonly ACC = 3;
  private static readonly DEC = 4;
  depart(p: number) { if (this.departAt === null) this.departAt = p; }
  get departed() { return this.departAt !== null; }
  private get titleCruise() {
    const vi = this.idleSpeed, A = LateralRail.ACC, B = LateralRail.DEC;
    return Math.max(0, this.titleStop - (vi * A) / 2 - (vi * B) / 2) / vi;
  }
  titleArrival() { return this.departAt === null ? Infinity : this.departAt + LateralRail.ACC + this.titleCruise + LateralRail.DEC; }
  titleTravel(p: number) {
    if (this.departAt === null || p < this.departAt) return 0;
    const u = p - this.departAt, vi = this.idleSpeed, A = LateralRail.ACC, B = LateralRail.DEC, tc = this.titleCruise;
    if (u < A) return (vi * u * u) / (2 * A);
    if (u < A + tc) return (vi * A) / 2 + vi * (u - A);
    const w = Math.min(u - A - tc, B);
    return (vi * A) / 2 + vi * tc + vi * w - (vi * w * w) / (2 * B);
  }
  /** Start running without a title run-in (pack switch mid-track). */
  goImmediate() { this.going = true; this.goX = 0; this.rampSec = 0.001; this.x0 = 0; this.xs = [0]; this.vs = [this.cruise(0)]; }

  /** Speed when the run-in starts (0 when pulling away from the name board). */
  private goV = 5;

  /** Music will start rampSec from now; the camera is at titleTravel(p) now. */
  go(pNow: number, rampSec: number) {
    this.rampSec = rampSec;
    this.goX = this.titleTravel(pNow);
    this.goV = Math.max(0, (this.titleTravel(pNow + 0.05) - this.titleTravel(pNow - 0.05)) / 0.1);
    const v = this.spec.speed, vi = this.goV, R = rampSec;
    this.x0 = this.goX + vi * R + ((v - vi) * R) / 2;
    this.going = true;
    this.xs = [this.x0];
    this.vs = [this.cruise(0)];
  }

  get runInSec() { return this.rampSec; }

  attachScore(score: Score) { this.score = score; }

  private cruise(t: number): number {
    const sp = this.spec;
    if (!this.score) return sp.speed;
    const { section, index } = sectionAt(this.score, t);
    if (!section) return sp.speed;
    const k = sp.speedByEnergy ?? 0;
    const target = sp.speed * (1 + k * (section.energy - 0.5));
    // Ease from the previous section's speed over 4 s, so speed changes are causal and smooth.
    const prev = index > 0 ? this.score.sections[index - 1] : null;
    const from = prev ? sp.speed * (1 + k * (prev.energy - 0.5)) : target;
    const u = Math.min(1, (t - section.t) / 4);
    return from + (target - from) * (u * u * (3 - 2 * u));
  }

  /** Extend the travel table up to time t (only ever with final sections, so it never changes). */
  private ensure(t: number) {
    const limit = this.score ? Math.min(t, Math.max(this.score.frontierSec, 0)) : t;
    while ((this.xs.length - 1) * DT < limit) {
      const i = this.xs.length - 1;
      const v = this.cruise(i * DT);
      this.vs.push(v);
      this.xs.push(this.xs[i] + v * DT);
    }
  }

  travel(s: number): number {
    if (!this.going) return this.titleTravel(s);
    const R = this.rampSec, vi = this.goV, v = this.spec.speed;
    if (s < -R) return this.goX + vi * (s + R);
    if (s < 0) { const u = s + R; return this.goX + vi * u + ((v - vi) * u * u) / (2 * R); }
    const D = this.score?.track.durationSec ?? Infinity;
    if (s > D) {
      const xD = this.travel(D);
      const vD = this.speedAt(D);
      const stop = 9; // seconds to come to a halt at the end station
      const u = Math.min(s - D, stop);
      return xD + vD * u - (vD * u * u) / (2 * stop);
    }
    this.ensure(s + DT);
    const i = Math.min(this.xs.length - 2, Math.floor(s / DT));
    if (i < 0) return this.x0;
    const f = s / DT - i;
    if (i >= this.xs.length - 1) return this.xs[this.xs.length - 1] + (s - (this.xs.length - 1) * DT) * this.vs[this.vs.length - 1];
    return this.xs[i] + (this.xs[i + 1] - this.xs[i]) * f;
  }

  speedAt(s: number): number {
    if (!this.going) return (this.titleTravel(s + 0.05) - this.titleTravel(s - 0.05)) / 0.1;
    const R = this.rampSec, vi = this.goV, v = this.spec.speed;
    if (s < -R) return vi;
    if (s < 0) return vi + ((v - vi) * (s + R)) / R;
    const D = this.score?.track.durationSec ?? Infinity;
    if (s > D) return Math.max(0, this.speedAt(D - 1e-3) * (1 - (s - D) / 9));
    this.ensure(s + DT);
    const i = Math.min(this.vs.length - 1, Math.max(0, Math.floor(s / DT)));
    return this.vs[i];
  }

  pose(s: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    pos.set(this.travel(s), 0, 0);
    quat.identity(); // camera default looks down -z: straight out of the window
  }

  placeFor(t: number, depth: number, yaw: number, out: THREE.Vector3) {
    out.set(this.travel(t) + depth * Math.tan(yaw), 0, -depth);
  }

  /** Just inside the leading edge of the screen (an object's middle a touch past the edge). */
  hitAngle() { return this.spec.hitAt === 'centre' ? 0 : this.halfFovH * 0.9; }

  leadTime(depth: number) {
    const reachAngle = Math.min(THREE.MathUtils.degToRad(80), THREE.MathUtils.degToRad(this.spec.maxYaw) + this.halfFovH);
    return Math.min(MAX_LEAD, (depth * Math.tan(reachAngle)) / Math.max(1, this.spec.speed * 0.8) + 0.3);
  }

  timeAtTravel(x: number): number {
    if (!this.going || x < this.x0) return -1;
    // Binary search on the table.
    this.ensure((this.xs.length - 1) * DT);
    const xs = this.xs;
    if (x >= xs[xs.length - 1]) return (xs.length - 1) * DT + (x - xs[xs.length - 1]) / Math.max(1, this.vs[this.vs.length - 1]);
    let lo = 0, hi = xs.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
    return (lo + (x - xs[lo]) / Math.max(1e-6, xs[lo + 1] - xs[lo])) * DT;
  }
}

/**
 * A locked-off camera on a slow orbit around a stage (Around the World). The camera circles the
 * origin at `orbitRadius`, looking at a point above the stage centre. Events do not travel past
 * this camera; they are performed in place, so lead times are zero.
 */
export class OrbitRig implements CameraRig {
  readonly spec: RigSpec;
  private going = false;
  private departAt: number | null = null;
  private goAngle = 0;
  private rampSec = 4;
  private score: Score | null = null;
  constructor(spec: RigSpec) { this.spec = spec; }

  private get omega() { return (2 * Math.PI) / (this.spec.orbitPeriod ?? 90); }
  get departed() { return this.departAt !== null; }
  depart(p: number) { if (this.departAt === null) this.departAt = p; }
  titleTravel(p: number) { return 0.35 * this.omega * p; } // a slower drift while the title shows
  titleArrival() { return this.departAt === null ? Infinity : this.departAt + 8.5; }
  go(pNow: number, rampSec: number) { this.goAngle = this.titleTravel(pNow); this.rampSec = rampSec; this.going = true; }
  goImmediate() { this.goAngle = 0; this.rampSec = 0.001; this.going = true; }
  attachScore(score: Score) { this.score = score; }
  setAspect(_aspect: number) { /* nothing depends on the aspect */ }

  /** Orbit angle (radians) at show time s. */
  travel(s: number) {
    if (!this.going) return this.titleTravel(s);
    const R = this.rampSec, w0 = 0.35 * this.omega, w = this.omega;
    const u = s + R;
    if (u <= 0) return this.goAngle + w0 * u;
    if (u < R) return this.goAngle + w0 * u + ((w - w0) * u * u) / (2 * R);
    const D = this.score?.track.durationSec ?? Infinity;
    const base = this.goAngle + w0 * R + ((w - w0) * R) / 2;
    if (s <= D) return base + w * s;
    const v = Math.min(s - D, 8);
    return base + w * D + w * v - (w * v * v) / 16;
  }
  speedAt(_s: number) { return this.omega * (this.spec.orbitRadius ?? 20); }

  /** Look-around on a stage walks the camera round it instead of turning the head (radians). */
  gazeOffset = 0;

  pose(s: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const a = this.travel(s) + this.gazeOffset, r = this.spec.orbitRadius ?? 20;
    pos.set(r * Math.sin(a), 0, r * Math.cos(a));
    const down = Math.atan2(this.spec.eyeHeight - (this.spec.lookAtY ?? 1.5), r);
    quat.setFromEuler(new THREE.Euler(-down, a, 0, 'YXZ'));
  }
  placeFor(_t: number, _depth: number, _yaw: number, out: THREE.Vector3) { out.set(0, 0, 0); }
  leadTime(_depth: number) { return 0.5; }
  timeAtTravel(_x: number) { return -1; }
}

export function makeRig(spec: RigSpec): CameraRig {
  if (spec.type === 'orbit') return new OrbitRig(spec);
  return new LateralRail(spec);
}
