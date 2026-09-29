/** Small, dependency-free math helpers shared across the journey. */

export const clamp = (v: number, min = 0, max = 1) =>
  v < min ? min : v > max ? max : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Frame-rate independent exponential approach.
 * `tau` is the time constant in seconds: after `tau`, ~63% of the gap is closed.
 */
export const damp = (current: number, target: number, tau: number, dt: number) =>
  target + (current - target) * Math.exp(-dt / tau);

/**
 * Ken Perlin's smootherstep. Zero first AND second derivative at both ends,
 * which is what keeps the flight C2-continuous where the two halves of the
 * trajectory meet at closest approach.
 */
export const smootherstep = (x: number) => {
  const t = clamp(x);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** Deterministic PRNG so every reload produces the identical sky. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Smooth, non-repeating drift in [-1, 1] from a sum of incommensurable sines.
 * Cheaper than Perlin and perfectly adequate for sub-degree camera attitude jitter.
 */
export const drift = (x: number) =>
  (Math.sin(x) * 0.62 + Math.sin(x * 2.371 + 1.7) * 0.26 + Math.sin(x * 4.137 + 4.1) * 0.12);

/** Approximate blackbody colour for a stellar temperature in Kelvin. */
export function kelvinToRGB(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r: number, g: number, b: number;

  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }

  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return [clamp(r / 255), clamp(g / 255), clamp(b / 255)];
}
