// The static world around the spawned objects: renderer, sky, light over the day, themed
// ground, the neighbouring track and its wires, the carriage interior with its windows,
// and the station boards used for the title block and the end card.

import * as THREE from 'three/webgpu';
import type { Pack } from '../packs/types';
import type { CameraRig } from './rig';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { makeGroundMaterial, makeWindowGlassMaterial, makeGrassMaterial, makeShipSkyMaterial, makeCanopyMaterial, makeConsoleMaterial, U as SU } from './shaders';
import { makePipeline, FX_UNIFORMS } from './fx';
import { FLAGS } from './flags';
import { perf } from '../ui/frames';

export interface StationInfo { name: string; line2: string; line3?: string; art?: HTMLImageElement | null }

const TILE = 300;
const tmpPos = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const ZAX = new THREE.Vector3(0, 0, 1);
const FLASH = new THREE.Color(0xd8d0ff);

export class World {
  renderer!: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Moves with the train (camera + carriage), never rotates. */
  readonly train = new THREE.Group();
  readonly head = new THREE.Group();
  backend = 'unknown';
  private sky!: THREE.Mesh;
  private skyColors!: THREE.BufferAttribute;
  private sunDisc!: THREE.Mesh;
  /** Physical sky (Rayleigh/Mie scattering with clouds) for outdoor packs. */
  private phys: SkyMesh | null = null;
  private envSky: SkyMesh | null = null;
  private envScene = new THREE.Scene();
  private pmrem: THREE.PMREMGenerator | null = null;
  private envRT: THREE.RenderTarget | null = null;
  private lastEnvU = -1;
  private pipeline: THREE.RenderPipeline | null = null;
  private pipelineFailed = false;
  /** Night factor 0..1 from the light keyframes (lit windows). */
  night = 0;
  private hemi = new THREE.HemisphereLight(0xdfe8f0, 0xa89f80, 1.1);
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private fog = new THREE.FogExp2(0xdddddd, 0.0015);
  private tiles: { mesh: THREE.Mesh; index: number }[] = [];
  private groundMats = new Map<string, THREE.Material>();
  private ballast!: THREE.Mesh;
  private ballastTex!: THREE.Texture;
  private followers: THREE.Object3D[] = [];
  private lastLightU = -1;
  readonly stations = new THREE.Group();
  themeForX: (x: number) => string = () => 'industrial';

  /** 'train': ground tiles, track and carriage; 'stage': an open floor for a set built by the show. */
  readonly mode: 'train' | 'stage';
  /** The starship: space all round, no ground, an open canopy instead of a carriage. */
  readonly ship: boolean;
  /** Nothing at all: the visualiser draws the whole world. */
  readonly void: boolean;
  /** A little open fairground cart on a track that rises and falls (rig.coaster). */
  readonly cart: boolean;
  private shipSky: THREE.Mesh | null = null;

  constructor(private pack: Pack) {
    this.mode = pack.rig.type === 'lateral-rail' ? 'train' : 'stage';
    this.ship = pack.vehicle === 'ship';
    this.void = pack.vehicle === 'void';
    this.cart = pack.vehicle === 'cart';
    this.camera = new THREE.PerspectiveCamera(pack.rig.fov, 16 / 9, 0.05, 4000);
    this.baseFov = pack.rig.fov;
    this.camera.rotation.order = 'YXZ';
  }

