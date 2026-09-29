"use client";

/**
 * The vignette, as a DOM overlay: a static gradient, composited once and
 * effectively free. (Film grain used to live here too; it moved into the
 * frame — see scene/grade/FilmGrain.tsx for why.)
 */

export function Grade() {
  // The grain now lives in the frame itself (scene/grade/FilmGrain.tsx):
  // measured, the old blended DOM layer cost more than the nebula. The
  // vignette stays here — a static gradient, and effectively free.
  return <div className="vignette" aria-hidden />;
}
