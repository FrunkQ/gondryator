import './style.css';
import * as THREE from 'three/webgpu';
import { World } from './render/world';
import { makeRig, OrbitRig, type CameraRig } from './render/rig';
import { Spawner } from './render/spawner';
import { OtherSide, ClampedGaze } from './render/otherside';
import { OTHER_SIDE } from './packs/other-side';
import { Performer } from './render/performer';
import { Visualiser } from './render/visualiser';
import type { CardInfo, ShowDriver } from './render/driver';
import { FxDirector, FX_LOOKS, type FxLook } from './render/fx';
import { VR } from './ui/vr';
import { SkyLife } from './render/flock';
import { U as SU } from './render/shaders';
import { LookController } from './ui/look';
import { DebugOverlay } from './ui/debug';
import { Player, toMono } from './audio/player';
import { readTags } from './audio/tags';
import { makeDemoTrack } from './audio/demo';
import { applyDelta, emptyScore, type Score, type ScoreDelta } from './score/types';
import { hashFile, loadScore, saveScore } from './score/cache';
import { parseMidi, scoreToMidi, type MidiImport } from './score/midi';
import { PACKS, HIDDEN_PACKS } from './packs';
import type { Pack } from './packs/types';
import AnalysisWorker from './analysis/worker?worker&inline';
import { Analyzer } from './analysis/analyzer';
import { DEFAULT_TUNING, isDefaultTuning, type Tuning } from './analysis/tuning';
import type { AutoTuneResult } from './analysis/autotune';
import { TuningScreen } from './ui/tuning';
import { FrameAnalyser, perf } from './ui/frames';

/** Settings auto-tune found for one song (keyed by the file's hash), if any. */
function songTuning(hash: string): Tuning | null {
  try { const j = localStorage.getItem('gondryator.tuning.' + hash); return j ? { ...DEFAULT_TUNING, ...JSON.parse(j) } : null; } catch { return null; }
}
function saveSongTuning(hash: string, t: Tuning) {
  try { localStorage.setItem('gondryator.tuning.' + hash, JSON.stringify(t)); } catch { /* private window */ }
}

function savedTuning(): Tuning {
  try { return { ...DEFAULT_TUNING, ...JSON.parse(localStorage.getItem('gondryator.tuning') ?? '{}') }; } catch { return { ...DEFAULT_TUNING }; }
}

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

type Phase = 'landing' | 'title' | 'run' | 'ended';

const MIN_LOOKAHEAD = 10; // seconds the score must be ahead of the playhead before the music starts
const GUARD_LOOKAHEAD = 4; // below this, stop at a signal and wait
const RUN_IN = 4; // seconds of acceleration between the title block and the first note

class App {
  pack: Pack = [...PACKS, ...HIDDEN_PACKS].find(p => p.id === params.get('pack')) ?? PACKS[0];
  world!: World;
  rig!: CameraRig;
  /** The pack's spawn mode: pass-by scenery (Spawner) or a cast on a stage (Performer). */
  driver: ShowDriver | null = null;
  /** The last title/landing/end card, re-shown when the driver is rebuilt. */
  private lastCard: { kind: 'landing' | 'title' | 'end'; x: number; info: CardInfo; opts: { end?: boolean; trackside?: boolean } } | null = null;
  look!: LookController;
  private other: OtherSide | null = null;
  private mainGaze: ClampedGaze | null = null;
  fx!: FxDirector;
  vr!: VR;
  sky!: SkyLife;
  debug: DebugOverlay;
  player = new Player();
  score: Score | null = null;
  midi: MidiImport | null = null;
  phase: Phase = 'landing';
  p = 0; // seconds since page load (title clock)
  dropAt = 0;
  titleCross = 0;
  signalStop = false;
  worker: Worker | null = null;
  analysedSec = 0;
  analysisWall = 0;
  fps = 60;
  private lastFrame = performance.now();
  private t0 = performance.now() / 1000;
  private canvas: HTMLCanvasElement;
  private stage: HTMLElement;
  private uiTimer = 0;
  private endBuilt = false;
  private endedAt: number | null = null;
  private art: HTMLImageElement | null = null;
  private trackInfo = { title: '', artist: '', album: '' };
  /** The music parser's settings (Tuning screen), and the track to re-parse with them. */
  private tuning = savedTuning();
  /** The settings this track is parsed with: yours, or what auto-tune found for this song. */
  private trackTuning = this.tuning;
  private trackHash = '';
  private tuneWorker: Worker | null = null;
  private audioBuf: AudioBuffer | null = null;
  private lastFile: { buf: ArrayBuffer; name: string } | null = null;
  private tuner!: TuningScreen;
  private frames!: FrameAnalyser;
  /** What was on screen last frame, so the frame analyser can say what changed. */
  private seen = { sec: -1, theme: '', other: '', look: '' };

  constructor() {
    this.stage = $('#stage');
    this.canvas = $('#view');
    this.debug = new DebugOverlay(this.stage);
    if (params.has('debug')) this.debug.toggle(true);
  }