  async init(canvas: HTMLCanvasElement, forceWebGL: boolean, renderer?: THREE.WebGPURenderer) {
    this.renderer = renderer ?? new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL, powerPreference: 'high-performance' } as any);
    if (!renderer) await this.renderer.init();
    this.backend = (this.renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
    this.renderer.setPixelRatio(this.pixelRatio = Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.mode === 'train' ? 0.72 : 0.95;
    this.renderer.shadowMap.enabled = FLAGS.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    const sc = this.scene;
    sc.fog = this.fog;
    sc.background = new THREE.Color(0xcccccc);
    this.buildSky();
    sc.add(this.hemi, this.sun, this.sun.target);
    // Sun shadows in a box that follows the camera.
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc2 = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc2.left = -70; sc2.right = 70; sc2.top = 70; sc2.bottom = -70; sc2.near = 1; sc2.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    if (this.mode === 'train' && FLAGS.physSky && !this.ship && !this.cart) {
      this.phys = new SkyMesh();
      this.phys.scale.setScalar(6000);
      this.phys.frustumCulled = false;
      this.phys.cloudCoverage.value = 0.35 + 0.25 * (this.pack.haze ?? 0);
      this.phys.cloudDensity.value = 0.5;
      this.phys.cloudScale.value = 0.00025;
      (this.phys.material as any).fog = false;
      sc.add(this.phys);
      this.sky.visible = false;
      this.sunDisc.visible = false;
      this.envSky = new SkyMesh();
      this.envSky.scale.setScalar(100);
      this.envSky.showSunDisc.value = 0;
      this.envScene.add(this.envSky);
    }
    if (this.mode === 'train') {
      // The ground (fields, a river or a road), then what only a railway has: grass, rails, wires.
      if (this.ship) {
        this.shipSky = new THREE.Mesh(new THREE.SphereGeometry(3000, 64, 32), makeShipSkyMaterial());
        this.shipSky.renderOrder = -10;
        this.shipSky.frustumCulled = false;
        sc.add(this.shipSky);
        this.sky.visible = false;
        sc.background = new THREE.Color(0x000000);
        this.buildCockpit();
      } else if (this.cart) {
        this.buildGround();
        this.buildGrass();
        this.buildCoaster();
        this.buildCart();
      } else {
        this.buildGround();
        this.buildGrass();
        this.buildTrack();
        this.buildCabin();
      }
    } else if (this.void) {
      sc.background = new THREE.Color(0x000000);
      this.sky.visible = false;
      this.sunDisc.visible = false;
    } else {
      const floor = new THREE.Mesh(new THREE.CircleGeometry(3500, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: new THREE.Color(this.pack.stage?.floor ?? 0x2a2730).multiplyScalar(0.3), roughness: 0.95, metalness: 0, envMapIntensity: 0.1 }));
      floor.receiveShadow = true;
      sc.add(floor);
      // A studio environment for reflections on the stage.
      try { this.envRT = this.pmrem!.fromScene(new RoomEnvironment(), 0.04); sc.environment = this.envRT.texture; sc.environmentIntensity = 0.35; } catch { /* no reflections */ }
      this.sunDisc.visible = false; // a stage under lights: no sun in the sky
    }
    // The head sits at eye height; the camera turns inside it (a headset drives it directly).
    this.head.position.set(0, this.pack.rig.eyeHeight, 0);
    this.head.add(this.camera);
    this.train.add(this.head);
    sc.add(this.train, this.stations);
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep a sensible horizontal view on portrait screens.
    const minHFov = 60;
    const vf = this.pack.rig.fov;
    const hf = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(vf / 2)) * this.camera.aspect));
    this.camera.fov = this.baseFov = hf < minHFov ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(minHFov / 2)) / this.camera.aspect)) : vf;
    this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ sky and light
  private buildSky() {
    const g = new THREE.SphereGeometry(3000, 32, 16);
    this.skyColors = new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3), 3);
    g.setAttribute('color', this.skyColors);
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(g, m);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(55, 16, 8), new THREE.MeshBasicMaterial({ color: 0xfff2d0, fog: false }));
    this.sunDisc.frustumCulled = false;
    this.scene.add(this.sunDisc);
  }

  /** u = position through the track, 0..1: morning to evening. */
  setTimeOfDay(u: number) {
    if (Math.abs(u - this.lastLightU) < 0.001) return;
    this.lastLightU = u;
    const L = this.pack.light;
    let i = 0;
    while (i + 1 < L.length && L[i + 1].at <= u) i++;
    const a = L[i], b = L[Math.min(L.length - 1, i + 1)];
    const f = b.at > a.at ? THREE.MathUtils.clamp((u - a.at) / (b.at - a.at), 0, 1) : 0;
    const col = (x: string, y: string) => new THREE.Color(x).lerp(new THREE.Color(y), f);
    const sky = col(a.sky, b.sky), hor = col(a.horizon, b.horizon), sunC = col(a.sun, b.sun);
    const elev = THREE.MathUtils.degToRad(a.sunElevation + (b.sunElevation - a.sunElevation) * f);
    const inten = a.sunIntensity + (b.sunIntensity - a.sunIntensity) * f;
    const fogA = a.fog ?? 0.0014, fogB = b.fog ?? fogA;
    this.fog.density = fogA + (fogB - fogA) * f;
    this.fog.color.copy(hor);
    this.baseFog.copy(hor);
    if (!this.ship) (this.scene.background as THREE.Color).copy(hor);

    // Sun moves from the right (ahead) in the morning, over, to behind in the evening.
    const az = THREE.MathUtils.degToRad(-60 + 140 * u);
    // The sun stays on the train's side of the line, so the scenery faces it (soft, front-lit).
    // Outdoors the sun rakes in from the side (long shadows, modelled forms); still never from behind the scenery.
    const side = this.mode === 'train' ? 0.35 : 0.8;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), (Math.cos(az) * side + 0.15) * Math.cos(elev)).normalize();
    this.sun.position.copy(dir).multiplyScalar(100);
    this.sunDir.copy(dir);
    this.night = THREE.MathUtils.clamp((12 - (a.sunElevation + (b.sunElevation - a.sunElevation) * f)) / 12, 0, 1);
    if (this.phys) {
      // Physical sky: the sun's height sets the colour; haze thickens towards evening.
      const sp = dir.clone();
      for (const k of [this.phys, this.envSky!]) {
        k.sunPosition.value.copy(sp);
        const hz = this.pack.haze ?? 0;
        k.turbidity.value = 2.5 + 6 * u + 6 * hz;
        k.rayleigh.value = (1.2 + 1.8 * u) * (1 - 0.55 * hz);
        k.mieCoefficient.value = 0.004 + 0.004 * u + 0.006 * hz;
        k.mieDirectionalG.value = 0.82;
      }
      if (FLAGS.env && (Math.abs(u - this.lastEnvU) > 0.04 || this.lastEnvU < 0)) {
        this.lastEnvU = u;
        try {
          // Re-bake into the same target: a new texture would make every material rebuild its shader.
          const reuse = this.envRT && this.lastEnvU >= 0 && this.scene.environment === this.envRT.texture ? this.envRT : null;
          this.envRT = this.pmrem!.fromScene(this.envScene, 0.02, 0.1, 100, { renderTarget: reuse } as any);
          if (this.scene.environment !== this.envRT.texture) this.scene.environment = this.envRT.texture;
          perf.mark('sky reflections re-baked');
          this.scene.environmentIntensity = 0.5;
        } catch { /* reflections stay as they were */ }
      }
    }
    this.sun.color.copy(sunC);
    this.sun.intensity = inten * 1.35;
    this.hemi.color.copy(sky).lerp(new THREE.Color(0xffffff), 0.35);
    this.hemi.groundColor.set(0xa89f80).lerp(sunC, 0.15);
    this.hemi.intensity = this.ship ? 0.45 : this.cart ? 0.75 : this.phys ? 0.3 + 0.2 * (inten / 2.3) : 1.3 + 0.4 * (inten / 2.3);
    this.baseHemi = this.hemi.intensity;
    (this.sunDisc.material as THREE.MeshBasicMaterial).color.copy(sunC).lerp(new THREE.Color(0xffffff), 0.5);
    this.sunDisc.userData.dir = dir;

    const pos = this.sky.geometry.getAttribute('position');
    const tmp = new THREE.Color();
    const sunTint = sunC.clone();
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
      const e = y / 3000;
      tmp.copy(hor).lerp(sky, Math.pow(Math.max(0, e), 0.55));
      // Glow around the sun.
      const d = (x * dir.x + y * dir.y + z * dir.z) / 3000;
      if (d > 0.6) tmp.lerp(sunTint, Math.pow((d - 0.6) / 0.4, 3) * 0.6);
      if (e < 0) tmp.copy(hor).multiplyScalar(0.92);
      this.skyColors.setXYZ(k, tmp.r, tmp.g, tmp.b);
    }
    this.skyColors.needsUpdate = true;
  }

  // ------------------------------------------------------------------ ground
  private groundTexture(theme: Pack['themes'][number]): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 1024;
    const g = c.getContext('2d')!;
    g.fillStyle = theme.ground.base;
    g.fillRect(0, 0, c.width, c.height);
    let seed = theme.name.length * 977;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Field patches: rows of rectangles of varying size (x = along track, y = depth).
    let y = 0;
    while (y < c.height) {
      const h = 20 + rnd() * 90;
      let x = 0;
      while (x < c.width) {
        const w = 40 + rnd() * 160;
        g.fillStyle = theme.ground.stripes[Math.floor(rnd() * theme.ground.stripes.length)];
        g.fillRect(x, y, w - 1, h - 1);
        if (theme.ground.rows && rnd() < 0.5) {
          g.strokeStyle = 'rgba(60,70,30,0.35)';
          g.lineWidth = 1;
          for (let k = x + 3; k < x + w - 2; k += 4) { g.beginPath(); g.moveTo(k, y + 1); g.lineTo(k, y + h - 2); g.stroke(); }
        }
        x += w;
      }
      y += h;
    }
    // Soft noise.
    const img = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * 14;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 3);
    return t;
  }

  private buildGround() {
    for (const th of this.pack.themes) {
      this.groundMats.set(th.name, FLAGS.procedural ? makeGroundMaterial(this.groundTexture(th)) : new THREE.MeshStandardMaterial({ map: this.groundTexture(th) }));
    }
    // Both sides of the line: the main view (-z) and the other window (+z).
    const geo = new THREE.PlaneGeometry(TILE, 5200);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, 40);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(geo, this.groundMats.values().next().value!);
      m.renderOrder = -5;
      m.receiveShadow = true;
      this.tiles.push({ mesh: m, index: -999 });
      this.scene.add(m);
    }
  }

  /** Grass tufts beside the line in tiles of 60 m that leapfrog as the train moves. */
  private grassTiles: THREE.InstancedMesh[] = [];
  private buildGrass() {
    const card = (rot: number) => new THREE.PlaneGeometry(0.9, 0.5, 1, 1).translate(0, 0.25, 0).rotateY(rot);
    const geo = mergeGeometries([card(0), card(Math.PI / 3), card(-Math.PI / 3)], false)!;
    const mat = makeGrassMaterial(this.cart ? 0.4 : 1);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    for (let t = 0; t < 3; t++) {
      const N = 1400;
      const mesh = new THREE.InstancedMesh(geo, mat, N);
      let seed = 1234 + t * 77;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < N; i++) {
        // Denser near the line, thinning out into the field; a gap for the neighbouring track.
        const z = -(5.9 + Math.pow(rnd(), 1.6) * 16);
        p.set(rnd() * 60, 0, z);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
        const s0 = 0.6 + rnd() * 0.9;
        sc.set(s0, s0 * (0.7 + rnd() * 0.8), s0);
        mesh.setMatrixAt(i, m4.compose(p, q, sc));
      }
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.userData.tile = -999;
      this.grassTiles.push(mesh);
      this.scene.add(mesh);
    }
  }

  private buildTrack() {
    // Ballast + sleepers of the neighbouring track, scrolled by texture offset.
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#7d766c'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(${90 + Math.random() * 60},${85 + Math.random() * 50},${80 + Math.random() * 40},0.8)`; g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
    g.fillStyle = '#5a4c3e'; g.fillRect(22, 4, 20, 56);
    this.ballastTex = new THREE.CanvasTexture(c);
    this.ballastTex.colorSpace = THREE.SRGBColorSpace;
    this.ballastTex.wrapS = this.ballastTex.wrapT = THREE.RepeatWrapping;
    this.ballastTex.repeat.set(800 / 0.65, 1);
    this.ballast = new THREE.Mesh(new THREE.PlaneGeometry(800, 3.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: this.ballastTex }));
    this.ballast.position.set(0, 0.06, -4.3);
    this.scene.add(this.ballast);
    // Our own track bed under the carriage, mostly hidden.
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(800, 4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6e675d }));
    bed.position.set(0, 0.05, 0);
    this.scene.add(bed);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb8b9bb, metalness: 0.9, roughness: 0.3 });
    for (const z of [-3.6, -5.0]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(800, 0.16, 0.08), railMat);
      r.position.set(0, 0.2, z);
      this.scene.add(r);
      this.followers.push(r);
    }
    const wireMat = new THREE.MeshStandardMaterial({ color: 0x3e4246 });
    for (const [y, z] of [[6.62, -4.45], [7.15, -4.45], [7.15, -7.2]]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(800, 0.03, 0.03), wireMat);
      w.position.set(0, y, z);
      this.scene.add(w);
      this.followers.push(w);
    }
    this.followers.push(bed);
  }

  // ------------------------------------------------------------------ carriage
  private buildCabin() {
    const W = this.pack.window;
    const eye = this.pack.rig.eyeHeight;
    // Interior light: a little self-illumination so the carriage never goes black against the view.
    const lit = (c: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, emissive: new THREE.Color(c).multiplyScalar(0.22) });
    const wall = lit(W.wall);
    const frame = lit(W.frame);
    const dark = lit(0x6d665c);
    const cabin = new THREE.Group();
    const floorY = eye - 1.45, ceilY = eye + 1.05;
    const winBottom = eye + W.bottom, winTop = winBottom + W.height;
    const pitch = W.width + W.pillar;
    const nWin = 7;
    const halfLen = (nWin * pitch) / 2 + 0.6;
    // Collect boxes per material, then merge: the whole carriage is three draw calls.
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z);
      if (!parts.has(m)) parts.set(m, []);
      parts.get(m)!.push(g);
    };
    const wallSide = (zc: number, sign: number) => {
      add(halfLen * 2, winBottom - floorY, 0.08, 0, (winBottom + floorY) / 2, zc, wall);
      add(halfLen * 2, ceilY - winTop, 0.08, 0, (winTop + ceilY) / 2, zc, wall);
      // Pillars between windows, and solid wall past the end windows.
      for (let k = 0; k <= nWin; k++) add(W.pillar, W.height, 0.08, (k - nWin / 2) * pitch, (winBottom + winTop) / 2, zc, wall);
      const endW = halfLen - (nWin / 2) * pitch;
      for (const sx of [-1, 1]) add(endW, W.height, 0.08, sx * (halfLen - endW / 2), (winBottom + winTop) / 2, zc, wall);
      for (let k = 0; k < nWin; k++) {
        const cx = (k - (nWin - 1) / 2) * pitch;
        // Slim rubber-mounted frames, nearly flush with the wall, like a real carriage window.
        const t = 0.035;
        add(W.width, t, 0.05, cx, winBottom + t / 2, zc + 0.01 * sign, frame);
        add(W.width, t, 0.05, cx, winTop - t / 2, zc + 0.01 * sign, frame);
        add(t, W.height, 0.05, cx - W.width / 2 + t / 2, (winBottom + winTop) / 2, zc + 0.01 * sign, frame);
        add(t, W.height, 0.05, cx + W.width / 2 - t / 2, (winBottom + winTop) / 2, zc + 0.01 * sign, frame);
      }
      // Window ledge.
      add(halfLen * 2, 0.03, 0.07, 0, winBottom - 0.015, zc + 0.035 * sign, dark);
    };
    wallSide(-W.distance, 1);
    wallSide(2.5, -1);
    // Floor, ceiling, end walls.
    const depth = 2.5 + W.distance + 0.1, mid = (2.5 - W.distance) / 2;
    add(halfLen * 2, 0.05, depth, 0, floorY, mid, dark);
    add(halfLen * 2, 0.05, depth, 0, ceilY, mid, wall);
    for (const sx of [-1, 1]) add(0.1, ceilY - floorY, depth, sx * halfLen, (ceilY + floorY) / 2, mid, wall);
    // A small fold-down table under the centre window.
    add(0.7, 0.04, 0.4, 0, winBottom - 0.25, -W.distance + 0.25, dark);
    for (const [m, gs] of parts) cabin.add(new THREE.Mesh(mergeGeometries(gs, false)!, m));
    // Glass in the viewing-side windows: sheen, dust, and rain when the music breaks down.
    const glass = makeWindowGlassMaterial();
    for (let k = 0; k < nWin; k++) {
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(W.width - 0.1, W.height - 0.1), glass);
      pane.position.set((k - (nWin - 1) / 2) * pitch, (winBottom + winTop) / 2, -W.distance + 0.01);
      pane.renderOrder = 10;
      cabin.add(pane);
      if (this.pack.rig.lookYaw) {
        // And across the aisle, the other window.
        const back = pane.clone();
        back.position.z = 2.5 - 0.01;
        back.rotation.y = Math.PI;
        cabin.add(back);
      }
    }
    this.train.add(cabin);
  }


  // ------------------------------------------------------------------ fairground cart
  /**
   * A little open car for two, like a ghost-train or a wild-mouse car: low sides you can see over,
   * a padded lap bar, a bench, a carved nose with a skull and a lantern on a crooked pole. No roof
   * and no glass: the night is right there. Colours from pack.window (frame = trim, wall = body).
   */
  private buildCart() {
    const W = this.pack.window;
    const lit = (c: THREE.ColorRepresentation, e = 0.25) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.2, emissive: new THREE.Color(c).multiplyScalar(e) });
    const body = lit(W.wall), trim = lit(W.frame, 0.4), dark = lit(0x221a20, 0.15), bone = lit(0xd8cfb8, 0.3);
    const glow = new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false });
    const red = new THREE.MeshBasicMaterial({ color: 0xff2a10, toneMapped: false });
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (g: THREE.BufferGeometry, m: THREE.Material) => { if (!parts.has(m)) parts.set(m, []); parts.get(m)!.push(g); };
    const L = 2.3, Z = 0.78, floorY = 0.28, sideTop = 0.86;
    // Chassis and wheels on the rails.
    add(new THREE.BoxGeometry(L, 0.18, 1.2).translate(0, 0.14, 0), dark);
    for (const sx of [-0.75, 0.75]) for (const sz of [-0.45, 0.45]) add(new THREE.CylinderGeometry(0.14, 0.14, 0.1, 12).rotateX(Math.PI / 2).translate(sx, 0.08, sz), dark);
    add(new THREE.BoxGeometry(L, 0.06, 2 * Z).translate(0, floorY, 0), dark);
    // Low sides, both windows, with a padded trim rail along the top.
    for (const sz of [-1, 1]) {
      add(new THREE.BoxGeometry(L, sideTop - floorY, 0.07).translate(0, (sideTop + floorY) / 2, sz * Z), body);
      add(new THREE.CylinderGeometry(0.06, 0.06, L, 8).rotateZ(Math.PI / 2).translate(0, sideTop + 0.03, sz * Z), trim);
    }
    // The nose (ahead, +x) curls up; the tail is a low back.
    add(new THREE.BoxGeometry(0.1, 0.95, 2 * Z).translate(L / 2, floorY + 0.47, 0), body);
    add(new THREE.CylinderGeometry(0.35, 0.35, 2 * Z, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(L / 2, floorY + 0.95, 0), trim);
    add(new THREE.BoxGeometry(0.1, 0.7, 2 * Z).translate(-L / 2, floorY + 0.35, 0), body);
    // A skull on the nose, with glowing eyes.
    add(new THREE.SphereGeometry(0.2, 12, 8).scale(1, 0.95, 1.05).translate(L / 2 + 0.12, floorY + 1.3, 0), bone);
    add(new THREE.BoxGeometry(0.14, 0.1, 0.22).translate(L / 2 + 0.16, floorY + 1.12, 0), bone);
    for (const ez of [-0.07, 0.07]) add(new THREE.SphereGeometry(0.045, 8, 6).translate(L / 2 + 0.2, floorY + 1.33, ez), red);
    // The bench, low enough to see over when you turn round to the other window.
    add(new THREE.BoxGeometry(1.5, 0.12, 0.5).translate(0, 0.62, 0.22), trim);
    add(new THREE.BoxGeometry(1.5, 0.4, 0.08).translate(0, 0.86, 0.5).rotateX(0), trim);
    // The lap bar.
    add(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10).rotateZ(Math.PI / 2).translate(0, 0.98, -0.42), trim);
    for (const sx of [-0.75, 0.75]) add(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8).translate(sx, 0.63, -0.42), dark);
    // A lantern on a crooked pole at the front corner.
    add(new THREE.CylinderGeometry(0.025, 0.035, 1.3, 6).rotateZ(-0.08).translate(L / 2 - 0.15, floorY + 0.65 + 0.5, Z - 0.1), dark);
    add(new THREE.BoxGeometry(0.16, 0.22, 0.16).translate(L / 2 - 0.06, floorY + 1.75, Z - 0.1), glow);
    // Little bulbs along both sides.
    for (const sz of [-1, 1]) for (let k = 0; k < 7; k++) add(new THREE.SphereGeometry(0.03, 6, 4).translate(-L / 2 + 0.2 + k * (L - 0.4) / 6, sideTop - 0.08, sz * (Z + 0.04)), glow);
    const cart = new THREE.Group();
    for (const [m, gs] of parts) cart.add(new THREE.Mesh(mergeGeometries(gs, false)!, m));
    this.train.add(cart);
  }

  /** The coaster track: rails, sleepers and trestles, rebuilt under and ahead of the cart each frame. */
  private coaster: { rails: THREE.InstancedMesh; ties: THREE.InstancedMesh; posts: THREE.InstancedMesh } | null = null;
  private static readonly SEG = 1.2;
  private static readonly NSEG = 110;
  private buildCoaster() {
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3236, roughness: 0.45, metalness: 0.7, emissive: 0x120608 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x2c2420, roughness: 0.9, emissive: 0x0a0605 });
    const N = World.NSEG;
    const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(World.SEG + 0.02, 0.09, 0.08), iron, 2 * N);
    const ties = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.07, 1.25), wood, N);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 1, 0.2).translate(0, 0.5, 0), wood, N);
    for (const m of [rails, ties, posts]) { m.frustumCulled = false; this.scene.add(m); }
    this.coaster = { rails, ties, posts };
  }
  private updateCoaster(rig: CameraRig, trainX: number) {
    const c = this.coaster;
    if (!c || !rig.heightAt) return;
    const S = World.SEG, N = World.NSEG;
    const H = (x: number) => rig.heightAt!(rig.timeAtTravel(x));
    const k0 = Math.floor((trainX - 45) / S);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let np = 0;
    let h0 = H(k0 * S);
    for (let i = 0; i < N; i++) {
      const xa = (k0 + i) * S, h1 = H(xa + S);
      const ang = Math.atan2(h1 - h0, S);
      q.setFromAxisAngle(ZAX, ang);
      const xm = xa + S / 2, hm = (h0 + h1) / 2 - 0.06;
      sc.set(1 / Math.cos(ang), 1, 1);
      for (const [j, z] of [[0, -0.45], [1, 0.45]] as const) c.rails.setMatrixAt(2 * i + j, m4.compose(p.set(xm, hm, z), q, sc));
      sc.set(1, 1, 1);
      c.ties.setMatrixAt(i, m4.compose(p.set(xa, h0 - 0.12, 0), q, sc));
      // A trestle every few sleepers, down to the ground.
      if ((k0 + i) % 4 === 0 && h0 > 0.5) {
        q.identity();
        c.posts.setMatrixAt(np++, m4.compose(p.set(xa, 0, 0), q, sc.set(1, h0 - 0.15, 1)));
        sc.set(1, 1, 1);
      }
      h0 = h1;
    }
    c.posts.count = np;
    c.rails.instanceMatrix.needsUpdate = c.ties.instanceMatrix.needsUpdate = c.posts.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ storm (render/storm.ts drives it)
  private baseFog = new THREE.Color();
  private baseHemi = 1;
  private stormCol = new THREE.Color();
  /**
   * Lightning and the pulse: `flash` 0..1 lights the sky, the fog and every surface for a moment;
   * `pulse` 0..1 throbs the sky and the fog towards `colour` (the beat, the blood).
   */
  setStorm(flash: number, pulse: number, colour: THREE.Color) {
    const m = this.sky.material as THREE.MeshBasicMaterial;
    m.color.setRGB(1, 1, 1).lerp(colour, Math.min(1, pulse * 0.7)).multiplyScalar(1 + pulse * 0.6 + flash * 3);
    this.stormCol.copy(this.baseFog).lerp(colour, Math.min(1, pulse * 0.55));
    this.stormCol.lerp(FLASH, Math.min(1, flash * 0.7));
    this.fog.color.copy(this.stormCol);
    if (!this.ship) (this.scene.background as THREE.Color).copy(this.stormCol);
    this.hemi.intensity = this.baseHemi * (1 + pulse * 0.35 + flash * 5);
  }

  // ------------------------------------------------------------------ starship cockpit
  /**
   * An open canopy: one sweep of glass from below the console on the main side, over your head,
   * down past the other side, held by a few slim ribs. Consoles of blinking buttons under each side.
   */
  private buildCockpit() {
    const eye = this.pack.rig.eyeHeight;
    const L = 20, R = 2.7, y0 = eye - 0.3, z0 = 0.75;
    const under = 0.52; // how far the glass wraps below the horizontal, radians
    const cockpit = new THREE.Group();
    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, L, 64, 1, true, Math.PI - under, Math.PI + 2 * under).rotateZ(-Math.PI / 2).translate(0, y0, z0),
      makeCanopyMaterial());
    glass.renderOrder = 10;
    cockpit.add(glass);
    const lit = (c: THREE.ColorRepresentation, e = 0.15) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.7, emissive: new THREE.Color(c).multiplyScalar(e) });
    const frame = lit(this.pack.window.frame);
    const hull = lit(this.pack.window.wall, 0.2);
    const parts = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const add = (g: THREE.BufferGeometry, m: THREE.Material) => { if (!parts.has(m)) parts.set(m, []); parts.get(m)!.push(g); };
    // Ribs: thin arcs every few metres, none straight ahead.
    for (let k = -3; k < 3; k++) {
      add(new THREE.TorusGeometry(R + 0.02, 0.03, 6, 48, Math.PI + 2 * under).rotateZ(-under).rotateY(Math.PI / 2).translate((k + 0.5) * 3.4, y0, z0), frame);
    }
    // Sills along both lower edges of the glass, with a light strip.
    const sillY = y0 - Math.sin(under) * R, sillZ = Math.cos(under) * R;
    const strip = new THREE.MeshBasicMaterial({ color: 0x7fe8ff, toneMapped: false });
    for (const sz of [-1, 1]) {
      add(new THREE.BoxGeometry(L, 0.12, 0.3).translate(0, sillY - 0.06, z0 + sz * sillZ), frame);
      add(new THREE.BoxGeometry(L, 0.025, 0.025).translate(0, sillY + 0.01, z0 + sz * (sillZ - 0.16)), strip);
    }
    // Floor, and bulkheads closing each end.
    const floorY = eye - 1.5;
    add(new THREE.BoxGeometry(L, 0.06, 2 * sillZ).translate(0, floorY, z0), hull);
    // Each end is a round window of the same glass in a slim frame (a solid bulkhead here was a
    // big grey wall whenever you looked fore or aft).
    for (const sx of [-1, 1]) {
      const end = new THREE.Mesh(new THREE.CircleGeometry(R, 64).rotateY(Math.PI / 2).translate(sx * L / 2, y0, z0), makeCanopyMaterial());
      end.renderOrder = 10;
      cockpit.add(end);
      add(new THREE.TorusGeometry(R, 0.05, 8, 64).rotateY(Math.PI / 2).translate(sx * L / 2, y0, z0), frame);
      add(new THREE.TorusGeometry(R * 0.55, 0.025, 6, 48).rotateY(Math.PI / 2).translate(sx * L / 2, y0, z0), frame);
    }
    // Consoles: a sloping desk under each side of the canopy.
    const desk = makeConsoleMaterial();
    for (const sz of [-1, 1]) {
      const g = new THREE.BoxGeometry(L - 0.4, 0.3, 0.75).rotateX(sz * -0.28).translate(0, sillY - 0.35, z0 + sz * (sillZ - 0.5));
      add(g, desk);
      add(new THREE.BoxGeometry(L - 0.4, sillY - 0.5 - floorY, 0.08).translate(0, (sillY - 0.5 + floorY) / 2, z0 + sz * (sillZ - 0.85)), hull);
    }
    for (const [m, gs] of parts) cockpit.add(new THREE.Mesh(mergeGeometries(gs, false)!, m));
    this.train.add(cockpit);
  }

  // ------------------------------------------------------------------ stations
  stationBoard(x: number, info: StationInfo, opts: { end?: boolean; trackside?: boolean } = {}) {
    const grp = new THREE.Group();
    grp.position.x = x;
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x8d9497, emissive: 0x2a2d2f });
    // (A launch-screen ride has no platforms: its landing card floats too.)
    const screen = opts.end ? this.pack.end?.template === 'arrival-screen' : this.launch;
    // (A ghost-gate ride has no platforms either: every card is the fairground sign.)
    const gate = !screen && this.spooky && (!opts.end || this.pack.end?.template === 'ghost-gate');
    if (screen) this.launchScreen(grp, World.LAUNCH_Z);
    else if (gate) { this.ghostGate(grp, -8.3, !!opts.end); canopyMat.color.set(0x1a1016); canopyMat.emissive.set(0x0a0408); }
    else if (!opts.trackside) this.platform(grp, canopyMat);
    else {
      // The title card: a lineside goods shed, its name board fixed to the wall facing the line.
      const pad = new THREE.Mesh(new THREE.BoxGeometry(22, 0.1, 4), new THREE.MeshStandardMaterial({ color: this.ship ? 0x5b6168 : 0x9d968a }));
      pad.position.set(0, 0.05, -6.3);
      grp.add(pad);
      const shed = new THREE.Mesh(new THREE.BoxGeometry(18, 5.6, 6), new THREE.MeshStandardMaterial({ color: this.ship ? 0x8d949c : 0xd8c9a8, roughness: this.ship ? 0.5 : 0.9, metalness: this.ship ? 0.6 : 0 }));
      shed.position.set(0, 2.8, -8.3 - 3);
      grp.add(shed);
      const sr = new THREE.Mesh(new THREE.BoxGeometry(18.6, 0.35, 6.8), new THREE.MeshStandardMaterial({ color: this.ship ? 0x3e5f86 : 0xa75a3c }));
      sr.position.set(0, 5.75, -8.3 - 3);
      grp.add(sr);
    }
    // The name board is fixed flat to a wall: the shed's, or the station building's (on the
    // starship's launch, the face of a floating screen).
    this.boardOnWall(grp, info, gate ? { ...opts, trackside: !opts.end } : opts, screen ? new THREE.MeshStandardMaterial({ color: 0x1a2230, roughness: 0.35, metalness: 0.8 }) : canopyMat, screen ? World.LAUNCH_Z + 0.1 : gate || opts.trackside ? -8.3 : -11.5);
    this.stations.add(grp);
    return grp;
  }

  /** The title card is the floating launch screen (pack.title.template), not a station board. */
  private get launch() { return this.pack.title.template === 'launch-screen'; }
  /** The title card is the fairground ghost-train sign. */
  private get spooky() { return this.pack.title.template === 'ghost-gate'; }
  /** How high the ride waits above the ground (a coaster's station height). */
  private get lift() { return this.pack.rig.coaster?.low ?? 0; }

  /**
   * The ghost train's sign: a tall black fascia on two crooked posts, the name board on its face,
   * chaser bulbs round the edge (they run in update()), a skull on top between two jack-o'-lanterns,
   * and a tattered bunting of pennants. The ride waits beside it, lap bar down.
   */
  private ghostGate(grp: THREE.Group, z: number, end: boolean) {
    const eye = this.pack.rig.eyeHeight + this.lift;
    const cy = eye + (end ? 1.3 : 0.35) + 0.5;
    const W = 13.5, H = end ? 7 : 6.2;
    const wood = new THREE.MeshStandardMaterial({ color: 0x2a1c22, roughness: 0.9, emissive: 0x0c0508 });
    const paint = new THREE.MeshStandardMaterial({ color: 0x3a1430, roughness: 0.7, emissive: 0x12040e });
    const bone = new THREE.MeshStandardMaterial({ color: 0xe0d6bc, roughness: 0.6, emissive: 0x2a2620 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xe0661a, roughness: 0.6, emissive: 0x401400 });
    const lamp = (c: number) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.4), paint);
    fascia.position.set(0.7, cy, z - 0.3);
    grp.add(fascia);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, cy + H / 2 + 1, 0.45), wood);
      post.position.set(0.7 + sx * (W / 2 + 0.1), (cy + H / 2 + 1) / 2, z - 0.3);
      post.rotation.z = sx * 0.035;
      grp.add(post);
      // A jack-o'-lantern on each post top.
      const pk = new THREE.Mesh(new THREE.SphereGeometry(0.75, 14, 10).scale(1.2, 0.9, 1.2), orange);
      pk.position.set(post.position.x, cy + H / 2 + 1.6, z - 0.3);
      grp.add(pk);
      for (const ex of [-0.28, 0.28]) {
        const e = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.22, 3), lamp(0xffc040));
        e.position.set(pk.position.x + ex, pk.position.y + 0.15, z - 0.3 + 0.88);
        e.rotation.z = Math.PI;
        grp.add(e);
      }
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.05), lamp(0xffc040));
      mouth.position.set(pk.position.x, pk.position.y - 0.25, z - 0.3 + 0.9);
      grp.add(mouth);
    }
    // The skull on top, eyes lit red.
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1.1, 18, 12).scale(1, 0.95, 0.9), bone);
    skull.position.set(0.7, cy + H / 2 + 1.1, z - 0.2);
    grp.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.8), bone);
    jaw.position.set(0.7, cy + H / 2 + 0.25, z - 0.1);
    grp.add(jaw);
    for (const ex of [-0.4, 0.4]) {
      const eye_ = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), lamp(0xff2a10));
      eye_.position.set(0.7 + ex, cy + H / 2 + 1.15, z + 0.55);
      grp.add(eye_);
    }
    // Chaser bulbs round the edge of the fascia.
    const per = 2 * (W + H), n = 56;
    for (let i = 0; i < n; i++) {
      let d = (i / n) * per, x: number, y: number;
      if (d < W) { x = -W / 2 + d; y = H / 2; } else if ((d -= W) < H) { x = W / 2; y = H / 2 - d; } else if ((d -= H) < W) { x = W / 2 - d; y = -H / 2; } else { d -= W; x = -W / 2; y = -H / 2 + d; }
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), lamp(i % 2 ? 0xffb030 : 0xff5a20));
      b.position.set(0.7 + x * 0.97, cy + y * 0.96, z - 0.05);
      b.userData.chase = i;
      this.blinkers.push(b);
      grp.add(b);
    }
    // Tattered pennants strung from post to post above the sign.
    for (let i = 0; i < 14; i++) {
      const u = i / 13, x = 0.7 - W / 2 + u * W, y = cy + H / 2 + 0.6 - Math.sin(u * Math.PI) * 0.5;
      const flag = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 3).rotateZ(Math.PI), lamp(i % 3 === 0 ? 0x5a1a70 : i % 3 === 1 ? 0xd05010 : 0x1a1a1a));
      flag.position.set(x, y - 0.3, z + 0.05);
      grp.add(flag);
    }
  }

  /** Floating things on the launch (the screen): they bob and sway gently in update(). */
  private floaters: { o: THREE.Object3D; y: number; ph: number }[] = [];

  /**
   * The starship's title card: a big screen hanging in space beside the launch, the song's name on
   * it, a T-minus countdown above, a countdown dial beside, a bezel with light strips, antennas
   * with blinking tips, and little thruster pods underneath keeping it up. It bobs as it waits.
   */
  /** How far out the launch screen hangs: beyond the gate struts, so nothing passes in front. */
  static readonly LAUNCH_Z = -14;
  private launchScreen(grp: THREE.Group, z: number) {
    const float = new THREE.Group();
    const eye = this.pack.rig.eyeHeight;
    const cy = eye + 0.35 + 0.6;
    const bezel = new THREE.MeshStandardMaterial({ color: 0x232b38, roughness: 0.3, metalness: 0.85 });
    const glow = (c: number) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, fog: false });
    const W = 12.6, H = 5.4;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, 0.7), bezel);
    body.position.set(0.7, cy, z - 0.45);
    float.add(body);
    // Light strips round the bezel.
    for (const [w, h, x, y] of [[W, 0.08, 0.7, cy + H / 2], [W, 0.08, 0.7, cy - H / 2], [0.08, H, 0.7 - W / 2, cy], [0.08, H, 0.7 + W / 2, cy]] as const) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.76), glow(0x5ff0ff));
      s.position.set(x, y, z - 0.45);
      float.add(s);
    }
    // Antennas with blinking tips (blink() below).
    for (const sx of [-1, 1]) {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 2.4, 6), bezel);
      a.position.set(0.7 + sx * (W / 2 - 1), cy + H / 2 + 1.2, z - 0.45);
      a.rotation.z = -sx * 0.25;
      float.add(a);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), glow(0xff3b3b));
      tip.position.set(0.7 + sx * (W / 2 - 1) + sx * 0.3, cy + H / 2 + 2.35, z - 0.45);
      tip.userData.blink = sx > 0 ? 0 : 0.5;
      this.blinkers.push(tip);
      float.add(tip);
    }
    // Thruster pods underneath, each with a soft glowing cone of exhaust.
    for (const sx of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 1.1, 14), bezel);
      pod.position.set(0.7 + sx * 3.8, cy - H / 2 - 0.6, z - 0.45);
      float.add(pod);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.8, 14, 1, true).rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false, fog: false }));
      flame.position.set(pod.position.x, pod.position.y - 1.4, pod.position.z);
      this.blinkers.push(flame);
      flame.userData.flame = true;
      float.add(flame);
    }
    grp.add(float);
    // The whole card bobs (the board and dial are added to grp after this).
    this.floaters.push({ o: grp, y: 0, ph: Math.random() * 6 });
  }
  private blinkers: THREE.Object3D[] = [];
  private platform(grp: THREE.Group, canopyMat: THREE.Material) {
    // Platform along the window side.
    const plat = new THREE.Mesh(new THREE.BoxGeometry(180, 1.1, 5.5), new THREE.MeshStandardMaterial({ color: this.ship ? 0x6f767e : 0xbdb5a3 }));
    plat.position.set(0, 0.55, -2.35 - 2.75 - 0.4);
    grp.add(plat);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(180, 0.06, 0.4), new THREE.MeshStandardMaterial({ color: 0xe8d36a }));
    edge.position.set(0, 1.13, -2.9);
    grp.add(edge);
    // Canopy.
    for (let k = -4; k <= 4; k++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 4.4, 0.18), canopyMat);
      post.position.set(k * 9 + 4.5, 3.3, -7.6);
      grp.add(post);
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(84, 0.2, 4.6), canopyMat);
    canopy.position.set(0, 5.55, -7.4);
    canopy.rotation.x = 0.06;
    grp.add(canopy);
    // Station building behind the platform.
    const bldg = new THREE.Mesh(new THREE.BoxGeometry(34, 7, 9), new THREE.MeshStandardMaterial({ color: this.ship ? 0x9da2a8 : 0xe1d2b2 }));
    bldg.position.set(-6, 3.5, -16);
    grp.add(bldg);
    const bRoof = new THREE.Mesh(new THREE.BoxGeometry(35, 0.6, 10), new THREE.MeshStandardMaterial({ color: this.ship ? 0x3e5f86 : 0xa75a3c }));
    bRoof.position.set(-6, 7.2, -16);
    grp.add(bRoof);
  }

  private boardOnWall(grp: THREE.Group, info: StationInfo, opts: { end?: boolean; trackside?: boolean }, canopyMat: THREE.Material, wallZ: number) {
    const z = wallZ + 0.1;
    // The board itself, screwed to the wall, facing the train.
    const tex = this.boardTexture(info, !!opts.end);
    const bw = opts.end ? 7.4 : opts.trackside ? 7.2 : 6.4, bh = bw * (tex.image.height / tex.image.width);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false }));
    const cy = this.pack.rig.eyeHeight + this.lift + (opts.trackside ? 0.35 : 1.3);
    board.position.set(0, cy, z);
    grp.add(board);
    const back = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.12, bh + 0.12, 0.08), canopyMat);
    back.position.set(0, cy, z - 0.06);
    grp.add(back);
    // On the title stop: a departures strip above the name board and a platform clock beside it,
    // so the wait while the line ahead is read has something to watch.
    if (opts.trackside && !opts.end) {
      const dw = bw, dh = 0.8;
      this.depCanvas = document.createElement('canvas');
      this.depCanvas.width = 1400; this.depCanvas.height = Math.round(1400 * dh / dw);
      this.depTex = new THREE.CanvasTexture(this.depCanvas);
      this.depTex.colorSpace = THREE.SRGBColorSpace;
      this.depText = '';
      this.setDeparture('Waiting for a clear line');
      const dep = new THREE.Mesh(new THREE.PlaneGeometry(dw, dh), new THREE.MeshBasicMaterial({ map: this.depTex, fog: false, toneMapped: false }));
      dep.position.set(0, cy + bh / 2 + 0.25 + dh / 2, z);
      grp.add(dep);
      const dback = new THREE.Mesh(new THREE.BoxGeometry(dw + 0.12, dh + 0.12, 0.08), canopyMat);
      dback.position.set(0, dep.position.y, z - 0.06);
      grp.add(dback);
      this.clockCanvas = document.createElement('canvas');
      this.clockCanvas.width = this.clockCanvas.height = 256;
      this.clockTex = new THREE.CanvasTexture(this.clockCanvas);
      this.clockTex.colorSpace = THREE.SRGBColorSpace;
      this.clockSec = -1; this.clockDrawn = '';
      this.drawClock();
      // To the right of the board, clear of the window pillar in the angled start view (the cover
      // art, when there is some, hangs on the left).
      const cx = bw / 2 + 1.4;
      const face = new THREE.Mesh(new THREE.CircleGeometry(1.05, 48), new THREE.MeshBasicMaterial({ map: this.clockTex, fog: false, toneMapped: false }));
      face.position.set(cx, cy, z + 0.12);
      grp.add(face);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.16, 0.2, 48).rotateX(Math.PI / 2), canopyMat);
      rim.position.set(cx, cy, z);
      grp.add(rim);
    }
    // Cover art as a poster on the station wall.
    if (info.art) {
      const at = new THREE.Texture(info.art);
      at.colorSpace = THREE.SRGBColorSpace;
      at.needsUpdate = true;
      const poster = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), new THREE.MeshBasicMaterial({ map: at, toneMapped: false }));
      poster.position.set(9, 3.6, -11.45);
      grp.add(poster);
      const pf = new THREE.Mesh(new THREE.BoxGeometry(3.5, 3.5, 0.1), canopyMat);
      pf.position.set(9, 3.6, -11.52);
      if (opts.trackside) { poster.position.set(-(bw / 2 + 1.9), cy, z); pf.position.set(-(bw / 2 + 1.9), cy, z - 0.06); }
      grp.add(pf);
    }
  }

  dispose() {
    this.pipeline?.dispose();
    this.pipeline = null;
    this.envRT?.dispose();
    this.scene.traverse(o => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as any).material;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x: THREE.Material) => x.dispose());
    });
    this.scene.clear();
  }

  private depCanvas: HTMLCanvasElement | null = null;
  private depTex: THREE.CanvasTexture | null = null;
  private depText = '';
  private clockCanvas: HTMLCanvasElement | null = null;
  private clockTex: THREE.CanvasTexture | null = null;
  private clockSec = -1;
  private countdown: number | null = null;
  private clockDrawn = '';

  /** The departures strip on the title stop: amber dot-matrix text, redrawn only when it changes. */
  setDeparture(text: string) {
    // The clock counts the same seconds down on its face.
    const n = /(\d+)s$/.exec(text)?.[1];
    this.countdown = n ? Number(n) : text === 'Departing' ? 0 : null;
    const c = this.depCanvas;
    if (!c || !this.depTex || text === this.depText) return;
    this.depText = text;
    const g = c.getContext('2d')!;
    g.fillStyle = '#111312';
    g.fillRect(0, 0, c.width, c.height);
    g.font = `700 ${Math.round(c.height * 0.5)}px ui-monospace, "Courier New", monospace`;
    g.textBaseline = 'middle';
    g.fillStyle = this.launch ? '#5ff0ff' : this.spooky ? '#ff6a1a' : '#ffb22e';
    g.shadowColor = this.launch ? '#00c8ff' : this.spooky ? '#ff2a00' : '#ff9a00'; g.shadowBlur = 14;
    g.textAlign = 'left';
    g.fillText(this.launch ? 'LAUNCH' : this.spooky ? 'GHOST TRAIN' : 'PLATFORM 1', 40, c.height / 2);
    g.textAlign = 'right';
    const label = this.launch ? 'LAUNCH' : this.spooky ? 'GHOST TRAIN' : 'PLATFORM 1';
    const room = c.width - 120 - g.measureText(label).width;
    const words = this.launch ? launchText(text, this.countdown) : this.spooky ? spookyText(text, this.countdown) : text.toUpperCase();
    let fs = Math.round(c.height * 0.5);
    while (g.measureText(words).width > room && fs > 16) { fs -= 2; g.font = `700 ${fs}px ui-monospace, "Courier New", monospace`; }
    g.fillText(this.launch ? launchText(text, this.countdown) : this.spooky ? spookyText(text, this.countdown) : text.toUpperCase(), c.width - 40, c.height / 2);
    g.shadowBlur = 0;
    // The dot-matrix grain.
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 0; x < c.width; x += 6) g.fillRect(x, 0, 2, c.height);
    for (let y = 0; y < c.height; y += 6) g.fillRect(0, y, c.width, 2);
    this.depTex.needsUpdate = true;
  }

  /** The platform clock: the real time on your machine, with a sweeping red second hand. */
  private drawClock() {
    const c = this.clockCanvas;
    if (!c || !this.clockTex) return;
    const now = new Date();
    const sec = now.getSeconds();
    const key = sec + ':' + this.countdown;
    if (key === this.clockDrawn) return;
    this.clockDrawn = key;
    this.clockSec = sec;
    const g = c.getContext('2d')!, r = c.width / 2;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.launch) { this.drawDial(g, r); this.clockTex.needsUpdate = true; return; }
    const ink = this.spooky ? '#ff8a2a' : '#1b1d20';
    g.fillStyle = this.spooky ? '#140a10' : '#f4f1e8';
    g.fillRect(0, 0, c.width, c.height);
    g.translate(r, r);
    g.fillStyle = ink;
    for (let i = 0; i < 60; i++) {
      g.save(); g.rotate((i / 60) * Math.PI * 2);
      if (i % 5 === 0) g.fillRect(-4, -r + 10, 8, 26); else g.fillRect(-1.5, -r + 10, 3, 9);
      g.restore();
    }
    // A departure countdown: a red wedge from twelve o'clock, one second per tick, shrinking to
    // nothing as the train pulls away, with the seconds in a window under the hands.
    if (this.countdown !== null) {
      const left = Math.min(60, this.countdown);
      g.beginPath(); g.moveTo(0, 0);
      g.arc(0, 0, r - 40, -Math.PI / 2, -Math.PI / 2 + (left / 60) * Math.PI * 2);
      g.closePath(); g.fillStyle = 'rgba(200,36,29,0.28)'; g.fill();
      g.fillStyle = '#111312'; g.fillRect(-46, r * 0.32, 92, 44);
      g.font = '700 34px ui-monospace, "Courier New", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#ffb22e'; g.fillText(left > 0 ? String(left) : 'GO', 0, r * 0.32 + 23);
    }
    const hand = (a: number, len: number, w: number, col: string) => {
      g.save(); g.rotate(a); g.fillStyle = col; g.fillRect(-w / 2, -len, w, len + 18); g.restore();
    };
    const m = now.getMinutes() + sec / 60, h = (now.getHours() % 12) + m / 60;
    hand((h / 12) * Math.PI * 2, r * 0.5, 12, ink);
    hand((m / 60) * Math.PI * 2, r * 0.78, 8, ink);
    hand((sec / 60) * Math.PI * 2, r * 0.82, 3, '#c8241d');
    g.beginPath(); g.arc(0, 0, 9, 0, Math.PI * 2); g.fillStyle = '#c8241d'; g.fill();
    this.clockTex.needsUpdate = true;
  }

  /** The starship's dial: a countdown ring that empties to lift-off, the seconds big in the middle. */
  private drawDial(g: CanvasRenderingContext2D, r: number) {
    g.fillStyle = '#06121f';
    g.fillRect(0, 0, r * 2, r * 2);
    g.translate(r, r);
    g.strokeStyle = 'rgba(95,240,255,0.25)'; g.lineWidth = 3;
    for (let i = 0; i < 60; i++) {
      g.save(); g.rotate((i / 60) * Math.PI * 2);
      g.beginPath(); g.moveTo(0, -r + 12); g.lineTo(0, -r + (i % 5 ? 20 : 34)); g.stroke();
      g.restore();
    }
    const left = this.countdown === null ? null : Math.min(60, this.countdown);
    g.lineWidth = 16; g.lineCap = 'round';
    g.strokeStyle = '#5ff0ff'; g.shadowColor = '#00c8ff'; g.shadowBlur = 16;
    g.beginPath();
    const frac = left === null ? (this.clockSec / 60) : left / 60;
    g.arc(0, 0, r - 52, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, frac) * Math.PI * 2);
    g.stroke();
    g.fillStyle = '#dffcff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 30px ui-monospace, "Courier New", monospace';
    g.fillText('T-MINUS', 0, -34);
    g.font = '700 74px ui-monospace, "Courier New", monospace';
    g.fillText(left === null ? '--' : left > 0 ? String(left).padStart(2, '0') : 'GO', 0, 26);
    g.shadowBlur = 0;
  }

  private boardTexture(info: StationInfo, end: boolean): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 1400; c.height = end ? 620 : 420;
    const g = c.getContext('2d')!;
    g.fillStyle = this.launch ? '#06121f' : this.spooky ? '#140810' : '#1f3b5a';
    g.fillRect(0, 0, c.width, c.height);
    if (this.spooky) { g.shadowColor = '#ff3a00'; g.shadowBlur = 22; }
    if (this.launch) {
      // A screen, not a sign: faint scanlines and a cyan glow.
      g.fillStyle = 'rgba(95,240,255,0.06)';
      for (let y = 0; y < c.height; y += 8) g.fillRect(0, y, c.width, 3);
      g.shadowColor = '#5ff0ff'; g.shadowBlur = 18;
    }
    g.strokeStyle = this.launch ? '#5ff0ff' : this.spooky ? '#ff7a1a' : '#f2efe6';
    g.lineWidth = 12;
    g.strokeRect(22, 22, c.width - 44, c.height - 44);
    g.fillStyle = this.launch ? '#dffcff' : this.spooky ? '#ffd27a' : '#f2efe6';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fit = (text: string, size: number, maxW: number, weight = '700') => {
      let s = size;
      const face = this.spooky ? 'Georgia, "Times New Roman", serif' : '"Helvetica Neue", Arial, sans-serif';
      do { g.font = `${this.spooky && weight === '700' ? 'italic 700' : weight} ${s}px ${face}`; s -= 4; } while (g.measureText(text).width > maxW && s > 20);
    };
    if (!end) {
      fit(info.name.toUpperCase(), 150, c.width - 120);
      g.fillText(info.name.toUpperCase(), c.width / 2, 170);
      fit(info.line2, 70, c.width - 160, '400');
      g.fillText(info.line2, c.width / 2, 310);
    } else {
      fit(info.name.toUpperCase(), 110, c.width - 120);
      g.fillText(info.name.toUpperCase(), c.width / 2, 120);
      fit(info.line2, 60, c.width - 160, '400');
      g.fillText(info.line2, c.width / 2, 250);
      if (info.line3) {
        g.font = 'italic 38px Georgia, serif';
        const words = info.line3.split(' ');
        let line = '', y = 380;
        for (const w of words) {
          if (g.measureText(line + w).width > c.width - 180) { g.fillText(line.trim(), c.width / 2, y); y += 54; line = ''; }
          line += w + ' ';
        }
        g.fillText(line.trim(), c.width / 2, y);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  // ------------------------------------------------------------------ per frame
  update(s: number, rig: CameraRig, yaw: number, pitch: number, xr = false) {
    this.drawClock();
    if (this.floaters.length || this.blinkers.length) {
      const t = performance.now() / 1000;
      // (Cards taken down leave the list.)
      this.floaters = this.floaters.filter(f => f.o.parent);
      this.blinkers = this.blinkers.filter(b => b.parent?.parent?.parent);
      for (const f of this.floaters) { f.o.position.y = Math.sin(t * 0.9 + f.ph) * 0.18; f.o.rotation.z = Math.sin(t * 0.55 + f.ph) * 0.012; }
      for (const b of this.blinkers) {
        if (b.userData.flame) { b.scale.y = 0.85 + 0.3 * Math.abs(Math.sin(t * 23 + b.id)); continue; }
        if (b.userData.chase !== undefined) { b.visible = (Math.floor(t * 6) + b.userData.chase) % 3 !== 0; continue; }
        b.visible = ((t + b.userData.blink) % 1) < 0.5;
      }
    }
    // Turning right round, you lean across the aisle to the other window.
    if (!xr && this.pack.rig.lookYaw) this.head.position.z = (this.cart ? 0.3 : 1.55) * Math.max(0, -Math.cos(yaw)) ** 1.5;
    rig.pose(s, tmpPos, tmpQuat);
    this.train.position.copy(tmpPos);
    this.train.quaternion.copy(tmpQuat);
    if (!xr) this.camera.rotation.set(pitch, -yaw, 0); else this.camera.rotation.set(0, 0, 0);
    // A warp jump throws the field of view wide for a moment: the whoosh.
    const fov = this.baseFov * (1 + 0.32 * FX_UNIFORMS.warp.value);
    if (!xr && Math.abs(fov - this.camera.fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    // Motion blur: travel speed over a 1/60 s shutter, projected (uv per metre of depth).
    if (this.mode === 'train') {
      const v = rig.speedAt(s);
      const focal = 1 / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect);
      SU.speed.value = v;
      FX_UNIFORMS.blurK.value = v * (1 / 100) * focal * Math.cos(yaw) * (this.blurScale ?? 1);
      FX_UNIFORMS.blurDir.value.set(1, 0);
    } else FX_UNIFORMS.blurK.value = 0;
    const trainX = tmpPos.x;
    this.sky.position.set(trainX, 0, tmpPos.z);
    this.phys?.position.set(trainX, 0, tmpPos.z);
    this.shipSky?.position.set(trainX, this.pack.rig.eyeHeight, tmpPos.z);
    // Keep the shadow box centred on what the camera sees.
    this.sun.target.position.set(trainX, 0, tmpPos.z - 30);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 200);
    const d0 = this.sunDisc.userData.dir as THREE.Vector3 | undefined;
    if (d0) this.sunDisc.position.set(trainX + d0.x * 2800, d0.y * 2800, tmpPos.z + d0.z * 2800);
    if (this.mode !== 'train') return;
    this.updateCoaster(rig, trainX);
    for (const f of this.followers) f.position.x = trainX;
    if (this.ballast) this.ballast.position.x = trainX;
    if (this.ballastTex) this.ballastTex.offset.x = (((trainX - 400) / 800) * this.ballastTex.repeat.x) % 1;
    const g0 = Math.floor(trainX / 60) - 1;
    for (let k = 0; k < this.grassTiles.length; k++) {
      const idx = g0 + k, tile = this.grassTiles[((idx % 3) + 3) % 3];
      if (tile.userData.tile !== idx) { tile.userData.tile = idx; tile.position.x = idx * 60; }
    }
    // Ground tiles, themed by the section the train is in when it passes them.
    const first = Math.floor(trainX / TILE) - 3;
    for (let k = 0; k < this.tiles.length; k++) {
      const idx = first + k;
      const tile = this.tiles[((idx % this.tiles.length) + this.tiles.length) % this.tiles.length];
      if (tile.index !== idx) {
        tile.index = idx;
        tile.mesh.position.x = idx * TILE + TILE / 2;
        const mat = this.groundMats.get(this.themeForX(idx * TILE + TILE / 2)) ?? tile.mesh.material;
        if (mat !== tile.mesh.material) { tile.mesh.material = mat; perf.mark('ground re-themed'); }
      }
    }
  }

  /**
   * Build every shader the show will need ahead of time, so nothing compiles mid-ride. In three,
   * each InstancedMesh gets its own shader build, so a model's first appearance used to cost a
   * full build of the scenery material: the stutters at scene changes. Warm-up goes through every
   * pooled model, each ground theme and anything hidden until later (the other window's sky), one
   * object per frame so the landing and title cards stay smooth while it works.
   */
  warmup(extra: THREE.Object3D[] = []) {
    const jobs: (() => Promise<void>)[] = [];
    const compile = (o: THREE.Object3D) => this.renderer.compileAsync(o, this.camera, this.scene).catch(() => {});
    this.scene.traverse(o => {
      const m = o as THREE.InstancedMesh;
      if (!m.isInstancedMesh || m.userData.warm) return;
      jobs.push(async () => {
        if (m.userData.warm || !m.parent) return;
        m.userData.warm = true;
        const n = m.count;
        if (n === 0) { m.setMatrixAt(0, new THREE.Matrix4().makeScale(0, 0, 0)); m.instanceMatrix.needsUpdate = true; m.count = 1; }
        await compile(m);
        if (n === 0 && m.count === 1 && !m.userData.used) m.count = 0;
      });
    });
    const tile = this.tiles[0]?.mesh;
    if (tile) for (const mat of this.groundMats.values()) jobs.push(async () => {
      if (mat.userData.warm) return;
      mat.userData.warm = true;
      const was = tile.material;
      tile.material = mat;
      await compile(tile);
      tile.material = was;
    });
    for (const o of extra) jobs.push(async () => {
      if (o.userData.warm) return;
      o.userData.warm = true;
      // Shown only to the compiler: shrunk to nothing, so the frames drawn while it builds
      // never see it (the far side's disco dome used to flash up over the start view).
      const was = o.visible, sc = o.scale.clone();
      o.scale.setScalar(1e-6);
      o.visible = true;
      await compile(o);
      o.visible = was;
      o.scale.copy(sc);
    });
    this.warmJobs.push(...jobs);
  }
  private warmJobs: (() => Promise<void>)[] = [];
  /** Shader builds still queued. */
  get warmPending() { return this.warmJobs.length + (this.warming ? 1 : 0); }
  private warming = false;
  /** Run the next warm-up job, if the last one has finished. Called once a frame. */
  private stepWarmup() {
    if (this.warming || !this.warmJobs.length) return;
    this.warming = true;
    const job = this.warmJobs.shift()!;
    const t0 = performance.now();
    void job().finally(() => {
      this.warming = false;
      perf.mark(`warm-up ${Math.round(performance.now() - t0)} ms (${this.warmJobs.length} left)`);
    });
  }

  /** Re-theme ground tiles (after a seek or when sections arrive). */
  invalidateGround() { for (const t of this.tiles) t.index = -999; }

  /** Renders through the effects pipeline; falls back to a plain render if it cannot be built. */
  render() {
    this.stepWarmup();
    if (!this.pipeline && !this.pipelineFailed && this.fxEnabled) {
      try { this.pipeline = makePipeline(this.renderer, this.scene, this.camera, { ao: FLAGS.ao ?? false }); } catch (e) { console.warn('effects off:', e); this.pipelineFailed = true; }
    }
    if (this.renderer.xr?.isPresenting) { this.renderer.render(this.scene, this.camera); return; } // no post in a headset
    if (this.pipeline && this.fxEnabled) {
      try { this.pipeline.render(); return; } catch (e) { console.warn('effects off:', e); this.pipelineFailed = true; this.pipeline = null; }
    }
    this.renderer.render(this.scene, this.camera);
  }
  fxEnabled = true;
  pixelRatio = 1;
  private slowFor = 0;
  private fastFor = 0;
  /** Dynamic resolution: trade pixels for frame rate on slower machines (never below 0.5x). */
  adaptQuality(fps: number, dt: number) {
    if (fps < 45) { this.slowFor += dt; this.fastFor = 0; } else if (fps > 58) { this.fastFor += dt; this.slowFor = 0; } else { this.slowFor = this.fastFor = 0; }
    const max = Math.min(window.devicePixelRatio, 1.5);
    let next = this.pixelRatio;
    if (this.slowFor > 2) { next = Math.max(0.5, this.pixelRatio - 0.15); this.slowFor = 0; }
    if (this.fastFor > 6) { next = Math.min(max, this.pixelRatio + 0.1); this.fastFor = 0; }
    if (next !== this.pixelRatio) { this.pixelRatio = next; this.renderer.setPixelRatio(next); }
  }
  blurScale = 1;
  private baseFov = 50;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
}

/** The departure strip's words on the starship's launch screen. */
function launchText(text: string, countdown: number | null) {
  if (countdown !== null) return countdown > 0 ? `T-MINUS 00:${String(Math.min(99, countdown)).padStart(2, '0')}` : 'IGNITION';
  if (text === 'Departing') return 'IGNITION';
  return /line/i.test(text) ? 'AWAITING LAUNCH WINDOW' : text.toUpperCase();
}

/** The departures strip's words on the ghost train's sign. */
function spookyText(text: string, countdown: number | null) {
  if (countdown !== null) return countdown > 0 ? `DOORS CLOSE IN ${countdown}` : 'NO TURNING BACK';
  if (text === 'Departing') return 'NO TURNING BACK';
  return /line/i.test(text) ? 'THE DEAD ARE BOARDING' : text.toUpperCase();
}
