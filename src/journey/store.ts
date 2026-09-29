import { create } from "zustand";
import { clamp } from "@/lib/math";

/**
 * The journey store — one normalised parameter for the entire experience.
 *
 * Deliberately split in two:
 *
 *  • `journey` is a plain mutable singleton read and written every frame.
 *    Per-frame values must never live in React state; at 60fps that is 60
 *    re-renders a second and the whole thing judders.
 *
 *  • `useJourneyFlags` is Zustand, and holds only things that change when a
 *    human presses a key. React may re-render for those all it likes.
 *
 * Everything visual is a pure function of `journey.t`. Nothing in the scene
 * reads scroll directly. That single rule is what makes the site feel like one
 * continuous object rather than a stack of coordinated tricks — and it means we
 * can scrub the whole film by writing one number.
 */

export interface Journey {
  /** Where scroll (or the scrub handle) wants us to be. 0..1 */
  target: number;
  /** Where we actually are — spring-damped. This is the number that matters. 0..1 */
  t: number;
  /** Spring velocity, units of t per second. */
  velocity: number;
}

export const journey: Journey = { target: 0, t: 0, velocity: 0 };

/**
 * Stiffness of the critically damped spring that turns `target` into `t`.
 * This single number is most of how the site *feels*. Lower = heavier, more
 * mass, more lag. ~7 settles in about half a second and feels like something
 * large is being moved.
 */
const OMEGA = 7.0;

/** Integrate the spring. Called once per frame from the render loop. */
export function advanceJourney(dt: number) {
  // A long frame (tab regains focus) must not be allowed to explode the spring.
  const step = Math.min(dt, 1 / 30);
  const x = journey.t - journey.target;
  journey.velocity += (-2 * OMEGA * journey.velocity - OMEGA * OMEGA * x) * step;
  journey.t = clamp(journey.t + journey.velocity * step);
}

export function setJourneyTarget(v: number) {
  journey.target = clamp(v);
}

/** Jump without the spring — used when re-syncing scroll after a scrub. */
export function snapJourney(v: number) {
  journey.target = clamp(v);
  journey.t = journey.target;
  journey.velocity = 0;
}

interface JourneyFlags {
  /** While true, scroll input is ignored and the dev panel owns `target`. */
  scrubbing: boolean;
  /** Auto-advance t, for previewing the whole flight hands-free. */
  autoplay: boolean;
  /** Dev panel visibility. */
  panel: boolean;
  setScrubbing: (v: boolean) => void;
  setAutoplay: (v: boolean) => void;
  togglePanel: () => void;
  toggleAutoplay: () => void;
}

export const useJourneyFlags = create<JourneyFlags>((set) => ({
  scrubbing: false,
  autoplay: false,
  panel: true,
  setScrubbing: (v) => set({ scrubbing: v }),
  setAutoplay: (v) => set({ autoplay: v }),
  togglePanel: () => set((s) => ({ panel: !s.panel })),
  toggleAutoplay: () => set((s) => ({ autoplay: !s.autoplay })),
}));

/** Seconds for autoplay to traverse the full journey. */
export const AUTOPLAY_DURATION = 95;
