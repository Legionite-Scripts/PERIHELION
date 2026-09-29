"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { journey } from "@/journey/store";
import { smoothstep } from "@/lib/math";
import { SCRIPT } from "@/journey/script";
import { MOVEMENTS, movementAt } from "@/journey/movements";
import { gravityInfluence } from "@/journey/gravity";
import { markReady, overlay } from "@/ui/overlay";
import { soundscape } from "@/audio/soundscape";

/**
 * Drives the DOM type layer from inside the render loop, so the site keeps
 * exactly one animation loop and the type can never drift out of phase with
 * the frame it sits on. Renders nothing.
 *
 * Writes only opacity and transform — compositor properties, no layout — and
 * only when `t` has actually changed.
 */

/** Frames to render before lifting the veil: the first includes the bakes. */
const READY_AFTER_FRAMES = 2;

/** The title block is gone by here. */
const OPENING_END = 0.035;

/**
 * Fade length at each end of a beat, in t — capped at 30% of the window so
 * a short beat still holds fully visible in its middle.
 */
const BEAT_FADE = 0.02;

/** Vertical drift across a beat's whole life, px: it rises in and rises out. */
const BEAT_DRIFT = 10;

/** The opening cue leaves as soon as the flight has visibly begun. */
const CUE_GONE = { from: 0.002, to: 0.012 };
/** ...and returns if someone lingers near the start this long, seconds. */
const CUE_LINGER = 8;
const CUE_LINGER_ZONE = 0.03;

/** The wordmark arrives as the title finishes leaving. */
const WORDMARK_IN = { from: 0.03, to: 0.05 };

/** "Begin again" appears with the last line, once it is fully there. */
const RESTART_IN = { from: 0.978, to: 0.992 };

/** The journey mark warms only where gravity is near its peak. */
const WARM_G = { from: 0.6, to: 0.95 };

/** Write a style only when its value actually changed. */
function set(el: HTMLElement, prop: "opacity" | "transform" | "visibility", value: string) {
  if (el.style[prop] !== value) el.style[prop] = value;
}

export function UiDriver() {
  const frames = useRef(0);
  const lastT = useRef(-1);
  const lastMoveAt = useRef(0);
  const lastMovement = useRef(-1);
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useFrame(() => {
    if (frames.current <= READY_AFTER_FRAMES) {
      frames.current++;
      if (frames.current === READY_AFTER_FRAMES) markReady();
    }

    const t = journey.t;
    const now = performance.now() / 1000;

    // Sound follows the journey from the same loop as everything else. A no-op
    // unless the visitor has turned it on; throttled inside when it is.
    soundscape.update(t);

    // The cue is the one element that also depends on time: it returns if the
    // visitor lingers at the start without scrolling.
    // "Moving" means visibly moving: the spring keeps nudging t by tiny
    // amounts long after it has come to rest.
    if (Math.abs(t - lastT.current) > 1e-5) lastMoveAt.current = now;
    const cue = overlay.cue;
    if (cue) {
      const gone = smoothstep(CUE_GONE.from, CUE_GONE.to, t);
      const linger =
        t < CUE_LINGER_ZONE ? smoothstep(CUE_LINGER, CUE_LINGER + 1.5, now - lastMoveAt.current) : 0;
      set(cue, "opacity", String(Math.max(1 - gone, linger).toFixed(3)));
    }

    if (t === lastT.current) return;
    lastT.current = t;

    // Wordmark: the name stays in the corner once the title has been left.
    if (overlay.wordmark) {
      set(overlay.wordmark, "opacity", String(smoothstep(WORDMARK_IN.from, WORDMARK_IN.to, t)));
    }

    // Journey indicator: the slider is the full track long, so translating it
    // by t of its own length puts its leading edge — the mark — at t. The CSS
    // picks the axis (vertical, or horizontal on portrait), so no layout reads.
    if (overlay.mark) overlay.mark.style.setProperty("--t", t.toFixed(4));
    if (overlay.markWarm) {
      set(overlay.markWarm, "opacity", String(smoothstep(WARM_G.from, WARM_G.to, gravityInfluence(t))));
    }
    const movement = movementAt(t);
    if (movement !== lastMovement.current) {
      lastMovement.current = movement;
      for (let i = 0; i < MOVEMENTS.length; i++) {
        const b = overlay.movements[i];
        if (!b) continue;
        if (i === movement) b.setAttribute("aria-current", "step");
        else b.removeAttribute("aria-current");
      }
    }

    // Begin again: present — and focusable — only with the last line.
    if (overlay.restart) {
      const k = smoothstep(RESTART_IN.from, RESTART_IN.to, t);
      set(overlay.restart, "opacity", String(k));
      set(overlay.restart, "visibility", k > 0.01 ? "visible" : "hidden");
    }

    const el = overlay.opening;
    if (el) {
      // Left behind: it fades and draws back a little as the flight begins.
      const k = smoothstep(0, OPENING_END, t);
      el.style.opacity = String(1 - k);
      el.style.transform = reducedMotion.current
        ? "none"
        : `scale(${1 - 0.04 * k}) translate3d(0, ${-6 * k}px, 0)`;
    }

    // Narrative: each beat is a pure function of t, so scrubbing backwards
    // plays it backwards. Windows never overlap, so at most one is visible.
    for (let i = 0; i < SCRIPT.length; i++) {
      const beat = SCRIPT[i];
      const node = overlay.beats[i];
      if (!node) continue;
      const fade = Math.min(BEAT_FADE, (beat.to - beat.from) * 0.3);
      const fadeIn = smoothstep(beat.from, beat.from + fade, t);
      const fadeOut = beat.holds ? 0 : smoothstep(beat.to - fade, beat.to, t);
      const opacity = fadeIn * (1 - fadeOut);
      node.style.opacity = String(opacity);
      node.style.transform =
        reducedMotion.current || opacity === 0
          ? "none"
          : `translate3d(0, ${(BEAT_DRIFT / 2) * (1 - fadeIn) - (BEAT_DRIFT / 2) * fadeOut}px, 0)`;
    }
  });

  return null;
}
