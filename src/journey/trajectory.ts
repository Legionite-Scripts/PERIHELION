import { Euler, Quaternion, Vector3 } from "three";
import { smootherstep } from "@/lib/math";

/**
 * PERIHELION — the flight path.
 *
 * The whole site is one hyperbolic flyby of a single mass sitting at the world
 * origin. Scroll is the orbital parameter. Nothing else in the app knows what
 * shape the path is; everything asks this module. Swap the maths here and the
 * entire experience re-choreographs itself.
 *
 * Pure functions, no three.js scene access, no React — trivially testable and
 * trivially replaceable.
 */

export interface TrajectoryConfig {
  /** Closest approach distance to the mass, in world units. */
  periapsis: number;
  /** Orbital eccentricity. > 1 is an unbound (hyperbolic) flyby. */
  eccentricity: number;
  /** Distance from the mass at t = 0 and t = 1. */
  farRadius: number;
  /** Where along t closest approach happens. */
  periapsisAt: number;
  /**
   * Extra weighting toward closest approach. 1 is neutral; > 1 spends more of
   * the scroll parked near the mass, which is where the interesting thing
   * happens. This is the pacing dial for Movement III.
   */
  dwell: number;
  /** Tilt of the orbital plane, radians. Keeps the path off the world axes. */
  inclination: number;
  /** Rotation of the orbital plane about Y, radians. */
  nodeAngle: number;
}

export const DEFAULT_TRAJECTORY: TrajectoryConfig = {
  periapsis: 13,
  eccentricity: 1.6,
  farRadius: 900,
  periapsisAt: 0.52,
  dwell: 1.12,
  inclination: 0.27,
  nodeAngle: -0.62,
};

export class Trajectory {
  readonly config: TrajectoryConfig;

  /** Semi-major axis of the hyperbola. */
  private readonly a: number;
  /** Semi-minor axis. */
  private readonly b: number;
  /** Hyperbolic anomaly at the two ends of the path. */
  private readonly uMax: number;
  /** Orientation of the orbital plane. */
  private readonly orientation: Quaternion;

  constructor(config: Partial<TrajectoryConfig> = {}) {
    this.config = { ...DEFAULT_TRAJECTORY, ...config };
    const { periapsis, eccentricity: e, farRadius } = this.config;

    this.a = periapsis / (e - 1);
    this.b = this.a * Math.sqrt(e * e - 1);
    // r = a(e·cosh u − 1)  ⇒  solve for u at the far end of the path.
    this.uMax = Math.acosh((farRadius / this.a + 1) / e);

    this.orientation = new Quaternion().setFromEuler(
      new Euler(this.config.inclination, this.config.nodeAngle, 0, "YXZ")
    );
  }

  /**
   * Signed, normalised distance from closest approach in *scroll* terms.
   * −1 at the start, 0 at periapsis, +1 at the end.
   */
  private phase(t: number): number {
    const p = this.config.periapsisAt;
    return t < p ? -(1 - t / p) : (t - p) / (1 - p);
  }

  /**
   * Distance from the mass at t — and the real pacing of the entire site.
   *
   * The obvious approach is to pace on the hyperbolic anomaly and let radius
   * fall out of the orbit. Do not: r grows like cosh(u), so an evenly-paced
   * anomaly collapses 900 units of distance into the first tenth of the scroll
   * and then parks for the rest. Movement I is supposed to be the still one.
   *
   * So pace on radius directly, geometrically. What the eye actually reads as
   * "approach speed" is the rate of change of *apparent size*, which goes as
   * 1/r — so even motion means even change in log r, not in r. Eased at both
   * ends with smootherstep: nearly static in the far field, nearly static at
   * closest approach, and the fall happens in between.
   */
  radius(t: number): number {
    const { periapsis, farRadius, dwell } = this.config;
    const f = Math.pow(smootherstep(Math.abs(this.phase(t))), dwell);
    return periapsis * Math.pow(farRadius / periapsis, f);
  }

  /**
   * t → hyperbolic anomaly, derived by inverting the orbit equation for the
   * radius we actually want. The path stays a true hyperbola; only the rate at
   * which we travel along it is art-directed.
   */
  anomaly(t: number): number {
    const e = this.config.eccentricity;
    const coshU = Math.max(1, (this.radius(t) / this.a + 1) / e);
    return Math.sign(this.phase(t)) * Math.acosh(coshU);
  }

  /** Camera position at t. */
  position(t: number, out = new Vector3()): Vector3 {
    const u = this.anomaly(t);
    const e = this.config.eccentricity;
    // Periapsis lies on +X; the camera sweeps through the XZ plane.
    out.set(this.a * (e - Math.cosh(u)), 0, this.b * Math.sinh(u));
    return out.applyQuaternion(this.orientation);
  }

  /** Unit direction of travel at t. */
  tangent(t: number, out = new Vector3()): Vector3 {
    const h = 1e-3;
    const ahead = this.position(Math.min(1, t + h), _a);
    const behind = this.position(Math.max(0, t - h), _b);
    return out.subVectors(ahead, behind).normalize();
  }

  /**
   * Where the camera aims.
   *
   * Not simply "at the mass" — that would centre the subject for the whole
   * flight and read as a rollercoaster POV. Instead the aim point is pushed
   * sideways and vertically off the mass by a slow, smooth amount, so the
   * subject drifts across the frame, approaches an edge, and is briefly lost
   * behind the limb. This is the difference between a camera move and framing.
   */
  lookTarget(t: number, out = new Vector3()): Vector3 {
    const p = this.position(t, _a);
    const r = p.length();

    const toMass = _b.copy(p).negate().normalize();
    const right = _c.crossVectors(toMass, WORLD_UP).normalize();
    const up = _d.crossVectors(right, toMass).normalize();

    // Hand-tuned, continuous, and deliberately not periodic with the path.
    const ox = 0.3 * Math.sin(t * Math.PI * 1.3 + 0.6);
    const oy = -0.15 + 0.2 * Math.cos(t * Math.PI * 0.9);

    return out
      .set(0, 0, 0)
      .addScaledVector(right, ox * r)
      .addScaledVector(up, oy * r);
  }

  /** Camera roll at t, radians. Small, slow, and never level for long. */
  roll(t: number): number {
    return 0.105 * Math.sin(t * Math.PI * 1.7 - 0.4);
  }

  /**
   * Normalised speed along the path, 0..1, peaking at periapsis.
   * Unused by the render for now; exposed because the later stages
   * (grain, sound, gravity ramp) should all key off real orbital speed.
   */
  speed(t: number): number {
    const h = 2e-3;
    const d = this.position(Math.min(1, t + h), _a).distanceTo(
      this.position(Math.max(0, t - h), _b)
    );
    return d / (2 * h) / (this.config.farRadius * 2);
  }
}

const WORLD_UP = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _d = new Vector3();

export const trajectory = new Trajectory();
