// Perform mode (spec section 9): a fixed cast on a round stage acts out the score. One troupe
// per stem; every move is a pure function of show time and the troupe's events, so scrubbing
// and pack switching just work. Pack 2 is an original homage to Michel Gondry's video for
// Daft Punk's "Around the World" (1997): original characters, no likenesses or helmets.

import * as THREE from 'three/webgpu';
import type { Pack, TroupeSpec, MappingRule } from '../packs/types';
import type { Score, ScoreEvent } from '../score/types';
import type { CameraRig } from './rig';
import type { GazeSource } from './spawner';
import type { CardInfo, ShowDriver } from './driver';
import { makeDanceFloorMaterial, U } from './shaders';

interface Ev { t: number; vel: number; pitch: number; role: string; idx: number; tier: 1 | 2 | 3 }

interface Pose {
  x: number; y: number; z: number; rotY: number; lean: number; sy: number;
  armL: number; armR: number; spread: number; legL: number; legR: number;
}

type PartName = 'torso' | 'head' | 'armL' | 'armR' | 'legL' | 'legR' | 'acc';

const tmpM = new THREE.Matrix4();
const base = new THREE.Matrix4();
const local = new THREE.Matrix4();
const rot = new THREE.Matrix4();
const v3 = new THREE.Vector3();

function impulse(s: number, t: number | undefined, vel: number, decay: number) {
  return t === undefined || t > s ? 0 : vel * Math.exp(-(s - t) / decay);
}
function smooth(x: number) { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); }

/** Body measurements per style. */
const BUILD: Record<TroupeSpec['style'], { torso: [number, number, number]; head: number; limb: number; arm: number; leg: number; boxHead: boolean }> = {
  stompers: { torso: [0.62, 0.78, 0.42], head: 0.2, limb: 0.17, arm: 0.66, leg: 0.88, boxHead: false },
  climbers: { torso: [0.44, 0.7, 0.26], head: 0.15, limb: 0.11, arm: 0.66, leg: 0.9, boxHead: false },
  walkers: { torso: [0.52, 0.62, 0.36], head: 0.19, limb: 0.12, arm: 0.6, leg: 0.86, boxHead: true },
  swimmers: { torso: [0.4, 0.68, 0.24], head: 0.15, limb: 0.1, arm: 0.7, leg: 0.92, boxHead: false },
  hoppers: { torso: [0.26, 0.66, 0.16], head: 0.15, limb: 0.06, arm: 0.66, leg: 0.92, boxHead: false },
};

class Troupe {
  readonly spec: TroupeSpec;
  readonly events: Ev[] = [];
  readonly meshes = new Map<PartName, THREE.InstancedMesh>();
  readonly poses: Pose[] = [];
  private ptr = 0;
  private sway = 0;
  readonly center = new THREE.Vector3();
  readonly stairs: { origin: THREE.Vector3; dir: THREE.Vector3; side: THREE.Vector3 } | null = null;

