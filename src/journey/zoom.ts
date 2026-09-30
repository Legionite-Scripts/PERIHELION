import { Vector3 } from "three";
import { clamp } from "@/lib/math";

/**
 * The telescope. Separate from the journey: scrolling moves you along the
 * orbit, zoom only narrows the lens, so a visitor can hold a close-up while
 * the flight carries on underneath it.
 *
 * Like `journey`, a plain mutable singleton read every frame. The one thing
 * React cares about, the target level shown on the control, is published to
 * subscribers when a human changes it.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 24;

export interface Zoom {
  /** What the visitor asked for. */
  target: number;
  /** What the lens is at: eased toward target in log space. */
  level: number;
  /**
   * Where the telescope is pointed, on the planet's surface (world space). The
   * colony lives here; see scene/world/aliens.
   */
  focus: Vector3;
  /** False until a zoom picks a spot; cleared once the lens is back at 1×. */
  focused: boolean;
  /** Bumped every time the focus moves, so the colony knows to re-place. */
  epoch: number;
}

export const zoom: Zoom = {
  target: 1,
  level: 1,
  focus: new Vector3(),
  focused: false,
  epoch: 0,
};

type Listener = (target: number) => void;
const listeners = new Set<Listener>();

export function subscribeZoom(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setZoomTarget(z: number) {
  const next = clamp(z, ZOOM_MIN, ZOOM_MAX);
  if (next === zoom.target) return;
  zoom.target = next;
  listeners.forEach((fn) => fn(next));
}

export function zoomBy(factor: number) {
  setZoomTarget(zoom.target * factor);
}

export function resetZoom() {
  setZoomTarget(1);
}

/** Time constant of the lens, seconds. Quick, but it still feels like glass moving. */
const ZOOM_LAG = 0.28;

/** Ease level toward target. Called once per frame from the camera rig. */
export function advanceZoom(dt: number) {
  const step = Math.min(dt, 1 / 30);
  const a = Math.log(zoom.level);
  const b = Math.log(zoom.target);
  const k = 1 - Math.exp(-step / ZOOM_LAG);
  const next = Math.exp(a + (b - a) * k);
  zoom.level = Math.abs(next - zoom.target) < 1e-3 ? zoom.target : next;
}
