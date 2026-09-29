"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { JOURNEY_VH, setLenis } from "./lenis";
import { journey, snapJourney, useJourneyFlags } from "@/journey/store";
import { trajectory } from "@/journey/trajectory";
import { gravity, gravityInfluence } from "@/journey/gravity";
import { cloud, cloudPresence } from "@/journey/environment";
import { exposeDevHandles, removeDevHandles } from "@/dev/handles";

/**
 * Owns the Lenis instance and the tall spacer that gives the page its scroll
 * length. Renders no visuals — the entire site is one fixed canvas, and this
 * just provides the runway.
 *
 * Note there is no `lenis.raf` loop here on purpose: the render loop advances
 * it (see scene/Driver.tsx).
 */
export function ScrollProvider({ children }: { children?: React.ReactNode }) {
  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.075,
      wheelMultiplier: 0.9,
      touchMultiplier: 1.1,
      // We drive rAF ourselves from the render loop.
      autoRaf: false,
    });
    setLenis(lenis);

    // `?t=0.52` jumps straight to a frame. Invaluable when reviewing a specific
    // moment without scrolling seven screens to reach it.
    // Dev hook: `__perihelion.seek(0.52)` parks the flight on any frame from
    // the console or an automated capture, without touching scroll.
    const hook = {
      seek(t: number) {
        useJourneyFlags.getState().setScrubbing(true);
        snapJourney(t);
      },
      trajectory,
      journey,
      /** g at t (default: now), before the strength dial and the on/off switch. */
      gravityInfluence(t: number = journey.t) {
        return gravityInfluence(t);
      },
      setGravityStrength(v: number) {
        gravity.strength = Math.max(0, v);
      },
      /** A/B switch. Also `?gravity=0` at load, or `G` with the scrub panel. */
      setGravityEnabled(on: boolean) {
        gravity.enabled = on;
      },
      /** Molecular cloud presence at t (default: now), before the switch. */
      cloudPresence(t: number = journey.t) {
        return cloudPresence(t);
      },
      /** A/B switch. Also `C` with the scrub panel. */
      setCloudEnabled(on: boolean) {
        cloud.enabled = on;
      },
      release() {
        useJourneyFlags.getState().setScrubbing(false);
        lenis.scrollTo(journey.t * lenis.limit, { immediate: true, force: true });
      },
    };
    if (process.env.NODE_ENV !== "production") {
      exposeDevHandles({ __perihelion: hook });
    }

    const param = new URLSearchParams(window.location.search).get("t");
    let raf = 0;
    if (param !== null) {
      const t = parseFloat(param);
      if (Number.isFinite(t)) {
        // Deferred a frame so the spacer has been laid out and Lenis has a
        // real scroll limit to seek within.
        raf = requestAnimationFrame(() => {
          lenis.resize();
          snapJourney(t);
          lenis.scrollTo(t * lenis.limit, { immediate: true, force: true });
        });
      }
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (process.env.NODE_ENV !== "production") {
        removeDevHandles("__perihelion");
      }
      setLenis(null);
      lenis.destroy();
    };
  }, []);

  return (
    <>
      {children}
      <div aria-hidden style={{ height: `${JOURNEY_VH}vh` }} />
    </>
  );
}

