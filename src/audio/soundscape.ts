import { smoothstep } from "@/lib/math";
import { gravityInfluence } from "@/journey/gravity";
import { cloudPresence } from "@/journey/environment";

/**
 * The soundscape — procedural, optional, off until asked for.
 *
 * Everything is synthesised with Web Audio: no files, no samples. It is built
 * the first time the visitor turns sound on (that click is the user gesture
 * browsers require), and it is never on at load — not even after a refresh;
 * the choice is deliberately not remembered.
 *
 *   approach   two detuned low sines beating slowly, a soft upper partial,
 *              and brown-noise rumble through a low-pass. Rises through the
 *              ingress, recedes through the egress.
 *   periapsis  band-passed noise whose centre, stereo width and reverb send
 *              all open with gravityInfluence(t) — the same scalar that bends
 *              the light. A change of texture and space, not an impact.
 *   cloud      a deep, quiet pad (A–E–A–D) whose voices drift in level over
 *              tens of seconds, plus faint air; follows cloudPresence(t).
 *   space      a small feedback-delay network: four damped delay lines.
 *
 * Every level is a smooth function of journey t, applied with
 * setTargetAtTime — so scrubbing backwards, seeking and "Begin again" simply
 * glide, and nothing can click. A limiter sits before the speakers.
 */

/** Audio rate. The soundscape has no content above ~1 kHz. */
const SAMPLE_RATE = 24000;

/** Seconds for journey-driven levels to settle (time constant). */
const FOLLOW = 0.3;
/** Seconds for the master fade on enable, disable and tab visibility. */
const FADE = 0.12;

export interface Mix {
  approach: number;
  gravity: number;
  cloud: number;
  ending: number;
}

/** The journey-driven mix at t. Pure, so it can be tested. */
export function mixAt(t: number): Mix {
  return {
    // Opening: near silence. The approach texture rises through the ingress
    // and recedes through the egress.
    approach: smoothstep(0.04, 0.3, t) * (1 - smoothstep(0.6, 0.8, t)),
    gravity: gravityInfluence(t),
    cloud: cloudPresence(t),
    // The last few percent return toward silence without cutting to it.
    ending: 1 - 0.85 * smoothstep(0.92, 1.0, t),
  };
}

/** Seamlessly looping brown noise: the tail is crossfaded into the head. */
function loopNoise(ctx: BaseAudioContext, seconds: number, seed: number) {
  const rate = ctx.sampleRate;
  const len = Math.floor(seconds * rate);
  const fadeLen = Math.floor(0.5 * rate);
  const buffer = ctx.createBuffer(2, len, rate);
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  for (let c = 0; c < 2; c++) {
    const raw = new Float32Array(len + fadeLen);
    let b = 0;
    for (let i = 0; i < raw.length; i++) {
      b = (b + 0.02 * (rand() * 2 - 1)) / 1.02;
      raw[i] = b * 3.5;
    }
    const out = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] = raw[i];
    // The head blends from the continuation of the tail, so the loop point is
    // a continuous signal and cannot click.
    for (let i = 0; i < fadeLen; i++) {
      const w = i / fadeLen;
      out[i] = raw[i] * w + raw[len + i] * (1 - w);
    }
  }
  return buffer;
}

interface Graph {
  master: GainNode;
  approach: GainNode;
  approachFilter: BiquadFilterNode;
  gravity: GainNode;
  gravityBand: BiquadFilterNode;
  pan: StereoPannerNode;
  cloud: GainNode;
  send: GainNode;
  /** Pad voices: gain node, base level, drift rate (Hz), phase. */
  voices: { gain: GainNode; level: number; rate: number; phase: number }[];
  /** Depth of the slow drifts: 1, or 0.4 with reduced motion. */
  drift: number;
  stops: (() => void)[];
  taps?: { master: AnalyserNode; approach: AnalyserNode; gravity: AnalyserNode; cloud: AnalyserNode };
}

