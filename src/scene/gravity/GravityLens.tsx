"use client";

import { useFrame } from "@react-three/fiber";
import { journey } from "@/journey/store";
import { updateLens } from "./lens";

/**
 * Drives the shared lens uniforms. Renders nothing.
 *
 * Mounted after CameraRig so it aims from where the camera is this frame,
 * not where it was last frame — otherwise the field trails the planet by one
 * frame and the limb stars visibly swim during fast scrubs.
 */
export function GravityLens() {
  useFrame(({ camera }) => updateLens(camera, journey.t));
  return null;
}
