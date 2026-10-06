import './style.css';
import * as THREE from 'three/webgpu';
import { World } from './render/world';
import { makeRig, OrbitRig, type CameraRig } from './render/rig';
import { Spawner } from './render/spawner';
import { OtherSide, ClampedGaze } from './render/otherside';
import { OTHER_SIDE } from './packs/other-side';
import { SHIP_OTHER_SIDE } from './packs/ship-other-side';
import { HALLOWEEN_OTHER } from './packs/halloween';
import { Storm } from './render/storm';
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
import { DeepListen, deepPrecheck } from './analysis/deep';
import { SoundPass, soundsPrecheck } from './analysis/sounds';
import { DEFAULT_TUNING, isDefaultTuning, type Tuning } from './analysis/tuning';
import type { AutoTuneResult } from './analysis/autotune';
import { TuningScreen } from './ui/tuning';
import { FrameAnalyser, perf } from './ui/frames';
import { Dyno, type DynoResult } from './ui/dyno';
import { QUALITY, setQualityLevel } from './render/quality';
import { ListenAlong, canListenAlong } from './audio/listen';
import { Playlist, isAudio, canPickFolder, pickFolder, rememberFolder, lastFolder, regainAccess, type Track } from './ui/playlist';

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

const MIN_LOOKAHEAD = 10; // seconds the score must be ahead of the playhead before the music starts (at most)
const GUARD_LOOKAHEAD = 4; // below this, stop at a signal and wait
const RUN_IN = 4; // seconds of acceleration between the title block and the first note

