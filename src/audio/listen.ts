// Listen along: ride to whatever another browser tab is playing (a streaming service, a radio
// station, a mix on a video site). The tab's sound is captured with the browser's own screen-share
// prompt ("share tab audio"), the tab itself is muted, and each song is recorded as it plays. The
// gap between songs ends one, and it joins the shuffle queue like a file from a folder.
//
// So the ride runs one song behind the tab: while song 2 records, you ride song 1, which the
// Gondryator has heard from start to finish. That is the price of knowing a song's whole shape
// (where the drop is, where the climax is) before it plays. The first song is the wait.
//
// Nothing is uploaded or kept: the recordings live in memory for the session only.

import type { Track } from '../ui/playlist';

/** Quieter than this (RMS, about -54 dB) counts as silence. */
const SILENCE = 0.002;
/** A gap at least this long between two stretches of sound ends a song... */
const GAP_SEC = 0.6;
/** ...if the song has run at least this long (shorter blips, like a jingle, run on into the next). */
const MIN_SONG = 25;
/** Gapless albums and DJ mixes never pause: cut them into rides of at most this long. */
const MAX_SONG = 12 * 60;

export const canListenAlong = () => typeof navigator.mediaDevices?.getDisplayMedia === 'function' && !/Android|iPhone|iPad/i.test(navigator.userAgent);

export class ListenAlong {
  readonly name = 'the tab you are listening along to';
  /** Finished songs, oldest first. */
  private songs: Track[] = [];
  private played = 0;
  private left: Float32Array[] = [];
  private right: Float32Array[] = [];
  private samples = 0;
  private silentRun = 0;
  private stopped = false;
  private proc: ScriptProcessorNode | null = null;
  /** A song finished recording (and can be parsed ahead). */
  onSong: ((t: Track) => void) | null = null;
  /** The sharing ended (the browser's "Stop sharing" button, or the tab closed). */
  onStop: (() => void) | null = null;
  /** The level meter: smoothed loudness and peak, 0..1, and how long since the last sound. */
  level = 0;
  peak = 0;
  private quietFor = 0;
  private lastLoudAt = 0;
  private clipped = 0;
  private startedAt = 0;
  private monitor: GainNode | null = null;

  private constructor(private ctx: AudioContext, private stream: MediaStream) {}

