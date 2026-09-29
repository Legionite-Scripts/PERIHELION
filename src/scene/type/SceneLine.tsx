"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { journey } from "@/journey/store";
import { trajectory } from "@/journey/trajectory";
import { SCRIPT } from "@/journey/script";
import { smoothstep } from "@/lib/math";
import { PLANET_RADIUS } from "@/scene/world/planet/constants";
import { aimFor, fovFor } from "@/scene/rig/framing";

/**
 * The one line of narrative set inside the scene rather than over it.
 *
 * "We come in over the night side." is written into the sky just beside the
 * planet, and far behind it. It reads normally while the planet is small;
 * then, as we close in, the night side grows across the line and swallows its
 * first words — real occlusion, by the planet's own depth, not a mask.
 *
 * Deliberately modest in means: one plane, one canvas texture drawn in the
 * site's own Inter Tight, the same size and ink as every other line. No text
 * engine, no new dependency. One draw call, submitted only while the beat is
 * showing.
 *
 * Placement is solved from the camera's own framing at T_TOUCH: the line's
 * near edge sits exactly where the planet's limb will be then, so the eclipse
 * starts as the line has been read, and is well under way as it fades. On a
 * screen too narrow to hold the line beside the planet, it goes on the other
 * side and the limb takes its last words instead.
 *
 * Not lensed: across this beat gravity is under 2% of its peak, far below a
 * pixel of deflection.
 */

const BEAT_INDEX = SCRIPT.findIndex((b) => b.inScene);
const BEAT = SCRIPT[BEAT_INDEX];

/** The limb reaches the line's near edge, as seen from the camera, at this t. */
const T_TOUCH = 0.235;
/** How far behind the planet the line hangs, world units. */
const BEHIND = 900;
/** Same ink as the DOM narrative (--ink-line). */
const INK = 0.86;
/** Beat fade, matching UiDriver's DOM beats. */
const FADE = 0.02;
/** Canvas raster size of the text, px — supersampled well above screen size. */
const RASTER = 128;

function drawLine(text: string, family: string) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const font = `400 ${RASTER}px ${family}`;
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 8;
  const height = Math.ceil(RASTER * 1.35);
  canvas.width = width;
  canvas.height = height;
  ctx.font = font;
  ctx.fillStyle = "rgb(232, 234, 239)";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 4, height / 2);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return { texture, aspect: width / height };
}

export function SceneLine() {
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const mesh = useRef<Mesh>(null);
  const [line, setLine] = useState<ReturnType<typeof drawLine> | null>(null);

  // Draw once the webfont is really available, or the canvas silently falls
  // back to a system face.
  useEffect(() => {
    if (!BEAT) return;
    let cancelled = false;
    const family =
      getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim() ||
      "sans-serif";
    document.fonts
      .load(`400 ${RASTER}px ${family}`)
      .catch(() => undefined)
      .then(() => {
        if (cancelled) return;
        const drawn = drawLine(BEAT.line, family);
        drawn.texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
        setLine(drawn);
      });
    return () => {
      cancelled = true;
    };
  }, [gl]);

  const material = useMemo(
    () =>
      new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        // Depth-tested: this is what lets the planet eclipse it.
        depthTest: true,
        toneMapped: false,
      }),
    []
  );
  useEffect(() => {
    material.map = line?.texture ?? null;
    material.needsUpdate = true;
  }, [line, material]);

  // Where the line hangs, for this screen shape.
  const placement = useMemo(() => {
    if (!line) return null;
    const aspect = size.width / Math.max(1, size.height);
    const fov = fovFor(aspect);

    // The camera exactly as the rig would hold it at T_TOUCH (without drift).
    // A real camera, not a bare Object3D: lookAt aims a camera's −Z at the
    // target, but an ordinary object's +Z.
    const cam = new PerspectiveCamera(fov, aspect);
    cam.position.copy(trajectory.position(T_TOUCH, new Vector3()));
    cam.up.set(0, 1, 0);
    cam.lookAt(aimFor(T_TOUCH, aspect, new Vector3()));
    cam.rotateZ(trajectory.roll(T_TOUCH));
    cam.updateMatrixWorld();
    const R = new Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const U = new Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const F = new Vector3().setFromMatrixColumn(cam.matrixWorld, 2).negate();

    // Planet centre and limb, in angles from the view axis.
    const toPlanet = cam.position.clone().negate();
    const dPlanet = toPlanet.length();
    toPlanet.divideScalar(dPlanet);
    const ax = Math.atan2(toPlanet.dot(R), toPlanet.dot(F));
    const ay = Math.atan2(toPlanet.dot(U), toPlanet.dot(F));
    const limb = Math.asin(PLANET_RADIUS / dPlanet);

    // Size: the same on-screen size as the DOM narrative line.
    const lineEl = document.querySelector(".beat__line");
    const fontPx = lineEl ? parseFloat(getComputedStyle(lineEl).fontSize) : 20;
    const radPerPx = (fov * Math.PI) / 180 / size.height;
    const em = fontPx * radPerPx; // angular font size
    const heightAngle = em * 1.35;
    const widthAngle = heightAngle * line.aspect;

    // Beside the planet on its right; on its left if the frame cannot hold it.
    const halfH = Math.atan(Math.tan((fov * Math.PI) / 360) * aspect);
    const margin = 1.2 * em;
    let cx = ax + limb + widthAngle / 2;
    if (cx + widthAngle / 2 > halfH - margin) cx = ax - limb - widthAngle / 2;

    const dir = F.clone()
      .addScaledVector(R, Math.tan(cx))
      .addScaledVector(U, Math.tan(ay))
      .normalize();
    const distance = dPlanet + BEHIND;
    return {
      position: cam.position.clone().addScaledVector(dir, distance),
      quaternion: cam.quaternion.clone(),
      scale: [2 * distance * Math.tan(widthAngle / 2), 2 * distance * Math.tan(heightAngle / 2), 1] as const,
    };
  }, [line, size.width, size.height]);

  const geometry = useMemo(() => new PlaneGeometry(1, 1), []);

  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const t = journey.t;
    const fade = Math.min(FADE, (BEAT.to - BEAT.from) * 0.3);
    const opacity =
      smoothstep(BEAT.from, BEAT.from + fade, t) * (1 - smoothstep(BEAT.to - fade, BEAT.to, t));
    m.visible = opacity > 0 && !!placement;
    material.opacity = opacity * INK;
  });

  if (!BEAT || !placement) return null;
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      position={placement.position}
      quaternion={placement.quaternion}
      scale={placement.scale as unknown as [number, number, number]}
      renderOrder={-3}
      visible={false}
    />
  );
}