  async start() {
    if (params.has('virtual')) this.player.virtual = 0;
    await this.buildWorld(this.pack);
    this.bindUI();
    this.player.onEnded = () => { this.endedAt = this.p; };
    // Idle scenery around the first station, before any track is loaded.
    this.attachScore(emptyScore({ title: '', artist: '', album: '', durationSec: 0, art: null, hash: '' }, 0));
    this.showCard('landing', 0, { name: 'Gondryator', line2: 'Drop a music file to depart' });
    // three drives the loop so a headset can take it over.
    this.world.renderer.setAnimationLoop(this.frame);
    this.vr = new VR(() => this.world.renderer, $<HTMLButtonElement>('#vr'), t => this.toast(t, 4000));
    void this.vr.init();
    if (params.has('demo')) void this.loadDemo();
  }

  private async buildWorld(pack: Pack) {
    const prev = this.world;
    this.pack = pack;
    this.world = new World(pack);
    await this.world.init(this.canvas, params.has('webgl'), prev?.renderer);
    this.world.fxEnabled = params.get('fx') !== 'off';
    const locked = this.fx?.locked ?? (FX_LOOKS.includes(params.get('fx') as FxLook) ? params.get('fx') as FxLook : null);
    this.fx = new FxDirector(pack.fx?.cycle ?? ['clean'], pack.fx?.bySection);
    this.fx.locked = locked;
    this.fx.warpAll = pack.vehicle === 'ship';
    this.sky = new SkyLife(this.world.mode === 'stage');
    this.sky.birdsVisible = !this.world.ship && !this.world.void;
    this.world.scene.add(this.sky.group);
    this.rig = makeRig(pack.rig);
    this.world.themeForX = x => {
      if (!this.driver) return pack.themeCycle[0];
      const t = this.rig.timeAtTravel(x);
      return t < 0 ? pack.themeCycle[0] : this.driver.themeAt(t);
    };
    if (!this.look) {
      this.look = new LookController(this.stage, pack.rig.maxYaw, pack.rig.maxPitch, () => {
        const h = this.stage.clientHeight || 1;
        return THREE.MathUtils.degToRad(this.world.camera.fov) / h;
      });
      if (params.has('wander')) this.look.wander = true;
    }
    this.look.maxYaw = pack.rig.lookYaw ?? pack.rig.maxYaw;
    this.look.wanderYaw = pack.rig.maxYaw;
    // Waiting at the first station you face the board square on; the angled view comes with the ride.
    const angled = this.phase !== 'landing';
    this.look.setRest(angled ? THREE.MathUtils.degToRad(pack.rig.startYaw ?? 0) : 0, angled ? THREE.MathUtils.degToRad(pack.rig.startPitch ?? 0) : 0);
    this.onResize();
    const cr = $('#credits');
    cr.textContent = pack.credits + ' ';
    if (pack.inspiration) {
      const a = document.createElement('a');
      a.href = pack.inspiration.url; a.target = '_blank'; a.rel = 'noopener';
      a.textContent = `Watch the original ↗`;
      cr.appendChild(a);
    }
  }

  // ------------------------------------------------------------------ loading
  async loadFiles(files: File[]) {
    const audio = files.find(f => /\.(mp3|wav|flac|ogg|oga|opus|m4a|mp4|aac|webm)$/i.test(f.name) || f.type.startsWith('audio/'));
    const mid = files.find(f => /\.(mid|midi)$/i.test(f.name));
    if (mid) {
      try { this.midi = parseMidi(await mid.arrayBuffer()); this.toast(`Using MIDI for ${[...this.midi.stems].join(', ')}`); }
      catch (e) { this.toast('Could not read that MIDI file'); }
    }
    if (!audio) { if (!mid) this.toast('That does not look like an audio file'); return; }
    await this.loadAudio(await audio.arrayBuffer(), audio.name);
  }

  async loadDemo() {
    await this.loadAudio(makeDemoTrack(), 'Test Tones - Valence Line.wav');
  }

  private async loadAudio(buf: ArrayBuffer, name: string) {
    this.lastFile = { buf: buf.slice(0), name };
    if (this.phase !== 'landing') this.resetForNewTrack();
    $('#drop').classList.add('hidden');
    void this.player.ctx.resume();
    this.phase = 'title';
    this.dropAt = this.p;
    this.rig.depart(this.p);
    const tags = readTags(buf, name);
    this.trackInfo = { title: tags.title, artist: tags.artist, album: tags.album };
    if (tags.art) this.art = await loadImage(URL.createObjectURL(tags.art)).catch(() => null);
    // The train rolls up to a board with the song's name, turning to the angled view on the way,
    // and stops there while the analysis and the shader warm-up finish.
    this.titleCross = this.rig.titleArrival();
    this.look.restYaw = THREE.MathUtils.degToRad(this.pack.rig.startYaw ?? 0);
    this.look.restPitch = THREE.MathUtils.degToRad(this.pack.rig.startPitch ?? 0);
    this.look.center();
    this.showCard('title', this.titleBoardX(), {
      name: tags.title || 'Untitled', line2: [tags.artist, tags.album].filter(Boolean).join(' · ') || ' ', art: this.art,
    }, { trackside: true });
    const hash = await hashFile(buf);
    this.trackHash = hash;
    // Settings saved for this song (by auto-tune or the tuning screen) win over the general ones.
    this.trackTuning = songTuning(hash) ?? this.tuning;
    this.tuner?.setTuning(this.trackTuning);
    const audioBuf = await this.player.decode(buf.slice(0));
    this.audioBuf = audioBuf;
    const track = { title: tags.title, artist: tags.artist, album: tags.album, durationSec: audioBuf.duration, art: null, hash };
    const cached = this.midi || !isDefaultTuning(this.trackTuning) ? null : await loadScore(hash);
    if (cached && cached.final) {
      this.score = cached;
      this.analysedSec = cached.track.durationSec;
      this.attachScore();
      this.toast('Score loaded from cache');
      return;
    }
    this.score = emptyScore(track, audioBuf.duration);
    if (this.midi) this.score.analysis.mode = 'midi';
    this.attachScore();
    this.startAnalysis(audioBuf);
  }