  /** Asks the browser for a tab's sound. Returns the listener, or why it could not start. */
  static async start(ctx: AudioContext): Promise<ListenAlong | string> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // A video track is required; keep it tiny. The audio is what we want, with the tab muted
        // so you only hear the ride's (delayed) copy.
        video: { frameRate: 1, width: 320, height: 180 },
        audio: { suppressLocalAudioPlayback: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include', selfBrowserSurface: 'exclude', preferCurrentTab: false,
      } as any);
    } catch { return 'Listening along was cancelled'; }
    if (!stream.getAudioTracks().length) {
      stream.getTracks().forEach(t => t.stop());
      return 'No sound came with that share: pick a tab and tick "Also share tab audio"';
    }
    const l = new ListenAlong(ctx, stream);
    l.connect();
    return l;
  }

  private connect() {
    const ctx = this.ctx;
    void ctx.resume();
    const src = ctx.createMediaStreamSource(new MediaStream(this.stream.getAudioTracks()));
    const proc = ctx.createScriptProcessor(4096, 2, 2);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination); // a processor only runs when it leads somewhere
    proc.onaudioprocess = e => this.block(e.inputBuffer);
    this.proc = proc;
    // While you wait, you hear the tab faintly and muffled, like music from someone else's
    // headphones: proof it is coming through, without giving the song away.
    const muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass'; muffle.frequency.value = 520; muffle.Q.value = 0.9;
    const mon = ctx.createGain();
    mon.gain.value = 0;
    src.connect(muffle); muffle.connect(mon); mon.connect(ctx.destination);
    this.monitor = mon;
    this.startedAt = this.lastLoudAt = ctx.currentTime;
    for (const t of this.stream.getTracks()) t.addEventListener('ended', () => this.stop());
  }

  private block(buf: AudioBuffer) {
    if (this.stopped) return;
    const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
    let sum = 0;
    for (let i = 0; i < L.length; i += 4) sum += L[i] * L[i] + R[i] * R[i];
    const rms = Math.sqrt(sum / (L.length / 2));
    const loud = rms > SILENCE;
    const blockSec = L.length / buf.sampleRate;
    // The meter (scaled so ordinary music sits around the middle) and the signal checks.
    let pk = 0;
    for (let i = 0; i < L.length; i += 2) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    const lv = Math.min(1, Math.sqrt(rms) * 1.6);
    this.level = lv > this.level ? lv : this.level * 0.8 + lv * 0.2;
    this.peak = Math.max(pk, this.peak * 0.97);
    if (loud) this.lastLoudAt = this.ctx.currentTime;
    this.quietFor = loud && rms < 0.015 ? this.quietFor + blockSec : loud ? 0 : this.quietFor;
    this.clipped = pk >= 0.999 ? this.clipped + 1 : Math.max(0, this.clipped - 0.05);
    if (!loud && this.samples === 0) return; // silence before a song: nothing to keep
    this.left.push(L.slice());
    this.right.push(R.slice());
    this.samples += L.length;
    this.silentRun = loud ? 0 : this.silentRun + blockSec;
    const sec = this.samples / buf.sampleRate;
    if ((this.silentRun >= GAP_SEC && sec - this.silentRun >= MIN_SONG) || sec >= MAX_SONG) this.finish();
    // A long silence after something too short to be a song (an ad's tail, a click): drop it.
    else if (this.silentRun >= 4) this.clear();
  }

  /** Turns the muffled monitor on (while you wait) or off (while a ride plays the real thing). */
  setMonitor(on: boolean) {
    this.monitor?.gain.setTargetAtTime(on ? 0.35 : 0, this.ctx.currentTime, 0.4);
  }

  /** What is wrong with the signal, if anything, in words for the user. */
  get problem(): string | null {
    if (this.stopped) return 'Sharing stopped';
    const silent = this.ctx.currentTime - this.lastLoudAt;
    if (silent > 6) return this.ctx.currentTime - this.startedAt < 20 && this.songs.length === 0 && this.samples === 0
      ? 'No sound from the tab yet. Is it playing? Share it again with "Also share tab audio" ticked if it stays silent.'
      : 'No sound from the tab. Is the music paused?';
    if (this.quietFor > 5) return 'Very quiet: turn the volume up in the music tab (its own slider, not the computer\'s)';
    if (this.clipped > 8) return 'Too loud: it is distorting. Turn the music tab\'s volume down a little';
    return null;
  }

  /** Seconds of the song recording now. */
  get recordingSec() { return Math.max(0, this.samples / this.ctx.sampleRate - this.silentRun); }
  /** Songs recorded so far. */
  get size() { return this.songs.length; }
  /** Which song is playing (1-based). */
  get index() { return this.played; }
  get live() { return !this.stopped; }

  next(): Track | null { return this.played < this.songs.length ? this.songs[this.played++] : null; }
  peek(): Track | null { return this.songs[this.played] ?? null; }

  private finish() {
    const rate = this.ctx.sampleRate;
    // Keep a little of the silence at the end, so the song does not stop dead.
    const keep = Math.max(0, this.samples - Math.max(0, Math.round((this.silentRun - 0.3) * rate)));
    if (keep / rate >= MIN_SONG) {
      const n = this.songs.length + 1;
      const file = new File([wav(this.left, this.right, keep, rate)], `Listen along · song ${n}.wav`, { type: 'audio/wav' });
      const t: Track = { name: file.name, get: async () => file };
      this.songs.push(t);
      this.onSong?.(t);
    }
    this.clear();
  }

  private clear() { this.left = []; this.right = []; this.samples = 0; this.silentRun = 0; }

  stop() {
    if (this.stopped) return;
    if (this.samples / this.ctx.sampleRate >= MIN_SONG) this.finish();
    this.stopped = true;
    this.proc?.disconnect();
    this.monitor?.disconnect();
    this.stream.getTracks().forEach(t => t.stop());
    this.onStop?.();
  }
}

/** 16-bit stereo WAV from recorded blocks (only the first `n` samples). */
function wav(left: Float32Array[], right: Float32Array[], n: number, rate: number): ArrayBuffer {
  const out = new ArrayBuffer(44 + n * 4);
  const v = new DataView(out);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44, k = 0;
  for (let b = 0; b < left.length && k < n; b++) {
    const L = left[b], R = right[b];
    for (let i = 0; i < L.length && k < n; i++, k++, o += 4) {
      v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true);
      v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true);
    }
  }
  return out;
}
