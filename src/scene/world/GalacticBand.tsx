"use client";

import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  RepeatWrapping,
  ClampToEdgeWrapping,
  Scene,
  ShaderMaterial,
  Texture,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { NOISE_GLSL } from "@/scene/shaders/noise";
import { LENS_GLSL, lensUniforms } from "@/scene/gravity/lens";

/**
 * The unresolved galaxy: a faint milky band with dust lanes cutting through it.
 *
 * This is the only "atmosphere" in Stage 1 and it is deliberately near the
 * threshold of visibility — peak brightness around 4% of white. Its job is not
 * to be looked at. Its job is to stop the black from reading as an empty
 * framebuffer, and to give the frame a large-scale tonal gradient so
 * composition is possible at all. Turn it off and the sky immediately looks
 * cheap; turn it up 3× and it becomes a nebula, which is Stage 7's problem.
 *
 * Rendered on a camera-locked inverted sphere: it is background at infinity and
 * must never parallax.
 *
 * BAKED. The band is a fixed pattern on the sky — a function of direction
 * alone — yet it used to evaluate several octaves of noise for every pixel of
 * every frame. Measured in final QA it was the single largest cost in the
 * scene (~9–11 ms of a frame on the target HD 620). So the same formula now
 * runs once, into a map in galactic coordinates (longitude × latitude), and
 * each frame just looks it up. Lensing is still applied live, before the
 * lookup; the dither is still per pixel. No mipmaps: the band is smooth and
 * magnified on screen, and without them the longitude wrap cannot seam.
 */

const RADIUS = 4600;

/** Galactic plane orientation — must match Starfield's band. */
const BAND_TILT = 0.42;
const BAND_YAW = 0.9;

/** Resolution of the baked band: 0.18° per texel, several screen pixels. */
const MAP_W = 2048;
const MAP_H = 1024;

/** The band's brightness at a direction — the original formula, unchanged. */
const AMOUNT_GLSL = /* glsl */ `
  float bandAmount(vec3 d) {
    // Angular distance from the galactic plane, and position along it.
    float beta = asin(clamp(dot(d, uNormal), -1.0, 1.0));
    // Sample noise on the unit circle rather than on the raw angle, so there is
    // no seam where phi wraps.
    vec2 ring = vec2(dot(d, uU), dot(d, uV));
    ring = normalize(ring + 1e-6);

    // Band width breathes along its length.
    float w = 0.105 + 0.05 * fbm(ring * 2.2);

    float core = exp(-pow(beta / w, 2.0));
    float halo = exp(-pow(beta / (w * 3.2), 2.0)) * 0.30;

    // Foreground dust lane — slightly offset from the spine, and the single
    // detail that makes this read as a galaxy rather than a blurred stripe.
    float laneOffset = (fbm(ring * 3.1 + 11.0) - 0.5) * 0.07;
    float lane = exp(-pow((beta - laneOffset) / (w * 0.42), 2.0)) * 0.62;

    float amount = (core + halo) * (1.0 - lane);

    // Large-scale clumping so brightness is never even along the band.
    amount *= 0.42 + 0.78 * fbm(ring * 4.3 + vec2(beta * 5.0));

    // A whisper of all-sky glow. Kept very low: lift this and every black in
    // the frame goes grey, which is the fastest way to lose the vacuum.
    amount += 0.012 * (0.6 + 0.4 * fbm(ring * 1.1 + vec2(beta * 1.5)));
    return amount;
  }
`;

const BAKE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BAKE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uNormal;
  uniform vec3 uU;
  uniform vec3 uV;
  varying vec2 vUv;
  ${NOISE_GLSL}
  ${AMOUNT_GLSL}
  void main() {
    const float PI = 3.141592653589793;
    float phi = (vUv.x - 0.5) * 2.0 * PI;
    float beta = (vUv.y - 0.5) * PI;
    vec3 d = cos(beta) * (cos(phi) * uU + sin(phi) * uV) + sin(beta) * uNormal;
    gl_FragColor = vec4(bandAmount(d), 0.0, 0.0, 1.0);
  }
