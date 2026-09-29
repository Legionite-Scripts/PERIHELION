/**
 * The DOM the scene is allowed to drive.
 *
 * The type layer is plain HTML over the canvas — real, selectable, readable by
 * search engines and screen readers. But it must move with `journey.t`, and the
 * site has exactly one animation loop (see scene/Driver.tsx). So instead of
 * each piece of type running its own requestAnimationFrame, the elements
 * register here and `UiDriver`, inside the R3F loop, writes their styles.
 *
 * A module singleton for the same reason as the Lenis instance: simpler and
 * safer than threading React context across the Canvas reconciler boundary.
 */

export const overlay = {
  /** Opening title block — fades and recedes over the first few percent. */
  opening: null as HTMLElement | null,
  /** Narrative beats, indexed as in journey/script.ts. */
  beats: [] as (HTMLElement | null)[],
  /** Journey indicator: the sliding position mark, and its warm twin. */
  mark: null as HTMLElement | null,
  markWarm: null as HTMLElement | null,
  /** Journey indicator: one button per movement, indexed as in movements.ts. */
  movements: [] as (HTMLElement | null)[],
  /** "Begin the approach" — the opening scroll cue. */
  cue: null as HTMLElement | null,
  /** Small persistent wordmark, once the title has gone. */
  wordmark: null as HTMLElement | null,
  /** "Begin again", with the last beat. */
  restart: null as HTMLElement | null,
};

type Single = "opening" | "mark" | "markWarm" | "cue" | "wordmark" | "restart";

export function registerOverlay(key: Single, el: HTMLElement | null) {
  overlay[key] = el;
}

export function registerBeat(index: number, el: HTMLElement | null) {
  overlay.beats[index] = el;
}

export function registerMovement(index: number, el: HTMLElement | null) {
  overlay.movements[index] = el;
}

/**
 * Lift the veil. Called once the first frames have rendered (UiDriver), or by
 * the fallback timer if WebGL never starts. Idempotent.
 */
export function markReady() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.ready = "";
}