/** Build the whole graph on any context — live, or offline for benchmarking. */
export function buildGraph(ctx: BaseAudioContext, calm: boolean, withTaps = false): Graph {
  const stops: (() => void)[] = [];
  const osc = (type: OscillatorType, freq: number) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    stops.push(() => o.stop());
    return o;
  };
  const gain = (v: number) => {
    const g = ctx.createGain();
    g.gain.value = v;
    return g;
  };
  const noise = (seed: number) => {
    const src = ctx.createBufferSource();
    src.buffer = loopNoise(ctx, 6, seed);
    src.loop = true;
    src.start();
    stops.push(() => src.stop());
    return src;
  };
  // The slow drifts (pad voices, stereo motion) are all under 0.1 Hz. They are
  // driven from the update tick with smoothed parameter targets rather than by
  // audio-rate oscillators: indistinguishable, and a fraction of the cost.
  const drift = calm ? 0.4 : 1;

  // ---- output ----
  const master = gain(0);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.01;
  limiter.release.value = 0.4;
  master.connect(limiter).connect(ctx.destination);

  // Space: a small feedback-delay network rather than a convolver — four
  // damped delay lines, split across left and right, decaying over ~3.5 s.
  // A fraction of a convolution's cost, and at these frequencies just as
  // convincing a large, soft room.
  const send = gain(0);
  const wet = gain(0.5);
  const merge = ctx.createChannelMerger(2);
  const preFilter = ctx.createBiquadFilter();
  preFilter.type = "lowpass";
  preFilter.frequency.value = 1800;
  send.connect(preFilter);
  [0.113, 0.171, 0.257, 0.337].forEach((time, i) => {
    const delay = ctx.createDelay(1);
    delay.delayTime.value = time;
    const damp = ctx.createBiquadFilter();
    damp.type = "lowpass";
    damp.frequency.value = 1400;
    const feedback = gain(0.7);
    preFilter.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    delay.connect(merge, 0, i % 2);
  });
  merge.connect(wet).connect(master);

  const bus = (g: GainNode) => {
    g.connect(master);
    g.connect(send);
  };

  // ---- approach: detuned low sines + rumble ----
  const approach = gain(0);
  const approachFilter = ctx.createBiquadFilter();
  approachFilter.type = "lowpass";
  approachFilter.frequency.value = 200;
  approachFilter.Q.value = 0.5;
  const a1 = osc("sine", 41.2);
  const a2 = osc("sine", 41.47); // ~0.27 Hz beating: slow, felt more than heard
  const a3 = osc("triangle", 61.8);
  const a1g = gain(0.5), a2g = gain(0.42), a3g = gain(0.08);
  a1.connect(a1g).connect(approachFilter);
  a2.connect(a2g).connect(approachFilter);
  a3.connect(a3g).connect(approachFilter);
  const rumbleFilter = ctx.createBiquadFilter();
  rumbleFilter.type = "lowpass";
  rumbleFilter.frequency.value = 150;
  rumbleFilter.Q.value = 0.7;
  noise(0x51a7).connect(rumbleFilter).connect(gain(0.9)).connect(approachFilter);
  approachFilter.connect(approach);
  bus(approach);

  // ---- periapsis: band-passed noise, widening ----
  const gravity = gain(0);
  const gravityBand = ctx.createBiquadFilter();
  gravityBand.type = "bandpass";
  gravityBand.frequency.value = 220;
  gravityBand.Q.value = 1.1;
  const pan = ctx.createStereoPanner(); // swept slowly; width grows with gravity
  noise(0x9e37).connect(gravityBand).connect(pan).connect(gravity);
  bus(gravity);

  // ---- cloud: deep pad with slow voice drift, plus air ----
  const cloud = gain(0);
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 700;
  padFilter.Q.value = 0.4;
  const voices: [number, number, number][] = [
    // frequency, level, drift rate (Hz)
    [55.0, 0.34, 0.013],
    [82.41, 0.22, 0.021],
    [110.0, 0.16, 0.017],
    [146.83, 0.1, 0.027],
  ];
  const voiceNodes: Graph["voices"] = [];
  voices.forEach(([f, level, rate], i) => {
    const v = osc("sine", f);
    const vg = gain(level * 0.7);
    v.connect(vg).connect(padFilter);
    voiceNodes.push({ gain: vg, level, rate, phase: i * 1.7 });
  });
  const airFilter = ctx.createBiquadFilter();
  airFilter.type = "lowpass";
  airFilter.frequency.value = 900;
  noise(0x2c1b).connect(airFilter).connect(gain(0.05)).connect(padFilter);
  padFilter.connect(cloud);
  bus(cloud);

  let taps: Graph["taps"];
  if (withTaps) {
    const tap = (n: AudioNode) => {
      const a = ctx.createAnalyser();
      a.fftSize = 2048;
      n.connect(a);
      return a;
    };
    taps = { master: tap(limiter), approach: tap(approach), gravity: tap(gravity), cloud: tap(cloud) };
  }

  return { master, approach, approachFilter, gravity, gravityBand, pan, cloud, send, voices: voiceNodes, drift, stops, taps };
}

