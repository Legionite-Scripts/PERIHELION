import { Vector3, Vector4 } from "three";
import { trajectory } from "@/journey/trajectory";

/**
 * Where the molecular cloud is, and how it is sampled.
 *
 * PLACEMENT IS SOLVED, NOT CHOSEN. From t ≈ 0.80 to 1.00 the camera's view
 * direction holds within ~3° — it is looking back at the receding planet while
 * flying away from it. The cloud sits on that line of sight, pushed onto the
 * galactic plane: real molecular clouds live in the disc of the galaxy, and the
 * drift view already looks along it (latitude 2–5°), so the cloud continues the
 * existing band and its dust lane instead of arriving from nowhere. The same
 * direction is 127° from anything seen during ingress, so Movements I–II can
 * never show it.
 *
 * Frame, all unit vectors, world space, centred on the planet (world origin):
 *   CLOUD_AXIS  depth — into the cloud, along the drift line of sight
 *   CLOUD_U     along the galactic plane
 *   CLOUD_V     across it (≈ galactic north)
 */

/** Galactic plane orientation — must match Starfield and GalacticBand. */
const BAND_TILT = 0.42;
const BAND_YAW = 0.9;

function galactic(x: number, y: number, z: number) {
  const cosT = Math.cos(BAND_TILT);
  const sinT = Math.sin(BAND_TILT);
  const cosY = Math.cos(BAND_YAW);
  const sinY = Math.sin(BAND_YAW);
  const y1 = y * cosT - z * sinT;
  const z1 = y * sinT + z * cosT;
  return new Vector3(x * cosY + z1 * sinY, y1, -x * sinY + z1 * cosY);
}

const GALACTIC_NORTH = galactic(0, 1, 0).normalize();

/** Journey position whose line of sight the cloud is centred on. */
const DRIFT_REFERENCE_T = 0.9;

const driftView = trajectory
  .lookTarget(DRIFT_REFERENCE_T, new Vector3())
  .sub(trajectory.position(DRIFT_REFERENCE_T, new Vector3()))
  .normalize();

export const CLOUD_AXIS = driftView
  .clone()
  .addScaledVector(GALACTIC_NORTH, -driftView.dot(GALACTIC_NORTH))
  .normalize();
export const CLOUD_U = new Vector3().crossVectors(GALACTIC_NORTH, CLOUD_AXIS).normalize();
export const CLOUD_V = new Vector3().crossVectors(CLOUD_AXIS, CLOUD_U).normalize();

/**
 * The three slices, as distances from the planet along CLOUD_AXIS. Each is a
 * real plane through one continuous 3D density field; the camera's sideways
 * travel during the drift (~300 units) slides them ~6° against each other,
 * and that relative motion is the depth.
 */
export const SLICE_DISTANCES = new Vector3(2600, 3800, 5400);

/**
 * Angular half-extent each slice is baked over, radians, measured from the
 * planet. Sampling is uniform in angle (u ∝ atan(x / D)), not in plane
 * distance, so resolution is spent evenly across the sky instead of piling up
 * at the oblique edges.
 */
export const SLICE_HALF_ANGLE = { u: (60 * Math.PI) / 180, v: (32 * Math.PI) / 180 };

/**
 * One single-channel atlas, slices stacked vertically. 2048 texels across
 * 120° is ~0.06° per texel — about 1.4 screen pixels at the 38° lens — so the
 * dust edges stay sharp. R8 + mips ≈ 8.4 MB.
 */
export const SLICE_TEXELS = { u: 2048, v: 1024 };

/** World units per unit of noise. Sets the physical size of the structure. */
export const CLOUD_NOISE_SCALE = 700;

/**
 * Large-scale envelope of the complex, in the same angular coordinates:
 * centre and half-size. Its boundary is broken up by noise in the bake, so this
 * is a region, never a visible ellipse.
 */
export const CLOUD_ENVELOPE = {
  centre: { u: 0, v: 0 },
  extent: { u: 0.85, v: 0.36 },
};

/**
 * Stellar nurseries: where the young stars are, what lights the dust around
 * them, and what has blown cavities into it. Angular position (degrees, from
 * the planet), distance along the axis, and cavity radius in world units.
 */
const NURSERIES = [
  { u: -9, v: 2, depth: 3900, radius: 420, light: 1.0 },
  { u: 14, v: -5, depth: 4700, radius: 330, light: 0.7 },
  { u: -23, v: -7, depth: 3050, radius: 230, light: 0.45 },
];

function nurseryPosition(n: (typeof NURSERIES)[number]) {
  const d = n.depth;
  return new Vector3()
    .addScaledVector(CLOUD_AXIS, d)
    .addScaledVector(CLOUD_U, d * Math.tan((n.u * Math.PI) / 180))
    .addScaledVector(CLOUD_V, d * Math.tan((n.v * Math.PI) / 180));
}

/** xyz = world position, w = cavity / light radius. */
export const NURSERY_UNIFORM = NURSERIES.map((n) => {
  const p = nurseryPosition(n);
  return new Vector4(p.x, p.y, p.z, n.radius);
});

/** Relative brightness of each nursery's illumination. */
export const NURSERY_LIGHT = new Vector3(...NURSERIES.map((n) => n.light));

/** Opacity of the densest dust. Density 1 → 1 − e^−κ of the light behind it. */
export const DUST_KAPPA = 2.4;

/** Embedded young stars. Sparse on purpose — this is not a second starfield. */
export const YOUNG_STAR_COUNT = 240;

/**
 * Camera-locked shell the cloud is drawn on. Only its depth matters: it must
 * sit behind the planet (≤ 900 away at any point of the drift) so the planet's
 * depth occludes it, and inside the far plane.
 */
export const SHELL_RADIUS = 3000;

/**
 * Half-angle of the shell about CLOUD_AXIS. Nothing is drawn outside it.
 *
 * Solved, not chosen: the bake forces density to exactly zero beyond 93% / 90%
 * of SLICE_HALF_ANGLE, and the widest that zero-density boundary ever appears
 * from the camera — any slice, any t from 0.66 to 1.00, plus up to 4.1° of
 * gravitational deflection and the rig's positional drift — is 60.1°. Two
 * degrees of margin on top. The shell's edge therefore always lies over empty
 * sky, where the cloud contributes nothing, and can never be seen.
 */
export const SHELL_CAP_ANGLE = (62 * Math.PI) / 180;
