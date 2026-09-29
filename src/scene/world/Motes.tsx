"use client";

import { useMemo } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  ShaderMaterial,
  Sphere,
  Vector3,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { mulberry32 } from "@/lib/math";

/**
 * Near-field dust.
 *
 * This is not decoration, and it is the one element in Stage 1 that might look
 * like an "effect" but isn't: a distant starfield barely shifts when the camera
 * translates, so without a near-field reference, flying 900 units through space
 * looks almost identical to standing still. These few hundred faint specks are
 * the entire parallax budget — they are what makes the camera read as *moving*
 * rather than the sky as *rotating*.
 *
 * Kept deliberately sparse and dim. Three hundred, not thirty thousand.
 */

const COUNT = 340;
/** Side of the repeating cell the motes are tiled in, world units. */
const CELL = 200.0;

function buildGeometry() {
  const rand = mulberry32(0xc0ffee);
  const positions = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);

  for (let i = 0; i < COUNT; i++) {
    positions[i * 3] = rand() * CELL;
    positions[i * 3 + 1] = rand() * CELL;
    positions[i * 3 + 2] = rand() * CELL;
    seeds[i] = rand();
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));
  geo.boundingSphere = new Sphere(new Vector3(), CELL * 4);
  return geo;
}

const VERT = /* glsl */ `
  attribute float aSeed;

  uniform vec3  uCam;
  uniform float uCell;
  uniform float uPixelRatio;

  varying float vAlpha;

  void main() {
    // Tile the cell infinitely around the camera so there is always dust
    // nearby, without ever allocating more than a few hundred points.
    vec3 half3 = vec3(uCell * 0.5);
    vec3 rel = mod(position - uCam + half3, uCell) - half3;
    vec3 world = uCam + rel;

    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    float dist = length(rel);

    // Fade at the cell boundary so nothing ever pops into existence, and fade
    // again very close to the lens so nothing smears across the frame.
    float far  = smoothstep(uCell * 0.5, uCell * 0.31, dist);
    float near = smoothstep(1.5, 9.0, dist);

    float size = mix(1.0, 2.6, aSeed);
    gl_PointSize = clamp(size * uPixelRatio * (34.0 / max(1.0, -mv.z) + 0.55), 0.7, 4.0);

    vAlpha = far * near * (0.35 + 0.65 * aSeed);
  }
`;

const FRAG = /* glsl */ `
  uniform float uIntensity;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = exp(-d * d * 3.4) * vAlpha * uIntensity;
    gl_FragColor = vec4(vec3(0.72, 0.75, 0.82) * a, 1.0);
  }
`;

export function Motes({ intensity = 1.0 }: { intensity?: number }) {
  const dpr = useThree((s) => s.viewport.dpr);
  const geometry = useMemo(buildGeometry, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uCam: { value: new Vector3() },
          uCell: { value: CELL },
          uPixelRatio: { value: 1 },
          uIntensity: { value: 0.16 * intensity },
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        // Depth-tested, and drawn after the planet: dust in front of the world
        // stays visible, dust behind it is correctly hidden. Without this the
        // motes drift through the planet and the illusion of a solid body dies.
        depthTest: true,
      }),
    [intensity]
  );

  useFrame(({ camera }) => {
    material.uniforms.uCam.value.copy(camera.position);
    material.uniforms.uPixelRatio.value = dpr;
  });

  return (
    <points
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}
