import { MathUtils, Vector3 } from "three";
import { trajectory } from "@/journey/trajectory";
import { smoothstep } from "@/lib/math";
import { SUN_DIRECTION } from "@/scene/lighting";

/**
 * Framing rules that depend on the shape of the screen.
 *
 * The flight path is the same on every device; only the lens and where the
 * operator points it change. At aspect ≥ 1 — every desktop and landscape
 * screen — both functions return exactly what the camera always used: a 38°
 * vertical lens and trajectory.lookTarget, untouched. Portrait is the only
 * case handled here.
 *
 * Why portrait needs anything at all: a fixed 38° *vertical* lens on a
 * 390 × 844 phone sees only ~18° horizontally, and the aim point is pushed up
 * to ~10° sideways off the planet for composition. The planet spends most of
 * the flight outside the frame.
 *
 * So in portrait:
 *  • the lens keeps (up to a limit) the 38° it would have had horizontally,
 *    widening vertically instead — 52° on a tablet, capped at 64° on a phone;
 *  • only the SIDEWAYS part of the aim offset is reduced — the part the narrow
 *    frame cannot hold. The vertical part, which a tall frame holds easily,
 *    is left as composed.
 *
 * Both blend continuously to the desktop values as the aspect approaches 1, so
 * rotating a tablet never snaps the frame.
 *
 * One deliberate exception applies on every screen: the brief glance at the
 * star during the ingress (starGlance, below).
 */

export const DESKTOP_FOV = 38;

/** Horizontal lens portrait tries to keep, and the widest vertical it allows. */
const PORTRAIT_HFOV = 38;
const PORTRAIT_MAX_VFOV = 64;

/** Fraction of the sideways aim offset kept on the narrowest screens. */
const PORTRAIT_SIDE_KEEP = 0.3;

/** 0 on landscape, rising to 1 on a phone-shaped portrait screen. */
export function portraitAmount(aspect: number): number {
  return aspect >= 1 ? 0 : 1 - smoothstep(0.45, 1.0, aspect);
}

/** Vertical field of view, degrees. */
export function fovFor(aspect: number): number {
  if (aspect >= 1) return DESKTOP_FOV;
  const halfH = MathUtils.degToRad(PORTRAIT_HFOV / 2);
  const v = MathUtils.radToDeg(2 * Math.atan(Math.tan(halfH) / aspect));
  return Math.min(PORTRAIT_MAX_VFOV, Math.max(DESKTOP_FOV, v));
}

const _p = new Vector3();
const _right = new Vector3();
const WORLD_UP = new Vector3(0, 1, 0);

/**
 * The glance at the star.
 *
 * The star is never moved, and for almost the whole flight it is simply out
 * of shot — its presence carried by the terminator and the lit crescent. But
 * during the ingress (t ≈ 0.24–0.30) it passes just 7–10° above the top of
 * the frame, directly beyond the crescent it is lighting. So here, once, the
 * operator lifts the lens toward it — up to 12°, eased in and out — and the
 * source and the thing it lights share the frame. Then the camera returns to
 * its established framing.
 */
const STAR_GLANCE_DEG = 12;
const STAR_GLANCE = { rise: [0.19, 0.27], fall: [0.31, 0.37] } as const;

export function starGlance(t: number): number {
  return (
    smoothstep(STAR_GLANCE.rise[0], STAR_GLANCE.rise[1], t) *
    (1 - smoothstep(STAR_GLANCE.fall[0], STAR_GLANCE.fall[1], t))
  );
}

const _dir = new Vector3();
const _axis = new Vector3();
const _bisect = new Vector3();

/** Where the camera aims at journey t on a screen of this aspect. */
export function aimFor(t: number, aspect: number, out = new Vector3()): Vector3 {
  trajectory.lookTarget(t, out);
  trajectory.position(t, _p);

  const k = portraitAmount(aspect);
  if (k > 0) {
    // The same "right" the trajectory builds its offset from. The mass sits at
    // the origin, so the look target *is* the offset; split off its sideways
    // part and shorten only that.
    _right.copy(_p).negate().normalize().cross(WORLD_UP).normalize();
    const side = out.dot(_right);
    out.addScaledVector(_right, -side * (1 - PORTRAIT_SIDE_KEEP) * k);
  }

  // Turn the line of sight toward the star by the glance angle, keeping the
  // distance to the aim point — so the damped aim in the rig eases through it.
  const glance = starGlance(t);
  if (glance > 0) {
    _dir.subVectors(out, _p);
    const dist = _dir.length();
    _dir.divideScalar(dist);
    _axis.crossVectors(_dir, SUN_DIRECTION);
    const sin = _axis.length();
    if (sin > 1e-6) {
      _axis.divideScalar(sin);
      const angle = Math.min(Math.asin(Math.min(1, sin)), (STAR_GLANCE_DEG * Math.PI) / 180 * glance);
      _dir.applyAxisAngle(_axis, angle);

      // A portrait frame is only ±19° wide: tilting toward the star would push
      // the planet out of shot. There the lens instead settles on the bisector
      // of planet and star — ~39° apart at the glance, so each sits ~14° from
      // centre and both are held.
      if (k > 0) {
        _bisect.copy(_p).negate().normalize().add(SUN_DIRECTION).normalize();
        _dir.lerp(_bisect, k * glance).normalize();
      }
      out.copy(_p).addScaledVector(_dir, dist);
    }
  }
  return out;
}
