"use client";

import { useMemo, useRef } from "react";
import { BufferGeometry, CustomBlending, Float32BufferAttribute, OneFactor, OneMinusSrcColorFactor, ShaderMaterial, Sphere, Vector2, Vector3 } from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { NOISE_GLSL } from "@/scene/shaders/noise";

/**
 * Film grain, drawn into the frame itself.
 *
 * It used to be a DOM layer: an oversized, screen-blended div translated 14
 * times a second. Measured under real scrolling on the target laptop (HD 620,
 * a 1.9×-scaled panel) that layer alone cost more than the whole nebula — a
 * blend mode forces the compositor to re-render the page as an isolated group
 * and blend it over the full canvas every frame, before the desktop upscales
 * it. Here it is one full-screen triangle at the end of the pass the scene is
 * already drawing: no extra pass, no render target.
 *
 * Same look by construction. GL blending ONE, ONE_MINUS_SRC_COLOR *is* the
 * CSS `screen` operator; at 4% strength it lifts the shadows by the same
 * hair. Same grain size (1.5 CSS px per cell, as the old 128 → 192 px tile),
 * the same 14 Hz stepping, and held still at 2.8% under reduced motion.
 */

const GRAIN_FPS = 14;
const STRENGTH = 0.04;
const STRENGTH_CALM = 0.028;

const VERT = /* glsl */ `
  void main() {
    // A single triangle covering the viewport, in clip space.
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec2  uOffset;
  uniform float uCell;
  uniform float uStrength;
  ${NOISE_GLSL}
  void main() {
    float n = vnoise(gl_FragCoord.xy / uCell + uOffset);
    gl_FragColor = vec4(vec3(n * uStrength), 1.0);
  }
`;

export function FilmGrain() {
  const dpr = useThree((s) => s.viewport.dpr);
  const lastStep = useRef(-1);
  const calm = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.boundingSphere = new Sphere(new Vector3(), 1e6);
    return g;
  }, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uOffset: { value: new Vector2(17.3, 41.9) },
          uCell: { value: 1.5 },
          uStrength: { value: calm ? STRENGTH_CALM : STRENGTH },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        // The CSS `screen` operator: src + dst · (1 − src).
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcColorFactor,
      }),
    [calm]
  );

  useFrame(({ clock }) => {
    material.uniforms.uCell.value = 1.5 * dpr;
    if (calm) return;
    const step = Math.floor(clock.elapsedTime * GRAIN_FPS);
    if (step !== lastStep.current) {
      lastStep.current = step;
      material.uniforms.uOffset.value.set(Math.random() * 512, Math.random() * 512);
    }
  });

  // Last in the frame, over everything the scene drew.
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={1000} />;
}