/** The slow drifts at wall-clock time `time`, applied with smoothing. */
function applyDrift(g: Graph, m: Mix, time: number, now: number) {
  const TAU = Math.PI * 2;
  for (const v of g.voices) {
    const swing = Math.sin(TAU * v.rate * time + v.phase) * 0.3 * g.drift;
    v.gain.gain.setTargetAtTime(v.level * (0.7 + swing), now, 1.0);
  }
  const width = (0.15 + 0.6 * m.gravity) * g.drift;
  g.pan.pan.setTargetAtTime(Math.sin(TAU * 0.07 * time) * width, now, 0.5);
}

/** Apply the journey mix to a graph, gliding from wherever it is now. */
function applyMix(g: Graph, m: Mix, now: number, tc: number) {
  const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, now, tc);
  // Closest approach thins the approach texture and opens everything up.
  set(g.approach.gain, 0.24 * m.approach * (1 - 0.35 * m.gravity));
  set(g.approachFilter.frequency, 200 + 380 * m.gravity);
  set(g.gravity.gain, 0.14 * m.gravity);
  set(g.gravityBand.frequency, 220 + 520 * m.gravity);
  set(g.send.gain, 0.15 + 0.45 * m.gravity + 0.5 * m.cloud);
  set(g.cloud.gain, 0.22 * m.cloud);
}

type Listener = (on: boolean) => void;

class Soundscape {
  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private on = false;
  private hidden = false;
  private lastT = -1;
  private lastApplied = 0;
  private suspendTimer = 0;
  private listeners = new Set<Listener>();
  private level = 0.8;

