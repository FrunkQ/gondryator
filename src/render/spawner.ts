// Mapping and spawning (spec sections 6 and 7): score events -> pack layers -> pooled objects,
// placed by the camera rig so each object crosses its slot in the frame exactly on its note.
// Top-tier objects are placed into where the viewer is (predicted to be) looking, and gently
// steered while in flight. The section-7 metric is measured here.

import * as THREE from 'three/webgpu';
import type { Pack, PackLayer, MappingRule } from '../packs/types';
import type { Score, ScoreEvent } from '../score/types';
import type { CameraRig } from './rig';
import { Pools, type PooledObject } from './pool';
import { getModel } from './models';

interface LayerState {
  layer: PackLayer;
  events: { e: ScoreEvent; tier: 1 | 2 | 3 }[];
  ptr: number;
  lead: number;
}

interface Live {
  obj: PooledObject;
  t: number;
  tier: 1 | 2 | 3;
  depth: number;
  despawnAt: number;
  layer: LayerState | null;
  baseX: number; // x at spawn (before steering)
  focusY: number;
  measured: boolean;
}

export interface GazeSource {
  /** Smoothed yaw now, radians. */
  yaw: number;
  pitch: number;
  /** Smoothed yaw speed, radians per second. */
  yawVel: number;
  /** Predicted yaw `ahead` seconds from now. */
  predictYaw(ahead: number): number;
}

const tmpV = new THREE.Vector3();
const tmpC = new THREE.Color();
const tmpQ = new THREE.Quaternion();

