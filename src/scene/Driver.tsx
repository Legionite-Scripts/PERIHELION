"use client";

import { useFrame } from "@react-three/fiber";
import { getLenis } from "@/lib/scroll/lenis";
import {
  AUTOPLAY_DURATION,
  advanceJourney,
  journey,
  setJourneyTarget,
  useJourneyFlags,
} from "@/journey/store";
import { clamp } from "@/lib/math";

/**
 * The single clock.
 *
 * One rAF for the entire application: Lenis is advanced from inside the R3F
 * loop rather than running its own, so scroll smoothing and rendering can never
 * drift out of phase with each other.
 *
 * Order of business each frame:
 *   1. advance Lenis
 *   2. turn scroll (or autoplay, or the scrub handle) into `journey.target`
 *   3. integrate the spring into `journey.t`
 *
 * Everything else in the scene then reads `journey.t`. Mounted first so it runs
 * first.
 */
export function Driver() {
  useFrame((_, dt) => {
    const lenis = getLenis();
    const { scrubbing, autoplay } = useJourneyFlags.getState();

    if (lenis) lenis.raf(performance.now());

    if (autoplay) {
      const next = journey.target + dt / AUTOPLAY_DURATION;
      if (next >= 1) {
        // Park at the end of the journey rather than cutting back to the start.
        setJourneyTarget(1);

        // The real scrollbar has not moved while autoplay was driving, so bring
        // it to the end before releasing. Without this, clearing the flag hands
        // control straight back to a scrollbar still sitting at zero and the
        // journey snaps to the beginning — the same hard cut, just relocated.
        if (lenis && lenis.limit > 0) {
          lenis.scrollTo(lenis.limit, { immediate: true, force: true });
        }

        useJourneyFlags.getState().setAutoplay(false);
      } else {
        setJourneyTarget(next);
      }
    } else if (!scrubbing && lenis) {
      const limit = lenis.limit;
      if (limit > 0) setJourneyTarget(clamp(lenis.scroll / limit));
    }

    advanceJourney(dt);
  });

  return null;
}