  constructor(spec: TroupeSpec, group: THREE.Group) {
    this.spec = spec;
    const b = BUILD[spec.style];
    const body = new THREE.MeshStandardMaterial({ color: spec.body, roughness: spec.style === 'walkers' ? 0.25 : 0.55, metalness: spec.style === 'walkers' ? 0.85 : 0.05 });
    const accent = new THREE.MeshStandardMaterial({ color: spec.accent, emissive: new THREE.Color(spec.accent).multiplyScalar(spec.style === 'walkers' ? 0.6 : 0.1) });
    const limb = (len: number) => new THREE.BoxGeometry(b.limb, len, b.limb).translate(0, -len / 2, 0);
    const geo: Record<PartName, THREE.BufferGeometry> = {
      torso: spec.style === 'swimmers' || spec.style === 'climbers' ? new THREE.CapsuleGeometry(b.torso[0] / 2, b.torso[1] - b.torso[0], 4, 8) : new THREE.BoxGeometry(...b.torso),
      head: b.boxHead ? new THREE.BoxGeometry(b.head * 1.9, b.head * 1.7, b.head * 1.7) : new THREE.SphereGeometry(b.head, 12, 8),
      armL: limb(b.arm), armR: limb(b.arm), legL: limb(b.leg), legR: limb(b.leg),
      acc: accessory(spec.style, b.head),
    };
    for (const k of Object.keys(geo) as PartName[]) {
      const m = new THREE.InstancedMesh(geo[k], k === 'acc' ? accent : body, spec.count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.meshes.set(k, m);
      group.add(m);
    }
    const a = THREE.MathUtils.degToRad(spec.at.angle);
    this.center.set(Math.sin(a) * spec.at.radius, 0, Math.cos(a) * spec.at.radius);
    for (let i = 0; i < spec.count; i++) this.poses.push({ x: 0, y: 0, z: 0, rotY: 0, lean: 0, sy: 1, armL: 0, armR: 0, spread: 0.08, legL: 0, legR: 0 });
    if (spec.style === 'climbers') {
      // Stairs lead up and away from the stage centre.
      const dir = this.center.clone().normalize();
      (this as any).stairs = { origin: this.center.clone().addScaledVector(dir, -1.6), dir, side: new THREE.Vector3(dir.z, 0, -dir.x) };
    }
  }

  add(e: Ev) { this.events.push(e); }

  reset(s: number) {
    let lo = 0, hi = this.events.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.events[m].t <= s) lo = m + 1; else hi = m; }
    this.ptr = lo;
  }

  /** Last event of a role at or before s (searching back a little), and the next one. */
  private lastOf(role: string | null, s: number, back = 64): Ev | undefined {
    for (let i = this.ptr - 1; i >= Math.max(0, this.ptr - back); i--) {
      const e = this.events[i];
      if (e.t <= s && (role === null || e.role === role)) return e;
    }
    return undefined;
  }
  private nextOf(role: string | null, s: number): Ev | undefined {
    for (let i = this.ptr; i < Math.min(this.events.length, this.ptr + 64); i++) {
      const e = this.events[i];
      if (e.t > s && (role === null || e.role === role)) return e;
    }
    return undefined;
  }

  update(s: number, dt: number, beat: number) {
    while (this.ptr < this.events.length && this.events[this.ptr].t <= s) this.ptr++;
    while (this.ptr > 0 && this.events[this.ptr - 1].t > s) this.ptr--;
    const sp = this.spec, N = sp.count;
    const a0 = THREE.MathUtils.degToRad(sp.at.angle);
    for (let i = 0; i < N; i++) {
      const p = this.poses[i];
      // Default: standing in an arc, facing out of the stage centre's opposite (towards the audience ring).
      const off = (i - (N - 1) / 2) * sp.at.spread;
      const ang = a0 + off / Math.max(1, sp.at.radius);
      p.x = Math.sin(ang) * sp.at.radius; p.z = Math.cos(ang) * sp.at.radius; p.y = 0.5;
      p.rotY = ang; p.lean = 0; p.sy = 1; p.armL = p.armR = 0; p.spread = 0.08; p.legL = p.legR = 0;
      const idle = 0.03 * Math.sin(s * 2.2 + i);
      p.sy += idle * 0.3;
    }
    switch (sp.style) {
      case 'stompers': this.stompers(s, dt); break;
      case 'climbers': this.climbers(s); break;
      case 'walkers': this.walkers(s); break;
      case 'swimmers': this.swimmers(s, beat); break;
      case 'hoppers': this.hoppers(s); break;
    }
    this.write();
  }

  /** Drums: stiff stomps on kicks, arms up on snares, sway side to side every kick. */
  private stompers(s: number, dt: number) {
    const k = this.lastOf('stomp', s), kn = this.nextOf('stomp', s), sn = this.lastOf('clap', s);
    const bounce = impulse(s, k?.t, k?.vel ?? 0, 0.11);
    const crouch = kn ? 0.5 * smooth(1 - (kn.t - s) / 0.09) : 0;
    const clap = impulse(s, sn?.t, sn?.vel ?? 0, 0.16);
    const target = k ? (k.idx % 2 ? 0.35 : -0.35) : 0;
    this.sway += (target - this.sway) * (1 - Math.exp(-dt * 18));
    this.poses.forEach((p, i) => {
      p.sy = 1 - 0.16 * bounce - 0.05 * crouch;
      p.legL = p.legR = 0;
      p.rotY += this.sway * (i % 2 ? 1 : -1) * 0.6;
      p.armL = -0.3 - 2.6 * clap + 0.4 * bounce;
      p.armR = -0.3 - 2.6 * clap + 0.4 * bounce;
      p.spread = 0.2 + 0.5 * clap;
      p.lean = 0.12 * bounce;
    });
  }

  /** Bass: the climbers stand on the step that matches the bass note, moving on each note. */
  private climbers(s: number) {
    const st = this.stairs!;
    const e = this.lastOf(null, s), prev = e ? this.events[Math.max(0, e.idx - 1)] : undefined;
    const step = (pitch: number) => Math.round(THREE.MathUtils.clamp((pitch - 28) / 26, 0, 1) * 8);
    const s1 = e ? step(e.pitch) : 0;
    const s0 = prev && prev !== e ? step(prev.pitch) : s1;
    const u = e ? smooth((s - e.t) / 0.14) : 1;
    const level = s0 + (s1 - s0) * u;
    const hop = e ? Math.sin(Math.PI * Math.min(1, (s - e.t) / 0.14)) * 0.18 * (e.vel + 0.3) : 0;
    this.poses.forEach((p, i) => {
      const lateral = (i - (this.spec.count - 1) / 2) * 0.95;
      v3.copy(st.origin).addScaledVector(st.dir, level * 0.5 + 0.25).addScaledVector(st.side, lateral);
      p.x = v3.x; p.z = v3.z; p.y = 0.5 + (level + 1) * 0.34 + hop;
      p.rotY = Math.atan2(st.dir.x, st.dir.z) + Math.PI; // face down the stairs, towards the stage
      const stride = e ? Math.sin(Math.PI * u) * ((e.idx % 2) ? 1 : -1) : 0;
      p.legL = 0.7 * stride; p.legR = -0.7 * stride;
      p.armL = -0.6 * stride; p.armR = 0.6 * stride;
    });
  }

  /** Lead: the walkers circle the stage, one step per note, arms raised by pitch. */
  private walkers(s: number) {
    const e = this.lastOf(null, s);
    const n = e ? e.idx + 1 : 0;
    const u = e ? smooth((s - e.t) / 0.16) : 1;
    const r = this.spec.at.radius;
    const stepAng = 0.55 / r;
    const prog = (n - 1 + u) * stepAng;
    const raise = e ? THREE.MathUtils.clamp((e.pitch - 60) / 18, -0.6, 1.4) : 0;
    this.poses.forEach((p, i) => {
      const ang = THREE.MathUtils.degToRad(this.spec.at.angle) + prog + (i * 2 * Math.PI) / this.spec.count;
      p.x = Math.sin(ang) * r; p.z = Math.cos(ang) * r;
      p.rotY = ang + Math.PI / 2;
      const stride = e ? Math.sin(Math.PI * u) * (e.idx % 2 ? 1 : -1) : 0;
      p.legL = 0.5 * stride; p.legR = -0.5 * stride;
      p.armL = -0.3 - 1.3 * raise * (i % 2 ? 1 : 0.6);
      p.armR = -0.3 - 1.3 * raise * (i % 2 ? 0.6 : 1);
      p.y = 0.5 + 0.04 * Math.abs(stride);
    });
  }

  /** Pads: swimmers windmill their arms in a wave; each chord lifts them. */
  private swimmers(s: number, beat: number) {
    const e = this.lastOf(null, s);
    const lift = impulse(s, e?.t, e?.vel ?? 0, 0.9);
    const root = e ? (e.pitch % 12) / 12 : 0;
    this.poses.forEach((p, i) => {
      const ph = (s / (beat * 4)) * Math.PI * 2 + i * 0.7;
      p.armL = ph; p.armR = ph + Math.PI;
      p.lean = 0.35 + 0.2 * lift;
      p.y = 0.5 + 0.25 * lift;
      p.rotY += (root - 0.5) * 0.6;
      p.legL = 0.15 * Math.sin(ph * 2); p.legR = -p.legL;
    });
  }

  /** Hats: each hit makes the next dancer in line hop, so the hats ripple along the row. */
  private hoppers(s: number) {
    const N = this.spec.count;
    this.poses.forEach((p, i) => {
      // Most recent hit that belonged to this dancer.
      let e: Ev | undefined;
      for (let k = this.ptr - 1; k >= Math.max(0, this.ptr - N * 3); k--) {
        if (this.events[k].idx % N === i) { e = this.events[k]; break; }
      }
      const u = e ? (s - e.t) / 0.2 : 1;
      const hop = u < 1 ? Math.sin(Math.PI * u) * (0.2 + 0.25 * (e?.vel ?? 0)) : 0;
      p.y = 0.5 + hop;
      p.legL = hop * 2; p.legR = -hop * 1.2;
      p.armL = -hop * 4; p.armR = hop * 2;
      p.spread = 0.2 + hop;
    });
  }

  private write() {
    const b = BUILD[this.spec.style];
    const hipY = b.leg, shoulderY = b.leg + b.torso[1] - 0.06, headY = b.leg + b.torso[1] + b.head * 0.95;
    const set = (k: PartName, i: number, m: THREE.Matrix4) => this.meshes.get(k)!.setMatrixAt(i, m);
    this.poses.forEach((p, i) => {
      base.makeRotationY(p.rotY).premultiply(local.makeTranslation(p.x, p.y, p.z));
      base.multiply(rot.makeRotationX(p.lean)).multiply(local.makeScale(1, p.sy, 1));
      set('torso', i, tmpM.copy(base).multiply(local.makeTranslation(0, hipY + b.torso[1] / 2, 0)));
      set('head', i, tmpM.copy(base).multiply(local.makeTranslation(0, headY, 0)));
      set('acc', i, tmpM.copy(base).multiply(local.makeTranslation(0, headY, 0)));
      const sx = b.torso[0] / 2 + b.limb / 2;
      set('armL', i, tmpM.copy(base).multiply(local.makeTranslation(-sx, shoulderY, 0)).multiply(rot.makeRotationZ(-p.spread)).multiply(local.makeRotationX(p.armL)));
      set('armR', i, tmpM.copy(base).multiply(local.makeTranslation(sx, shoulderY, 0)).multiply(rot.makeRotationZ(p.spread)).multiply(local.makeRotationX(p.armR)));
      set('legL', i, tmpM.copy(base).multiply(local.makeTranslation(-0.11, hipY, 0)).multiply(rot.makeRotationX(p.legL)));
      set('legR', i, tmpM.copy(base).multiply(local.makeTranslation(0.11, hipY, 0)).multiply(rot.makeRotationX(p.legR)));
    });
    for (const m of this.meshes.values()) m.instanceMatrix.needsUpdate = true;
  }
}

