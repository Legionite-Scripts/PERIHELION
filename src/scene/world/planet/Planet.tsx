"use client";

import { useMemo } from "react";
import { SphereGeometry } from "three";
import { useThree } from "@react-three/fiber";
import {
  ATMOSPHERE_RADIUS,
  PLANET_RADIUS,
  SPHERE_SEGMENTS,
} from "./constants";
import { getSurfaceMaps } from "./surfaceBake";
import { createPlanetMaterial } from "./planetMaterial";
import { createAtmosphereMaterial } from "./atmosphereMaterial";

/**
 * The planet.
 *
 * Note what is NOT here: it does not read `journey.t`, it does not rotate, it
 * does not scale, it has no animation of its own. It sits at the world origin
 * and does nothing, for the whole film.
 *
 * That is the point. Everything that happens to it — the approach, the growth,
 * the terminator sweeping open, the slingshot — is the camera moving and the
 * light staying where it is. A planet that animated itself would be a planet
 * that was performing for the shot, and it would stop being a place.
 *
 * It is tidally locked, so it does not spin. It is geologically dead, so
 * nothing on it changes. It is simply there, and we go past.
 */
export function Planet() {
  const gl = useThree((s) => s.gl);

  // One-time procedural bake, cached against the renderer. Replace this line
  // with loaded Higgsfield textures and nothing else in the planet changes.
  const maps = useMemo(() => getSurfaceMaps(gl), [gl]);

  const geometry = useMemo(
    () => new SphereGeometry(PLANET_RADIUS, SPHERE_SEGMENTS, SPHERE_SEGMENTS / 2),
    []
  );
  const atmosphereGeometry = useMemo(
    () => new SphereGeometry(ATMOSPHERE_RADIUS, 96, 48),
    []
  );

  const material = useMemo(() => createPlanetMaterial(maps), [maps]);
  const atmosphereMaterial = useMemo(() => createAtmosphereMaterial(), []);

  // No disposal effect on purpose. The planet is mounted for the life of the
  // page, and a StrictMode cleanup would dispose geometry and materials that
  // are still bound — the resources belong to the WebGL context, not to this
  // component's lifecycle.

  return (
    <group>
      {/* Opaque, writes depth — this is what occludes the starfield. */}
      <mesh geometry={geometry} material={material} renderOrder={0} />
      {/* Additive, depth-tested against the surface above it. */}
      <mesh
        geometry={atmosphereGeometry}
        material={atmosphereMaterial}
        renderOrder={1}
      />
    </group>
  );
}
