"use client";

import { useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { trajectory } from "@/journey/trajectory";
import { journey } from "@/journey/store";
import { damp, drift } from "@/lib/math";
import { aimFor, fovFor } from "./framing";

/**
 * The camera.
 *
 * Position is an exact function of `journey.t` — `t` is already spring-damped,
 * and damping it twice makes the whole flight feel mushy.
 *
 * The AIM, however, is damped separately. That decoupling is the entire
 * cinematic quality of the move: the camera arrives somewhere slightly before
 * it finishes turning to look at it, exactly like a real crane or a gimbal with
 * mass. It is the difference between a camera operator and a spline.
 *
 * On top of everything, a permanent sub-degree attitude drift. Vacuum has no
 * handheld shake, but a real spacecraft has attitude-control jitter, and the eye
 * needs that trace of life or a static frame looks like a screensaver.
 */

const AIM_LAG = 0.42; // seconds

/** Attitude jitter, radians. ~0.15° — below conscious notice, above dead. */
const DRIFT_ROT = 0.0026;
/** Positional drift, as a fraction of distance from the mass. */
const DRIFT_POS = 0.0016;

export function CameraRig() {
  const aim = useRef(new Vector3());
  const initialised = useRef(false);

  const pos = useRef(new Vector3());
  const targetAim = useRef(new Vector3());

  useFrame(({ camera, clock, size }, dt) => {
    const t = journey.t;
    const time = clock.elapsedTime;
    const aspect = size.width / Math.max(1, size.height);

    // Portrait screens get a wider lens and a narrower sideways aim offset
    // (see framing.ts). Landscape is exactly the original 38° and look target.
    const cam = camera as PerspectiveCamera;
    const fov = fovFor(aspect);
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    trajectory.position(t, pos.current);
    aimFor(t, aspect, targetAim.current);

    if (!initialised.current) {
      aim.current.copy(targetAim.current);
      initialised.current = true;
    }

    const step = Math.min(dt, 1 / 30);
    aim.current.set(
      damp(aim.current.x, targetAim.current.x, AIM_LAG, step),
      damp(aim.current.y, targetAim.current.y, AIM_LAG, step),
      damp(aim.current.z, targetAim.current.z, AIM_LAG, step)
    );

    // Drift scales with distance so it stays perceptually constant whether we
    // are 900 units out or 13.
    const scale = pos.current.length() * DRIFT_POS;
    camera.position.set(
      pos.current.x + drift(time * 0.071) * scale,
      pos.current.y + drift(time * 0.053 + 2.3) * scale,
      pos.current.z + drift(time * 0.089 + 5.1) * scale
    );

    camera.up.set(0, 1, 0);
    camera.lookAt(aim.current);

    camera.rotateZ(trajectory.roll(t));
    camera.rotateX(drift(time * 0.113 + 1.1) * DRIFT_ROT);
    camera.rotateY(drift(time * 0.097 + 3.7) * DRIFT_ROT);
  });

  return null;
}