  private attachScore(placeholder?: Score) {
    const s = placeholder ?? this.score!;
    if (!placeholder) this.rig.attachScore(s);
    // A new score on the same ride keeps the instanced meshes, and so the shaders built for them.
    const pools = this.driver instanceof Spawner ? this.driver.pools : undefined;
    if (this.driver) { this.driver.reset(-1e9); this.world.scene.remove(this.driver.group); }
    this.driver = this.pack.spawnMode === 'perform'
      ? new Performer(this.pack, this.rig, s, this.world.camera)
      : this.pack.spawnMode === 'visualise'
        ? new Visualiser(this.pack, s, this.world.camera)
        : new Spawner(this.pack, this.rig, s, this.world.camera, undefined, pools);
    this.world.scene.add(this.driver.group);
    // Star Guitar has a second window: invented worlds across the aisle, on the same beat.
    if (this.other && this.pack.rig.lookYaw && !params.has('noother')) {
      this.other.reset(-1e9);
      this.other.setScore(s, this.world.camera);
    } else if (this.pack.rig.lookYaw && this.pack.spawnMode !== 'perform' && !params.has('noother')) {
      // The train looks out on invented worlds; the starship on a psychedelic double of its own.
      const trippy = this.pack.otherSide === 'trippy';
      const otherPack = trippy ? { ...this.pack, id: `${this.pack.id}-mirror`, sectionEvents: undefined } : OTHER_SIDE;
      this.other = new OtherSide(otherPack, this.rig, s, this.world.camera, trippy ? 0.9 : 0);
      this.world.scene.add(this.other.group);
      this.other.spawner.refreshLeads();
    }
    this.fx.setScore(placeholder ? null : s);
    this.driver.refreshLeads();
    if (this.lastCard) this.driver.card?.(this.lastCard.kind, this.lastCard.info);
    this.world.invalidateGround();
    // Build every shader now rather than when each thing first appears mid-ride.
    if (!params.has('nowarm')) this.world.warmup(this.other?.hidden ?? []);
  }

  /** Tell the frame analyser about section, scenery and look changes this frame. */
  private markChanges(s: number) {
    const sc = this.score, seen = this.seen;
    if (sc && sc.sections.length) {
      let i = -1;
      for (let k = 0; k < sc.sections.length; k++) if (sc.sections[k].t <= s) i = k;
      if (i !== seen.sec) { if (i >= 0) perf.mark(`section → ${sc.sections[i].label}`); seen.sec = i; }
    }
    const theme = this.driver?.themeAt(s) ?? '';
    if (theme !== seen.theme) { if (seen.theme) perf.mark(`scenery → ${theme}`); seen.theme = theme; }
    const other = this.other?.spawner.themeAt(s) ?? '';
    if (other !== seen.other) { if (seen.other) perf.mark(`other window → ${other}`); seen.other = other; }
    const look = this.fx.locked ?? this.fx.look;
    if (look !== seen.look) { if (seen.look) perf.mark(`look → ${look}`); seen.look = look; }
  }

  /** A landing, title or end card: a station board on the line, or whatever the pack's show uses. */
  /** Where the song's name board stands: right in the angled view from where the train stops. */
  private titleBoardX() {
    const x = this.rig.titleTravel(this.rig.titleArrival());
    return this.world.mode === 'train' ? x + 8.2 * Math.tan(THREE.MathUtils.degToRad(this.pack.rig.startYaw ?? 0)) : x;
  }

  private showCard(kind: 'landing' | 'title' | 'end', x: number, info: CardInfo, opts: { end?: boolean; trackside?: boolean } = {}) {
    this.lastCard = { kind, x, info, opts };
    perf.mark(`${kind} board`);
    if (this.driver?.card?.(kind, info)) return;
    const board = this.world.stationBoard(x, info, opts);
    // Build its shaders before it comes into view.
    if (!params.has('nowarm')) this.world.warmup([board]);
  }

