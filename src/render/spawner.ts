// Mapping and spawning (spec sections 6 and 7): score events -> pack layers -> pooled objects,
// placed by the camera rig so each object crosses its slot in the frame exactly on its note.
// Top-tier objects are placed into where the viewer is (predicted to be) looking, and gently
// steered while in flight. The section-7 metric is measured here.

import * as THREE from 'three/webgpu';
import type { Pack, PackLayer, MappingRule, RidgeLayer } from '../packs/types';
import { sampleEnvelope, type Envelope, type Score, type ScoreEvent } from '../score/types';
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
  /** Entry timing: how far the model's middle sits past its front edge (so the front enters on the beat). */
  xOff?: number;
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

  /** `pools`: reuse the instanced meshes of an earlier spawner, so their shaders are not built again. */
  constructor(private pack: Pack, private rig: CameraRig, private score: Score, camera: THREE.PerspectiveCamera, material?: THREE.Material, pools?: Pools) {
    this.camera = camera;
    this.probe = camera.clone();
    this.pools = pools ?? new Pools(200, material);
    for (const l of pack.layers) this.layers.set(l.id, { layer: l, events: [], ptr: 0, lead: rig.leadTime(l.depth + (l.depthJitter ?? 0)) });
    const models = new Set<string>();
    for (const l of pack.layers) for (const ms of Object.values(l.models)) ms.forEach(m => models.add(m));
    for (const a of pack.ambient) for (const ms of Object.values(a.models)) ms.forEach(m => models.add(m));
    if (pack.sectionEvents?.onNewSection) models.add(pack.sectionEvents.onNewSection);
    if (pack.sectionEvents?.onBreakdown) models.add(pack.sectionEvents.onBreakdown);
    for (const il of pack.idle ?? []) models.add(il.model);
    if (pack.contour) for (const ms of Object.values(pack.contour.models)) ms.forEach(m => models.add(m));
    for (const R of pack.ridges ?? []) for (const ms of Object.values(R.models)) ms.forEach(m => models.add(m));
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
        const target = this.rig.travel(l.t) + l.depth * Math.tan(this.hitYaw(clampAbs(gaze.yaw, yawMax))) + (l.xOff ?? 0);
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
          // At its sound: just entering the view (or in the central third, for 'centre' rides).
          const ax = Math.abs(tmpV.x), entry = (this.rig.hitAngle?.() ?? 0) > 0;
          const hit = (entry ? ax >= 0.6 && ax <= 1.15 : ax <= 1 / 3) && Math.abs(tmpV.y) <= 1 && tmpV.z < 1;
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

  /** Per ridge layer: which envelope samples belong to a held line long enough to show. */
  private ridgeMask: { mask: Uint8Array; done: number; runStart: number; last: number; gap: number; lo: number; hi: number }[] = [];

  private heldMask(R: RidgeLayer, ri: number, env: Envelope) {
    const st = (this.ridgeMask[ri] ??= { mask: new Uint8Array(0), done: 0, runStart: -1, last: 0, gap: 0, lo: 0, hi: 0 });
    const v = env.values, n = v.length;
    if (st.mask.length < n) { const m = new Uint8Array(Math.max(n, st.mask.length * 2)); m.set(st.mask); st.mask = m; }
    const minLen = Math.round(R.minDur * env.rate);
    for (let i = st.done; i < n; i++) {
      // A line continues while the pitch is there and moves smoothly (a slide, not a leap);
      // dropouts of up to 80 ms don't break it.
      if (v[i] <= 0) {
        if (st.runStart >= 0 && ++st.gap > 4) st.runStart = -1;
        if (st.runStart < 0) continue;
      } else {
        const smooth = st.runStart >= 0 && Math.abs(v[i] - st.last) < 1.2;
        if (!smooth) { st.runStart = i; st.lo = st.hi = v[i]; }
        st.lo = Math.min(st.lo, v[i]); st.hi = Math.max(st.hi, v[i]);
        st.last = v[i]; st.gap = 0;
      }
      // Only lines that actually glide: a steady note is a single object, not a ridge.
      if (st.runStart >= 0 && i - st.runStart + 1 >= minLen && st.hi - st.lo >= 0.8) {
        // A gliding line: mark the whole run so far.
        for (let k = i; k >= st.runStart && !st.mask[k]; k--) st.mask[k] = 1;
      }
    }
    st.done = n;
    return st.mask;
  }

  private updateRidge(R: RidgeLayer, ri: number, camX: number, want: Set<string>) {
    const env = this.score.envelopes[R.pitch];
    if (!env || !env.values.length) return;
    const mask = this.heldMask(R, ri, env);
    const known = env.values.length / env.rate;
    const rest = THREE.MathUtils.degToRad(this.rig.spec.startYaw ?? 0);
    const ahead = R.depth * Math.tan(this.hitYaw(rest));
    const reach = Math.min(1400, R.depth * 1.6 + 100);
    const c0 = Math.floor((camX - reach) / R.spacing), c1 = Math.floor((camX + reach) / R.spacing);
    for (let c = c0; c <= c1; c++) {
      const key = 'ridge' + ri + ':' + c;
      if (this.ambientCells.has(key)) { want.add(key); continue; }
      const x = c * R.spacing;
      // The pitch at the moment this stretch comes into view.
      const t = this.rig.timeAtTravel(x - ahead);
      if (t < 0.5 || t >= known) continue;
      const i = Math.min(env.values.length - 1, Math.round(t * env.rate));
      if (!mask[i]) continue;
      want.add(key);
      let r = hash32(c, ri, 777);
      const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 2246822507) >>> 0), (r & 0xffff) / 0x10000);
      const theme = this.themeAt(t);
      const models = R.models[theme] ?? Object.values(R.models)[0];
      const o = this.pools.acquire(models[Math.floor(rnd() * models.length)]);
      const items: Live[] = [];
      if (o) {
        const semis = env.values[i] - R.pitchCenter;
        o.x = x; o.z = -(R.depth + (rnd() - 0.5) * 3);
        o.sx = o.sz = 0.92 + rnd() * 0.16;
        if (R.float) { o.y = Math.max(0.5, R.float.y + semis * R.float.perSemitone); o.sy = 1; }
        else { o.y = 0; o.sy = THREE.MathUtils.clamp(1 + semis * (R.heightPerSemitone ?? 0.05), R.minScale ?? 0.3, R.maxScale ?? 2.5); }
        o.rotY = 0; o.grow = 1;
        const tints = R.tints?.[theme];
        if (tints) o.color.set(tints[Math.floor(rnd() * tints.length)]); else o.color.setRGB(1, 1, 1);
        this.pools.write(o);
        items.push({ obj: o, t, tier: 3, depth: R.depth, despawnAt: Infinity, layer: null, baseX: x, focusY: 0, measured: true });
      }
      this.ambientCells.set(key, items);
    }
  }

  /**
   * The angle an object must be at when its sound plays, for a gaze at `yaw`: the leading edge of
   * the view, so it comes into sight on the beat and everything behind it is history.
   */
  private hitYaw(yaw: number) {
    return Math.min(1.35, yaw + (this.rig.hitAngle?.() ?? 0));
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
    // Tier 1 follows the viewer's gaze, tier 2 half way, tier 3 the resting view.
    let yaw = THREE.MathUtils.degToRad(this.rig.spec.startYaw ?? 0);
    if (this.gazeSpawning) {
      const lead = Math.max(0, e.t - s);
      if (tier === 1) yaw = clampAbs(gaze.predictYaw(Math.min(lead, 1.5)), yawMax);
      else if (tier === 2) yaw = 0.5 * (yaw + clampAbs(gaze.predictYaw(Math.min(lead, 1.5)), yawMax));
    }
    this.rig.placeFor(e.t, depth, this.hitYaw(yaw), tmpV);
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
    // Entry timing: the front of the model (its -x end, the first to come into view) is what
    // arrives on the beat, so a long note streams in for as long as it lasts.
    const xOff = (this.rig.hitAngle?.() ?? 0) > 0 ? Math.max(0, -bb.min.x) * o.sx : 0;
    o.x += xOff;
    this.live.push({ obj: o, t: e.t, tier, depth, despawnAt: e.t + (xOff || this.rig.hitAngle?.() ? 2 * ls.lead + (2 * xOff) / Math.max(1, this.rig.speedAt(e.t)) : ls.lead) + 0.5, layer: ls, baseX: o.x, focusY, measured: false, xOff });
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
        const n = 7, carLen = 24.6, vx = -30, depth = se.breakdownDepth ?? 4.3;
        for (let i = 0; i < n; i++) {
          const o = this.pools.acquire(se.onBreakdown);
          if (!o) break;
          const base = xm + (i - (n - 1) / 2) * carLen;
          o.x = base; o.z = -depth; o.y = 0; o.sx = o.sy = o.sz = 1; o.vx = vx; o.t0 = tm; o.grow = 1;
          o.color.setRGB(1, 1, 1);
          this.live.push({ obj: o, t: tm, tier: 3, depth, despawnAt: tm + 8, layer: null, baseX: base, focusY: 2, measured: true });
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
    // The contour skyline: one model every few metres, as tall as the melody is high when you pass it.
    const C = this.pack.contour, contour = this.score.envelopes.contour;
    if (C && contour && contour.values.length) {
      const known = contour.values.length / contour.rate;
      const reach = Math.min(1400, C.depth * 1.6 + 100);
      const c0 = Math.floor((camX - reach) / C.spacing), c1 = Math.floor((camX + reach) / C.spacing);
      for (let c = c0; c <= c1; c++) {
        const key = 'contour:' + c;
        if (this.ambientCells.has(key)) { want.add(key); continue; }
        let r = hash32(c, 4321);
        const rnd = () => ((r = Math.imul(r ^ (r >>> 15), 2246822507) >>> 0), (r & 0xffff) / 0x10000);
        const x = c * C.spacing + (rnd() - 0.5) * C.spacing * 0.3;
        // Its height is the melody at the moment it comes into view (resting gaze).
        const rest = THREE.MathUtils.degToRad(this.rig.spec.startYaw ?? 0);
        const t = this.rig.timeAtTravel(x - C.depth * Math.tan(this.hitYaw(rest)));
        if (t < 0.5 || t >= known) continue; // only where the music is known
        want.add(key);
        const theme = this.themeAt(t);
        const models = C.models[theme] ?? Object.values(C.models)[0];
        const o = this.pools.acquire(models[Math.floor(rnd() * models.length)]);
        const items: Live[] = [];
        if (o) {
          const k = sampleEnvelope(contour, t), rise = sampleEnvelope(this.score.envelopes.rise, t);
          o.x = x; o.y = C.y ?? 0; o.z = -(C.depth + (rnd() - 0.5) * 4);
          o.sx = o.sz = 0.9 + rnd() * 0.2;
          o.sy = (C.minScale + (C.maxScale - C.minScale) * k) * (1 + (C.riseBoost ?? 0) * rise);
          o.rotY = 0; o.grow = 1;
          const tints = C.tints?.[theme];
          if (tints) o.color.set(tints[Math.floor(rnd() * tints.length)]); else o.color.setRGB(1, 1, 1);
          this.pools.write(o);
          items.push({ obj: o, t, tier: 3, depth: C.depth, despawnAt: Infinity, layer: null, baseX: x, focusY: 0, measured: true });
        }
        this.ambientCells.set(key, items);
      }
    }
    (this.pack.ridges ?? []).forEach((R, ri) => this.updateRidge(R, ri, camX, want));
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
