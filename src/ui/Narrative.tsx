"use client";

import { SCRIPT } from "@/journey/script";
import { registerBeat } from "./overlay";

/**
 * The narrative beats, as real text in reading order.
 *
 * Visually only one is ever present — UiDriver fades each in and out across
 * its window of journey t. Structurally they are all here, in sequence, so a
 * screen reader or a search engine gets the whole text regardless of where
 * the flight happens to be.
 */
export function Narrative() {
  return (
    <section className="narrative" aria-label="Narrative">
      {SCRIPT.map((beat, i) => (
        <div
          key={i}
          className={`beat beat--${beat.inScene ? "in-scene" : beat.place}`}
          ref={(el) => registerBeat(i, el)}
        >
          {beat.label && <p className="beat__label">{beat.label}</p>}
          <p className="beat__line">{beat.line}</p>
        </div>
      ))}
    </section>
  );
}