  get enabled() {
    return this.on;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Must be called from a user gesture (a click or key press). */
  enable() {
    if (this.on || typeof window === "undefined") return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return; // no Web Audio: the toggle simply stays off
    if (!this.ctx) {
      // Everything here lives below ~1 kHz, so 24 kHz is ample — and halves
      // the audio thread's work compared with 48 kHz.
      this.ctx = new Ctx({ latencyHint: "playback", sampleRate: SAMPLE_RATE });
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      this.graph = buildGraph(this.ctx, calm, process.env.NODE_ENV !== "production");
      document.addEventListener("visibilitychange", this.onVisibility);
    }
    window.clearTimeout(this.suspendTimer);
    this.on = true;
    this.lastT = -1; // force a fresh mix
    void this.ctx.resume();
    this.fadeTo(this.hidden ? 0 : this.level);
    this.emit();
  }

  disable() {
    if (!this.on) return;
    this.on = false;
    this.fadeTo(0);
    this.suspendSoon();
    this.emit();
  }

  toggle() {
    if (this.on) this.disable();
    else this.enable();
  }

  /**
   * Follow the journey. Called every frame from the render loop; cheap when
   * off, and throttled to ~20 updates a second when on.
   */
  update(t: number) {
    if (!this.on || !this.ctx || !this.graph) return;
    const now = this.ctx.currentTime;
    if (Math.abs(t - this.lastT) < 1e-4 && now - this.lastApplied < 0.25) return;
    if (now - this.lastApplied < 0.05 && this.lastT >= 0) return;
    this.lastT = t;
    this.lastApplied = now;
    const m = mixAt(t);
    applyMix(this.graph, m, now, FOLLOW);
    applyDrift(this.graph, m, now, now);
    this.graph.master.gain.setTargetAtTime(this.hidden ? 0 : this.level * m.ending, now, FOLLOW);
  }

  /** Dev only: current levels (RMS, dBFS) at the taps. */
  levels() {
    const taps = this.graph?.taps;
    if (!taps) return null;
    const rms = (a: AnalyserNode) => {
      const buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(buf);
      let s = 0;
      for (const x of buf) s += x * x;
      return +(20 * Math.log10(Math.sqrt(s / buf.length) + 1e-9)).toFixed(1);
    };
    const g = this.graph!;
    return {
      state: this.ctx?.state,
      sampleRate: this.ctx?.sampleRate,
      // The scheduled gains themselves — deterministic, unlike RMS.
      gains: [g.master.gain.value, g.approach.gain.value, g.gravity.gain.value, g.cloud.gain.value, g.send.gain.value].map((v) => +v.toFixed(4)),
      master: rms(taps.master),
      approach: rms(taps.approach),
      gravity: rms(taps.gravity),
      cloud: rms(taps.cloud),
    };
  }

  private fadeTo(v: number) {
    if (!this.ctx || !this.graph) return;
    const p = this.graph.master.gain;
    const now = this.ctx.currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.setTargetAtTime(v, now, FADE);
  }

  /** After the fade has finished, stop the audio thread entirely. */
  private suspendSoon() {
    window.clearTimeout(this.suspendTimer);
    this.suspendTimer = window.setTimeout(() => {
      if ((!this.on || this.hidden) && this.ctx?.state === "running") void this.ctx.suspend();
    }, FADE * 1000 * 6);
  }

  private onVisibility = () => {
    this.hidden = document.visibilityState === "hidden";
    if (!this.on || !this.ctx) return;
    if (this.hidden) {
      this.fadeTo(0);
      this.suspendSoon();
    } else {
      window.clearTimeout(this.suspendTimer);
      void this.ctx.resume();
      this.lastT = -1;
      this.fadeTo(this.level);
    }
  };

  private emit() {
    for (const fn of this.listeners) fn(this.on);
  }
}

export const soundscape = new Soundscape();

/**
 * Dev only: render N seconds of the full graph offline and report how much
 * faster than real time it ran — a CPU budget, measured.
 */
export async function benchmarkSoundscape(seconds = 20) {
  const rate = SAMPLE_RATE;
  const ctx = new OfflineAudioContext(2, seconds * rate, rate);
  const g = buildGraph(ctx, false);
  applyMix(g, { approach: 1, gravity: 1, cloud: 1, ending: 1 }, 0, 0.01);
  g.master.gain.value = 0.8;
  const t0 = performance.now();
  await ctx.startRendering();
  const ms = performance.now() - t0;
  return { seconds, renderMs: Math.round(ms), realtimeFactor: +((seconds * 1000) / ms).toFixed(1) };
}

/**
 * Dev only: render the graph offline through a scripted sequence — a hold, a
 * seek forward, a seek back, a "Begin again" cut to t = 0, a disable and a
 * re-enable — and measure the sharpest sample-to-sample step around each
 * transition against the steady state. A click shows up as a spike far above
 * the background; a clean transition does not.
 */
export async function artifactTest() {
  const rate = SAMPLE_RATE;
  const seconds = 14;
  const ctx = new OfflineAudioContext(2, seconds * rate, rate);
  const g = buildGraph(ctx, false);
  const events: [number, number | "off" | "on"][] = [
    [0, 0.25], [3, 0.85], [6, 0.5], [8, 0.97], [9.5, 0], [11, "off"], [12.5, "on"],
  ];
  // Levels start at the first state instantly, then every event glides as live.
  applyMix(g, mixAt(0.25), 0, 0.001);
  g.master.gain.value = 0.8;
  let lastT = 0.25;
  for (const [at, what] of events.slice(1)) {
    if (what === "off") g.master.gain.setTargetAtTime(0, at, FADE);
    else if (what === "on") g.master.gain.setTargetAtTime(0.8 * mixAt(lastT).ending, at, FADE);
    else {
      lastT = what;
      const m = mixAt(what);
      applyMix(g, m, at, FOLLOW);
      g.master.gain.setTargetAtTime(0.8 * m.ending, at, FOLLOW);
    }
  }
  const out = await ctx.startRendering();
  const L = out.getChannelData(0);
  const stepMax = (from: number, to: number) => {
    let m = 0;
    for (let i = Math.max(1, Math.floor(from * rate)); i < Math.min(L.length, Math.floor(to * rate)); i++) {
      m = Math.max(m, Math.abs(L[i] - L[i - 1]));
    }
    return m;
  };
  let peak = 0;
  for (const x of L) peak = Math.max(peak, Math.abs(x));
  const steady = stepMax(1.0, 2.9);
  const transitions = events.slice(1).map(([at, what]) => ({
    at,
    event: what,
    stepRatio: +(stepMax(at - 0.02, at + 0.6) / Math.max(steady, 1e-9)).toFixed(2),
  }));
  return { peakDbfs: +(20 * Math.log10(peak + 1e-9)).toFixed(1), steadyStep: +steady.toExponential(2), transitions };
}
