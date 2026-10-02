import './style.css';
import * as THREE from 'three/webgpu';
import { World } from './render/world';
import { makeRig, OrbitRig, type CameraRig } from './render/rig';
import { Spawner } from './render/spawner';
import { Performer } from './render/performer';
import type { CardInfo, ShowDriver } from './render/driver';
import { FxDirector, FX_LOOKS, type FxLook } from './render/fx';
import { LookController } from './ui/look';
import { DebugOverlay } from './ui/debug';
import { Player, toMono } from './audio/player';
import { readTags } from './audio/tags';
import { makeDemoTrack } from './audio/demo';
import { applyDelta, emptyScore, type Score, type ScoreDelta } from './score/types';
import { hashFile, loadScore, saveScore } from './score/cache';
import { parseMidi, scoreToMidi, type MidiImport } from './score/midi';
import { PACKS } from './packs';
import type { Pack } from './packs/types';
import AnalysisWorker from './analysis/worker?worker&inline';
import { Analyzer } from './analysis/analyzer';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

type Phase = 'landing' | 'title' | 'run' | 'ended';

const MIN_LOOKAHEAD = 10; // seconds the score must be ahead of the playhead before the music starts
const GUARD_LOOKAHEAD = 4; // below this, stop at a signal and wait
const RUN_IN = 4; // seconds of acceleration between the title block and the first note