  private startAnalysis(buf: AudioBuffer) {
    this.worker?.terminate();
    const pcm = toMono(buf), sampleRate = buf.sampleRate;
    let midiPtr = 0;
    const onMessage = (m: any) => {
      if (m.type === 'progress') { this.analysedSec = m.analyzedSec; this.analysisWall = m.wallSec; }
      if (m.type === 'delta' && this.score) {
        const d: ScoreDelta = m.delta;
        if (this.midi) {
          // MIDI replaces the matching analysis; merge MIDI events up to the new frontier.
          const mine = this.midi.events;
          d.events = d.events.filter(e => !this.midi!.covers(e));
          const add = [];
          while (midiPtr < mine.length && mine[midiPtr].t < d.frontierSec) add.push({ ...mine[midiPtr++] });
          d.events = [...d.events, ...add].sort((a, b) => a.t - b.t);
          d.events.forEach((e, i) => { if (!e.id) e.id = 'm' + (midiPtr + i); });
        }
        applyDelta(this.score, d);
        perf.mark(`score update (+${d.events.length} events)`);
        if (d.final) {
          this.score.final = true;
          if (isDefaultTuning(this.trackTuning)) void saveScore(this.score);
          // First play of a song on the default settings: learn better ones in the background.
          if (!this.midi && isDefaultTuning(this.trackTuning) && !params.has('noautotune')) void this.backgroundAutoTune(pcm, sampleRate, this.trackHash);
        }
      }
    };
    const throttle = Number(params.get('slow') ?? 0);
    const onMainThread = () => {
      // Workers can be blocked (strict sandboxes): analyse on the main thread in small slices.
      this.worker = null;
      const a = new Analyzer(pcm, buf.sampleRate, { chunkSec: 1.5, tuning: this.trackTuning });
      const t0 = performance.now();
      const tick = () => {
        if (this.score?.track.durationSec !== buf.duration) return; // a new track replaced this one
        const d = a.step();
        if (d) onMessage({ type: 'delta', delta: d });
        onMessage({ type: 'progress', analyzedSec: a.analyzedSec, wallSec: (performance.now() - t0) / 1000 });
        if (!a.finished) setTimeout(tick, throttle * 1.5);
      };
      tick();
    };
    try {
      const w = new AnalysisWorker();
      this.worker = w;
      let alive = false;
      w.onmessage = (ev: MessageEvent) => { alive = true; onMessage(ev.data); };
      w.onerror = () => { if (!alive) { w.terminate(); onMainThread(); } };
      w.postMessage({ type: 'start', pcm: pcm.slice(), sampleRate: buf.sampleRate, throttleMsPerSec: throttle, tuning: this.trackTuning });
    } catch {
      onMainThread();
    }
  }

  /**
   * Auto-tune (analysis/autotune.ts) in a worker of its own: re-parses a loud stretch of the song
   * a couple of dozen times and returns the settings that gave the most self-consistent parse.
   * Resolves null if workers are unavailable or a newer job replaced it.
   */
  private runAutoTune(pcm: Float32Array, sampleRate: number, start: Tuning, onProgress?: (p: number) => void): Promise<AutoTuneResult | null> {
    this.tuneWorker?.terminate();
    return new Promise(resolve => {
      let w: Worker;
      try { w = new AnalysisWorker(); } catch { resolve(null); return; }
      this.tuneWorker = w;
      w.onmessage = (ev: MessageEvent) => {
        if (ev.data.type === 'autotune-progress') onProgress?.(ev.data.p);
        if (ev.data.type === 'autotune-done') { w.terminate(); if (this.tuneWorker === w) this.tuneWorker = null; resolve(ev.data.result); }
      };
      w.onerror = () => { w.terminate(); resolve(null); };
      w.postMessage({ type: 'autotune', pcm: pcm.slice(), sampleRate, tuning: start });
    });
  }

  private async backgroundAutoTune(pcm: Float32Array, sampleRate: number, hash: string) {
    const r = await this.runAutoTune(pcm, sampleRate, DEFAULT_TUNING);
    if (!r || hash !== this.trackHash || !r.changes.length || r.score.total < r.baseline.total + 0.15) return;
    saveSongTuning(hash, r.tuning);
    this.tuner?.setTuning(r.tuning);
    this.toast(`Auto-tuned the parser for this song (${r.changes.length} setting${r.changes.length > 1 ? 's' : ''}). Next time it plays, it uses them.`, 5000);
  }

  /** Back to the first station for a new journey. */
  private resetForNewTrack() {
    this.worker?.terminate();
    this.worker = null;
    this.tuneWorker?.terminate();
    this.tuneWorker = null;
    this.player.pause();
    this.score = null;
    this.midi = null;
    this.endBuilt = false;
    this.signalStop = false;
    this.endedAt = null;
    this.art = null;
    for (const c of [...this.world.stations.children]) this.world.stations.remove(c);
    this.rig = makeRig(this.pack.rig);
    this.onResize();
    this.lastCard = null;
    this.attachScore(emptyScore({ title: '', artist: '', album: '', durationSec: 0, art: null, hash: '' }, 0));
    this.showCard('landing', 0, { name: 'Gondryator', line2: 'All change' });
    $('#endcard').classList.add('hidden');
    document.body.classList.remove('running', 'idle');
    this.phase = 'landing';
  }

