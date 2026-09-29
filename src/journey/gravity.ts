import { trajectory } from "./trajectory";
import { smoothstep } from "@/lib/math";

/**
 * Gravitational influence — the one scalar every gravity effect keys off.
 *
 * Anchored to the trajectory's own closest approach, not to a hand-picked t,
 * so re-timing the flight re-times the gravity with it.
 *
 * Why not simply a function of distance: the flight is paced to dwell at
 * periapsis, so r is almost flat across the whole encounter (15.2 at t 0.42,
 * 13 at 0.52, 15.8 at 0.62). A radius-driven field would plateau for a fifth
 * of the film and could not tell ingress from egress. The treatment wants the
 * opposite — a held breath on the way in, the peak at closest approach, and a
 * long release on the way out — so the shape is authored in scroll time:
 *
 *   g = exp(−(|Δt| / σ)^p)
 *
 * a generalised gaussian with its own width and shoulder on each side of
 * periapsis. p > 1 on both sides keeps the peak C1-flat, so nothing kinks as
 * the camera passes through closest approach.
 *
 *   ingress  σ 0.106  p 1.6   long, faint tail; restrained until late
 *   egress   σ 0.165  p 2.5   holds near full strength, then lets go
 *
 *   t      0.12  0.25  0.30  0.42  0.52  0.62  0.68  0.80
 *   g      0     .01   .04   .40   1     .75   .39   .02
 */

const INGRESS = { sigma: 0.1057, power: 1.6 };
const EGRESS = { sigma: 0.1645, power: 2.5 };

/**
 * Where the tail is forced to exactly zero, in units of σ. The gaussian is
 * already ~1e-4 by then; this only guarantees the far field is untouched.
 */
const CUTOFF_START = 3.0;
const CUTOFF_END = 3.6;

/** Normalised gravitational influence at journey position t. 0..1. */
export function gravityInfluence(t: number): number {
  const d = t - trajectory.config.periapsisAt;
  const { sigma, power } = d < 0 ? INGRESS : EGRESS;
  const x = Math.abs(d) / sigma;
  return Math.exp(-Math.pow(x, power)) * (1 - smoothstep(CUTOFF_START, CUTOFF_END, x));
}

/**
 * Runtime switches, read every frame by the lens. A plain mutable singleton,
 * like `journey`: flipping it must never cause a React render.
 *
 * In development, `?gravity=0` disables bending at load (same convention as
 * `?t=`), for A/B. Production always ships with gravity on.
 */
export const gravity = {
  enabled: true,
  /** Multiplier on the whole effect. 1 = as art-directed. */
  strength: 1,
};

// Literal DEV test (see @/dev/handles) so production drops the switch entirely.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  const param = new URLSearchParams(window.location.search).get("gravity");
  if (param === "0" || param === "off") gravity.enabled = false;
}
