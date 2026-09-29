"use client";

import { useEffect, useRef, useState } from "react";
import {
  journey,
  setJourneyTarget,
  snapJourney,
  useJourneyFlags,
} from "@/journey/store";
import { trajectory } from "@/journey/trajectory";
import { gravity, gravityInfluence } from "@/journey/gravity";
import { cloud, cloudPresence } from "@/journey/environment";
import { getLenis } from "@/lib/scroll/lenis";
import { clamp } from "@/lib/math";

/**
 * Developer scrub. Not part of the site — a cutting-room tool.
 *
 * `D` toggles it, `space` autoplays the whole flight, arrow keys step frame by
 * frame, `G` toggles gravitational bending and `C` the molecular cloud, for
 * A/B. Reads `journey.t` on its own slow rAF so inspecting the number never
 * costs the render loop a re-render.
 */

/** Movement boundaries from the treatment, for orientation while scrubbing. */
const MOVEMENTS = [
  { at: 0.0, label: "I" },
  { at: 0.12, label: "II" },
  { at: 0.42, label: "III" },
  { at: 0.62, label: "IV" },
  { at: 0.8, label: "V" },
];

export function ScrubPanel() {
  const panel = useJourneyFlags((s) => s.panel);
  const autoplay = useJourneyFlags((s) => s.autoplay);
  const togglePanel = useJourneyFlags((s) => s.togglePanel);
  const toggleAutoplay = useJourneyFlags((s) => s.toggleAutoplay);
  const setScrubbing = useJourneyFlags((s) => s.setScrubbing);

  const [t, setT] = useState(0);
  const [fps, setFps] = useState(0);
  const slider = useRef<HTMLInputElement>(null);

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The slider is the only input on the page and it owns the arrow keys,
      // so those defer to it while it has focus. Everything else stays live:
      // the old guard swallowed every shortcut the moment you touched the
      // handle, which killed the space bar for the rest of the session.
      const inSlider = e.target instanceof HTMLInputElement;
      if (inSlider && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
      if (e.key === "d" || e.key === "D") togglePanel();
      if (e.key === "g" || e.key === "G") gravity.enabled = !gravity.enabled;
      if (e.key === "c" || e.key === "C") cloud.enabled = !cloud.enabled;
      if (e.code === "Space") {
        e.preventDefault();
        toggleAutoplay();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const d = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 0.02 : 0.004);
        snapJourney(clamp(journey.target + d));
        syncScroll(journey.target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePanel, toggleAutoplay]);

  // Slow read-out loop + fps.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let frames = 0;
    let uiLast = 0;

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      acc += dt;
      frames++;

      if (now - uiLast > 120) {
        uiLast = now;
        setT(journey.t);
        if (frames > 0) setFps(Math.round(1000 / (acc / frames)));
        acc = 0;
        frames = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Keep the slider handle following scroll and autoplay.
  useEffect(() => {
    if (slider.current && document.activeElement !== slider.current) {
      slider.current.value = String(t);
    }
  }, [t]);

  if (!panel) {
    return (
      <div className="dev dev--hint" aria-hidden>
        D
      </div>
    );
  }

  const r = trajectory.radius(t);

  return (
    <div className="dev">
      <div className="dev__row">
        <span className="dev__key">t</span>
        <span className="dev__val">{t.toFixed(4)}</span>
        <span className="dev__key">r</span>
        <span className="dev__val">{r.toFixed(1)}</span>
        <span className="dev__key">g</span>
        <span className="dev__val">
          {gravity.enabled ? gravityInfluence(t).toFixed(2) : "off"}
        </span>
        <span className="dev__key">c</span>
        <span className="dev__val">
          {cloud.enabled ? cloudPresence(t).toFixed(2) : "off"}
        </span>
        <span className="dev__key">fps</span>
        <span className="dev__val">{fps || "—"}</span>
        <button
          className={`dev__btn${autoplay ? " is-on" : ""}`}
          onClick={() => toggleAutoplay()}
        >
          {autoplay ? "pause" : "play"}
        </button>
      </div>

      <input
        ref={slider}
        className="dev__slider"
        type="range"
        min={0}
        max={1}
        step={0.0002}
        defaultValue={0}
        onPointerDown={() => setScrubbing(true)}
        onPointerUp={() => {
          setScrubbing(false);
          syncScroll(journey.target);
        }}
        onChange={(e) => {
          setScrubbing(true);
          setJourneyTarget(parseFloat(e.target.value));
        }}
      />

      <div className="dev__ticks">
        {MOVEMENTS.map((m) => (
          <span key={m.label} style={{ left: `${m.at * 100}%` }}>
            {m.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Put the real scrollbar where the scrub handle left it, so scroll resumes seamlessly. */
function syncScroll(progress: number) {
  const lenis = getLenis();
  if (!lenis || lenis.limit <= 0) return;
  lenis.scrollTo(progress * lenis.limit, { immediate: true, force: true });
}
