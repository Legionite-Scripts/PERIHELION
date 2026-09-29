import { Camera, Vector3 } from "three";
import { gravity, gravityInfluence } from "@/journey/gravity";
import { PLANET_RADIUS } from "@/scene/world/planet/constants";

/**
 * Gravitational lensing of the sky.
 *
 * Not a post-process. A screen-space warp would need the whole frame in a
 * render target, would resample (and soften) the planet along with everything
 * else, and would smear stars into blobs wherever it stretched. Instead the
 * bending is applied where the sky is drawn:
 *
 *   • the starfield moves each star's *vertex* — stars are displaced, never
 *     resampled, so they stay single sharp points however hard they bend;
 *   • the galactic band bends the direction it looks up per fragment.
 *
 * Both happen in angle space around the true direction to the mass, so the
 * field is centred on the planet wherever it sits in frame, and nothing
 * rectangular or screen-shaped can appear. The planet, atmosphere and dust are
 * untouched: a lens does not distort itself, and the motes are foreground.
 * Zero extra passes, zero render targets, zero extra draw calls.
 *
 * The model is the point-mass lens equation,
 *
 *   β = θ − α(θ),    α(θ) = θE² / θ · exp(−(θ/T)²)
 *
 * θ is where a star appears, β where it truly is, both measured from the mass;
 * θE is the Einstein angle. The 1/θ term is real lensing — rays passing close
 * bend most — and the gaussian taper T keeps the far sky still, which a true
 * 1/θ field would not. Neither term can blow up: at small θ the primary image
 * sits at θE, not at infinity, and dα/dθ < 0 everywhere, so the mapping is
 * strictly monotonic and can never fold the sky over itself.
 *
 * The Einstein angle is held inside the planet's disc, so the ring itself is
 * always occluded. What you see is what a real lens looks like from outside
 * its ring: sky from *behind* the planet revealed around the limb, and the
 * starfield near the edge flowing around the disc as the camera passes.
 */

/** Peak Einstein angle, radians, at g = 1. ~14°, against a 32.6° disc at periapsis. */
const THETA_E_MAX = 0.245;

/** Never let the Einstein ring leave the disc, whatever the strength dial says. */
const THETA_E_DISC_FRACTION = 0.8;

/** Far-field taper, as a multiple of the disc's angular radius, plus a floor. */
const TAPER_DISC_SCALE = 2.2;
const TAPER_MIN = 0.35;

/**
 * Shared uniform objects. Every material spreads these into its own uniforms,
 * so all of them read the same values and one update per frame drives the lot.
 */
export const lensUniforms = {
  uLensDir: { value: new Vector3(0, 0, -1) },
  uLensThetaE: { value: 0 },
  uLensTaper: { value: 1 },
};

export const LENS_GLSL = /* glsl */ `
  uniform vec3  uLensDir;     // unit, camera → mass, world space
  uniform float uLensThetaE;  // Einstein angle, radians. 0 = off.
  uniform float uLensTaper;   // far-field taper angle, radians

  float lensAlpha(float theta) {
    float x = theta / uLensTaper;
    return uLensThetaE * uLensThetaE / max(theta, 1e-4) * exp(-x * x);
  }

  /** Rotate unit d away from / toward the lens, in their shared plane, to angle a. */
  vec3 lensRotate(vec3 d, float c, float a) {
    vec3 perp = d - uLensDir * c;
    float len = length(perp);
    if (len < 1e-6) return d;
    perp /= len;
    return cos(a) * uLensDir + sin(a) * perp;
  }

  /** Apparent direction → true direction. Exact, closed form. */
  vec3 lensSource(vec3 d) {
    if (uLensThetaE <= 0.0) return d;
    float c = clamp(dot(d, uLensDir), -1.0, 1.0);
    float theta = acos(c);
    return lensRotate(d, c, theta - lensAlpha(theta));
  }

  /**
   * True direction → apparent direction (the primary image). Seeded with the
   * exact point-mass solution, then Newton against the tapered field; f is
   * monotonic, so three steps is converged to well under a pixel.
   */
  vec3 lensImage(vec3 d) {
    if (uLensThetaE <= 0.0) return d;
    float c = clamp(dot(d, uLensDir), -1.0, 1.0);
    float beta = acos(c);
    float e2 = uLensThetaE * uLensThetaE;
    float theta = 0.5 * (beta + sqrt(beta * beta + 4.0 * e2));
    float invT2 = 1.0 / (uLensTaper * uLensTaper);
    for (int i = 0; i < 3; i++) {
      float a = lensAlpha(theta);
      float f = theta - a - beta;
      float fp = 1.0 + a * (1.0 / max(theta, 1e-4) + 2.0 * theta * invT2);
      theta -= f / fp;
    }
    return lensRotate(d, c, theta);
  }
`;

const _toMass = new Vector3();

/**
 * Point the lens at the planet from wherever the camera actually is (drift
 * included), and size it from the journey. Call once per frame, after the
 * camera has moved.
 */
export function updateLens(camera: Camera, t: number) {
  // The mass sits at the world origin for the whole film.
  _toMass.copy(camera.position).negate();
  const dist = _toMass.length();
  lensUniforms.uLensDir.value.copy(_toMass).divideScalar(Math.max(dist, 1e-6));

  const disc = Math.asin(Math.min(1, PLANET_RADIUS / Math.max(dist, PLANET_RADIUS)));

  const g = gravity.enabled ? gravityInfluence(t) * gravity.strength : 0;
  lensUniforms.uLensThetaE.value = Math.min(g * THETA_E_MAX, disc * THETA_E_DISC_FRACTION);
  lensUniforms.uLensTaper.value = disc * TAPER_DISC_SCALE + TAPER_MIN;
}