`;

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uNormal;   // normal of the galactic plane
  uniform vec3 uU;        // in-plane basis
  uniform vec3 uV;
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform sampler2D uBand;

  varying vec3 vDir;

  ${NOISE_GLSL}
  ${LENS_GLSL}

  void main() {
    const float PI = 3.141592653589793;
    // Look up the sky where this ray actually came from before the mass bent
    // it. The sphere is camera-locked and unrotated, so vDir is world-space.
    vec3 d = lensSource(normalize(vDir));

    // Galactic longitude and latitude — the baked map's coordinates.
    float beta = asin(clamp(dot(d, uNormal), -1.0, 1.0));
    float phi = atan(dot(d, uV), dot(d, uU));
    vec2 uv = vec2(phi / (2.0 * PI) + 0.5, beta / PI + 0.5);
    float amount = texture2D(uBand, uv).r;

    // Ordered dither. The band is a very smooth, very dark gradient, which is
    // exactly the case 8-bit output quantises into visible steps. A fraction of
    // a code value of noise costs nothing and removes them entirely.
    float dither = (hash21(gl_FragCoord.xy) - 0.5) / 255.0;

    gl_FragColor = vec4(uColor * amount * uIntensity + dither, 1.0);
  }
`;

/** The galactic basis, matching the starfield's rotation. */
function galacticBasis() {
  const cosT = Math.cos(BAND_TILT);
  const sinT = Math.sin(BAND_TILT);
  const cosY = Math.cos(BAND_YAW);
  const sinY = Math.sin(BAND_YAW);
  const rotate = (x: number, y: number, z: number) => {
    const y1 = y * cosT - z * sinT;
    const z1 = y * sinT + z * cosT;
    return new Vector3(x * cosY + z1 * sinY, y1, -x * sinY + z1 * cosY);
  };
  return {
    normal: rotate(0, 1, 0).normalize(),
    u: rotate(1, 0, 0).normalize(),
    v: rotate(0, 0, 1).normalize(),
  };
}

function bakeBand(renderer: WebGLRenderer): Texture {
  const target = new WebGLRenderTarget(MAP_W, MAP_H, {
    format: RedFormat,
    type: HalfFloatType,
    generateMipmaps: false,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    colorSpace: NoColorSpace,
    depthBuffer: false,
  });
  target.texture.wrapS = RepeatWrapping; // longitude wraps
  target.texture.wrapT = ClampToEdgeWrapping;
  const basis = galacticBasis();
  const material = new ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    uniforms: { uNormal: { value: basis.normal }, uU: { value: basis.u }, uV: { value: basis.v } },
    depthTest: false,
    depthWrite: false,
  });
  const scene = new Scene();
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(previous);
  quad.geometry.dispose();
  material.dispose();
  return target.texture;
}

/** Per-renderer cache — the map lives as long as the WebGL context. */
const cache = new WeakMap<WebGLRenderer, Texture>();
function getBand(renderer: WebGLRenderer) {
  let t = cache.get(renderer);
  if (!t) {
    t = bakeBand(renderer);
    cache.set(renderer, t);
  }
  return t;
}

export function GalacticBand({ intensity = 1.0 }: { intensity?: number }) {
  const ref = useRef<Mesh>(null);
  const gl = useThree((s) => s.gl);
  const band = useMemo(() => getBand(gl), [gl]);

  const material = useMemo(() => {
    const basis = galacticBasis();
    return new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uNormal: { value: basis.normal },
        uU: { value: basis.u },
        uV: { value: basis.v },
        uBand: { value: band },
        // Neutral, a touch cool. Never blue — an actually blue galaxy is the
        // fastest way to look like stock sci-fi.
        uColor: { value: new Vector3(0.6, 0.63, 0.7) },
        uIntensity: { value: 0.16 * intensity },
        ...lensUniforms,
      },
      side: 1, // BackSide
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      // See Starfield: transparent draws last, so the planet can only occlude
      // the sky through the depth buffer.
      depthTest: true,
    });
  }, [intensity, band]);

  // Locked to the camera's position: background at infinity, no parallax.
  useFrame(({ camera }) => {
    ref.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={ref} material={material} frustumCulled={false} renderOrder={-20}>
      <sphereGeometry args={[RADIUS, 64, 48]} />
    </mesh>
  );
}
