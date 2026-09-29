"use client";

import { useEffect } from "react";
import { markReady, registerOverlay } from "./overlay";

/**
 * The first frame: a black veil that fades up once the scene has rendered,
 * and the title block in the lower third.
 *
 * The planet sits just above and to the right of the title at t = 0 — a world
 * ten pixels across, above its own name. The block recedes as the flight
 * begins (UiDriver) and is gone by t ≈ 0.035.
 */

/** Lift the veil regardless, if the scene has not rendered by then. */
const VEIL_FALLBACK_MS = 4000;

export function Opening() {
  useEffect(() => {
    const id = window.setTimeout(markReady, VEIL_FALLBACK_MS);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <>
      <div className="veil" aria-hidden />
      <header className="opening">
        <div className="opening__block" ref={(el) => registerOverlay("opening", el)}>
          {/* Focus returns here after "Begin again". */}
          <h1 id="title" className="opening__title" tabIndex={-1}>
            PERIHELION
          </h1>
          <p className="opening__line">One pass by a world that has no name.</p>
          <p className="opening__label">Unbound orbit · Eccentricity 1.6</p>
        </div>
      </header>
    </>
  );
}
