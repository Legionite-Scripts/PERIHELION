import type Lenis from "lenis";

/**
 * Module singleton for the Lenis instance.
 *
 * The R3F render loop needs to drive Lenis so there is exactly one rAF in the
 * app — two loops fight each other and produce sub-frame jitter you can feel
 * but not screenshot. A module singleton is simpler and safer than threading
 * React context across the Canvas reconciler boundary.
 */
let instance: Lenis | null = null;

export const setLenis = (l: Lenis | null) => {
  instance = l;
};
export const getLenis = () => instance;

/** Total scroll length of the flight, in viewport heights. */
export const JOURNEY_VH = 720;
