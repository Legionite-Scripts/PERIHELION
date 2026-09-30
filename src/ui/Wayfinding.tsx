"use client";

import { registerOverlay } from "./overlay";
import { beginAgain } from "./travel";
import { SoundToggle } from "./SoundToggle";
import { ZoomControl } from "./ZoomControl";

/**
 * The three small pieces of interface around the film, all driven by
 * journey t from UiDriver:
 *
 *  • the opening cue — "Begin the approach" and a short hairline, gone as soon
 *    as the flight begins, back only if someone lingers at the start;
 *  • the wordmark — the name kept quietly in the corner once the title has
 *    been left behind;
 *  • "Begin again" — with the last line, a fade to black and back to t = 0;
 *  • the telescope — zoom, on the right edge (ZoomControl).
 */
export function Wayfinding() {
  return (
    <>
      <div className="cue-entrance">
        <p className="cue" ref={(el) => registerOverlay("cue", el)}>
          <span className="cue__label">Begin the approach</span>
          <span className="cue__line" aria-hidden />
        </p>
      </div>

      <p className="wordmark" aria-hidden ref={(el) => registerOverlay("wordmark", el)}>
        Perihelion
      </p>

      <SoundToggle />

      <ZoomControl />

      <div className="restart-slot">
        <button
          type="button"
          className="restart"
          ref={(el) => registerOverlay("restart", el)}
          onClick={() => beginAgain(document.getElementById("title"))}
        >
          Begin again
        </button>
      </div>
    </>
  );
}
