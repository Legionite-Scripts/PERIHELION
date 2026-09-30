"use client";

import { useEffect, useState } from "react";
import { resetZoom, subscribeZoom, zoom, zoomBy, ZOOM_MAX, ZOOM_MIN } from "@/journey/zoom";

/**
 * The telescope control: a small vertical column on the right edge,
 * mirroring the journey indicator on the left. Plus, the level, minus.
 *
 * Also owns every other way in:
 *   · trackpad pinch and ctrl/⌘ + wheel (both arrive as a wheel event with
 *     ctrlKey set; Lenis ignores those, so the flight does not move);
 *   · two-finger pinch on touch screens;
 *   · + / − on the keyboard, and 0 to put the lens back.
 */

/** Each press of a button doubles or halves the magnification. */
const STEP = 2;

export function ZoomControl() {
  const [level, setLevel] = useState(zoom.target);

  useEffect(() => subscribeZoom(setLevel), []);

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // Stop the browser zooming the page instead.
      e.preventDefault();
      zoomBy(Math.exp(-e.deltaY * 0.01));
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "+" || e.key === "=") zoomBy(STEP);
      else if (e.key === "-" || e.key === "_") zoomBy(1 / STEP);
      else if (e.key === "0") resetZoom();
    };

    // Two-finger pinch. One finger still scrolls the flight.
    let pinch = 0;
    const spread = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = spread(e.touches);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      const d = spread(e.touches);
      zoomBy(d / pinch);
      pinch = d;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = 0;
    };
    // Safari's own pinch gesture would scale the whole page.
    const onGesture = (e: Event) => e.preventDefault();

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    window.addEventListener("gesturestart", onGesture);
    window.addEventListener("gesturechange", onGesture);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("gesturestart", onGesture);
      window.removeEventListener("gesturechange", onGesture);
    };
  }, []);

  const shown = level < 10 ? level.toFixed(1).replace(/\.0$/, "") : Math.round(level).toString();

  return (
    <div className="zoom-entrance">
      <div className="zoom" role="group" aria-label="Telescope">
        <button
          type="button"
          className="zoom__button"
          aria-label="Zoom in"
          disabled={level >= ZOOM_MAX}
          onClick={() => zoomBy(STEP)}
        >
          +
        </button>
        <button
          type="button"
          className="zoom__level"
          aria-label={level > ZOOM_MIN ? `Magnification ${shown} times. Reset zoom` : "Magnification 1 times"}
          onClick={resetZoom}
        >
          {shown}×
        </button>
        <button
          type="button"
          className="zoom__button"
          aria-label="Zoom out"
          disabled={level <= ZOOM_MIN}
          onClick={() => zoomBy(1 / STEP)}
        >
          −
        </button>
      </div>
    </div>
  );
}