function accessory(style: TroupeSpec['style'], head: number): THREE.BufferGeometry {
  switch (style) {
    case 'walkers': { // two round lamp eyes and an antenna: a tin-toy robot
      const g1 = new THREE.SphereGeometry(head * 0.28, 8, 6).translate(-head * 0.42, 0.02, head * 0.86);
      const g2 = new THREE.SphereGeometry(head * 0.28, 8, 6).translate(head * 0.42, 0.02, head * 0.86);
      const g3 = new THREE.CylinderGeometry(0.015, 0.015, 0.3, 5).translate(0, head + 0.15, 0);
      const g4 = new THREE.SphereGeometry(0.05, 8, 6).translate(0, head + 0.32, 0);
      return mergeAll([g1, g2, g3, g4]);
    }
    case 'swimmers': return new THREE.SphereGeometry(head * 1.08, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.01, 0);
    case 'climbers': return new THREE.TorusGeometry(head * 1.0, 0.03, 6, 16).rotateX(Math.PI / 2).translate(0, head * 0.35, 0);
    case 'stompers': return mergeAll([0, 1, 2].map(k => new THREE.TorusGeometry(head * 1.02, 0.025, 4, 14).rotateX(Math.PI / 2 + 0.2 * (k - 1)).translate(0, (k - 1) * 0.08, 0)));
    case 'hoppers': return new THREE.BoxGeometry(head * 1.2, head * 0.5, 0.02).translate(0, 0, head * 0.98);
  }
}

