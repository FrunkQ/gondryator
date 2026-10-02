// Audio playback and the one clock the visuals follow (spec section 8): AudioContext time,
// corrected for output latency, so what you see lines up with what you hear.

export class Player {
  readonly ctx: AudioContext;
  buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode;
  /** ctx time at which track position `offset` plays (or played). */
  private startCtx = 0;
  private offset = 0;
  playing = false;
  onEnded: (() => void) | null = null;
  /** Test mode: a silent clock advanced by tick() a fixed step per frame, so slow renderers still see every moment. */
  virtual: number | null = null;
  private now() { return this.virtual ?? this.ctx.currentTime; }
  tick(dt: number) {
    if (this.virtual === null) return;
    this.virtual += dt;
    if (this.playing && this.buffer && this.time >= this.duration) { this.offset = this.duration; this.playing = false; this.onEnded?.(); }
  }

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    this.buffer = await this.ctx.decodeAudioData(data);
    return this.buffer;
  }

  get latency() {
    return (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  /** Track position (seconds) being heard now. Negative before a scheduled start. */
  get time(): number {
    if (!this.playing) return this.offset;
    return this.now() - (this.virtual === null ? this.latency : 0) - this.startCtx + this.offset;
  }

  get duration() { return this.buffer?.duration ?? 0; }

  /** Start playing track position `offset` after `delay` seconds. */
  play(offset: number, delay = 0) {
    if (!this.buffer) return;
    this.stopSource();
    void this.ctx.resume();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    const when = this.now() + Math.max(0, delay);
    this.startCtx = when;
    this.offset = offset;
    if (this.virtual !== null) { this.playing = true; this.source = null; return; }
    // Position offset may be negative before the music starts: hold silence until 0.
    if (offset < 0) {
      src.start(when - offset, 0);
    } else {
      src.start(when, offset);
    }
    src.onended = () => {
      if (this.source === src && this.playing) {
        this.offset = this.duration;
        this.playing = false;
        this.onEnded?.();
      }
    };
    this.source = src;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time;
    this.stopSource();
    this.playing = false;
  }

  seek(t: number) {
    const was = this.playing;
    this.stopSource();
    this.playing = false;
    this.offset = t;
    if (was) this.play(t);
  }

  setVolume(v: number) { this.gain.gain.value = v; }

  private stopSource() {
    if (this.source) {
      this.source.onended = null;
      try { this.source.stop(); } catch { /* not started */ }
      this.source.disconnect();
      this.source = null;
    }
  }
}

/** Mix an AudioBuffer down to mono. */
export function toMono(b: AudioBuffer): Float32Array {
  const out = new Float32Array(b.length);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / b.numberOfChannels;
  }
  return out;
}