  // ------------------------------------------------------------------ main loop
  private frame = (now: number) => {
    const dt = this.player.virtual !== null ? 1 / 30 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fps += (1 / Math.max(1e-3, dt) - this.fps) * 0.05;
    if (this.player.virtual === null && this.world) this.world.adaptQuality(this.fps, dt);
    if (this.player.virtual !== null) {
      // Test mode: every frame is 1/30 s of show time, however long it took to render.
      this.p += 1 / 30;
      this.player.tick(1 / 30);
    } else this.p = now / 1000 - this.t0; // real time: the title clock must not drift when frames are slow
    const head = this.vr?.headLook(this.world.train);
    if (head) this.look.setFromHead(head.yaw, head.pitch, dt); else this.look.update(dt);

    let s = this.p; // title phase: the rig is driven by the title clock
    const score = this.score;
    if (this.phase === 'title' && score) {
      const ahead = score.final ? Infinity : score.frontierSec;
      // Pull away from the name board only when the line ahead is read and every shader is built
      // (but never wait forever on the shaders).
      const warm = this.world.warmPending === 0 || this.p > this.titleCross + 15;
      const ready = ahead >= Math.min(MIN_LOOKAHEAD + 0.5, score.track.durationSec) && this.p >= this.titleCross + 1.2 && warm;
      if (ready) this.go();
    }
    if (this.phase === 'run' || this.phase === 'ended') {
      s = this.player.time;
      // After the last note the show clock keeps running so the train can roll into the terminus.
      if (score && !this.player.playing && this.endedAt !== null) s = score.track.durationSec + (this.p - this.endedAt);
      if (score && !score.final) {
        const ahead = score.frontierSec - s;
        if (!this.signalStop && this.player.playing && s > 0 && ahead < GUARD_LOOKAHEAD) {
          // Never let the visuals sync late: wait at a signal until the line ahead is clear.
          this.signalStop = true;
          this.player.pause();
          this.toast('Signal stop: waiting for the line ahead to clear', 3000);
        }
        if (this.signalStop && ahead > 8) { this.signalStop = false; this.player.play(this.player.time); }
      }
      if (score && this.phase === 'run' && s > score.track.durationSec + 0.2) this.end();
      // The train sees its terminus coming; a stage only shows the end card once the music stops.
      if (score && score.final && !this.endBuilt && (this.world.mode === 'train' || s > score.track.durationSec)) this.buildEndStation();
    }

    if (head) {
      if (this.rig instanceof OrbitRig) this.rig.gazeOffset = 0; // in a headset you turn your own head
      this.world.update(s, this.rig, this.look.yaw, this.look.pitch, true);
    } else if (this.rig instanceof OrbitRig) {
      // Wraparound packs: looking around walks you round the stage, so the show stays in view.
      this.rig.gazeOffset = this.look.yaw * 2;
      this.world.update(s, this.rig, 0, this.look.pitch * 0.5);
    } else this.world.update(s, this.rig, this.look.yaw, this.look.pitch);
    if (score) {
      const u = this.phase === 'title' || s < 0 ? 0 : Math.min(1, s / score.track.durationSec);
      this.world.setTimeOfDay(u);
    } else this.world.setTimeOfDay(0);
    this.world.train.updateMatrixWorld(true);
    if (this.driver) {
      const running = this.phase === 'run' || this.phase === 'ended';
      const frontier = score?.final ? Infinity : score?.frontierSec ?? 0;
      this.mainGaze ??= new ClampedGaze(this.look, 1);
      this.mainGaze.limit = THREE.MathUtils.degToRad(this.pack.rig.maxYaw);
      this.driver.update(s, dt, this.mainGaze, frontier, running);
      if (this.driver instanceof Visualiser) {
        // The visualiser picks the post-effects look per scene, and crashes the picture on a change.
        this.fx.override = this.driver.look;
        this.fx.feedback = this.driver.feedbackNow;
        if (this.driver.takeCrash()) this.fx.crash();
      }
      this.other?.update(s, dt, this.look, frontier, running, this.world.train.position.x);
    }
    try {
      this.sky.update(s, dt, this.score, this.phase === 'run' || this.phase === 'ended', this.world.train.position, SU.energy.value);
      // Star Guitar's main window stays true to the video; the looks come in as you turn round.
      this.fx.amount = this.pack.rig.lookYaw ? ((1 - Math.cos(this.look.yaw)) / 2) ** 2 : 1;
      this.fx.update(s, dt, this.phase === 'run' || this.phase === 'ended', this.world.night, this.world.camera.aspect);
      if (perf.on) this.markChanges(s);
      if (!this.tuner?.isOpen) this.world.render(); // the tuning screen covers the view
      this.frames?.frame(s);
    } catch (e) {
      // Some browsers expose WebGPU but lack features three.js needs: fall back to WebGL2.
      if (this.world.backend === 'WebGPU' && !params.has('webgl') && this.phase === 'landing') {
        location.search = location.search + (location.search ? '&' : '?') + 'webgl';
        return;
      }
      throw e;
    }
    this.updateHud(s);
  };

  private go() {
    this.phase = 'run';
    this.rig.go(this.p, RUN_IN);
    this.player.play(-RUN_IN);
    this.driver?.reset(-RUN_IN);
    this.other?.reset(-RUN_IN);
    this.world.invalidateGround();
    document.body.classList.add('running');
    this.pokeUI();
    if (params.has('seek')) setTimeout(() => this.seek(Number(params.get('seek'))), (RUN_IN + 0.5) * 1000);
    // Test mode: jump straight to a show time.
    if (params.has('start')) this.seek(Number(params.get('start')));
  }