/** Where you look when the ride starts (?yaw=150 overrides it, for testing the far window). */
const startYaw = (pack: Pack) => params.has('yaw') ? Number(params.get('yaw')) : pack.rig.startYaw ?? 0;

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
  storm: Storm | null = null;
  debug: DebugOverlay;
  player = new Player();
  score: Score | null = null;
  midi: MidiImport | null = null;
  phase: Phase = 'landing';
  p = 0; // seconds since page load (title clock)
  dropAt = 0;
  titleCross = 0;
  /** The dynamometer's verdict on this machine (null until it has run). */
  dyno: DynoResult | null = null;
  /** What the sign on the landing board says while the dynamometer runs, and how far it has got. */
  private dynoSign: { text: string; p: number | null } | null = null;
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
  private stoppedThisRide = false;
  private trackHash = '';
  private tuneWorker: Worker | null = null;
  private deep: DeepListen | null = null;
  private sounds: SoundPass | null = null;
  private audioBuf: AudioBuffer | null = null;
  private lastFile: { buf: ArrayBuffer; name: string } | null = null;
  /** Shuffle play over a folder: the next ride starts when this one reaches its terminus. */
  private playlist: Playlist | ListenAlong | null = null;
  private waitShown = '';
  private advancing = false;
  private preStarted = false;
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
    // ?detail=0..3 pins the detail level (render/quality.ts) for testing.
    if (params.has('detail')) setQualityLevel(Number(params.get('detail')));
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
    // The gatekeeper: test the machine while the rider looks for a song (not in the stepped-clock tests).
    if (!params.has('nodyno') && (this.player.virtual === null || params.has('dyno'))) void this.runDyno();
  }

  /** The words the landing sign uses for the test, in each ride's own language. */
  private dynoWords() {
    if (this.pack.id === 'non-gondry') return 'Venue sound test';
    const tpl = this.pack.title?.template;
    return tpl === 'launch-screen' ? 'Test firing rockets' : tpl === 'ghost-gate' ? 'Rattling the chains' : 'Train on the dynamometer';
  }

  /**
   * Runs the dynamometer (ui/dyno.ts) on the landing screen, with its progress on the sign. A
   * machine that can't give a good ride is told so, plainly, on the sign and in a pop-up; a light one
   * leaves deep listen off.
   */
  private async runDyno() {
    const dyno = new Dyno(this.world.renderer, () => this.world.pixelRatio);
    const at = performance.now();
    try {
      this.dyno = await dyno.run(p => { this.dynoSign = { text: this.dynoWords(), p }; });
    } catch (e) {
      console.warn('Dynamometer failed', e);
      this.dynoSign = null;
      return;
    }
    const r = this.dyno;
    console.info(`Dynamometer (${Math.round(performance.now() - at)} ms): ${r.headline}; ride ~${r.estimate.ride} fps, disco ~${r.estimate.disco} fps`, r);
    this.dynoSign = { text: r.level === 'ok' ? (r.light ? 'All clear · running light' : 'All clear') : r.headline, p: null };
    if (r.level !== 'ok') {
      const gate = $('#gate');
      $('#gate-head').textContent = r.level === 'none' ? 'This needs 3D acceleration' : r.headline;
      $('#gate-advice').replaceChildren(...[
        ...r.advice,
        'The Gondryator reads the whole track and draws everything with shaders, so it is all graphics-card work: a faster machine gives a far better ride.',
      ].map(a => Object.assign(document.createElement('li'), { textContent: a })));
      gate.classList.toggle('none', r.level === 'none');
      gate.classList.remove('hidden');
      $('#gate-ok').onclick = () => gate.classList.add('hidden');
    }
    // A slow machine starts at a lower resolution; the frame rate lifts it again if it can. Running
    // light also tones the detail down (fewer particles; render/quality.ts), and the governor in
    // World.adaptQuality only climbs back part of the way.
    if (r.level === 'slow' && this.world.pixelRatio > 0.75) { this.world.pixelRatio = 0.75; this.world.renderer.setPixelRatio(0.75); }
    if (r.light && !params.has('detail')) {
      setQualityLevel(r.level === 'slow' || r.level === 'none' ? 1 : 2);
      this.world.detailCap = 2;
    }
  }

  private async buildWorld(pack: Pack) {
    const prev = this.world;
    this.pack = pack;
    // The door on the start screen leads to the discothèque, and back out to the trains from it.
    document.body.classList.toggle('disco', pack.id === 'non-gondry');
    const sign = document.querySelector('#door .sign');
    if (sign) sign.textContent = pack.id === 'non-gondry' ? 'To the trains' : 'Discothèque';
    this.world = new World(pack);
    if (prev) this.world.detailCap = prev.detailCap;
    await this.world.init(this.canvas, params.has('webgl'), prev?.renderer);
    this.world.fxEnabled = params.get('fx') !== 'off';
    const locked = this.fx?.locked ?? (FX_LOOKS.includes(params.get('fx') as FxLook) ? params.get('fx') as FxLook : null);
    this.fx = new FxDirector(pack.fx?.cycle ?? ['clean'], pack.fx?.bySection, pack.palettes);
    this.fx.locked = locked;
    this.fx.warpAll = pack.vehicle === 'ship';
    this.sky = new SkyLife(this.world.mode === 'stage');
    this.sky.birdsVisible = !this.world.ship && !this.world.void;
    this.world.scene.add(this.sky.group);
    // Rain, lightning and the pulse on the beat, for a stormy ride (pack.storm).
    this.storm = pack.storm ? new Storm(pack, this.world) : null;
    if (this.storm) this.world.scene.add(this.storm.group);
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
    this.look.setRest(angled ? THREE.MathUtils.degToRad(startYaw(pack)) : 0, angled ? THREE.MathUtils.degToRad(pack.rig.startPitch ?? 0) : 0);
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
    // A pile of songs is a playlist.
    const songs = files.filter(f => isAudio(f.name) || f.type.startsWith('audio/'));
    if (songs.length > 1) { this.startPlaylist(Playlist.fromFiles(songs, 'the pile you dropped')); return; }
    const audio = files.find(f => /\.(mp3|wav|flac|ogg|oga|opus|m4a|mp4|aac|webm)$/i.test(f.name) || f.type.startsWith('audio/'));
    const mid = files.find(f => /\.(mid|midi)$/i.test(f.name));
    if (mid) {
      try { this.midi = parseMidi(await mid.arrayBuffer()); this.toast(`Using MIDI for ${[...this.midi.stems].join(', ')}`); }
      catch (e) { this.toast('Could not read that MIDI file'); }
    }
    if (!audio) { if (!mid) this.toast('That does not look like an audio file'); return; }
    await this.loadAudio(await audio.arrayBuffer(), audio.name);
  }

  private startPlaylist(pl: Playlist | ListenAlong) {
    if (pl instanceof Playlist && !pl.size) { this.toast(`No music found in ${pl.name}`, 3500); return; }
    if (this.playlist instanceof ListenAlong && this.playlist !== pl) this.playlist.stop();
    this.playlist = pl;
    if (pl instanceof ListenAlong) {
      this.toast('Listening along. The ride runs one song behind the tab, so it can see each whole song coming: it starts when the first song ends. (Your own music files are still the best ride.)', 8000);
      return;
    }
    $('#next').classList.remove('hidden');
    this.toast(`Shuffling ${pl.size} song${pl.size === 1 ? '' : 's'} from ${pl.name}`, 3500);
    void this.playNext();
  }

  /** The next song in the shuffle (skipping any the browser cannot play). */
  private async playNext() {
    const pl = this.playlist;
    if (!pl || this.advancing) return;
    this.advancing = true;
    try {
      for (let tries = 0; tries < 8; tries++) {
        const t = pl.next();
        if (!t) { this.toast('The next song is still recording', 2500); return; }
        try {
          const f = await t.get();
          this.midi = null;
          await this.loadAudio(await f.arrayBuffer(), f.name);
          return;
        } catch (e) {
          console.warn('playlist: skipping', t.name, e);
          this.toast(`Skipping ${t.name}`, 2000);
        }
      }
    } finally { this.advancing = false; }
  }

  /**
   * While one song plays, the next one in the shuffle is parsed in the background and cached, so
   * it pulls away from its station almost at once, with its whole shape already known.
   */
  private async preanalyse(t: Track) {
    try {
      const f = await t.get();
      const buf = await f.arrayBuffer();
      const hash = await hashFile(buf);
      if (!isDefaultTuning(songTuning(hash) ?? this.tuning) || (await loadScore(hash))?.final) return;
      const tags = readTags(buf, f.name);
      const audio = await this.player.ctx.decodeAudioData(buf.slice(0));
      const score = emptyScore({ title: tags.title, artist: tags.artist, album: tags.album, year: tags.year, durationSec: audio.duration, art: null, hash }, audio.duration);
      const w = new AnalysisWorker();
      w.onmessage = (ev: MessageEvent) => {
        if (ev.data.type !== 'delta') return;
        applyDelta(score, ev.data.delta);
        if (ev.data.delta.final) { score.final = true; void saveScore(score); w.terminate(); }
      };
      w.onerror = () => w.terminate();
      w.postMessage({ type: 'start', pcm: toMono(audio), sampleRate: audio.sampleRate, throttleMsPerSec: 0, tuning: this.tuning });
    } catch (e) { console.warn('playlist: could not pre-parse', t.name, e); }
  }

  /** Listen along, between rides: the meter, the muffled monitor, and any trouble with the signal. */
  private updateMeter(l: ListenAlong) {
    const waiting = !this.player.playing && this.phase !== 'run';
    l.setMonitor(waiting && l.live);
    const el = $('#meter');
    el.classList.toggle('hidden', !waiting);
    if (!waiting) return;
    const sec = Math.floor(l.recordingSec);
    (el.querySelector('.mlabel') as HTMLElement).innerHTML = `<span>🎧 Listening to the track${l.size ? ` (song ${l.size + 1})` : ''}</span><span>${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</span>`;
    (el.querySelector('.mbar i') as HTMLElement).style.width = `${Math.round(l.level * 100)}%`;
    (el.querySelector('.mbar b') as HTMLElement).style.left = `${Math.round(Math.min(1, Math.sqrt(l.peak)) * 100)}%`;
    const warn = el.querySelector('.mwarn') as HTMLElement;
    const p = l.problem ?? '';
    if (warn.textContent !== p) warn.textContent = p;
  }

  /** The card while listening along and the next song is still recording. */
  private listenWait() {
    const l = this.playlist as ListenAlong;
    const sec = Math.floor(l.recordingSec);
    const line2 = !l.live ? 'Sharing stopped: nothing more to ride' : sec > 0 ? `Recording song ${l.size + 1} · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}` : 'Waiting for the music';
    if (line2 === this.waitShown) return;
    this.waitShown = line2;
    if (this.phase === 'ended') { this.toast(line2, 1500); return; }
    this.showCard('landing', 0, { name: 'Listening along', line2 });
  }

  private async shuffleFolder(dir: FileSystemDirectoryHandle) {
    this.toast(`Looking for music in ${dir.name}…`, 6000);
    this.startPlaylist(await Playlist.fromDirectory(dir));
  }

  async loadDemo() {
    await this.loadAudio(makeDemoTrack(), 'Test Tones - Valence Line.wav');
  }

  private async loadAudio(buf: ArrayBuffer, name: string) {
    this.lastFile = { buf: buf.slice(0), name };
    this.pausedMenu(false);
    if (this.phase !== 'landing') this.resetForNewTrack();
    this.preStarted = false;
    this.stoppedThisRide = false;
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
    this.look.restYaw = THREE.MathUtils.degToRad(startYaw(this.pack));
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
    const track = { title: tags.title, artist: tags.artist, album: tags.album, year: tags.year, durationSec: audioBuf.duration, art: null, hash };
    const cached = this.midi || !isDefaultTuning(this.trackTuning) ? null : await loadScore(hash);
    if (cached && cached.final) {
      this.score = cached;
      cached.track.year = tags.year;
      this.analysedSec = cached.track.durationSec;
      this.attachScore();
      this.toast('Score loaded from cache');
      this.startSounds();
      this.startDeepListen();
      return;
    }
    this.score = emptyScore(track, audioBuf.duration);
    if (this.midi) this.score.analysis.mode = 'midi';
    this.attachScore();
    // The sound pass starts at once, alongside the fast parser: intros are full of samples and effects.
    this.startSounds();
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
      // The train and the starship look out on invented worlds (packs/other-side.ts, packs/ship-other-side.ts).
      const trippy = this.pack.otherSide === 'trippy';
      // The starship's worlds keep their own colours under a lighter trip than the old mirror's.
      const named = [OTHER_SIDE, HALLOWEEN_OTHER].find(p => p.id === this.pack.otherSide) ?? OTHER_SIDE;
      const otherPack = trippy ? (this.pack.id === 'starship' ? SHIP_OTHER_SIDE : { ...this.pack, id: `${this.pack.id}-mirror`, sectionEvents: undefined }) : named;
      this.other = new OtherSide(otherPack, this.rig, s, this.world.camera, trippy ? (this.pack.id === 'starship' ? 0.35 : 0.9) : 0);
      this.world.scene.add(this.other.group);
      this.other.spawner.refreshLeads();
    }
    this.fx.setScore(placeholder ? null : s);
    this.driver.refreshLeads();
    if (this.lastCard) this.driver.card?.(this.lastCard.kind, this.lastCard.info);
    this.world.invalidateGround();
    // Build every shader now rather than when each thing first appears mid-ride.
    if (!params.has('nowarm')) this.world.warmup([...(this.other?.hidden ?? []), ...(this.storm?.hidden ?? [])]);
  }

  /**
   * With two windows, only draw the side the viewer can see: facing the main window, the far
   * side's scenery (and its disco and space) is not drawn at all, and the other way round. Both
   * keep scheduling, so either is ready the moment you turn. The margin covers looking up or down,
   * which widens what the corners of the screen take in.
   */
  private cullSides() {
    if (!this.other || !this.driver) return;
    const running = this.phase === 'run' || this.phase === 'ended';
    const half = Math.atan(this.fx.view.tanH), yaw = Math.abs(this.look.yaw), m = THREE.MathUtils.degToRad(15);
    const mainOn = !running || yaw - half < Math.PI / 2 + m;
    const otherOn = !running || yaw + half > Math.PI / 2 - m;
    this.driver.group.visible = mainOn;
    if (this.storm) this.storm.group.visible = mainOn;
    this.other.group.visible = otherOn;
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
    const out = this.pack.title.template === 'launch-screen' ? -World.LAUNCH_Z : 8.2;
    return this.world.mode === 'train' ? x + out * Math.tan(THREE.MathUtils.degToRad(this.pack.rig.startYaw ?? 0)) : x;
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
          // (a ride with no signal stop earns back a second of the margin)
          if (!this.stoppedThisRide) learn('extra', Math.max(0, learned('extra', 0) - 1));
          if (this.analysisWall > 1) learn('rate', 0.5 * learned('rate', this.analysedSec / this.analysisWall) + 0.5 * (this.analysedSec / this.analysisWall));
          if (isDefaultTuning(this.trackTuning)) void saveScore(this.score);
          // First play of a song on the default settings: learn better ones in the background.
          if (!this.midi && isDefaultTuning(this.trackTuning) && !params.has('noautotune')) void this.backgroundAutoTune(pcm, sampleRate, this.trackHash);
          this.startDeepListen();
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
    this.trackTuning = r.tuning;
    this.tuner?.setTuning(r.tuning);
    // Use them this ride too: re-parse in the background, gently, and swap in what is still ahead.
    const n = `${r.changes.length} setting${r.changes.length > 1 ? 's' : ''}`;
    const used = await this.reparseAhead(pcm, sampleRate, r.tuning, hash);
    if (hash !== this.trackHash) return;
    this.toast(used ? `Auto-tuned the parser for this song (${n}): the rest of this ride already uses them.` : `Auto-tuned the parser for this song (${n}). Next time it plays, it uses them.`, 5000);
  }

  /**
   * Parse the song again with new settings (throttled, so the visuals keep the machine) and swap
   * the new events into the live score from the first bar beyond anything already scheduled.
   * Deep-listened melody and bass are kept; without deep listen, the notes are re-parsed too.
   * Resolves whether it did.
   */
  private reparseAhead(pcm: Float32Array, sampleRate: number, tuning: Tuning, hash: string): Promise<boolean> {
    const live = this.score;
    if (!live) return Promise.resolve(false);
    return new Promise(resolve => {
      let w: Worker;
      try { w = new AnalysisWorker(); } catch { resolve(false); return; }
      this.tuneWorker = w;
      const fresh = emptyScore(live.track, live.track.durationSec);
      w.onmessage = (ev: MessageEvent) => {
        if (ev.data.type !== 'delta') return;
        applyDelta(fresh, ev.data.delta);
        if (!ev.data.delta.final) return;
        w.terminate();
        if (this.tuneWorker === w) this.tuneWorker = null;
        if (hash !== this.trackHash || this.score !== live) { resolve(false); return; }
        const a = this.safeFrom();
        if (a >= live.track.durationSec - 5) { resolve(false); return; }
        const deep = !!this.deep && this.deep.state !== 'skipped';
        const isDeepNote = (e: { kind: string; stem: string }) => deep && e.kind === 'note' && (e.stem === 'bass' || e.stem === 'other');
        const ev2 = live.events;
        let lo = 0;
        while (lo < ev2.length && ev2[lo].t < a) lo++;
        const kept = ev2.slice(lo).filter(isDeepNote);
        const add = fresh.events.filter(e => e.t >= a && !isDeepNote(e)).map((e, i) => ({ ...e, id: `rt${i}-${e.id}` }));
        ev2.splice(lo, ev2.length - lo, ...kept.concat(add).sort((x, y) => x.t - y.t));
        this.resyncFrom(a);
        perf.mark(`re-tuned score from ${a.toFixed(1)} s (+${add.length} events)`);
        resolve(true);
      };
      w.onerror = () => { w.terminate(); resolve(false); };
      w.postMessage({ type: 'start', pcm: pcm.slice(), sampleRate, throttleMsPerSec: 25, tuning });
    });
  }

  /**
   * The sound pass: YAMNet recognises speech, singing, crowds, sirens, explosions and the rest
   * (score.sounds, envelopes.voice). Skipped in the single-file build (no model file), with
   * ?nosounds, on tiny devices, and when the cached score already has it.
   */
  private startSounds() {
    const sc = this.score, audio = this.audioBuf;
    this.sounds?.stop();
    this.sounds = null;
    if (import.meta.env.MODE === 'single' || params.has('nosounds') || !sc || !audio) return;
    if (sc.sounds && (sc.soundsFrontier ?? 0) >= sc.track.durationSec) return;
    if (soundsPrecheck()) return;
    const hash = this.trackHash;
    const pass = new SoundPass(audio, sc, () => {}, () => {
      if (hash !== this.trackHash) return;
      perf.mark(`sound pass done (${sc.sounds?.length ?? 0} cues, ${pass.speed.toFixed(0)}× real time, model ${Math.round(pass.loadMs)} ms)`);
      if (sc.final && isDefaultTuning(this.trackTuning)) void saveScore(sc);
    });
    this.sounds = pass;
    void pass.start().catch(() => { pass.state = 'skipped'; });
  }

  /**
   * Deep listen: Basic Pitch transcribes the melody and bass in the background and upgrades the
   * score ahead of the playhead; the fully upgraded score is cached for next time. Skipped with
   * MIDI (already exact), in the single-file build (no model file to load), with ?nodeep, and
   * when the score has already had it.
   */
  private startDeepListen() {
    const sc = this.score, audio = this.audioBuf;
    if (import.meta.env.MODE === 'single' || params.has('nodeep') || this.midi || !sc || !audio) return;
    if (this.dyno?.light && !params.has('deep')) return; // a light machine keeps its breath for the ride
    this.deep?.stop();
    this.deep = null;
    const ABOUT = 'Deep listen runs a small neural network (Spotify\'s Basic Pitch) on your own machine to transcribe the melody and bass note by note, more precisely than the quick parser. Nothing is uploaded.';
    if (sc.analysis.engine.includes('basic-pitch')) {
      this.deepNote('deep listen', `${ABOUT}\n\nThis song already has its deep-listened notes (cached from an earlier ride).`);
      return;
    }
    const pref = deepPref();
    if (pref === 'off') {
      this.deepNote('deep listen off', `${ABOUT}\n\nIt is switched off, so the quick parser does the notes. Click to switch it back on.`);
      return;
    }
    const tryAnyway = pref === 'try' || params.get('deep') === 'force';
    // Only on machines that can take it: a free precheck, then a timed check in the worker.
    const no = tryAnyway || params.has('deep') ? null : deepPrecheck();
    if (no) {
      this.deepNote('quick listen', `${ABOUT}\n\nIt is off on this device (${no}), so the quick parser does the notes; the ride is just as smooth. Click to try deep listen anyway (it may slow things down).`);
      return;
    }
    const hash = this.trackHash, tuning = this.trackTuning;
    const deep = new DeepListen(audio, sc, () => this.player.time, upgraded => {
      if (hash !== this.trackHash) return;
      sc.analysis.engine = upgraded.analysis.engine;
      if (isDefaultTuning(tuning)) void saveScore(upgraded);
      this.toast(`Deep listen finished: ${deep.notes} notes transcribed. Next ride on this song uses them all.`, 5000);
    });
    this.deep = deep;
    deep.onSplice = a => { if (hash === this.trackHash) this.resyncFrom(a); };
    deep.force = tryAnyway;
    deep.onChange = () => {
      if (this.deep !== deep) return;
      if (deep.state === 'checking') this.deepNote('checking…', `${ABOUT}\n\nChecking whether this machine can run it without slowing the ride. Click to switch it off.`);
      else if (deep.state === 'running') this.deepNote(`deep listen ${Math.round(deep.progress * 100)}%`, `${ABOUT}\n\nIt is working in the background (${deep.speed.toFixed(0)}× faster than real time here) and the ride picks the notes up as they arrive. Click to switch it off.`);
      else if (deep.state === 'done') this.deepNote('deep listen', `${ABOUT}\n\nDone: ${deep.notes} notes, cached with this song for next time. Click to switch it off for future songs.`);
      else this.deepNote('quick listen', `${ABOUT}\n\n` + (deep.failed
        ? 'It could not run here, so the quick parser does the notes; the ride is just as smooth.'
        : `It is off on this machine: a quick check ran it at ${deep.speed.toFixed(1)}× real time and it needs 1.5×, so the quick parser does the notes; the ride is just as smooth.`) + ' Click to try it anyway (it may slow things down).');
    };
    deep.onChange();
    deep.start().catch(e => { deep.failed = (e as Error).message; deep.state = 'skipped'; deep.onChange(); });
  }

  /** The 🎧 button: switches deep listen off, back on, or (where it was skipped) tries it anyway. */
  private toggleDeep() {
    const label = $('#deep').textContent ?? '';
    if (/off$/.test(label)) { setDeepPref(null); this.toast('Deep listen on'); }
    else if (/quick listen/.test(label)) { setDeepPref('try'); this.toast('Trying deep listen on this machine'); }
    else { setDeepPref('off'); this.deep?.stop(); this.toast('Deep listen off: the quick parser does the notes'); }
    this.startDeepListen();
  }

  /** The quiet 🎧 button in the bar saying whether deep listen is on. */
  private deepNote(text: string, title: string) {
    const el = $('#deep');
    el.textContent = '🎧 ' + text;
    el.title = title;
    el.classList.remove('hidden');
  }

  /** Back to the first station for a new journey. */
  private resetForNewTrack() {
    $('#deep').classList.add('hidden');
    this.deep?.stop();
    this.deep = null;
    this.sounds?.stop();
    this.sounds = null;
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
    if (this.phase === 'landing' && this.dynoSign) {
      this.world.setDeparture(this.dynoSign.text, this.dynoSign.p);
      if (this.driver instanceof Visualiser) this.driver.setWaiting(this.dynoSign.text, this.dynoSign.p);
    }
    if (this.phase === 'title' && score) {
      const ahead = score.final ? Infinity : score.frontierSec;
      // Pull away from the name board only when the line ahead is read and every shader is built
      // (but never wait forever on the shaders).
      const warm = this.world.warmPending === 0 || this.p > this.titleCross + 15;
      const need = Math.min(this.leadNeeded(), score.track.durationSec);
      // (?quick, for headless checks: no station stop, no shader warm-up; go as soon as the line is read.)
      // The sound pass gets a few seconds' grace to read the intro too (it loads a model first).
      const snd = this.sounds;
      const heard = !snd || snd.state === 'skipped' || snd.state === 'done' || (score.soundsFrontier ?? 0) >= need || this.p > this.titleCross + 5;
      const ready = ahead >= need && (params.has('quick') || (this.p >= this.titleCross + 1.2 && warm && heard));
      const dep = ready ? 'Departing' : this.departureText(ahead, need, warm);
      // While the line ahead is being read, the strip fills as a progress bar.
      this.world.setDeparture(dep, ready || ahead >= need ? null : Math.min(1, ahead / need));
      if (this.driver instanceof Visualiser) this.driver.setWaiting(dep, ready || ahead >= need ? null : Math.min(1, ahead / need));
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
          learn('extra', Math.min(9, learned('extra', 0) + 2));
          this.stoppedThisRide = true;
          this.toast('Signal stop: waiting for the line ahead to clear', 3000);
        }
        if (this.signalStop && ahead > 8) { this.signalStop = false; this.player.play(this.player.time); }
      }
      if (score && this.phase === 'run' && s > score.track.durationSec + 0.2) this.end();
      if (this.playlist instanceof Playlist && score) {
        // Shuffle: parse the next song once this one is settled (or nearly over), and move on once
        // the train has pulled into its terminus (or the curtain has come down).
        const settled = score.final && (!this.deep || this.deep.state === 'done' || this.deep.state === 'skipped');
        if (!this.preStarted && score.final && (settled || s > score.track.durationSec - 90)) {
          this.preStarted = true;
          const next = this.playlist.peek();
          if (next) void this.preanalyse(next);
        }
      }
      if (this.playlist && this.phase === 'ended' && this.endedAt !== null && !this.advancing && this.p - this.endedAt > (this.world.mode === 'train' ? 12 : 4)) {
        if (this.playlist instanceof Playlist || this.playlist.peek()) void this.playNext();
        else this.listenWait();
      }
      // The train sees its terminus coming; a stage only shows the end card once the music stops.
      if (score && score.final && !this.endBuilt && (this.world.mode === 'train' || s > score.track.durationSec)) this.buildEndStation();
    }
    if (this.playlist instanceof ListenAlong) this.updateMeter(this.playlist);
    // Listening along: the first song (or a song that is still recording) is the wait.
    if (this.playlist instanceof ListenAlong && this.phase === 'landing' && !this.advancing) {
      if (this.playlist.peek()) void this.playNext();
      else this.listenWait();
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
      this.storm?.update(s, dt, this.score, this.phase === 'run' || this.phase === 'ended', this.world.train.position, this.rig.speedAt(s));
      // Star Guitar's main window stays true to the video; the looks come in as you turn round.
      this.fx.split = !!this.pack.rig.lookYaw;
      const cam = this.world.camera;
      this.fx.view.yaw = this.look.yaw;
      this.fx.view.tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect / cam.zoom;
      this.fx.update(s, dt, this.phase === 'run' || this.phase === 'ended', this.world.night, this.world.camera.aspect);
      this.cullSides();
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

  /**
   * What the departures strip says while the train waits at the title stop: a countdown once the
   * wait can be predicted (from how fast the analysis and the shader warm-up are going), and
   * "waiting for a clear line" while it cannot.
   */
  /** The first downbeat beyond everything the rides have already scheduled: where new events can safely start. */
  private safeFrom() {
    const h = Math.max(this.driver?.horizon?.() ?? 0, this.other?.spawner.horizon() ?? 0);
    const t0 = this.player.time + Math.max(2, h + 1);
    const bar = this.score?.beats.find(b => b.downbeat && b.t >= t0);
    return bar ? bar.t : t0;
  }

  /** Events from `from` on changed in the live score: let the rides re-read them. */
  private resyncFrom(from: number) {
    this.driver?.resync?.(from);
    this.other?.spawner.resync(from);
  }

  /**
   * How far the score must be read before departing, learned from this machine: the parser's
   * speed (measured now, or remembered from earlier rides) sets it between 8 and 17 seconds (a
   * longer wait at the station leaves the background listeners less to do while the show runs), and
   * every signal stop (the music catching up with the parser) adds a little for next time.
   */
  private leadNeeded() {
    const now = this.analysisWall > 1 ? this.analysedSec / this.analysisWall : 0;
    const rate = now || learned('rate', 0);
    const base = rate > 0 ? 6 + 12 / rate : MIN_LOOKAHEAD + 2;
    return THREE.MathUtils.clamp(base + learned('extra', 0), 8, 17);
  }

  /** The rest of a saved performance profile (frame analyser, P): machine, test scenes, song, settings. */
  private perfProfile(): Record<string, unknown> {
    const heap = (performance as any).memory;
    const sc = this.score;
    return {
      build: __BUILD__, saved: new Date().toISOString(), url: location.search,
      dyno: this.dyno ?? 'not run',
      memory: {
        jsHeapMB: heap ? { used: Math.round(heap.usedJSHeapSize / 1e6), total: Math.round(heap.totalJSHeapSize / 1e6), limit: Math.round(heap.jsHeapSizeLimit / 1e6) } : 'not reported (Chromium only)',
        deviceGB: (navigator as any).deviceMemory ?? null,
        gpu: (this.world?.renderer as any)?.info?.memory ?? null,
      },
      view: { detail: { ...QUALITY, cap: this.world?.detailCap }, pack: this.pack.id, phase: this.phase, mode: this.world?.mode, pixelRatio: this.world?.pixelRatio, size: `${this.stage.clientWidth}x${this.stage.clientHeight}`, dpr: devicePixelRatio, fpsNow: Math.round(this.fps) },
      analysis: sc ? { duration: Math.round(sc.track.durationSec), frontier: Math.round(sc.frontierSec), final: sc.final, speed: this.analysisWall > 0 ? +(this.analysedSec / this.analysisWall).toFixed(1) : null, deepListen: this.deep?.state ?? 'off', sounds: this.sounds?.state ?? null } : null,
    };
  }

  private departureText(ahead: number, need: number, warm: boolean): string {
    const rate = this.analysisWall > 0 ? this.analysedSec / this.analysisWall : 0;
    const analysis = ahead >= need ? 0 : rate > 0 ? (need - ahead) / rate : Infinity;
    const shaders = warm ? 0 : this.world.warmPending / Math.max(5, this.fps);
    const arrive = Math.max(0, this.titleCross + 1.2 - this.p);
    const wait = Math.max(analysis, shaders, arrive);
    if (!isFinite(wait) || wait > 60) {
      // No estimate yet: say how far the reading has got (words kept clear of the countdown's "Ns").
      if (ahead < need && this.analysisWall > 0) return `Reading ahead ${Math.floor(ahead)} of ${Math.ceil(need)} sec${rate > 1 ? ` · ${rate.toFixed(0)}× speed` : ''}`;
      return 'Waiting for a clear line';
    }
    const n = Math.ceil(wait);
    return n <= 1 ? 'Departing' : `Departs in ${n}s`;
  }

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
    if (!this.playlist) $('#endcard').classList.remove('hidden');
  }

  private buildEndStation() {
    this.endBuilt = true;
    const D = this.score!.track.durationSec;
    // (Riding facing forward, the end card stands where the view rests, like the title card.)
    const yaw = THREE.MathUtils.degToRad(this.pack.rig.startYaw ?? 0);
    const stopX = this.rig.travel(D + 9) + (Math.abs(yaw) > 0.5 ? 8.3 * Math.tan(yaw) : 0);
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
    if (!this.player.playing && this.phase === 'ended') { this.phase = 'run'; $('#endcard').classList.add('hidden'); this.pausedMenu(false); this.player.play(t); }
    this.driver?.reset(t);
    this.other?.reset(t);
    this.world.invalidateGround();
  }

  togglePause() {
    if (this.phase !== 'run' && this.phase !== 'ended') return;
    if (this.player.playing) { this.player.pause(); this.pausedMenu(true); }
    else {
      this.pausedMenu(false);
      if (this.phase === 'ended' || this.endedAt !== null) { this.seek(0); return; }
      this.player.play(this.player.time);
    }
  }

  /** Paused mid-ride: the departure board comes back, so you can change course to another song. */
  private pausedMenu(on: boolean) {
    if (document.body.classList.contains('paused') === on) return;
    document.body.classList.toggle('paused', on);
    $('#drop').classList.toggle('hidden', !on);
    const lead = $('#drop .lead'), small = $('#drop .small');
    if (on) {
      lead.dataset.orig ??= lead.textContent ?? '';
      small.dataset.orig ??= small.textContent ?? '';
      lead.textContent = 'Paused. Change course?';
      small.textContent = 'Drop or pick another song, a folder or the demo, or press space to ride on.';
    } else {
      if (lead.dataset.orig) lead.textContent = lead.dataset.orig;
      if (small.dataset.orig) small.textContent = small.dataset.orig;
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

  private quietTimer = 0;
  private pokeUI() {
    document.body.classList.remove('idle', 'quiet');
    // The top-left links fade after ten seconds without a touch, whatever is showing.
    clearTimeout(this.quietTimer);
    this.quietTimer = window.setTimeout(() => document.body.classList.add('quiet'), 10000);
    clearTimeout(this.uiTimer);
    this.uiTimer = window.setTimeout(() => { if (this.phase === 'run') document.body.classList.add('idle'); }, 3500);
  }

  private bindUI() {
    // Embedded viewers (iframes) usually block downloads: hide the export buttons there.
    if (window.self !== window.top) { $('#json').hidden = true; $('#mid').hidden = true; }
    window.addEventListener('resize', this.onResize);
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel'] as const) window.addEventListener(ev, () => this.pokeUI());
    this.pokeUI();
    const input = $<HTMLInputElement>('#file');
    $('#choose').addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files?.length) void this.loadFiles([...input.files]); });
    $('#demo').addEventListener('click', () => void this.loadDemo());
    // Shuffle a folder: the browser's folder picker where it has one (and it is remembered for
    // next time), otherwise a folder upload field (the files still never leave the machine).
    const dirInput = $<HTMLInputElement>('#dir');
    $('#folder').addEventListener('click', async () => {
      if (!canPickFolder()) { dirInput.click(); return; }
      const dir = await pickFolder();
      if (!dir) return;
      void rememberFolder(dir);
      await this.shuffleFolder(dir);
    });
    dirInput.addEventListener('change', () => {
      const files = [...(dirInput.files ?? [])];
      const name = (files[0] as any)?.webkitRelativePath?.split('/')[0] || 'your folder';
      this.startPlaylist(Playlist.fromFiles(files, name));
    });
    void lastFolder().then(dir => {
      if (!dir) return;
      const btn = $('#refolder');
      btn.textContent = `↻ Shuffle “${dir.name}” again`;
      btn.hidden = false;
      btn.addEventListener('click', async () => {
        if (await regainAccess(dir)) await this.shuffleFolder(dir);
        else this.toast('The browser did not allow reading that folder: pick it again', 3500);
      });
    });
    $('#next').addEventListener('click', () => void this.playNext());
    // Listen along to another tab (desktop Chrome and Edge share tab audio).
    $('#listen').hidden = !canListenAlong();
    $('#listen').addEventListener('click', async () => {
      const l = await ListenAlong.start(this.player.ctx);
      if (typeof l === 'string') { this.toast(l, 4500); return; }
      $('#drop').classList.add('hidden');
      $('#next').classList.remove('hidden');
      // Each song is parsed as soon as it has finished recording, so its ride can start at once.
      l.onSong = t => { void this.preanalyse(t); };
      l.onStop = () => this.toast('Listen along stopped: the songs already recorded will still play', 4000);
      this.startPlaylist(l);
    });
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
    $('#deep').addEventListener('click', () => this.toggleDeep());
    $('#tonon').addEventListener('click', async () => {
      await this.switchPack('non-gondry');
      $<HTMLSelectElement>('#pack').value = 'non-gondry';
      this.seek(0);
    });
    $('#another').addEventListener('click', () => input.click());
    $('#door').addEventListener('click', async e => {
      e.stopPropagation();
      const to = this.pack.id === 'non-gondry' ? 'star-guitar' : 'non-gondry';
      await this.switchPack(to);
      $<HTMLSelectElement>('#pack').value = to;
    });
    const scrub = $<HTMLInputElement>('#scrub');
    scrub.addEventListener('input', () => { if (this.score) this.seek((Number(scrub.value) / 1000) * this.score.track.durationSec); });
    const sel = $<HTMLSelectElement>('#pack');
    for (const p of PACKS) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); }
    if (!PACKS.includes(this.pack)) { const o = document.createElement('option'); o.value = this.pack.id; o.textContent = this.pack.name; sel.appendChild(o); }
    sel.value = this.pack.id;

    sel.addEventListener('change', () => void this.switchPack(sel.value));
    $('#center').addEventListener('click', () => this.look.center());
    $('#gyro').addEventListener('click', async () => this.toast((await this.look.enableGyro()) ? 'Gyroscope on: move your phone to look around' : 'No gyroscope available'));
    $('#dbg').addEventListener('click', () => this.debug.toggle());
    $('#json').addEventListener('click', () => this.score && download(new Blob([JSON.stringify(this.score)], { type: 'application/json' }), slug(this.trackInfo.title) + '.score.json'));
    $('#mid').addEventListener('click', () => this.score && download(new Blob([scoreToMidi(this.score) as BlobPart], { type: 'audio/midi' }), slug(this.trackInfo.title) + '.mid'));
    $('#fs').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
    $('#fsx').addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen(); });
    // Full screen shows nothing but the show (style.css): made for a club's big screen.
    document.addEventListener('fullscreenchange', () => document.body.classList.toggle('fullscreen', !!document.fullscreenElement));
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
    this.frames = new FrameAnalyser(() => this.world?.renderer, () => this.perfProfile());
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
      if ((e.key === 'n' || e.key === 'N') && this.playlist) void this.playNext();
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
    // (The wait at the station is told on the departures strip now, not down here.)
    status.textContent = '';
    if (this.debug.visible) {
      const m = this.driver?.metric;
      const recent = m && m.recent.length ? Math.round((m.recent.filter(Boolean).length / m.recent.length) * 100) : 0;
      this.debug.lines = [
        `${this.world.backend}`,
        `${this.fps.toFixed(0)} fps · res ${this.world.pixelRatio.toFixed(2)} · detail ${QUALITY.level}/${this.world.detailCap}`,
        `t ${s.toFixed(2)}`,
        sc ? `frontier +${sc.final ? '∞ (final)' : (sc.frontierSec - Math.max(0, s)).toFixed(1) + 's'}` : '',
        this.analysisWall ? `analysis ${(this.analysedSec / this.analysisWall).toFixed(0)}× rt` : '',
        `objects ${this.driver?.activeCount ?? 0}`,
        m ? `refocus ${m.total ? Math.round((m.hits / m.total) * 100) : 0}% (${m.hits}/${m.total}, last64 ${recent}%)` : '',
        `look ${(this.look.yaw * 57.3).toFixed(0)}°${this.look.wander ? ' wander' : ''}`,
        sc ? `${sc.analysis.mode} · bpm ${sc.tempo[sc.tempo.length - 1]?.bpm ?? '?'}` : '',
        this.driver instanceof Visualiser ? this.driver.status : '',
        this.deep ? this.deep.status : '',
        this.sounds ? this.sounds.status : '',
        `build ${__BUILD__}`,
      ].filter(Boolean);
    }
    this.debug.draw(sc, s, this.deep ? { spans: this.deep.spans, state: this.deep.state } : undefined);
    (window as any).__gondry = { phase: this.phase, s, yaw: Math.round(this.look.yaw * 57.3), fps: this.fps, metric: this.driver?.metric, frontier: sc?.frontierSec, final: sc?.final, objects: this.driver?.activeCount, backend: this.world.backend, events: sc?.events.length, viz: this.driver instanceof Visualiser ? this.driver.status : undefined, deep: this.deep?.status, sounds: this.sounds?.status, cues: sc?.sounds?.map(c => `${c.kind}@${c.t.toFixed(1)}+${c.dur.toFixed(1)}`).join(' '), sections: sc?.sections, signalStop: this.signalStop };
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

/** Deep listen preference: null = automatic (if the machine can take it), 'off', or 'try' anyway. */
function deepPref(): 'off' | 'try' | null {
  try { const v = localStorage.getItem('gondryator.deep'); return v === 'off' || v === 'try' ? v : null; } catch { return null; }
}
function setDeepPref(v: 'off' | 'try' | null) {
  try { if (v) localStorage.setItem('gondryator.deep', v); else localStorage.removeItem('gondryator.deep'); } catch { /* private window */ }
}

/** What this machine has taught us about itself (the parser's speed, signal stops), kept between rides. */
function learned(key: string, fallback: number): number {
  try { const v = Number(localStorage.getItem(`gondryator-learn-${key}`)); return Number.isFinite(v) && localStorage.getItem(`gondryator-learn-${key}`) !== null ? v : fallback; } catch { return fallback; }
}
function learn(key: string, v: number) { try { localStorage.setItem(`gondryator-learn-${key}`, String(v)); } catch { /* private mode */ } }
