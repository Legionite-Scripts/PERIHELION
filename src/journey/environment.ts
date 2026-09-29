/**
 * The second environment — how present the molecular cloud is at journey t.
 *
 * Most of the reveal is not authored here at all. From t ≈ 0.68 the camera
 * looks back at the receding planet, and its existing turn swings the cloud in
 * from the frame edge (36° off-axis at 0.68, 14° at 0.74, centred by 0.80).
 * This scalar only lets the dust itself thicken into visibility behind that
 * turn, so the frame at 0.68 carries a trace rather than a finished object.
 *
 *   t      0.66  0.68  0.80  0.90  1.00
 *   p      0     .03   .35   .80   1
 *
 * Monotone cubic (Fritsch–Carlson) through those knots, flat at both ends: it
 * never overshoots, never dips, and holds at 1 — the film ends parked in the
 * cloud, not fading out of it.
 */

const KNOTS_T = [0.66, 0.68, 0.8, 0.9, 1.0];
const KNOTS_P = [0, 0.03, 0.35, 0.8, 1.0];

/** Knot tangents, solved once. Zero at both ends so the curve lands flat. */
const TANGENTS = (() => {
  const n = KNOTS_T.length;
  const secant: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    secant.push((KNOTS_P[i + 1] - KNOTS_P[i]) / (KNOTS_T[i + 1] - KNOTS_T[i]));
  }
  const m = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    m[i] = secant[i - 1] * secant[i] > 0 ? (secant[i - 1] + secant[i]) / 2 : 0;
  }
  // Fritsch–Carlson limiter: keeps every segment monotone.
  for (let i = 0; i < n - 1; i++) {
    if (secant[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / secant[i];
    const b = m[i + 1] / secant[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * secant[i];
      m[i + 1] = k * b * secant[i];
    }
  }
  return m;
})();

/** Presence of the molecular cloud at journey position t. 0..1, exactly 0 before 0.66. */
export function cloudPresence(t: number): number {
  const n = KNOTS_T.length;
  if (t <= KNOTS_T[0]) return 0;
  if (t >= KNOTS_T[n - 1]) return KNOTS_P[n - 1];
  let i = 0;
  while (t > KNOTS_T[i + 1]) i++;
  const h = KNOTS_T[i + 1] - KNOTS_T[i];
  const s = (t - KNOTS_T[i]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * KNOTS_P[i] +
    (s3 - 2 * s2 + s) * h * TANGENTS[i] +
    (-2 * s3 + 3 * s2) * KNOTS_P[i + 1] +
    (s3 - s2) * h * TANGENTS[i + 1]
  );
}

/**
 * The colour of the star-forming region — how much of the emission nebula's
 * light has come up. Separate from the dust's presence because it tells a
 * different part of the story: the dust arrives as a darkening, the colour as
 * the final act's reveal.
 *
 *   t      0.58  0.60  0.62  0.66  0.70  0.80  0.90  1.00
 *   n      0     .08   .18   .30   .38   .58   .9    1
 *
 * The nebula's region only reaches the frame from t ≈ 0.62 (17% of it, half
 * by 0.66), so the first light has to be up by then for the emergence behind
 * the receding planet to be seen at all; full colour only in the drift.
 */
const NEBULA_T = [0.58, 0.6, 0.62, 0.66, 0.7, 0.8, 0.9, 1.0];
const NEBULA_P = [0, 0.08, 0.18, 0.3, 0.38, 0.58, 0.9, 1.0];

function monotoneTangents(xs: number[], ys: number[]) {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] > 0 ? (d[i - 1] + d[i]) / 2 : 0;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return m;
}

const NEBULA_M = monotoneTangents(NEBULA_T, NEBULA_P);

export function nebulaPresence(t: number): number {
  const n = NEBULA_T.length;
  if (t <= NEBULA_T[0]) return 0;
  if (t >= NEBULA_T[n - 1]) return NEBULA_P[n - 1];
  let i = 0;
  while (t > NEBULA_T[i + 1]) i++;
  const h = NEBULA_T[i + 1] - NEBULA_T[i];
  const s = (t - NEBULA_T[i]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * NEBULA_P[i] +
    (s3 - 2 * s2 + s) * h * NEBULA_M[i] +
    (-2 * s3 + 3 * s2) * NEBULA_P[i + 1] +
    (s3 - s2) * h * NEBULA_M[i + 1]
  );
}

/**
 * Runtime switch, read every frame. A plain mutable singleton like `gravity`:
 * flipping it must never cause a React render. Only the dev tools touch it.
 */
export const cloud = {
  enabled: true,
};