  private end() {
    this.phase = 'ended';
    $('#endcard .lead').textContent = this.world.mode === 'train' ? 'Terminus.' : 'Curtain.';
    // At the end of a train ride, invite people to hear the same song again with no train at all.
    $('#tonon').classList.toggle('hidden', this.pack.id === 'non-gondry');
    $('#endcard').classList.remove('hidden');
  }

  private buildEndStation() {
    this.endBuilt = true;
    const D = this.score!.track.durationSec;
    const stopX = this.rig.travel(D + 9);
    this.showCard('end', stopX, {
      name: this.world.mode === 'train' ? 'Terminus' : 'Curtain',
      line2: [this.trackInfo.title, this.trackInfo.artist].filter(Boolean).join(' — '),
      line3: this.pack.credits + '  Made with the Gondryator and three.js.',
      art: this.art,
    }, { end: true });
  }

  seek(t: number) {
    if (!this.score || this.phase === 'title' || this.phase === 'landing') return;
    this.endedAt = null;
    const limit = this.score.final ? this.score.track.durationSec - 0.5 : this.score.frontierSec - MIN_LOOKAHEAD;
    t = Math.max(0, Math.min(limit, t));
    this.player.seek(t);
    if (!this.player.playing && this.phase === 'ended') { this.phase = 'run'; $('#endcard').classList.add('hidden'); this.player.play(t); }
    this.driver?.reset(t);
    this.other?.reset(t);
    this.world.invalidateGround();
  }

  togglePause() {
    if (this.phase !== 'run' && this.phase !== 'ended') return;
    if (this.player.playing) this.player.pause();
    else {
      if (this.phase === 'ended' || this.endedAt !== null) { this.seek(0); return; }
      this.player.play(this.player.time);
    }
  }

  async switchPack(id: string) {
    const pack = [...PACKS, ...HIDDEN_PACKS].find(p => p.id === id);
    if (!pack || pack === this.pack) return;
    const wasRunning = this.phase === 'run' || this.phase === 'ended';
    const s = this.player.time;
    this.world.dispose();
    // The old ride's spawners went with its scene.
    if (this.driver) this.driver.reset(-1e9);
    this.driver = null; this.other = null;
    await this.buildWorld(pack);
    if (this.score) {
      if (wasRunning) this.rig.goImmediate();
    }
    const card = this.lastCard;
    this.lastCard = null;
    if (this.phase === 'title') this.rig.depart(this.dropAt);
    this.attachScore(this.score ? undefined : emptyScore({ title: '', artist: '', album: '', durationSec: 0, art: null, hash: '' }, 0));
    (this.driver as ShowDriver | null)?.reset(wasRunning ? s : this.score ? 0 : -1e9);
    (this.other as OtherSide | null)?.reset(wasRunning ? s : this.score ? 0 : -1e9);
    this.endBuilt = false;
    if (this.phase === 'landing' && card) this.showCard('landing', 0, card.info);
    if (this.phase === 'title') this.showCard('title', this.titleBoardX(), { name: this.trackInfo.title || 'Untitled', line2: this.trackInfo.artist || ' ', art: this.art }, { trackside: true });
  }

  // ------------------------------------------------------------------ UI
  private cycleFx() {
    const look = this.fx.cycleLock();
    const names: Record<string, string> = { auto: 'Effects follow the music', clean: 'Clean (photographic)', prism: 'Prism', trip: 'Trip', kaleido: 'Kaleidoscope', liquid: 'Liquid', thermal: 'Thermal', echo: 'Echo', fold: 'Fold' };
    this.toast(names[look] ?? look);
    $('#fx').title = `Effects: ${look}. Click or press X to pick a look`;
  }

  private onResize = () => {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    this.world.resize(w, h);
    this.rig.setAspect(w / h);
    this.driver?.refreshLeads();
  };

