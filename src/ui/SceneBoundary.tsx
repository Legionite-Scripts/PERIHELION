"use client";

import { Component, type ReactNode } from "react";

/**
 * Contains a failure of the 3D scene — no WebGL, a lost context, a driver that
 * refuses a shader — to the scene alone.
 *
 * Without it the error unwinds the whole page and the visitor gets a white
 * error screen. With it they get the black ground, the title and the text:
 * a still, quiet version of the site rather than a broken one.
 */
export class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("Scene failed to start; continuing without it.", error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