export function hash32(...xs: number[]): number {
  let h = 2166136261;
  for (const x of xs) {
    h ^= Math.floor(x * 1000) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export class Spawner {
  readonly pools: Pools;
  get group() { return this.pools.group; }
  private layers = new Map<string, LayerState>();
  private live: Live[] = [];
  private consumed = 0; // score.events consumed into layers
  private sectionsDone = 0;
  private sectionPtr = 0;
  private themeCache: string[] = [];
  private ambientCells = new Map<string, Live[]>();
  private want = new Set<string>();
  private camera: THREE.PerspectiveCamera;
  metric = { hits: 0, total: 0, recent: [] as boolean[], byLayer: {} as Record<string, [number, number]> };
  steering = true;
  /** How much in-view top-tier objects may follow a head turn (0 = never, 1 = fully). */
  followGain = Number(new URLSearchParams(location.search).get("follow") ?? 0.9);
  gazeSpawning = true;
  private lastS = -Infinity;

  private probe: THREE.PerspectiveCamera;

  constructor(private pack: Pack, private rig: CameraRig, private score: Score, camera: THREE.PerspectiveCamera, material?: THREE.Material) {
    this.camera = camera;
    this.probe = camera.clone();
    this.pools = new Pools(200, material);
    for (const l of pack.layers) this.layers.set(l.id, { layer: l, events: [], ptr: 0, lead: rig.leadTime(l.depth + (l.depthJitter ?? 0)) });
    const models = new Set<string>();
    for (const l of pack.layers) for (const ms of Object.values(l.models)) ms.forEach(m => models.add(m));
    for (const a of pack.ambient) for (const ms of Object.values(a.models)) ms.forEach(m => models.add(m));
    if (pack.sectionEvents?.onNewSection) models.add(pack.sectionEvents.onNewSection);
    if (pack.sectionEvents?.onBreakdown) models.add(pack.sectionEvents.onBreakdown);
    for (const il of pack.idle ?? []) models.add(il.model);
    this.pools.warm([...models]);
  }

  get activeCount() { return this.live.length; }

  /** Recompute lead times after a resize (field of view changes how early things appear). */
  refreshLeads() {
    this.probe.fov = this.camera.fov; this.probe.aspect = this.camera.aspect; this.probe.updateProjectionMatrix();
    for (const ls of this.layers.values()) ls.lead = this.rig.leadTime(ls.layer.depth + (ls.layer.depthJitter ?? 0));
  }

  /** Pull newly committed score events into layer queues. */
  private ingest() {
    const ev = this.score.events;
    for (; this.consumed < ev.length; this.consumed++) {
      const e = ev[this.consumed];
      const rule = this.ruleFor(e);
      if (!rule) continue;
      if (rule.every && rule.every > 1 && hash32(e.t) % rule.every !== 0) continue;
      const ls = this.layers.get(rule.layer);
      if (ls) ls.events.push({ e, tier: rule.tier });
    }
  }

  private ruleFor(e: ScoreEvent): MappingRule | null {
    for (const r of this.pack.mapping) {
      const m = r.match;
      if (m.stem && m.stem !== e.stem) continue;
      if (m.kind && m.kind !== e.kind) continue;
      if (m.minDur !== undefined && e.dur < m.minDur) continue;
      if (m.maxDur !== undefined && e.dur > m.maxDur) continue;
      if (m.minVel !== undefined && e.vel < m.minVel) continue;
      return r;
    }
    return null;
  }

  themeAt(t: number): string {
    const secs = this.score.sections;
    const cycle = this.pack.themeCycle;
    if (secs.length === 0 || t < secs[0].t) return cycle[0];
    let i = 0;
    while (i + 1 < secs.length && secs[i + 1].t <= t) i++;
    while (this.themeCache.length <= i) {
      const k = this.themeCache.length;
      const forced = this.pack.themeBySection?.[secs[k].label];
      if (forced) { this.themeCache.push(forced); continue; }
      // Next theme in the cycle after the last unforced one.
      let prev = -1;
      for (let j = k - 1; j >= 0; j--) {
        if (!this.pack.themeBySection?.[secs[j].label]) { prev = cycle.indexOf(this.themeCache[j]); break; }
      }
      this.themeCache.push(cycle[(prev + 1) % cycle.length]);
    }
    return this.themeCache[i];
  }

  /** Clear everything (seek). */
  reset(s: number) {
    for (const l of this.live) this.pools.release(l.obj);
    this.live.length = 0;
    for (const cell of this.ambientCells.values()) for (const l of cell) this.pools.release(l.obj);
    this.ambientCells.clear();
    for (const ls of this.layers.values()) {
      // First event that is still (or will be) in view.
      let lo = 0, hi = ls.events.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (ls.events[m].e.t + ls.lead < s) lo = m + 1; else hi = m; }
      ls.ptr = lo;
    }
    this.sectionPtr = 0;
    while (this.sectionPtr < this.score.sections.length && this.score.sections[this.sectionPtr].t + 12 < s) this.sectionPtr++;
    this.lastS = s;
  }

  update(s: number, dt: number, gaze: GazeSource, frontier: number, running: boolean) {
    this.ingest();
    const yawMax = THREE.MathUtils.degToRad(this.rig.spec.maxYaw);

    if (running) {
      // Spawn.
      for (const ls of this.layers.values()) {
        while (ls.ptr < ls.events.length) {
          const { e, tier } = ls.events[ls.ptr];
          if (e.t >= frontier) break;
          if (e.t - ls.lead > s) break;
          ls.ptr++;
          if (e.t + ls.lead < s) continue; // already gone by
          this.spawnEvent(ls, e, tier, s, gaze, yawMax);
        }
      }
      this.sectionEvents(s, frontier);
    }

    // Update live objects: steering, grow animation, movers, despawn, metric.
    const crossedFrom = this.lastS;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const l = this.live[i];
      const o = l.obj;
      if (s > l.despawnAt || s < l.t - 30) {
        this.pools.release(o);
        this.live[i] = this.live[this.live.length - 1];
        this.live.pop();
        continue;
      }
      if (o.vx !== 0) o.x = l.baseX + o.vx * (s - o.t0);
      if (o.grow < 1) o.grow = Math.min(1, o.grow + dt / 0.6);
      if (l.tier === 1 && this.steering && s < l.t) {
        const target = this.rig.travel(l.t) + l.depth * Math.tan(clampAbs(gaze.yaw, yawMax));
        const onScreen = this.ndcX(o.x, l.focusY, o.z);
        const v = this.rig.speedAt(s);
        // Off screen the object can slide quickly (nobody sees it); in view, only subtly.
        // While the viewer turns their head everything is moving on screen anyway, so in-view
        // objects may follow the turn.
        const inView = Math.abs(onScreen) < 1.15;
        const rate = (inView ? 0.05 * l.depth + 0.08 * v + (this.followGain * Math.abs(gaze.yawVel) * l.depth) / Math.cos(gaze.yaw) ** 2 : 0.9 * l.depth + 0.5 * v) * dt;
        const dx = THREE.MathUtils.clamp(target - o.x, -rate, rate);
        o.x += dx;
      }
      // Section-7 metric: was the object in the central third at its event time?
      if (l.tier === 1 && !l.measured && crossedFrom < l.t && s >= l.t && running) {
        l.measured = true;
        if (s - l.t < 0.25) {
          // Project with the camera as it was exactly at the event time (frames are discrete).
          this.probe.quaternion.copy(this.camera.getWorldQuaternion(tmpQ));
          this.probe.position.set(this.rig.travel(l.t), this.rig.spec.eyeHeight, 0);
          this.probe.updateMatrixWorld(true);
          tmpV.set(o.x, l.focusY, o.z).project(this.probe);
          const hit = Math.abs(tmpV.x) <= 1 / 3 && Math.abs(tmpV.y) <= 1 && tmpV.z < 1;
          this.metric.total++;
          if (hit) this.metric.hits++;
          const bl = (this.metric.byLayer[l.layer?.layer.id ?? '?'] ??= [0, 0]);
          bl[1]++; if (hit) bl[0]++;
          this.metric.recent.push(hit);
          if (this.metric.recent.length > 64) this.metric.recent.shift();
        }
      }
      this.pools.write(o);
    }
    this.updateAmbient(s);
    this.pools.flush();
    this.lastS = s;
  }

  private ndcX(x: number, y: number, z: number) {
    tmpV.set(x, y, z).project(this.camera);
    return tmpV.z > 1 ? 99 : tmpV.x;
  }

  private spawnEvent(ls: LayerState, e: ScoreEvent, tier: 1 | 2 | 3, s: number, gaze: GazeSource, yawMax: number) {
    const L = ls.layer;
    const theme = this.themeAt(e.t);
    const models = L.models[theme] ?? Object.values(L.models)[0];
    // Same musical content -> same object: hash pitch, kind and position in the bar.
    const h = hash32(e.kind.length, e.pitch ?? 0, e.step ?? 0, Math.round(e.vel * 4));
    const model = models[h % models.length];
    const o = this.pools.acquire(model);
    if (!o) return;
    const jitter = L.depthJitter ? ((hash32(h, 7) % 1000) / 1000 - 0.5) * 2 * L.depthJitter : 0;
    const depth = L.depth + jitter;
    let yaw = 0;
    if (this.gazeSpawning) {
      const lead = Math.max(0, e.t - s);
      if (tier === 1) yaw = clampAbs(gaze.predictYaw(Math.min(lead, 1.5)), yawMax);
      else if (tier === 2) yaw = 0.5 * clampAbs(gaze.predictYaw(Math.min(lead, 1.5)), yawMax);
    }
    this.rig.placeFor(e.t, depth, yaw, tmpV);
    o.x = tmpV.x; o.y = L.y ?? 0; o.z = tmpV.z;
    const vel = Math.round(e.vel * 10) / 10;
    const sc = (L.scale ?? 1) * (1 + (L.scaleByVel ?? 0) * (vel - 0.5));
    o.sx = sc; o.sy = sc; o.sz = sc;
    if (L.pitchCenter !== undefined && e.pitch !== null) o.sy *= THREE.MathUtils.clamp(1 + (e.pitch - L.pitchCenter) * (L.heightPerSemitone ?? 0.05), 0.35, 2.6);
    if (L.lengthByDur) {
      // Duration -> length: a note lasting d seconds is about as long as the stretch of line
      // the train covers in d seconds, so consecutive notes make a continuous row.
      const bbw = getModel(model).boundingBox!;
      const width = bbw.max.x - bbw.min.x;
      const len = THREE.MathUtils.clamp(e.dur * this.rig.speedAt(e.t) * L.lengthByDur, 3, 60);
      o.sx = len / width;
    }
    o.rotY = L.depth > 100 ? ((h % 100) / 100 - 0.5) * 0.6 : 0;
    const tints = L.tints?.[theme];
    if (tints) o.color.set(tints[(h >>> 8) % tints.length]); else o.color.setRGB(1, 1, 1);
    const late = s > e.t - ls.lead + 0.2;
    o.grow = late ? 0 : 1;
    const bb = getModel(model).boundingBox!;
    const top = bb.max.y * o.sy;
    const focusY = THREE.MathUtils.clamp(this.rig.spec.eyeHeight, 0.3, Math.max(0.3, top * 0.9));
    this.live.push({ obj: o, t: e.t, tier, depth, despawnAt: e.t + ls.lead + 0.5, layer: ls, baseX: o.x, focusY, measured: false });
    this.pools.write(o);
  }

  private sectionEvents(s: number, frontier: number) {
    const secs = this.score.sections;
    const se = this.pack.sectionEvents;
    if (!se) return;
    while (this.sectionPtr < secs.length) {
      const sec = secs[this.sectionPtr];
      if (sec.t >= frontier || sec.t - 9 > s) break;
      this.sectionPtr++;
      if (sec.t + 9 < s) continue;
      if (sec.label === 'breakdown' && se.onBreakdown) {
        // A train passes on the next track, its middle crossing the window a beat after the section starts.
        const tm = sec.t + 1.5;
        const xm = this.rig.travel(tm);
        const n = 7, carLen = 24.6, vx = -30;
        for (let i = 0; i < n; i++) {
          const o = this.pools.acquire(se.onBreakdown);
          if (!o) break;
          const base = xm + (i - (n - 1) / 2) * carLen;
          o.x = base; o.z = -4.3; o.y = 0; o.sx = o.sy = o.sz = 1; o.vx = vx; o.t0 = tm; o.grow = 1;
          o.color.setRGB(1, 1, 1);
          this.live.push({ obj: o, t: tm, tier: 3, depth: 4.3, despawnAt: tm + 8, layer: null, baseX: base, focusY: 2, measured: true });
        }
      } else if (this.sectionPtr > 1 && se.onNewSection) {
        const o = this.pools.acquire(se.onNewSection);
        if (!o) continue;
        o.x = this.rig.travel(sec.t); o.z = 0; o.y = 0; o.sx = o.sy = o.sz = 1; o.grow = 1;
        o.color.setRGB(1, 1, 1);
        this.live.push({ obj: o, t: sec.t, tier: 3, depth: 0, despawnAt: sec.t + 9, layer: null, baseX: o.x, focusY: 8, measured: true });
      }
    }
  }

  // Ambient scenery: deterministic per 100 m cell of travel, themed by when the train passes.
  private updateAmbient(s: number) {
    const camX = this.rig.travel(s);
    const want = this.want;
    want.clear();
    this.pack.ambient.forEach((a, ai) => {
      const cell = 100;
      const reach = Math.min(1400, a.depthMax * 1.6 + 100);
      const c0 = Math.floor((camX - reach) / cell), c1 = Math.floor((camX + reach) / cell);
      for (let c = c0; c <= c1; c++) {
        const key = ai + ':' + c;
        want.add(key);
        if (this.ambientCells.has(key)) continue;
        const t = this.rig.timeAtTravel(c * cell + cell / 2);
        const theme = t < 0 ? this.pack.themeCycle[0] : this.themeAt(t);
        const dens = a.density[theme] ?? 1;
        const items: Live[] = [];
        let r = hash32(c, ai, 99);
        const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 2246822507) >>> 0), (r & 0xffff) / 0x10000);
        const count = Math.floor(dens + rnd());
        const models = a.models[theme] ?? Object.values(a.models)[0];
        for (let k = 0; k < count; k++) {
          const o = this.pools.acquire(models[Math.floor(rnd() * models.length)]);
          if (!o) break;
          o.x = c * cell + rnd() * cell;
          o.z = -(a.depthMin + rnd() * (a.depthMax - a.depthMin));
          const [s0, s1] = a.scale ?? [1, 1];
          const sc = s0 + rnd() * (s1 - s0);
          o.sx = o.sz = sc; o.sy = sc * (0.85 + rnd() * 0.3); o.rotY = rnd() * 6.28; o.grow = 1;
          tmpC.setHSL(0.18 + rnd() * 0.08, 0.15, 0.85 + rnd() * 0.15);
          o.color.copy(tmpC);
          this.pools.write(o);
          items.push({ obj: o, t: 0, tier: 3, depth: -o.z, despawnAt: Infinity, layer: null, baseX: o.x, focusY: 0, measured: true });
        }
        this.ambientCells.set(key, items);
      }
    });
    // Idle scenery before the music: evenly spaced, unsynced, never past where the music starts.
    const idleLimit = this.rig.travel(-0.5);
    const synced = this.rig.travel(0) > this.rig.travel(-1); // going
    (this.pack.idle ?? []).forEach((il, ii) => {
      const reach = Math.min(1200, il.depth * 5.7 + 30);
      const c0 = Math.floor((camX - reach) / il.spacing), c1 = Math.floor((camX + reach) / il.spacing);
      for (let c = c0; c <= c1; c++) {
        const key = 'idle' + ii + ':' + c;
        let r = hash32(c, ii, 1234);
        const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 2246822507) >>> 0), (r & 0xffff) / 0x10000);
        const x = c * il.spacing + (il.jitter ? (rnd() - 0.5) * il.jitter : 0);
        if (synced && x > idleLimit) continue;
        if (x < 20 && !this.rig.departed) continue; // keep the first station clear
        want.add(key);
        if (this.ambientCells.has(key)) continue;
        const items: Live[] = [];
        if (rnd() < (il.chance ?? 1)) {
          const o = this.pools.acquire(il.model);
          if (o) {
            o.x = x; o.z = -il.depth; o.sx = o.sy = o.sz = 1; o.grow = 1;
            o.color.setRGB(1, 1, 1);
            this.pools.write(o);
            items.push({ obj: o, t: 0, tier: 3, depth: il.depth, despawnAt: Infinity, layer: null, baseX: x, focusY: 0, measured: true });
          }
        }
        this.ambientCells.set(key, items);
      }
    });
    for (const [key, items] of this.ambientCells) {
      if (want.has(key)) continue;
      for (const l of items) this.pools.release(l.obj);
      this.ambientCells.delete(key);
    }
  }
}

function clampAbs(v: number, m: number) { return v > m ? m : v < -m ? -m : v; }