function mergeAll(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const parts = gs.map(g => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; });
  const count = parts.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    o += g.getAttribute('position').count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return out;
}

export class Performer implements ShowDriver {
  readonly group = new THREE.Group();
  metric = { hits: 0, total: 0, recent: [] as boolean[], byLayer: {} as Record<string, [number, number]> };
  steering = true;
  gazeSpawning = true;
  private troupes: Troupe[] = [];
  private byId = new Map<string, Troupe>();
  private consumed = 0;
  private ringMat: THREE.MeshStandardMaterial;
  private glowMat: THREE.MeshStandardMaterial;
  private screenCanvas = document.createElement('canvas');
  private screenTex: THREE.CanvasTexture;
  private probe: THREE.PerspectiveCamera;
  private lastS = -Infinity;
  private kickPtr = 0;
  private kicks: number[] = [];
  private ringColors: THREE.Color[];

  constructor(private pack: Pack, private rig: CameraRig, private score: Score, private camera: THREE.PerspectiveCamera) {
    this.probe = camera.clone();
    const st = pack.stage ?? { floor: '#2a2730', ring: ['#ff5ea8', '#5ee0ff', '#ffd25e'], screen: '#15131c' };
    this.ringColors = st.ring.map(c => new THREE.Color(c));
    // The stage: a white disc with a light ring, a glowing centre, stairs for the climbers.
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(11, 11.4, 0.5, 64), new THREE.MeshStandardMaterial({ color: 0x2a2630, roughness: 0.4 }));
    disc.position.y = 0.25;
    disc.receiveShadow = true;
    this.group.add(disc);
    // Polished floor with tiles that light up on the beat.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(10.95, 64).rotateX(-Math.PI / 2), makeDanceFloorMaterial());
    floor.position.y = 0.505;
    floor.receiveShadow = true;
    this.group.add(floor);
    this.buildRig();
    this.ringMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: this.ringColors[0].clone() });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(11.2, 0.12, 8, 96).rotateX(Math.PI / 2), this.ringMat);
    ring.position.y = 0.5;
    this.group.add(ring);
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(0xffffff) });
    const glow = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.06, 6, 48).rotateX(-Math.PI / 2), this.glowMat);
    glow.position.y = 0.53;
    this.group.add(glow);
    for (const ts of pack.troupes ?? []) {
      const t = new Troupe(ts, this.group);
      this.troupes.push(t);
      this.byId.set(ts.id, t);
      if (t.stairs) {
        const sm = new THREE.MeshStandardMaterial({ color: 0x24212c, roughness: 0.3, metalness: 0.3 });
        const edgeMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: new THREE.Color(ts.accent).multiplyScalar(1.5) });
        for (let k = 0; k < 9; k++) {
          const g = new THREE.BoxGeometry(ts.count * 0.95 + 0.8, 0.34 * (k + 1), 0.5);
          const m = new THREE.Mesh(g, sm);
          v3.copy(t.stairs.origin).addScaledVector(t.stairs.dir, k * 0.5 + 0.25);
          m.position.set(v3.x, 0.5 + (0.34 * (k + 1)) / 2, v3.z);
          m.rotation.y = Math.atan2(t.stairs.dir.x, t.stairs.dir.z);
          m.castShadow = m.receiveShadow = true;
          // A glowing nosing on each tread, lit up as the bass climbs.
          const edge = new THREE.Mesh(new THREE.BoxGeometry(ts.count * 0.95 + 0.8, 0.04, 0.05), edgeMat);
          v3.copy(t.stairs.origin).addScaledVector(t.stairs.dir, k * 0.5);
          edge.position.set(v3.x, 0.5 + 0.34 * (k + 1) + 0.02, v3.z);
          edge.rotation.y = m.rotation.y;
          this.group.add(m, edge);
        }
      }
    }
    // Four-sided screen hanging over the centre: title, then the track, then the credits.
    this.screenCanvas.width = 1024; this.screenCanvas.height = 512;
    this.screenTex = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false, fog: false });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1a1820 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6), [scr, scr, dark, dark, scr, scr]);
    box.position.y = 8.4;
    this.group.add(box);
    this.drawScreen({ name: 'Gondryator', line2: '' }, st.screen);
  }

  get activeCount() { return this.troupes.reduce((a, t) => a + t.spec.count, 0); }

  themeAt(t: number) { return this.pack.themeCycle[0] ?? 'stage'; void t; }
  refreshLeads() { this.probe.fov = this.camera.fov; this.probe.aspect = this.camera.aspect; this.probe.updateProjectionMatrix(); }

  card(kind: 'landing' | 'title' | 'end', info: CardInfo) {
    this.drawScreen(info, this.pack.stage?.screen ?? '#15131c', kind === 'end');
    return true;
  }

  private drawScreen(info: CardInfo, bg: string, small = false) {
    const c = this.screenCanvas, g = c.getContext('2d')!;
    g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#ffffff22'; g.lineWidth = 2;
    for (let y = 0; y < c.height; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
    g.fillStyle = '#f4f0ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const fit = (t: string, size: number, y: number, weight = '700') => {
      let s = size;
      do { g.font = `${weight} ${s}px "Helvetica Neue", Arial, sans-serif`; s -= 4; } while (g.measureText(t).width > c.width - 80 && s > 16);
      g.fillText(t, c.width / 2, y);
    };
    fit(info.name.toUpperCase(), small ? 80 : 120, small ? 120 : 210);
    if (info.line2) fit(info.line2, small ? 44 : 56, small ? 220 : 340, '400');
    if (info.line3) {
      g.font = 'italic 30px Georgia, serif';
      const words = info.line3.split(' ');
      let line = '', y = 320;
      for (const w of words) { if (g.measureText(line + w).width > c.width - 120) { g.fillText(line.trim(), c.width / 2, y); y += 40; line = ''; } line += w + ' '; }
      g.fillText(line.trim(), c.width / 2, y);
    }
    this.screenTex.needsUpdate = true;
  }

  private ingest() {
    const ev = this.score.events;
    for (; this.consumed < ev.length; this.consumed++) {
      const e = ev[this.consumed];
      if (e.kind === 'kick') this.kicks.push(e.t);
      const rule = this.ruleFor(e);
      if (!rule) continue;
      const tr = this.byId.get(rule.layer);
      if (!tr) continue;
      tr.add({ t: e.t, vel: e.vel, pitch: e.pitch ?? 60, role: rule.role ?? 'move', idx: tr.events.length, tier: rule.tier });
    }
  }

  private ruleFor(e: ScoreEvent): MappingRule | null {
    for (const r of this.pack.mapping) {
      const m = r.match;
      if (m.stem && m.stem !== e.stem) continue;
      if (m.kind && m.kind !== e.kind) continue;
      if (m.minDur !== undefined && e.dur < m.minDur) continue;
      if (m.maxDur !== undefined && e.dur > m.maxDur) continue;
      return r;
    }
    return null;
  }

  reset(s: number) {
    for (const t of this.troupes) t.reset(s);
    let lo = 0, hi = this.kicks.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.kicks[m] <= s) lo = m + 1; else hi = m; }
    this.kickPtr = lo;
    this.lastS = s;
  }

  update(s: number, dt: number, _gaze: GazeSource, frontier: number, running: boolean) {
    this.ingest();
    const tempo = this.score.tempo;
    const beat = tempo.length ? 60 / tempo[tempo.length - 1].bpm : 0.5;
    // Only perform what the score has committed; idle otherwise.
    const sp = running ? Math.min(s, frontier) : -1;
    for (const t of this.troupes) t.update(sp, dt, beat);
    // Stage light: section colour on the ring, the centre flashes on kicks.
    while (this.kickPtr < this.kicks.length && this.kicks[this.kickPtr] <= sp) this.kickPtr++;
    const lastKick = this.kickPtr > 0 ? this.kicks[this.kickPtr - 1] : -10;
    const flash = Math.exp(-(sp - lastKick) / 0.12);
    this.glowMat.emissive.setRGB(0.15 + flash, 0.12 + flash * 0.9, 0.2 + flash);
    let secIdx = 0;
    for (let i = 0; i < this.score.sections.length; i++) if (this.score.sections[i].t <= sp) secIdx = i;
    this.ringMat.emissive.lerp(this.ringColors[secIdx % this.ringColors.length], 1 - Math.exp(-dt * 3));
    this.animateRig(sp, dt, flash, secIdx);
    if (running) this.measure(s);
    this.lastS = s;
  }

  private beams: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; spot: THREE.SpotLight | null; base: number; color: THREE.Color }[] = [];
  private ball!: THREE.Mesh;
  private beamSpin = 0;

  /** Lighting rig: a mirror ball over the stage and coloured beams from a ring of moving heads. */
  private buildRig() {
    const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08, flatShading: true });
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 3), ballMat);
    this.ball.position.set(0, 12.6, 0);
    this.group.add(this.ball);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 6, 4), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    cord.position.set(0, 16.6, 0);
    this.group.add(cord);
    const N = 8;
    const headMat = new THREE.MeshStandardMaterial({ color: 0x16151a, metalness: 0.6, roughness: 0.4 });
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const col = this.ringColors[i % this.ringColors.length].clone();
      // A soft additive cone, apex at the lamp, pointing down at the stage.
      const len = 16;
      const geo = new THREE.ConeGeometry(1.1, len, 24, 1, true).translate(0, -len / 2, 0);
      const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(Math.sin(a) * 13, 14, Math.cos(a) * 13);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), headMat);
      head.position.copy(mesh.position).setY(14.3);
      this.group.add(head, mesh);
      // Every other beam really lights the stage (no shadows: cheap).
      let spot: THREE.SpotLight | null = null;
      if (i % 2 === 0) {
        spot = new THREE.SpotLight(col, 260, 40, 0.22, 0.6, 1.6);
        spot.position.copy(mesh.position);
        this.group.add(spot, spot.target);
      }
      this.beams.push({ mesh, mat, spot, base: a, color: col });
    }
  }

  private animateRig(s: number, dt: number, flash: number, secIdx: number) {
    this.ball.rotation.y += dt * 0.4;
    this.beamSpin += dt * (0.25 + 1.5 * U.kick.value);
    const tmp = new THREE.Vector3();
    this.beams.forEach((b, i) => {
      // Each beam sweeps a figure-eight over the stage; the pattern changes per section.
      const ph = this.beamSpin * (i % 2 ? 1 : -1) + b.base;
      const mode = secIdx % 3;
      const r = mode === 0 ? 4 + 3 * Math.sin(ph * 0.7) : mode === 1 ? 7 * Math.abs(Math.sin(ph * 0.5)) : 2.5;
      tmp.set(Math.sin(ph) * r, 0.5, Math.cos(ph * (mode === 2 ? 1 : 1.3)) * r);
      b.mesh.lookAt(tmp);
      b.mesh.rotateX(-Math.PI / 2);
      b.mat.opacity = 0.02 + 0.07 * flash + 0.025 * U.energy.value;
      const c = this.ringColors[(i + secIdx) % this.ringColors.length];
      b.mat.color.lerp(c, 1 - Math.exp(-dt * 2));
      if (b.spot) { b.spot.target.position.copy(tmp); b.spot.color.copy(b.mat.color); b.spot.intensity = 70 + 220 * flash; }
    });
    void s;
  }

  /** Section-7 metric for perform mode: is the troupe acting a top-tier event in the central third? */
  private measure(s: number) {
    for (const t of this.troupes) {
      for (let i = t.events.length - 1; i >= 0; i--) {
        const e = t.events[i];
        if (e.t <= this.lastS) break;
        if (e.t > s || e.tier !== 1 || s - e.t > 0.25) continue;
        this.probe.quaternion.copy(this.camera.getWorldQuaternion(new THREE.Quaternion()));
        this.probe.position.copy(this.camera.getWorldPosition(new THREE.Vector3()));
        this.probe.updateMatrixWorld(true);
        // The whole troupe acts each event together, so it counts if any of them is in the centre.
        const hit = t.poses.some(p => {
          v3.set(p.x, p.y + 1.2, p.z).project(this.probe);
          return Math.abs(v3.x) <= 1 / 3 && Math.abs(v3.y) <= 1 && v3.z < 1;
        });
        this.metric.total++; if (hit) this.metric.hits++;
        const bl = (this.metric.byLayer[t.spec.id] ??= [0, 0]); bl[1]++; if (hit) bl[0]++;
        this.metric.recent.push(hit); if (this.metric.recent.length > 64) this.metric.recent.shift();
      }
    }
  }
}
