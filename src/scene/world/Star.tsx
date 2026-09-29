"use client";

import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Sphere,
  Vector3,
} from "three";
import { useFrame } from "@react-three/fiber";
import { SUN_COLOR, SUN_DIRECTION } from "@/scene/lighting";

/**
 * The star — the one light in the film, seen.
 *
 * Exactly where the lighting says it is: at infinity along SUN_DIRECTION, the
 * same vector that shades the planet, so the lit crescent always faces it.
 * It is not moved to be seen. For almost the whole flight it is out of shot
 * and costs nothing (frustum-culled); it comes into frame once, during the
 * ingress glance (rig/framing.ts), above the crescent it is lighting.
 *
 * Its size is physical: a cool K dwarf of ~0.7 solar radii, seen from a
 * habitable-zone orbit of ~0.4 AU, subtends about 0.93° — a disc some twenty
 * pixels across, not a glowing ball. Rendered as what a camera would record:
 * an overexposed, faintly limb-darkened core, a tight warm glare, and a very
 * wide, very faint scatter. No spikes, no flare, no rays.
 *
 * Depth-tested, so the planet occludes it like anything else in the sky.
 */

/** Angular radius of the stellar disc, radians (0.93° across). */
const STAR_RADIUS = (0.93 / 2) * (Math.PI / 180);
/** The billboard extends to this many disc radii, for the glare. */
const EXTENT = 9;
/** Distance of the billboard from the camera — inside the far plane, beyond everything else. */
const DISTANCE = 8200;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uExtent;
  varying vec2 vUv;

  void main() {
    // Distance from the centre in stellar radii.
    float r = length(vUv) * uExtent;
    float aa = fwidth(r) * 1.2;

    // Photosphere: overexposed, with just enough limb darkening that it reads
    // as a sphere at the edge. Warmer toward the limb.
    float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    float mu = sqrt(max(0.0, 1.0 - r * r));
    vec3 core = mix(uColor, vec3(1.0, 0.97, 0.92), mu) * (0.78 + 0.32 * mu);

    // Glare: what the lens does with that much light. Tight and warm, then a
    // very wide, very faint scatter. Nothing that reads as a shape.
    float glare = exp(-(r - 1.0) * 1.9) * 0.34 * step(1.0, r);
    float scatter = exp(-r * 0.42) * 0.07;
    float edge = 1.0 - smoothstep(0.75 * uExtent, uExtent, r);

    vec3 col = core * disc + uColor * (glare + scatter) * edge;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const _pos = new Vector3();

export function Star() {
  const mesh = useRef<Mesh>(null);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uColor: { value: SUN_COLOR.clone() },
          uExtent: { value: EXTENT },
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      }),
    []
  );

  const geometry = useMemo(() => {
    const size = 2 * DISTANCE * Math.tan(STAR_RADIUS * EXTENT);
    const g = new PlaneGeometry(size, size);
    g.boundingSphere = new Sphere(new Vector3(), size * 0.75);
    return g;
  }, []);

  // At infinity: carried with the camera, always facing it.
  useFrame(({ camera }) => {
    const m = mesh.current;
    if (!m) return;
    _pos.copy(SUN_DIRECTION).multiplyScalar(DISTANCE).add(camera.position);
    m.position.copy(_pos);
    m.quaternion.copy(camera.quaternion);
  });

  return <mesh ref={mesh} geometry={geometry} material={material} renderOrder={-2} />;
}
