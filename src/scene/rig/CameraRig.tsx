"use client";

import { useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { useFrame } from "@react-three/fiber";
import { trajectory } from "@/journey/trajectory";
import { journey } from "@/journey/store";
import { damp, drift, smoothstep } from "@/lib/math";
import { advanceZoom, zoom } from "@/journey/zoom";
import { PLANET_RADIUS } from "@/scene/world/planet/constants";
import { SUN_DIRECTION } from "@/scene/lighting";
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
 *
 * ZOOM (journey/zoom.ts) narrows the lens and, as it does, swings the aim onto
 * a spot on the planet's surface (see pickFocus), so that zooming in always
 * ends on the world rather than on empty sky.
 */

const AIM_LAG = 0.42; // seconds

/** Attitude jitter, radians. ~0.15° — below conscious notice, above dead. */
const DRIFT_ROT = 0.0026;
/** Positional drift, as a fraction of distance from the mass. */
const DRIFT_POS = 0.0016;

const _look = new Vector3();
const _toCam = new Vector3();
const _n = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _v = new Vector3();
const _c = new Vector3();
const _up = new Vector3();

/** How steeply we want to look down on the colony: cos of the angle from vertical. */
const IDEAL_VIEW = 0.3; // ~17° above their horizon — a low, standing view

/**
 * The surface point to zoom onto, written as a unit normal into `out`.
 *
 * Not simply the centre of view. Straight down from orbit, anyone standing on
 * the ground is the top of a head; and on the night side they are not lit at
 * all. So the telescope searches the visible face for a spot seen at a low
 * angle, in sunlight if there is any, as near as it can to where we were
 * already looking.
 */
function pickFocus(camPos: Vector3, aim: Vector3, out: Vector3) {
  _look.subVectors(aim, camPos).normalize();
  const d = camPos.length();
  const axis = _toCam.copy(camPos).divideScalar(d);
  // Any perpendicular pair around the sub-camera axis.
  _a.set(0, 1, 0).cross(axis);
  if (_a.lengthSq() < 1e-6) _a.set(1, 0, 0).cross(axis);
  _a.normalize();
  _b.crossVectors(axis, _a);

  const cap = Math.acos(Math.min(1, PLANET_RADIUS / d)); // visible cap half-angle
  let best = -Infinity;
  for (let i = 1; i <= 24; i++) {
    const theta = (cap * i) / 24.5;
    for (let j = 0; j < 48; j++) {
      const phi = (j / 48) * Math.PI * 2;
      _c.copy(axis)
        .multiplyScalar(Math.cos(theta))
        .addScaledVector(_a, Math.sin(theta) * Math.cos(phi))
        .addScaledVector(_b, Math.sin(theta) * Math.sin(phi));
      // Direction from that ground point up to us, and how steeply we see it.
      _v.copy(camPos).addScaledVector(_c, -PLANET_RADIUS);
      const range = _v.length();
      _v.divideScalar(range);
      const view = _c.dot(_v);
      if (view < 0.08) continue;
      const sun = _c.dot(SUN_DIRECTION);
      const offAxis = Math.acos(Math.min(1, Math.max(-1, -_v.dot(_look))));
      const score =
        -Math.abs(view - IDEAL_VIEW) * 3 +
        1.6 * Math.min(Math.max(sun, -0.25), 0.4) -
        1.1 * offAxis;
      if (score > best) {
        best = score;
        out.copy(_c);
      }
    }
  }
  if (best === -Infinity) out.copy(axis);
}

/** Is the spot with normal n still seen from a usable angle? */
function facing(n: Vector3, camPos: Vector3) {
  _v.copy(camPos).addScaledVector(n, -PLANET_RADIUS).normalize();
  const view = n.dot(_v);
  return view > 0.06 && view < 0.85;
}

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
    advanceZoom(dt);
    const z = zoom.level;
    // Narrowing the lens by z divides the tangent of the half-angle by z.
    const base = fovFor(aspect);
    const fov =
      z === 1
        ? base
        : ((2 * Math.atan(Math.tan((base * Math.PI) / 360) / z)) * 180) / Math.PI;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    trajectory.position(t, pos.current);
    aimFor(t, aspect, targetAim.current);

    // Zoom: pick a spot on the surface when the lens starts to close, keep it
    // while it stays in view, and let it go once the lens is back at 1×.
    // Through a long lens, level the horizon: the local ground becomes "down",
    // as if standing there, rather than keeping the flight's bank.
    let level = 0;
    if (zoom.target > 1.001 || z > 1.001) {
      if (!zoom.focused || !facing(_n.copy(zoom.focus).normalize(), pos.current)) {
        pickFocus(pos.current, initialised.current ? aim.current : targetAim.current, _n);
        zoom.focus.copy(_n).multiplyScalar(PLANET_RADIUS);
        zoom.focused = true;
        zoom.epoch++;
      }
      // Swing the aim onto it over the first ~2.5× of zoom.
      const w = smoothstep(0, Math.log(2.5), Math.log(z));
      targetAim.current.lerp(zoom.focus, w);
      level = smoothstep(Math.log(3), Math.log(8), Math.log(z));
    } else if (zoom.focused) {
      zoom.focused = false;
    }

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
    if (level > 0) camera.up.lerp(_up.copy(zoom.focus).normalize(), level).normalize();
    camera.lookAt(aim.current);

    camera.rotateZ(trajectory.roll(t) * (1 - level));
    // Jitter is an angle, and a long lens magnifies angles: calm it as we zoom.
    const jitter = DRIFT_ROT / Math.sqrt(z);
    camera.rotateX(drift(time * 0.113 + 1.1) * jitter);
    camera.rotateY(drift(time * 0.097 + 3.7) * jitter);
  });

  return null;
}
