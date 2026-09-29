/**
 * Development-only window handles.
 *
 * The scrub hook, the renderer and the camera are genuinely useful to have on
 * `window` while art-directing — you can park the flight on any frame from the
 * console, read draw calls, or project a world point to screen to check
 * framing. None of that should ship.
 *
 * `process.env.NODE_ENV` is substituted literally at build time, so guarding a
 * call site with it leaves the bundler `if (false) { ... }`, which it deletes
 * outright — handle names and all.
 *
 * Guard at the CALL SITE, not just in here. A no-op function still has its
 * arguments constructed, so `exposeDevHandles({ __perihelionGL: gl })` alone
 * leaves the object literal (and the name) in the production bundle even though
 * nothing is ever attached to `window`.
 */
export const DEV = process.env.NODE_ENV !== "production";

export function exposeDevHandles(handles: Record<string, unknown>) {
  if (!DEV || typeof window === "undefined") return;
  Object.assign(window, handles);
}

export function removeDevHandles(...names: string[]) {
  if (!DEV || typeof window === "undefined") return;
  for (const name of names) {
    delete (window as unknown as Record<string, unknown>)[name];
  }
}
