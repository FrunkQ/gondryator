// src/analysis/dsp.ts
var FFT = class {
  n;
  rev;
  cos;
  sin;
  re;
  im;
  window;
  constructor(n) {
    this.n = n;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= (i >> b & 1) << bits - 1 - b;
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos(-2 * Math.PI * i / n);
      this.sin[i] = Math.sin(-2 * Math.PI * i / n);
    }
    this.window = new Float64Array(n);
    for (let i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
  }
  /** Windowed magnitude spectrum of x[start .. start+n) into mags (length n/2+1). */
  magnitudes(x, start, mags) {
    const { n, re, im, rev, window } = this;
    for (let i = 0; i < n; i++) {
      const j = start + i;
      const v = j >= 0 && j < x.length ? x[j] * window[i] : 0;
      re[rev[i]] = v;
      im[rev[i]] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step];
          const wi = this.sin[k * step];
          const a = i + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
    for (let k = 0; k <= n / 2; k++) mags[k] = Math.hypot(re[k], im[k]);
  }
};
function biquad(x, sr, type, freq, q = Math.SQRT1_2) {
  const w0 = 2 * Math.PI * freq / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  let b0, b1, b2;
  if (type === "lp") {
    b0 = (1 - c) / 2;
    b1 = 1 - c;
    b2 = (1 - c) / 2;
  } else {
    b0 = (1 + c) / 2;
    b1 = -(1 + c);
    b2 = (1 + c) / 2;
  }
  const a0 = 1 + alpha;
  const a1 = -2 * c;
  const a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const B0 = b0 / a0, B1 = b1 / a0, B2 = b2 / a0, A1 = a1 / a0, A2 = a2 / a0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = B0 * xi + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    y[i] = yi;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
  }
  return y;
}
function decimate(x, factor) {
  const n = Math.floor(x.length / factor);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = x[i * factor];
  return y;
}
function halve(x) {
  const n = Math.floor(x.length / 2);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = x[2 * i - 1] ?? 0;
    const b = x[2 * i];
    const c = x[2 * i + 1] ?? 0;
    y[i] = 0.25 * a + 0.5 * b + 0.25 * c;
  }
  return y;
}
function yin(x, center, win, tauMin, tauMax, sr, threshold, scratch) {
  const start = center - (win >> 1);
  if (start < 0 || start + win + tauMax >= x.length) return 0;
  const d = scratch;
  d[0] = 1;
  let running = 0;
  for (let tau2 = 1; tau2 <= tauMax; tau2++) {
    let s = 0;
    for (let j = 0; j < win; j++) {
      const diff = x[start + j] - x[start + j + tau2];
      s += diff * diff;
    }
    running += s;
    d[tau2] = running > 0 ? s * tau2 / running : 1;
  }
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < threshold) {
      while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return 0;
  let better = tau;
  if (tau > 1 && tau < tauMax) {
    const a = d[tau - 1], b = d[tau], c = d[tau + 1];
    const den = a + c - 2 * b;
    if (Math.abs(den) > 1e-12) better = tau + 0.5 * (a - c) / den;
  }
  return sr / better;
}
var hzToMidi = (f) => 69 + 12 * Math.log2(f / 440);
var clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function percentile(arr, from, to, p, scratch) {
  scratch.length = 0;
  const stride = Math.max(1, Math.floor((to - from) / 4e3));
  for (let i = from; i < to; i += stride) scratch.push(arr[i]);
  if (scratch.length === 0) return 0;
  scratch.sort((a, b) => a - b);
  return scratch[Math.min(scratch.length - 1, Math.floor(p * scratch.length))];
}

