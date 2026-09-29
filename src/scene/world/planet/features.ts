import { Vector3, Vector4 } from "three";

/**
 * Named geology — the few deliberate features laid over the procedural
 * surface, informed by the archived Stage 3 candidate (a reference, never a
 * texture): dark basalt plains against lighter highlands, a handful of fresh
 * craters throwing faint blue-grey ejecta, long straight fractures, and a
 * couple of multi-ring impact basins.
 *
 * All positions are unit directions in the planet's frame (it sits at the
 * origin, unrotated, for the whole film). They are placed where the camera
 * actually sees lit ground — the face swung into view by the slingshot, from
 * the sub-camera point at t 0.52 (0.81, 0, 0.58) round to t 0.80
 * (−0.90, −0.23, 0.38), under a star at (−0.57, 0.23, 0.79). Features
 * anywhere else would be baked for nobody.
 *
 * Only shape and albedo are defined here. No light is baked: the star lights
 * all of it live, exactly as it lights everything else.
 */

const dir = (x: number, y: number, z: number) => new Vector3(x, y, z).normalize();
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Multi-ring basins: centre, and inner-ring radius (radians). Outer rings sit
 * at ~1.4× and ~2× that, broken into arcs so no basin ever reads as a target.
 *  A — high sun from t 0.62: reads by albedo, the flooded dark interior.
 *  B — near the terminator at t 0.52–0.58: low sun, reads by relief.
 */
export const BASINS = [
  { centre: dir(-0.33, -0.08, 0.94), radius: 0.13 },
  { centre: dir(0.55, 0.25, 0.8), radius: 0.075 },
];

/** Fresh craters with bright, cool ejecta rays: centre, crater radius (radians). */
export const RAY_CRATERS = [
  // Radii no smaller than ~0.03 rad (10+ texels of the 2048 height map): at
  // closest approach the map is magnified several times, and a smaller bowl
  // shades as facets with a hard shadow notch.
  { centre: dir(-0.08, 0.24, 0.97), radius: 0.04 },
  { centre: dir(-0.62, -0.32, 0.72), radius: 0.034 },
  { centre: dir(0.3, -0.26, 0.92), radius: 0.03 },
  { centre: dir(-0.8, 0.12, 0.58), radius: 0.036 },
  { centre: dir(0.12, 0.47, 0.88), radius: 0.03 },
  { centre: dir(-0.4, -0.6, 0.7), radius: 0.032 },
  { centre: dir(0.66, -0.12, 0.74), radius: 0.03 },
];

/**
 * Long straight fractures (graben): the midpoint of the arc, its bearing
 * there (degrees east of north), and its half-length (radians). Each follows
 * a great circle — straight, as a fault on a sphere is.
 */
export const FRACTURES = [
  { mid: dir(-0.05, -0.42, 0.9), bearing: 64, halfLength: rad(14) },
  { mid: dir(0.42, 0.06, 0.9), bearing: 32, halfLength: rad(10) },
  { mid: dir(-0.62, 0.36, 0.7), bearing: 108, halfLength: rad(11) },
];

/** Great-circle normal for a fracture through `mid` heading along `bearing`. */
function fractureNormal(mid: Vector3, bearingDeg: number) {
  const up = new Vector3(0, 1, 0);
  const east = new Vector3().crossVectors(up, mid).normalize();
  const north = new Vector3().crossVectors(mid, east).normalize();
  const b = rad(bearingDeg);
  const heading = north.multiplyScalar(Math.cos(b)).addScaledVector(east, Math.sin(b));
  return new Vector3().crossVectors(mid, heading).normalize();
}

/** Uniform payloads for the bake. */
export const FEATURE_UNIFORMS = {
  uBasin: BASINS.map((b) => new Vector4(b.centre.x, b.centre.y, b.centre.z, b.radius)),
  uRay: RAY_CRATERS.map((c) => new Vector4(c.centre.x, c.centre.y, c.centre.z, c.radius)),
  uFaultN: FRACTURES.map((f) => {
    const n = fractureNormal(f.mid, f.bearing);
    return new Vector4(n.x, n.y, n.z, f.halfLength);
  }),
  uFaultMid: FRACTURES.map((f) => f.mid.clone()),
};
