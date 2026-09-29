"use client";

import { MOVEMENTS } from "@/journey/movements";
import { registerMovement, registerOverlay } from "./overlay";
import { travelTo } from "./travel";

/**
 * The orbit, as one hairline.
 *
 * A 1px line down the left edge (along the bottom on portrait screens) with a
 * small mark for where the flight is now, and five ticks for the movements.
 * It is not a scrollbar: it has no thumb to drag and no chrome, and at rest it
 * is barely there. Hovering or focusing a tick reveals its numeral; activating
 * it glides the flight there through the scroll system.
 *
 * The mark warms to the star's colour only near closest approach — the one
 * place the interface borrows the warm light.
 */
export function JourneyIndicator() {
  return (
    <nav className="journey" aria-label="Journey">
      <div className="journey__track" aria-hidden>
        <div className="journey__slider" ref={(el) => registerOverlay("mark", el)}>
          <span className="journey__mark" />
          <span
            className="journey__mark journey__mark--warm"
            ref={(el) => registerOverlay("markWarm", el)}
          />
        </div>
      </div>
      <ol className="journey__list">
        {MOVEMENTS.map((m, i) => (
          <li key={m.numeral} className="journey__item" style={{ ["--at" as string]: m.at }}>
            <button
              type="button"
              className="journey__tick"
              aria-label={`Movement ${m.numeral}: ${m.name}`}
              ref={(el) => registerMovement(i, el)}
              onClick={() => travelTo(m.at)}
            >
              <span className="journey__numeral" aria-hidden>
                {m.numeral}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
