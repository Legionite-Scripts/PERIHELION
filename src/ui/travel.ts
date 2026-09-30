import { getLenis } from "@/lib/scroll/lenis";
import { resetZoom } from "@/journey/zoom";
import { snapJourney, useJourneyFlags } from "@/journey/store";

/**
 * Moving the visitor along the flight from the interface.
 *
 * Always through the scroll system — Lenis moves the page, the page drives
 * `journey.target`, the spring drives `t` — never by writing `t` directly, so
 * the film plays through on the way and the scrollbar position stays the truth.
 */

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Glide to journey position t. Longer trips take longer; never a jump cut. */
export function travelTo(t: number) {
  const lenis = getLenis();
  if (!lenis) return;
  // Hand control back to scroll in case a dev scrub left it held.
  useJourneyFlags.getState().setScrubbing(false);
  const target = t * lenis.limit;
  if (prefersReducedMotion()) {
    lenis.scrollTo(target, { immediate: true, force: true });
    return;
  }
  const distance = Math.abs(target - lenis.scroll) / Math.max(1, lenis.limit);
  lenis.scrollTo(target, { duration: 1.4 + 2.6 * distance, force: true });
}

/** Veil hold before and after the cut, ms. */
const RESTART_FADE_MS = 900;
const RESTART_SETTLE_MS = 450;

/**
 * Begin again: fade to black, cut to t = 0 behind the veil, fade back up on
 * the opening. The one hard cut in the site, and it happens in the dark.
 */
export function beginAgain(focusAfter?: HTMLElement | null) {
  const root = document.documentElement;
  const fade = prefersReducedMotion() ? 0 : RESTART_FADE_MS;
  root.dataset.restarting = "";
  window.setTimeout(() => {
    const lenis = getLenis();
    useJourneyFlags.getState().setScrubbing(false);
    lenis?.scrollTo(0, { immediate: true, force: true });
    snapJourney(0);
    resetZoom();
    window.setTimeout(() => {
      delete root.dataset.restarting;
      focusAfter?.focus({ preventScroll: true });
    }, fade ? RESTART_SETTLE_MS : 0);
  }, fade);
}