class App {
  pack: Pack = PACKS.find(p => p.id === params.get('pack')) ?? PACKS[0];
  world!: World;
  rig!: CameraRig;
  /** The pack's spawn mode: pass-by scenery (Spawner) or a cast on a stage (Performer). */
  driver: ShowDriver | null = null;
  /** The last title/landing/end card, re-shown when the driver is rebuilt. */
  private lastCard: { kind: 'landing' | 'title' | 'end'; x: number; info: CardInfo; opts: { end?: boolean; trackside?: boolean } } | null = null;
  look!: LookController;
  fx!: FxDirector;
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
    requestAnimationFrame(this.frame);
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
    this.onResize();
    $('#credits').textContent = pack.credits;
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
    if (this.phase !== 'landing') this.resetForNewTrack();
    $('#drop').classList.add('hidden');
    void this.player.ctx.resume();
    this.phase = 'title';
    this.dropAt = this.p;
    this.rig.depart(this.p);
    const tags = readTags(buf, name);
    this.trackInfo = { title: tags.title, artist: tags.artist, album: tags.album };
    if (tags.art) this.art = await loadImage(URL.createObjectURL(tags.art)).catch(() => null);
    // The title board crosses the window ~7 s after departure, while the analysis runs.
    this.titleCross = this.dropAt + 7.5;
    this.showCard('title', this.rig.titleTravel(this.titleCross), {
      name: tags.title || 'Untitled', line2: [tags.artist, tags.album].filter(Boolean).join(' · ') || ' ', art: this.art,
    }, { trackside: true });
    const hash = await hashFile(buf);
    const audioBuf = await this.player.decode(buf.slice(0));
    const track = { title: tags.title, artist: tags.artist, album: tags.album, durationSec: audioBuf.duration, art: null, hash };
    const cached = this.midi ? null : await loadScore(hash);
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
    if (this.driver) { this.driver.reset(-1e9); this.world.scene.remove(this.driver.group); }
    this.driver = this.pack.spawnMode === 'perform'
      ? new Performer(this.pack, this.rig, s, this.world.camera)
      : new Spawner(this.pack, this.rig, s, this.world.camera);
    this.world.scene.add(this.driver.group);
    this.fx.setScore(placeholder ? null : s);
    this.driver.refreshLeads();
    if (this.lastCard) this.driver.card?.(this.lastCard.kind, this.lastCard.info);
    this.world.invalidateGround();
  }

  /** A landing, title or end card: a station board on the line, or whatever the pack's show uses. */
  private showCard(kind: 'landing' | 'title' | 'end', x: number, info: CardInfo, opts: { end?: boolean; trackside?: boolean } = {}) {
    this.lastCard = { kind, x, info, opts };
    if (this.driver?.card?.(kind, info)) return;
    this.world.stationBoard(x, info, opts);
  }

  private startAnalysis(buf: AudioBuffer) {
    this.worker?.terminate();
    const pcm = toMono(buf);
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
        if (d.final) {
          this.score.final = true;
          void saveScore(this.score);
        }
      }
    };
    const throttle = Number(params.get('slow') ?? 0);
    const onMainThread = () => {
      // Workers can be blocked (strict sandboxes): analyse on the main thread in small slices.
      this.worker = null;
      const a = new Analyzer(pcm, buf.sampleRate, { chunkSec: 1.5 });
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
      w.postMessage({ type: 'start', pcm: pcm.slice(), sampleRate: buf.sampleRate, throttleMsPerSec: throttle });
    } catch {
      onMainThread();
    }
  }

  /** Back to the first station for a new journey. */
  private resetForNewTrack() {
    this.worker?.terminate();
    this.worker = null;
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
    requestAnimationFrame(this.frame);
    const dt = this.player.virtual !== null ? 1 / 30 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fps += (1 / Math.max(1e-3, dt) - this.fps) * 0.05;
    if (this.player.virtual === null && this.world) this.world.adaptQuality(this.fps, dt);
    if (this.player.virtual !== null) {
      // Test mode: every frame is 1/30 s of show time, however long it took to render.
      this.p += 1 / 30;
      this.player.tick(1 / 30);
    } else this.p = now / 1000 - this.t0; // real time: the title clock must not drift when frames are slow
    this.look.update(dt);

    let s = this.p; // title phase: the rig is driven by the title clock
    const score = this.score;
    if (this.phase === 'title' && score) {
      const ahead = score.final ? Infinity : score.frontierSec;
      const ready = ahead >= Math.min(MIN_LOOKAHEAD + 0.5, score.track.durationSec) && this.p >= this.titleCross + 1;
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

    if (this.rig instanceof OrbitRig) {
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
      this.driver.update(s, dt, this.look, score?.final ? Infinity : score?.frontierSec ?? 0, running);
    }
    try {
      this.fx.update(s, dt, this.phase === 'run' || this.phase === 'ended', this.world.night, this.world.camera.aspect);
      this.world.render();
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
    $('#endcard').classList.remove('hidden');
  }

  private buildEndStation() {
    this.endBuilt = true;
    const D = this.score!.track.durationSec;
    const stopX = this.rig.travel(D + 9);
    this.showCard('end', stopX, {
      name: this.world.mode === 'train' ? 'Terminus' : 'Curtain',
      line2: [this.trackInfo.title, this.trackInfo.artist].filter(Boolean).join(' — '),
      line3: this.pack.credits + '  Made with the Gondryator.',
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
    const pack = PACKS.find(p => p.id === id);
    if (!pack || pack === this.pack) return;
    const wasRunning = this.phase === 'run' || this.phase === 'ended';
    const s = this.player.time;
    this.world.dispose();
    await this.buildWorld(pack);
    if (this.score) {
      if (wasRunning) this.rig.goImmediate();
    }
    const card = this.lastCard;
    this.lastCard = null;
    if (this.phase === 'title') this.rig.depart(this.dropAt);
    this.attachScore(this.score ? undefined : emptyScore({ title: '', artist: '', album: '', durationSec: 0, art: null, hash: '' }, 0));
    this.driver!.reset(wasRunning ? s : this.score ? 0 : -1e9);
    this.endBuilt = false;
    if (this.phase === 'landing' && card) this.showCard('landing', 0, card.info);
    if (this.phase === 'title') this.showCard('title', this.rig.titleTravel(this.titleCross), { name: this.trackInfo.title || 'Untitled', line2: this.trackInfo.artist || ' ', art: this.art }, { trackside: true });
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
    $('#another').addEventListener('click', () => input.click());
    const scrub = $<HTMLInputElement>('#scrub');
    scrub.addEventListener('input', () => { if (this.score) this.seek((Number(scrub.value) / 1000) * this.score.track.durationSec); });
    const sel = $<HTMLSelectElement>('#pack');
    for (const p of PACKS) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); }
    sel.value = this.pack.id;
    $('#fx').addEventListener('click', () => this.cycleFx());
    sel.addEventListener('change', () => void this.switchPack(sel.value));
    $('#center').addEventListener('click', () => this.look.center());
    $('#gyro').addEventListener('click', async () => this.toast((await this.look.enableGyro()) ? 'Gyroscope on: move your phone to look around' : 'No gyroscope available'));
    $('#dbg').addEventListener('click', () => this.debug.toggle());
    $('#json').addEventListener('click', () => this.score && download(new Blob([JSON.stringify(this.score)], { type: 'application/json' }), slug(this.trackInfo.title) + '.score.json'));
    $('#mid').addEventListener('click', () => this.score && download(new Blob([scoreToMidi(this.score) as BlobPart], { type: 'audio/midi' }), slug(this.trackInfo.title) + '.mid'));
    $('#fs').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === ' ') { e.preventDefault(); this.togglePause(); }
      if (e.key === 'd' || e.key === 'D') this.debug.toggle();
      if (e.key === 'g' || e.key === 'G') { this.look.wander = !this.look.wander; this.toast(this.look.wander ? 'Wandering-viewer test on (refocus metric in debug view)' : 'Wandering-viewer test off'); }
      if (e.key === 'c' || e.key === 'C') this.look.center();
      if (e.key === 'f' || e.key === 'F') $('#fs').click();
      if (e.key === 'x' || e.key === 'X') this.cycleFx();
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
      ].filter(Boolean);
    }
    this.debug.draw(sc, s);
    (window as any).__gondry = { phase: this.phase, s, fps: this.fps, metric: this.driver?.metric, frontier: sc?.frontierSec, final: sc?.final, objects: this.driver?.activeCount, backend: this.world.backend, events: sc?.events.length, sections: sc?.sections, signalStop: this.signalStop };
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

const app = new App();
(window as any).app = app;
app.start().catch(e => {
  console.error(e);
  $('#status').textContent = 'Could not start the 3D view: ' + (e as Error).message;
});