  private toast(text: string, ms = 2500) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout((t as any)._h);
    (t as any)._h = setTimeout(() => t.classList.remove('show'), ms);
  }

  private pokeUI() {
    document.body.classList.remove('idle');
    clearTimeout(this.uiTimer);
    this.uiTimer = window.setTimeout(() => { if (this.phase === 'run') document.body.classList.add('idle'); }, 3500);
  }

  private bindUI() {
    // Embedded viewers (iframes) usually block downloads: hide the export buttons there.
    if (window.self !== window.top) { $('#json').hidden = true; $('#mid').hidden = true; }
    window.addEventListener('resize', this.onResize);
    window.addEventListener('pointermove', () => this.pokeUI());
    const input = $<HTMLInputElement>('#file');
    $('#choose').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files?.length) void this.loadFiles([...input.files]); });
    $('#demo').addEventListener('click', () => void this.loadDemo());
    const drop = $('#stage');
    drop.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
    drop.addEventListener('dragleave', () => document.body.classList.remove('dragging'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      document.body.classList.remove('dragging');
      const files = [...(e.dataTransfer?.files ?? [])];
      const packFile = files.find(f => f.name.endsWith('.json'));
      if (packFile) { void this.loadPackFile(packFile); return; }
      void this.loadFiles(files);
    });
    $('#play').addEventListener('click', () => this.togglePause());
    $('#again').addEventListener('click', () => this.seek(0));
    $('#tonon').addEventListener('click', async () => {
      await this.switchPack('non-gondry');
      $<HTMLSelectElement>('#pack').value = 'non-gondry';
      this.seek(0);
    });
    $('#another').addEventListener('click', () => input.click());
    const scrub = $<HTMLInputElement>('#scrub');
    scrub.addEventListener('input', () => { if (this.score) this.seek((Number(scrub.value) / 1000) * this.score.track.durationSec); });
    const sel = $<HTMLSelectElement>('#pack');
    for (const p of PACKS) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); }
    if (!PACKS.includes(this.pack)) { const o = document.createElement('option'); o.value = this.pack.id; o.textContent = this.pack.name; sel.appendChild(o); }
    sel.value = this.pack.id;
    $('#fx').addEventListener('click', () => this.cycleFx());
    sel.addEventListener('change', () => void this.switchPack(sel.value));
    $('#center').addEventListener('click', () => this.look.center());
    $('#gyro').addEventListener('click', async () => this.toast((await this.look.enableGyro()) ? 'Gyroscope on: move your phone to look around' : 'No gyroscope available'));
    $('#dbg').addEventListener('click', () => this.debug.toggle());
    $('#json').addEventListener('click', () => this.score && download(new Blob([JSON.stringify(this.score)], { type: 'application/json' }), slug(this.trackInfo.title) + '.score.json'));
    $('#mid').addEventListener('click', () => this.score && download(new Blob([scoreToMidi(this.score) as BlobPart], { type: 'audio/midi' }), slug(this.trackInfo.title) + '.mid'));
    $('#fs').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    // The tuning screen: a piano roll of what the parser heard, with all its settings.
    this.tuner = new TuningScreen({
      audio: () => this.audioBuf,
      player: this.player,
      togglePlay: () => {
        if (this.phase === 'run' || this.phase === 'ended') this.togglePause();
        else if (this.player.playing) this.player.pause();
        else if (this.audioBuf && this.phase === 'landing') this.player.play(Math.max(0, this.player.time));
      },
      autoTune: (start, onProgress) => {
        const buf = this.audioBuf;
        if (!buf) return Promise.resolve(null);
        const hash = this.trackHash;
        return this.runAutoTune(toMono(buf), buf.sampleRate, start, onProgress).then(r => {
          if (r && hash === this.trackHash) saveSongTuning(hash, r.tuning);
          return r;
        });
      },
      apply: t => {
        // With a song loaded the settings are kept for that song; otherwise they become the default.
        if (this.trackHash) {
          if (isDefaultTuning(t)) { try { localStorage.removeItem('gondryator.tuning.' + this.trackHash); } catch { /* private window */ } }
          else saveSongTuning(this.trackHash, t);
        } else {
          this.tuning = t;
          try { localStorage.setItem('gondryator.tuning', JSON.stringify(t)); } catch { /* private window */ }
        }
        if (this.lastFile) void this.loadAudio(this.lastFile.buf, this.lastFile.name);
        this.toast(isDefaultTuning(t) ? 'Parser back on its default settings' : 'Re-parsing the track with these settings', 3000);
      },
    }, this.tuning);
    document.body.appendChild(this.tuner.el);
    // The frame analyser: frame times against the show clock, each stutter labelled with its cause.
    this.frames = new FrameAnalyser(() => this.world?.renderer);
    this.stage.appendChild(this.frames.el);
    $('#perf').addEventListener('click', () => this.frames.toggle());
    if (params.has('perf')) this.frames.toggle(true);
    $('#tune').addEventListener('click', () => this.tuner.toggle());
    if (params.has('tune')) this.tuner.toggle(true);
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 't' || e.key === 'T') this.tuner.toggle();
      if (e.key === 'p' || e.key === 'P') this.frames.toggle();
      if (this.tuner.isOpen) { if (e.key === ' ') { e.preventDefault(); (this.tuner.el.querySelector('.tn-play') as HTMLElement).click(); } return; }
      if (e.key === ' ') { e.preventDefault(); this.togglePause(); }
      if (e.key === 'd' || e.key === 'D') this.debug.toggle();
      if (e.key === 'g' || e.key === 'G') { this.look.wander = !this.look.wander; this.toast(this.look.wander ? 'Wandering-viewer test on (refocus metric in debug view)' : 'Wandering-viewer test off'); }
      if (e.key === 'c' || e.key === 'C') this.look.center();
      if (e.key === 'f' || e.key === 'F') $('#fs').click();
      if (e.key === 'x' || e.key === 'X') this.cycleFx();
      if ((e.key === 'r' || e.key === 'R') && this.driver instanceof Visualiser) this.toast(`New seed: ${this.driver.reroll()}`);
      if (e.key === 's' || e.key === 'S') { if (this.driver) { this.driver.steering = !this.driver.steering; this.driver.gazeSpawning = this.driver.steering; this.toast(this.driver.steering ? 'Refocusing on' : 'Refocusing off (objects stay where the original video would put them)'); } }
    });
  }

  private async loadPackFile(f: File) {
    try {
      const pack = JSON.parse(await f.text()) as Pack;
      if (!pack.id || !pack.layers || !pack.mapping) throw new Error('missing fields');
      const i = PACKS.findIndex(p => p.id === pack.id);
      if (i >= 0) PACKS[i] = pack; else PACKS.push(pack);
      const sel = $<HTMLSelectElement>('#pack');
      if (![...sel.options].some(o => o.value === pack.id)) { const o = document.createElement('option'); o.value = pack.id; o.textContent = pack.name; sel.appendChild(o); }
      sel.value = pack.id;
      this.pack = { ...this.pack, id: '__reload' } as Pack;
      await this.switchPack(pack.id);
      this.toast(`Loaded pack "${pack.name}"`);
    } catch (e) {
      this.toast('That pack.json could not be loaded: ' + (e as Error).message);
    }
  }

  private updateHud(s: number) {
    const sc = this.score;
    const dur = sc?.track.durationSec ?? 0;
    $('#time').textContent = sc ? `${fmt(Math.max(0, s))} / ${fmt(dur)}` : '';
    if (sc && document.activeElement !== $('#scrub')) $<HTMLInputElement>('#scrub').value = String(dur ? (Math.max(0, s) / dur) * 1000 : 0);
    if (sc) ($('#analysed') as HTMLElement).style.width = `${Math.min(100, (sc.final ? 1 : sc.frontierSec / dur) * 100)}%`;
    $('#play').textContent = this.player.playing ? '❚❚' : '▶';
    const status = $('#status');
    if (this.phase === 'title' && sc) {
      const rtf = this.analysisWall > 0 ? this.analysedSec / this.analysisWall : 0;
      status.textContent = sc.final || sc.frontierSec >= MIN_LOOKAHEAD ? 'Departing…' : `Reading the line ahead · ${Math.round(sc.frontierSec)}s of ${Math.round(MIN_LOOKAHEAD)}s${rtf ? ` · ${rtf.toFixed(0)}× real time` : ''}`;
    } else status.textContent = '';
    if (this.debug.visible) {
      const m = this.driver?.metric;
      const recent = m && m.recent.length ? Math.round((m.recent.filter(Boolean).length / m.recent.length) * 100) : 0;
      this.debug.lines = [
        `${this.world.backend}`,
        `${this.fps.toFixed(0)} fps`,
        `t ${s.toFixed(2)}`,
        sc ? `frontier +${sc.final ? '∞ (final)' : (sc.frontierSec - Math.max(0, s)).toFixed(1) + 's'}` : '',
        this.analysisWall ? `analysis ${(this.analysedSec / this.analysisWall).toFixed(0)}× rt` : '',
        `objects ${this.driver?.activeCount ?? 0}`,
        m ? `refocus ${m.total ? Math.round((m.hits / m.total) * 100) : 0}% (${m.hits}/${m.total}, last64 ${recent}%)` : '',
        `look ${(this.look.yaw * 57.3).toFixed(0)}°${this.look.wander ? ' wander' : ''}`,
        sc ? `${sc.analysis.mode} · bpm ${sc.tempo[sc.tempo.length - 1]?.bpm ?? '?'}` : '',
        this.driver instanceof Visualiser ? this.driver.status : '',
        `build ${__BUILD__}`,
      ].filter(Boolean);
    }
    this.debug.draw(sc, s);
    (window as any).__gondry = { phase: this.phase, s, yaw: Math.round(this.look.yaw * 57.3), fps: this.fps, metric: this.driver?.metric, frontier: sc?.frontierSec, final: sc?.final, objects: this.driver?.activeCount, backend: this.world.backend, events: sc?.events.length, viz: this.driver instanceof Visualiser ? this.driver.status : undefined, sections: sc?.sections, signalStop: this.signalStop };
  }
}