// src/analysis/analyzer.ts
var N = 1024;
var HOP = 256;
var ENV_RATE = 50;
var Analyzer = class _Analyzer {
  sr;
  // analysis sample rate
  duration;
  frames;
  hopSec;
  x;
  bassSig;
  bassSr;
  leadSig;
  leadSr;
  fft = new FFT(N);
  fftBig = new FFT(4096);
  mags = new Float32Array(N / 2 + 1);
  magsBig = new Float32Array(4096 / 2 + 1);
  prevLog = new Float32Array(N / 2 + 1);
  curLog = new Float32Array(N / 2 + 1);
  yinScratch = new Float64Array(512);
  // Per-frame features.
  fluxLow;
  fluxMid;
  fluxHigh;
  dbLow;
  dbMid;
  dbHigh;
  dbAll;
  flat;
  odf;
  framesDone = 0;
  onsetScanned = 0;
  // frames scanned for onset peaks
  onsets = [];
  lastOnsetFrame = { kick: -1e9, snare: -1e9, hat: -1e9 };
  p95 = { low: 1, mid: 1, high: 1 };
  pScratch = [];
  // Beats.
  periodFrames = 0;
  beatsFrozen = 0;
  tempoDisagree = 0;
  beatFrames = [];
  beatStrength = [];
  bars = [];
  dbEvidence = [];
  phaseVotes = 0;
  tempoOut = [];
  lastBpm = 0;
  // Bars / phrases / sections.
  barFeatures = [];
  barsDecided = 0;
  // bars whose section membership is known
  phraseStart = 1;
  // first bar of the open phrase
  novelty = [];
  phrasesOut = [];
  phraseVecs = [];
  sectionsOut = [];
  lastSectionBar = -999;
  prevBlockActive = /* @__PURE__ */ new Set();
  padEvents = [];
  bass;
  lead;
  // Commit bookkeeping.
  committedSec = 0;
  sentBeats = 0;
  sentSections = 0;
  sentPhrases = 0;
  sentTempo = 0;
  sentEnv = 0;
  eventId = 0;
  pendingEvents = [];
  drumEnv = 0;
  envDrums = [];
  startWall = 0;
  opts;
  /** Calibrated onset offset (seconds) so event times land on the audible attack. */
  static ONSET_OFFSET = 0;
  constructor(pcm, sampleRate, opts = {}) {
    this.opts = { chunkSec: 4, throttleMsPerSec: 0, ...opts };
    let x = pcm;
    let sr = sampleRate;
    while (sr > 3e4) {
      x = halve(x);
      sr /= 2;
    }
    this.x = x;
    this.sr = sr;
    this.duration = pcm.length / sampleRate;
    this.hopSec = HOP / sr;
    this.frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
    const F = this.frames;
    this.fluxLow = new Float32Array(F);
    this.fluxMid = new Float32Array(F);
    this.fluxHigh = new Float32Array(F);
    this.dbLow = new Float32Array(F);
    this.dbMid = new Float32Array(F);
    this.dbHigh = new Float32Array(F);
    this.dbAll = new Float32Array(F);
    this.flat = new Float32Array(F);
    this.odf = new Float32Array(F);
    let b = biquad(x, sr, "lp", 220);
    b = biquad(b, sr, "lp", 220);
    this.bassSr = sr / 8;
    this.bassSig = decimate(b, 8);
    let l = biquad(x, sr, "hp", 200);
    l = biquad(l, sr, "lp", 1800);
    l = biquad(l, sr, "lp", 1800);
    this.leadSr = sr / 2;
    this.leadSig = decimate(l, 2);
    this.bass = { pitch: new Float32Array(F), energy: this.dbLow, active: null, done: [], stem: "bass", minFrames: 7 };
    this.lead = { pitch: new Float32Array(F), energy: this.dbMid, active: null, done: [], stem: "other", minFrames: 5 };
  }
  get finished() {
    return this.framesDone >= this.frames && this.committedSec >= this.duration - 1e-6;
  }
  get analyzedSec() {
    return Math.min(this.duration, this.framesDone * this.hopSec);
  }
  frameTime(f) {
    return (f * HOP + N / 2) / this.sr + _Analyzer.ONSET_OFFSET;
  }
  timeFrame(t) {
    return Math.round(((t - _Analyzer.ONSET_OFFSET) * this.sr - N / 2) / HOP);
  }
  /** Process one chunk. Returns a delta to send (or null if nothing new was committed). */
  step() {
    if (this.startWall === 0) this.startWall = performance.now();
    const target = Math.min(this.frames, this.framesDone + Math.ceil(this.opts.chunkSec / this.hopSec));
    for (let f = this.framesDone; f < target; f++) this.computeFrame(f);
    this.framesDone = target;
    const final = this.framesDone >= this.frames;
    this.detectOnsets(final);
    this.trackPitch(this.bass, final);
    this.trackPitch(this.lead, final);
    this.trackBeats(final);
    this.buildBars(final);
    return this.commit(final);
  }
  // ---------------------------------------------------------------- frame features
  computeFrame(f) {
    const { mags, curLog, prevLog } = this;
    this.fft.magnitudes(this.x, f * HOP, mags);
    const binHz = this.sr / N;
    const lowA = Math.max(1, Math.round(30 / binHz)), lowB = Math.round(160 / binHz);
    const midA = Math.round(200 / binHz), midB = Math.round(3e3 / binHz);
    const highA = Math.round(5e3 / binHz), highB = Math.min(N / 2, Math.round(12e3 / binHz));
    let eL = 0, eM = 0, eH = 0, eA = 0, fL = 0, fM = 0, fH = 0;
    let logSum = 0, linSum = 0, flatCount = 0;
    const flatA = Math.round(400 / binHz), flatB = Math.min(N / 2, Math.round(9e3 / binHz));
    for (let k = 0; k <= N / 2; k++) {
      const m = mags[k];
      const p = m * m;
      eA += p;
      const lg = Math.log(1 + 100 * m);
      curLog[k] = lg;
      const d = lg - prevLog[k];
      const pos = d > 0 ? d : 0;
      if (k >= lowA && k <= lowB) {
        eL += p;
        fL += pos;
      }
      if (k >= midA && k <= midB) {
        eM += p;
        fM += pos;
      }
      if (k >= highA && k <= highB) {
        eH += p;
        fH += pos;
      }
      if (k >= flatA && k <= flatB) {
        logSum += Math.log(p + 1e-12);
        linSum += p;
        flatCount++;
      }
    }
    prevLog.set(curLog);
    const norm = 3 * (N / 4) * (N / 4);
    const db = (e) => 10 * Math.log10(e / norm + 1e-10);
    this.dbLow[f] = db(eL);
    this.dbMid[f] = db(eM);
    this.dbHigh[f] = db(eH);
    this.dbAll[f] = db(eA);
    this.fluxLow[f] = fL / (lowB - lowA + 1);
    this.fluxMid[f] = fM / (midB - midA + 1);
    this.fluxHigh[f] = fH / (highB - highA + 1);
    this.flat[f] = linSum > 1e-9 ? Math.exp(logSum / flatCount) / (linSum / flatCount) : 0;
    const center = (f * HOP + N / 2) / this.sr;
    if (this.dbLow[f] > -42) {
      const fr = yin(this.bassSig, Math.round(center * this.bassSr), 200, Math.floor(this.bassSr / 330), Math.ceil(this.bassSr / 35), this.bassSr, 0.15, this.yinScratch);
      this.bass.pitch[f] = fr > 0 ? hzToMidi(fr) : 0;
    }
    if (this.dbMid[f] > -45) {
      const fr = yin(this.leadSig, Math.round(center * this.leadSr), 400, Math.floor(this.leadSr / 1500), Math.ceil(this.leadSr / 160), this.leadSr, 0.2, this.yinScratch);
      this.lead.pitch[f] = fr > 0 ? hzToMidi(fr) : 0;
    }
  }
  // ---------------------------------------------------------------- onsets
  detectOnsets(final) {
    const until = final ? this.framesDone : this.framesDone - 12;
    if (until <= this.onsetScanned) return;
    const s = this.pScratch;
    this.p95.low = Math.max(1e-4, percentile(this.fluxLow, 0, this.framesDone, 0.97, s));
    this.p95.mid = Math.max(1e-4, percentile(this.fluxMid, 0, this.framesDone, 0.97, s));
    this.p95.high = Math.max(1e-4, percentile(this.fluxHigh, 0, this.framesDone, 0.97, s));
    const lowRef = percentile(this.dbLow, 0, this.framesDone, 0.95, s);
    for (let f = this.onsetScanned; f < until; f++) {
      const lo = this.fluxLow, mi = this.fluxMid, hi = this.fluxHigh;
      const lowPeakDb = Math.max(this.dbLow[f], this.dbLow[f + 1] ?? -200, this.dbLow[f + 2] ?? -200);
      const kick = this.isPeak(lo, f, 0.35 * this.p95.low) && lowPeakDb > lowRef - 15 && this.kickDecay(f);
      const midRise = (this.dbMid[f + 1] ?? -200) - (this.dbMid[f - 2] ?? -200);
      const snare = !kick && this.isPeak(mi, f, 0.4 * this.p95.mid) && this.flatAround(f) > 0.2 && hi[f] > 0.3 * this.p95.high && midRise > 2;
      const snareWithKick = kick && this.isPeak(mi, f, 0.45 * this.p95.mid) && this.flatAround(f) > 0.3 && hi[f] > 0.5 * this.p95.high;
      const hat = !snare && !snareWithKick && this.isPeak(hi, f, 0.2 * this.p95.high, 1.25) && mi[f] < 0.8 * this.p95.mid;
      const t = this.frameTime(f);
      let accent = 0;
      if (kick && f - this.lastOnsetFrame.kick > 0.09 / this.hopSec) {
        const vel = clamp(lo[f] / this.p95.low, 0.05, 1);
        this.onsets.push({ frame: f, t, kind: "kick", vel });
        this.lastOnsetFrame.kick = f;
        accent += 2 * vel;
      }
      if ((snare || snareWithKick) && f - this.lastOnsetFrame.snare > 0.09 / this.hopSec) {
        const vel = clamp(mi[f] / this.p95.mid, 0.05, 1);
        this.onsets.push({ frame: f, t, kind: "snare", vel });
        this.lastOnsetFrame.snare = f;
        accent += vel;
      }
      if (hat && f - this.lastOnsetFrame.hat > 0.05 / this.hopSec) {
        this.onsets.push({ frame: f, t, kind: "hat", vel: clamp(hi[f] / this.p95.high, 0.05, 1) });
        this.lastOnsetFrame.hat = f;
      }
      this.odf[f] = 0.5 * (lo[f] / this.p95.low + 0.8 * mi[f] / this.p95.mid + 0.4 * hi[f] / this.p95.high) + accent;
    }
    this.onsetScanned = until;
  }
  isPeak(a, f, floor, ratio = 1.5) {
    const v = a[f];
    if (v < floor) return false;
    for (let k = f - 3; k <= f + 3; k++) {
      if (k === f || k < 0 || k >= this.framesDone) continue;
      if (a[k] > v || a[k] === v && k < f) return false;
    }
    let sum = 0, n = 0;
    for (let k = Math.max(0, f - 20); k < Math.min(this.framesDone, f + 6); k++) {
      sum += a[k];
      n++;
    }
    return v > ratio * (sum / n);
  }
  kickDecay(f) {
    let peak = -200;
    for (let k = f; k <= f + 3 && k < this.framesDone; k++) peak = Math.max(peak, this.dbLow[k]);
    const later = this.dbLow[Math.min(this.framesDone - 1, f + 9)];
    return peak - later > 3.5;
  }
  flatAround(f) {
    let m = 0;
    for (let k = f; k <= f + 2 && k < this.framesDone; k++) m = Math.max(m, this.flat[k]);
    return m;
  }
  // ---------------------------------------------------------------- notes
  trackPitch(tr, final) {
    const until = final ? this.framesDone : this.framesDone - 12;
    const start = tr._scanned ?? 0;
    for (let f = start; f < until; f++) {
      const a = tr.pitch[f - 1] ?? 0, b = tr.pitch[f], c = tr.pitch[f + 1] ?? 0;
      const p = med3(a, b, c);
      const db = tr.energy[f];
      const act = tr.active;
      if (act) {
        const cur = act.pitchSum / act.count;
        const changed = p > 0 && Math.abs(p - cur) > 0.7 && Math.abs((tr.pitch[f + 1] ?? 0) - cur) > 0.7;
        if (p === 0) act.lowDbRun++;
        else act.lowDbRun = 0;
        const dipped = db < act.peakDb - 9;
        const tooLong = f - act.start > 4 / this.hopSec;
        if (changed || act.lowDbRun > 3 || dipped || tooLong) {
          this.endNote(tr, f - (act.lowDbRun > 3 ? act.lowDbRun : 0));
          if (p > 0 && !dipped) this.startNote(tr, f, p, db);
        } else if (p > 0) {
          if (act.count < 4) {
            act.pitchSum += p;
            act.count++;
          }
          if (act.all.length < 64) act.all.push(p);
          act.peakDb = Math.max(act.peakDb, db);
        }
      } else if (p > 0) {
        this.startNote(tr, f, p, db);
      }
    }
    tr._scanned = Math.max(start, until);
    if (final && tr.active) this.endNote(tr, this.framesDone - 1);
  }
  startNote(tr, f, p, db) {
    tr.active = { start: f, pitchSum: p, count: 1, peakDb: db, lowDbRun: 0, all: [p] };
  }
  endNote(tr, endFrame) {
    const a = tr.active;
    tr.active = null;
    const frames = endFrame - a.start;
    if (frames < tr.minFrames) return;
    const settled = a.all.length > 4 ? a.all.slice(2) : a.all;
    const sorted = settled.slice().sort((x, y) => x - y);
    const pitch = Math.round(sorted[sorted.length >> 1]);
    const t = this.frameTime(a.start) - 0.02;
    if (tr.stem === "bass" && frames < 0.14 / this.hopSec && this.onsets.some((o) => o.kind === "kick" && t - o.t > -0.04 && t - o.t < 0.16)) return;
    tr.done.push({
      id: "",
      t,
      dur: frames * this.hopSec,
      stem: tr.stem,
      kind: "note",
      pitch,
      vel: clamp((a.peakDb + 40) / 34, 0.05, 1)
    });
  }
  // ---------------------------------------------------------------- beats
  trackBeats(final) {
    const until = this.onsetScanned;
    const fps = 1 / this.hopSec;
    if (until < 6 * fps && !final) return;
    const est = this.estimatePeriod(Math.max(0, until - Math.round(20 * fps)), until);
    if (est > 0) {
      if (this.periodFrames === 0) this.periodFrames = est;
      else if (Math.abs(est / this.periodFrames - 1) < 0.06) {
        this.periodFrames = 0.7 * this.periodFrames + 0.3 * est;
        this.tempoDisagree = 0;
      } else if (++this.tempoDisagree >= 2) {
        this.periodFrames = est;
        this.tempoDisagree = 0;
      }
    }
    const P = this.periodFrames;
    if (P <= 0) return;
    const anchor = this.beatsFrozen > 0 ? this.beatFrames[this.beatsFrozen - 1] : -1;
    const s0 = anchor >= 0 ? anchor : 0;
    const len = until - s0;
    if (len <= P) return;
    const C = new Float64Array(len);
    const back = new Int32Array(len).fill(-1);
    const alpha = 6;
    for (let i = 0; i < len; i++) {
      const f = s0 + i;
      const local = this.odf[f];
      if (anchor >= 0 && i === 0) {
        C[0] = 1e3;
        continue;
      }
      let best = -Infinity, arg = -1;
      const a = Math.max(0, Math.round(i - 2 * P)), b = Math.round(i - P / 2);
      for (let j = a; j <= b; j++) {
        if (anchor >= 0 && back[j] === -1 && j !== 0) continue;
        const r = Math.log((i - j) / P);
        const v = C[j] - alpha * r * r;
        if (v > best) {
          best = v;
          arg = j;
        }
      }
      if (arg >= 0) {
        C[i] = local + best;
        back[i] = arg;
      } else C[i] = anchor >= 0 ? -Infinity : local;
      if (anchor < 0 && arg < 0) back[i] = -2;
    }
    let endI = -1, endV = -Infinity;
    for (let i = Math.max(0, len - Math.round(P)); i < len; i++) if (C[i] > endV) {
      endV = C[i];
      endI = i;
    }
    if (endI < 0 || !isFinite(endV)) return;
    const path = [];
    for (let i = endI; i >= 0; i = back[i]) {
      path.push(s0 + i);
      if (back[i] < 0) break;
    }
    path.reverse();
    if (anchor >= 0 && path[0] === anchor) path.shift();
    this.beatFrames.length = this.beatsFrozen;
    this.beatStrength.length = this.beatsFrozen;
    if (anchor < 0) {
      let first = path[0];
      const pre = [];
      while (first - P >= 0) {
        first -= P;
        pre.unshift(Math.round(first));
      }
      for (const f of pre) this.pushBeat(f);
    }
    for (const f of path) this.pushBeat(f);
    if (final) {
      let last = this.beatFrames[this.beatFrames.length - 1];
      while (last + P < this.frames) {
        last += P;
        this.pushBeat(Math.round(last));
      }
    }
    const bpm = 60 / (P * this.hopSec);
    if (Math.abs(bpm - this.lastBpm) > 0.5) {
      const t = this.beatsFrozen > 0 ? this.frameTime(this.beatFrames[this.beatsFrozen - 1]) : 0;
      if (this.tempoOut.length === 0 || t > this.tempoOut[this.tempoOut.length - 1].t) {
        this.tempoOut.push({ t: this.tempoOut.length ? t : 0, bpm: Math.round(bpm * 100) / 100 });
        this.lastBpm = bpm;
      }
    }
  }
  /** Evidence that beat i is a downbeat: kick yes, snare no, harmony changes. */
  downbeatEvidence(i) {
    const cached = this.dbEvidence[i];
    if (cached !== void 0) return cached;
    const f = this.beatFrames[i];
    let kickHere = 0, snareHere = 0;
    for (const o of this.onsets) {
      if (Math.abs(o.frame - f) > 3) continue;
      if (o.kind === "kick") kickHere = Math.max(kickHere, o.vel);
      if (o.kind === "snare") snareHere = Math.max(snareHere, o.vel);
    }
    const prev = i > 0 ? this.beatFrames[i - 1] : f - this.periodFrames;
    const next = i + 1 < this.beatFrames.length ? this.beatFrames[i + 1] : f + this.periodFrames;
    const v = kickHere - 0.8 * snareHere + 3 * this.harmonicChange(prev, f) + this.bassChange(prev, f, next);
    if (i < this.beatsFrozen) this.dbEvidence[i] = v;
    return v;
  }
  /** 1 when the bass pitch class differs between the beat before f and the beat at f. */
  bassChange(prev, f, next) {
    const pc = (a2, b2) => {
      const h = new Float32Array(12);
      for (let k = Math.round(a2); k < Math.round(b2); k++) {
        const p = this.bass.pitch[k];
        if (p > 0) h[(Math.round(p) % 12 + 12) % 12]++;
      }
      let arg = -1, m = 2;
      for (let j = 0; j < 12; j++) if (h[j] > m) {
        m = h[j];
        arg = j;
      }
      return arg;
    };
    const a = pc(prev, f), b = pc(f, next);
    return a >= 0 && b >= 0 && a !== b ? 1 : 0;
  }
  bestPhase(from, to) {
    const score = [0, 0, 0, 0];
    for (let i = Math.max(0, from); i < to; i++) score[i % 4] += this.downbeatEvidence(i);
    let best = 0;
    for (let i = 1; i < 4; i++) if (score[i] > score[best]) best = i;
    return { best, score };
  }
  /** Chroma distance between the beat before f and the beat starting at f.
   * Chords and bass lines tend to change on downbeats. */
  harmonicChange(prevBeat, f) {
    const span = Math.max(4, f - prevBeat);
    const a = this.chromaAt(prevBeat + span / 2), b = this.chromaAt(f + span / 2);
    let d = 0, na = 0, nb = 0;
    for (let i = 0; i < 12; i++) {
      d += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return na > 0 && nb > 0 ? 1 - d / Math.sqrt(na * nb) : 0;
  }
  chromaAt(frame) {
    const out = new Float32Array(12);
    const centerSample = Math.round(frame * HOP + N / 2);
    this.fftBig.magnitudes(this.x, centerSample - 2048, this.magsBig);
    const binHz = this.sr / 4096;
    for (let k = Math.round(55 / binHz); k < Math.round(2e3 / binHz); k++) {
      const pc = (Math.round(hzToMidi(k * binHz)) % 12 + 12) % 12;
      out[pc] += this.magsBig[k];
    }
    return out;
  }
  localMax(f, r) {
    let m = 0;
    for (let k = f - r; k <= f + r; k++) {
      const v = this.odf[k] ?? 0;
      if (v > m) m = v;
    }
    return m;
  }
  pushBeat(f) {
    this.beatFrames.push(f);
    this.beatStrength.push(clamp(this.localMax(f, 2) / 3, 0, 1));
  }
  estimatePeriod(a, b) {
    const fps = 1 / this.hopSec;
    const minL = Math.floor(60 / 180 * fps), maxL = Math.ceil(60 / 70 * fps);
    let mean = 0;
    for (let i = a; i < b; i++) mean += this.odf[i];
    mean /= Math.max(1, b - a);
    const ac = new Float64Array(maxL * 2 + 2);
    for (let L = minL; L <= Math.min(maxL * 2, b - a - 1); L++) {
      let s = 0;
      for (let i = a; i + L < b; i++) s += (this.odf[i] - mean) * (this.odf[i + L] - mean);
      ac[L] = s / (b - a - L);
    }
    let best = 0, bestV = -Infinity;
    for (let L = minL; L <= maxL; L++) {
      const bpm = 60 / (L * this.hopSec);
      const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.8) ** 2);
      const v = (ac[L] + 0.5 * (ac[2 * L] ?? 0)) * w;
      if (v > bestV) {
        bestV = v;
        best = L;
      }
    }
    if (best <= minL || best >= maxL || bestV <= 0) return best > 0 && bestV > 0 ? best : 0;
    const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
    const den = y0 + y2 - 2 * y1;
    return Math.abs(den) > 1e-12 ? best + 0.5 * (y0 - y2) / den : best;
  }
  // ---------------------------------------------------------------- bars, phrases, sections
  /** Index of the beat that starts bar n (1-based). */
  barStartBeat(n) {
    const B = this.bars;
    if (n - 1 < B.length) return B[n - 1].sb;
    return B[B.length - 1].eb + 4 * (n - 1 - B.length);
  }
  buildBars(final) {
    const onsetLimit = this.onsetScanned;
    const stableUntil = final ? Infinity : onsetLimit - 4 / this.hopSec;
    let stable = 0;
    while (stable < this.beatFrames.length && this.beatFrames[stable] < stableUntil) stable++;
    if (this.bars.length === 0 && stable < 20 && !final) return;
    while (true) {
      let sb;
      if (this.bars.length === 0) {
        sb = this.bestPhase(0, stable).best;
      } else {
        sb = this.bars[this.bars.length - 1].eb;
      }
      if (!final && sb + 8 >= stable) break;
      if (final && sb >= this.beatFrames.length - 1) break;
      let len = 4;
      if (this.bars.length > 0) {
        const { best, score } = this.bestPhase(sb - 8, Math.min(stable, sb + 8));
        const cur = sb % 4;
        if (best !== cur && score[best] > 1.25 * score[cur] + 0.2) this.phaseVotes++;
        else this.phaseVotes = 0;
        if (this.phaseVotes >= 2) {
          len = ((best - cur) % 4 + 4) % 4 || 4;
          this.phaseVotes = 0;
        }
      }
      const eb = sb + len;
      const fs = this.beatFrames[sb];
      const fe = eb < this.beatFrames.length ? this.beatFrames[eb] : this.frames;
      this.bars.push({ sb, eb });
      this.beatsFrozen = Math.max(this.beatsFrozen, Math.min(eb + 1, this.beatFrames.length));
      this.barFeatures.push(this.barFeature(sb, fs, fe));
    }
    this.decideBars(final);
  }
  barFeature(sb, fs, fe) {
    const grid = new Float32Array(48);
    const beatAt = (i) => this.beatFrames[Math.min(i, this.beatFrames.length - 1)] ?? fe;
    const density = [0, 0, 0];
    for (const o of this.onsets) {
      if (o.frame < fs - 2 || o.frame >= fe - 2) continue;
      let step = 0;
      for (let b = 0; b < 4; b++) {
        const a = beatAt(sb + b), c = b < 3 ? beatAt(sb + b + 1) : fe;
        if (o.frame >= a - 2 && (o.frame < c - 2 || b === 3)) {
          step = b * 4 + clamp(Math.round((o.frame - a) / Math.max(1, c - a) * 4), 0, 3);
          break;
        }
      }
      const row = o.kind === "kick" ? 0 : o.kind === "snare" ? 1 : 2;
      grid[row * 16 + step] = Math.max(grid[row * 16 + step], o.vel);
      density[row] += 1 / 4;
    }
    const chroma = new Float32Array(12);
    for (let b = 0; b < 4; b++) {
      const a = beatAt(sb + b), c = b < 3 ? beatAt(sb + b + 1) : fe;
      const centerSample = Math.round((a + c) / 2 * HOP + N / 2);
      this.fftBig.magnitudes(this.x, centerSample - 2048, this.magsBig);
      const binHz = this.sr / 4096;
      for (let k = Math.round(110 / binHz); k < Math.round(2e3 / binHz); k++) {
        const pc = (Math.round(hzToMidi(k * binHz)) % 12 + 12) % 12;
        chroma[pc] += this.magsBig[k];
      }
    }
    const bassPc = new Float32Array(12);
    let voiced = 0;
    const db = [0, 0, 0];
    let midDb = 0;
    for (let f = fs; f < fe; f++) {
      const p = this.bass.pitch[f];
      if (p > 0) {
        bassPc[(Math.round(p) % 12 + 12) % 12]++;
        voiced++;
      }
      db[0] += this.dbLow[f];
      db[1] += this.dbMid[f];
      db[2] += this.dbHigh[f];
      midDb += this.dbAll[f];
    }
    const n = Math.max(1, fe - fs);
    return { grid, chroma, bassPc, db: db.map((v) => v / n), density, bassVoiced: voiced / n, midDb: midDb / n, fs, fe };
  }
  activeStems(bars) {
    const s = /* @__PURE__ */ new Set();
    const avg = (fn) => bars.reduce((a, b) => a + fn(b), 0) / bars.length;
    if (avg((b) => b.density[0] + b.density[1]) > 0.3) s.add("drums");
    if (avg((b) => b.bassVoiced) > 0.25 && avg((b) => b.db[0]) > -40) s.add("bass");
    if (avg((b) => b.db[1]) > -36) s.add("other");
    return s;
  }
  /** Novelty at bar b (1-based): how different bars b..b+3 are from bars b-4..b-1. */
  noveltyAt(b) {
    if (this.novelty[b] !== void 0) return this.novelty[b];
    const F = this.barFeatures;
    const prev = F.slice(Math.max(0, b - 5), b - 1), next = F.slice(b - 1, b + 3);
    if (prev.length === 0 || next.length === 0) return 0;
    const dDb = Math.abs(avgOf(next, (x) => x.midDb) - avgOf(prev, (x) => x.midDb)) / 4;
    const pa = this.activeStems(prev), na = this.activeStems(next);
    let stem = 0;
    for (const s of ["drums", "bass", "other"]) if (pa.has(s) !== na.has(s)) stem += 1;
    const chroma = 1 - cosine(meanVec(next.map((x) => x.chroma)), meanVec(prev.map((x) => x.chroma)));
    const dens = (xs, r) => avgOf(xs, (x) => x.density[r]);
    let dd = 0;
    for (let r = 0; r < 3; r++) dd += Math.abs(dens(next, r) - dens(prev, r));
    const v = dDb + stem + 3 * chroma + dd;
    if (next.length === 4 && prev.length === 4) this.novelty[b] = v;
    return v;
  }
  decideBars(final) {
    const F = this.barFeatures;
    while (this.barsDecided < F.length && (final || this.barsDecided + 1 + 4 <= F.length)) {
      const b = this.barsDecided + 1;
      let boundary = b === 1;
      if (!boundary && b - this.lastSectionBar >= 4 && b > 4) {
        const n0 = this.noveltyAt(b);
        const n1 = b + 1 <= F.length ? this.noveltyAt(b + 1) : 0;
        const nm = this.noveltyAt(b - 1);
        boundary = n0 > 1 && n0 >= n1 && n0 > nm;
      }
      if (boundary || b - this.phraseStart >= 4) {
        if (b > this.phraseStart) this.emitPhrase(this.phraseStart, b - 1);
        this.phraseStart = b;
      }
      if (boundary) this.emitSection(b);
      this.emitPads(b);
      this.barsDecided++;
    }
    if (final && this.barsDecided === F.length && this.phraseStart <= F.length) {
      this.emitPhrase(this.phraseStart, F.length);
      this.phraseStart = F.length + 1;
    }
  }
  barTime(b) {
    return this.frameTime(this.beatFrames[this.barStartBeat(b)]);
  }
  emitPhrase(first, last) {
    const bars = this.barFeatures.slice(first - 1, last);
    const vec = new Float32Array(4 * 72);
    bars.forEach((b, i) => {
      const o = i * 72;
      writeNorm(vec, o, b.grid, 1);
      writeNorm(vec, o + 48, b.chroma, 0.8);
      writeNorm(vec, o + 60, b.bassPc, 0.6);
    });
    let repeatOf = null, id = this.phrasesOut.length, bestSim = 0;
    for (let i = 0; i < this.phraseVecs.length; i++) {
      if (this.phrasesOut[i].bars !== bars.length) continue;
      const s = cosine(vec, this.phraseVecs[i]);
      if (s > 0.9 && s > bestSim) {
        bestSim = s;
        repeatOf = i;
        id = this.phrasesOut[i].id;
      }
    }
    const active = this.activeStems(bars);
    const entering = [...active].filter((s) => !this.prevBlockActive.has(s));
    this.prevBlockActive = active;
    this.phraseVecs.push(vec);
    this.phrasesOut.push({ t: round3(this.barTime(first)), bar: first, bars: bars.length, id, repeatOf, entering });
  }
  emitSection(b) {
    const next = this.barFeatures.slice(b - 1, b + 3);
    const energy = clamp((avgOf(next, (x) => x.midDb) + 34) / 26, 0, 1);
    const active = this.activeStems(next);
    const prevLabel = this.sectionsOut.length ? this.sectionsOut[this.sectionsOut.length - 1].label : null;
    const drums = active.has("drums");
    const remaining = this.duration - this.barTime(b);
    let label;
    if (b === 1) label = "intro";
    else if (!drums && remaining < 25 && this.framesDone >= this.frames) label = "outro";
    else if (!drums && energy < 0.75) label = "breakdown";
    else if (prevLabel === "breakdown" && drums) label = "drop";
    else if (energy > 0.72 && drums) label = "chorus";
    else label = "verse";
    this.sectionsOut.push({ t: round3(this.barTime(b)), label, energy: Math.round(energy * 100) / 100, bar: b });
    this.lastSectionBar = b;
  }
  /** Pads: one long note per bar where the harmony is clear. */
  emitPads(b) {
    const f = this.barFeatures[b - 1];
    const c = f.chroma;
    let max = 0, arg = 0, sum = 0;
    for (let j = 0; j < 12; j++) {
      sum += c[j];
      if (c[j] > max) {
        max = c[j];
        arg = j;
      }
    }
    const peaky = sum > 0 ? max / (sum / 12) : 0;
    if (peaky > 2.2 && f.db[1] > -38) {
      const bt = this.frameTime(f.fs), et = this.frameTime(f.fe);
      this.padEvents.push({ id: "", t: bt, dur: Math.max(0.5, et - bt), stem: "other", kind: "note", pitch: 48 + arg, vel: clamp((f.db[1] + 40) / 30, 0.1, 1), bar: b, step: 0 });
    }
  }
  // ---------------------------------------------------------------- commit
  commit(final) {
    let frontier;
    if (final) frontier = this.duration;
    else {
      if (this.phraseStart <= 1) return null;
      const endBeat = this.barStartBeat(this.phraseStart);
      if (endBeat >= this.beatFrames.length) return null;
      frontier = this.frameTime(this.beatFrames[endBeat]);
      for (const tr of [this.bass, this.lead]) if (tr.active) frontier = Math.min(frontier, this.frameTime(tr.active.start) - 0.01);
      frontier = Math.min(frontier, this.frameTime(this.onsetScanned) - 0.05);
    }
    if (frontier <= this.committedSec && !final) return null;
    const events = [];
    const take = (e) => {
      if (e.t < this.committedSec || e.t >= frontier) return false;
      events.push(e);
      return true;
    };
    for (const o of this.onsets) take({ id: "", t: o.t, dur: o.kind === "kick" ? 0.12 : o.kind === "snare" ? 0.1 : 0.04, stem: "drums", kind: o.kind, pitch: null, vel: round3(o.vel) });
    for (const tr of [this.bass, this.lead]) {
      tr.done = tr.done.filter((e) => !take(e) && e.t >= this.committedSec);
    }
    this.padEvents = this.padEvents.filter((e) => !take(e) && e.t >= this.committedSec);
    this.onsets = this.onsets.filter((o) => o.t >= frontier || o.frame > this.onsetScanned - 600);
    events.sort((a, b) => a.t - b.t);
    for (const e of events) {
      e.id = "e" + this.eventId++;
      e.t = round3(e.t);
      e.dur = round3(e.dur);
      if (e.bar === void 0) {
        const g = this.gridPos(e.t);
        e.bar = g.bar;
        e.step = g.step;
      }
    }
    const beats = [];
    const allBeats = this.beatsOut();
    for (; this.sentBeats < allBeats.length && allBeats[this.sentBeats].t < frontier; this.sentBeats++) beats.push(allBeats[this.sentBeats]);
    const sections = this.sectionsOut.slice(this.sentSections).filter((s) => s.t < frontier);
    this.sentSections += sections.length;
    const phrases = this.phrasesOut.slice(this.sentPhrases).filter((p) => p.t < frontier);
    this.sentPhrases += phrases.length;
    const tempo = this.tempoOut.slice(this.sentTempo);
    this.sentTempo = this.tempoOut.length;
    const envTo = Math.floor(frontier * ENV_RATE);
    const env = { mix: [], bass: [], other: [], drums: [] };
    for (let i = this.sentEnv; i < envTo; i++) {
      const f = clamp(this.timeFrame(i / ENV_RATE), 0, this.frames - 1);
      env.mix.push(round3(clamp((this.dbAll[f] + 50) / 50, 0, 1)));
      env.bass.push(round3(clamp((this.dbLow[f] + 50) / 50, 0, 1)));
      env.other.push(round3(clamp((this.dbMid[f] + 50) / 50, 0, 1)));
    }
    const drumHits = events.filter((e) => e.stem === "drums");
    let hi = 0;
    for (let i = this.sentEnv; i < envTo; i++) {
      const tt = i / ENV_RATE;
      this.drumEnv *= 0.82;
      while (hi < drumHits.length && drumHits[hi].t <= tt) {
        this.drumEnv = Math.max(this.drumEnv, drumHits[hi].vel);
        hi++;
      }
      env.drums.push(round3(this.drumEnv));
    }
    this.sentEnv = Math.max(this.sentEnv, envTo);
    this.committedSec = frontier;
    const wall = (performance.now() - this.startWall) / 1e3;
    return {
      frontierSec: round3(frontier),
      final,
      tempo,
      beats,
      sections,
      phrases,
      events,
      envelopes: env,
      envelopeRate: ENV_RATE,
      realtimeFactor: Math.round(this.analyzedSec / Math.max(1e-3, wall) * 10) / 10
    };
  }
  _beatsCache = [];
  beatsOut() {
    const out = this._beatsCache;
    const B = this.bars;
    if (B.length === 0) return out;
    const limit = this.finished || this.framesDone >= this.frames ? this.beatFrames.length : B[B.length - 1].eb;
    let bi = 0;
    for (let i = out.length; i < Math.min(limit, this.beatFrames.length); i++) {
      let bar, beat;
      if (i < B[0].sb) {
        bar = 0;
        beat = Math.max(1, 4 - (B[0].sb - i) + 1);
      } else {
        while (bi < B.length - 1 && B[bi + 1].sb <= i) bi++;
        if (i >= B[bi].eb) {
          bar = B.length + 1 + Math.floor((i - B[B.length - 1].eb) / 4);
          beat = (i - B[B.length - 1].eb) % 4 + 1;
        } else {
          bar = bi + 1;
          beat = i - B[bi].sb + 1;
        }
      }
      out.push({ t: round3(this.frameTime(this.beatFrames[i])), bar, beat, downbeat: beat === 1, strength: round3(this.beatStrength[i]) });
    }
    return out;
  }
  gridPos(t) {
    const beats = this.beatsOut();
    if (beats.length < 2) return { bar: 0, step: 0 };
    let lo = 0, hi = beats.length - 1;
    if (t < beats[0].t) return { bar: beats[0].bar, step: 0 };
    while (lo < hi - 1) {
      const m = lo + hi >> 1;
      if (beats[m].t <= t) lo = m;
      else hi = m;
    }
    const b = beats[lo];
    const next = beats[lo + 1]?.t ?? b.t + 0.5;
    const sub = clamp(Math.round((t - b.t) / (next - b.t) * 4), 0, 4);
    let step = (b.beat - 1) * 4 + sub;
    let bar = b.bar;
    if (step >= 16) {
      step -= 16;
      bar++;
    }
    return { bar, step };
  }
};
function med3(a, b, c) {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}
function round3(v) {
  return Math.round(v * 1e3) / 1e3;
}
function writeNorm(dst, o, src, w) {
  let n = 0;
  for (let i = 0; i < src.length; i++) n += src[i] * src[i];
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < src.length; i++) dst[o + i] = src[i] / n * w;
}
function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? d / Math.sqrt(na * nb) : na === 0 && nb === 0 ? 1 : 0;
}
function meanVec(vs) {
  const out = new Float32Array(vs[0].length);
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i] / vs.length;
  return out;
}
function avgOf(xs, f) {
  return xs.reduce((a, x) => a + f(x), 0) / Math.max(1, xs.length);
}
export {
  Analyzer
};