function fmt(t: number) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${s.toString().padStart(2, '0')}`; }
function slug(s: string) { return (s || 'track').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

declare const __BUILD__: string;
console.info(`Gondryator ${__BUILD__}`);
const app = new App();
(window as any).app = app;
$('#fork a').title += ` (build ${__BUILD__})`;
const started = app.start().catch(e => {
  console.error(e);
  $('#status').textContent = 'Could not start the 3D view: ' + (e as Error).message;
});
installable(app, started);

/**
 * Install as an app (a PWA): the manifest and service worker live in public/. Skipped in the
 * single-file build, which has nowhere to serve them from. Once installed, music files can be
 * opened with the Gondryator straight from the desktop (file_handlers in the manifest).
 */
function installable(app: App, started: Promise<unknown>) {
  if (import.meta.env.MODE === 'single' || !/^https?:$/.test(location.protocol)) return;
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = './manifest.webmanifest';
  document.head.appendChild(link);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(e => console.warn('service worker', e));
  // The browser offers installing when it is ready; show a quiet button for it.
  let prompt: any = null;
  const show = (on: boolean) => document.querySelectorAll('#fork .inst').forEach(el => el.classList.toggle('hidden', !on));
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; show(true); });
  window.addEventListener('appinstalled', () => { prompt = null; show(false); });
  $('#install').addEventListener('click', e => {
    e.preventDefault();
    if (!prompt) return;
    prompt.prompt();
    prompt.userChoice.finally(() => { prompt = null; show(false); });
  });
  // Opened with a music file from the desktop.
  const lq = (window as any).launchQueue;
  if (lq?.setConsumer) lq.setConsumer(async (p: { files?: FileSystemFileHandle[] }) => {
    if (!p.files?.length) return;
    const files = await Promise.all(p.files.map(h => h.getFile()));
    await started;
    void app.loadFiles(files);
  });
}
