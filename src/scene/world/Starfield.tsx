"use client";

import { useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Sphere,
  Vector3,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { clamp, kelvinToRGB, mulberry32 } from "@/lib/math";
import { LENS_GLSL, lensUniforms } from "@/scene/gravity/lens";

/**
 * Procedural deep-space starfield.
 *
 * Four decisions do all the work here, and they are the difference between a
 * sky and a scatter of dots:
 *
 *  1. MAGNITUDE FOLLOWS A POWER LAW. Real skies are almost entirely faint
 *     stars with a handful of bright ones. A uniform distribution reads as
 *     noise; `pow(rand, 4)` reads as sky.
 *
 *  2. THERE IS A GALACTIC PLANE. Uniform-random-on-a-sphere is the single
 *     biggest tell of a generated starfield. Most stars are clustered into a
 *     band, tilted so it cuts the frame diagonally.
 *
 *  3. COLOUR IS BLACKBODY. Stars are physically coloured by temperature —
 *     blue-white, gold, orange — and the bright ones show it most strongly.
 *     Faint stars keep a lighter tint.
 *
 *  4. NOTHING TWINKLES. Twinkling is atmospheric scintillation. There is no
 *     atmosphere out here. Resisting it is both correct and restrained.
 */

const COUNT = 11000;
const R_INNER = 2400;
const R_OUTER = 4000;

/** Fraction of stars belonging to the galactic band rather than the field. */
const BAND_FRACTION = 0.56;

/** Orientation of the galactic plane — tilted so the band runs corner to corner. */
const BAND_TILT = 0.42;
const BAND_YAW = 0.9;

function buildGeometry() {
  const rand = mulberry32(0x5eed1a);

  const positions = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);
  const mags = new Float32Array(COUNT);

  const cosT = Math.cos(BAND_TILT);
  const sinT = Math.sin(BAND_TILT);
  const cosY = Math.cos(BAND_YAW);
  const sinY = Math.sin(BAND_YAW);

  for (let i = 0; i < COUNT; i++) {
    let x: number, y: number, z: number;

    if (rand() < BAND_FRACTION) {
      // Clustered toward a great circle: narrow core plus a wider halo, so the
      // band has a dense spine that frays out rather than a hard edge.
      const phi = rand() * Math.PI * 2;
      const sigma = rand() < 0.55 ? 0.09 : 0.3;
      // Box–Muller for a true gaussian latitude.
      const g =
        Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(Math.PI * 2 * rand());
      const beta = clamp(g * sigma, -1.4, 1.4);
      const cb = Math.cos(beta);
      x = cb * Math.cos(phi);
      y = Math.sin(beta);
      z = cb * Math.sin(phi);
    } else {
      // Uniform on the sphere (equal-area in z, not in latitude).
      const u = 1 - 2 * rand();
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      const phi = rand() * Math.PI * 2;
      x = s * Math.cos(phi);
      y = u;
      z = s * Math.sin(phi);
    }

    // Rotate the galactic frame into world space: tilt about X, then yaw.
    const y1 = y * cosT - z * sinT;
    const z1 = y * sinT + z * cosT;
    const x2 = x * cosY + z1 * sinY;
    const z2 = -x * sinY + z1 * cosY;

    const r = R_INNER + rand() * (R_OUTER - R_INNER);
    positions[i * 3] = x2 * r;
    positions[i * 3 + 1] = y1 * r;
    positions[i * 3 + 2] = z2 * r;

    // Brightness: steep power law — many faint, few bright — plus a small
    // population of genuine anchors. A real sky has a dozen stars you could
    // name and thousands you could not; without that top end the field reads
    // as evenly-speckled texture rather than as depth.
    const u = rand();
    const m = u > 0.994 ? 0.86 + rand() * 0.14 : Math.pow(u, 3.1);
    mags[i] = m;

    // Temperature: more cool stars than hot, but enough hot blues that the
    // field reads as two-coloured, gold against blue-white.
    const kelvin = 2700 + Math.pow(rand(), 1.4) * 9300;
    const [cr, cg, cb2] = kelvinToRGB(kelvin);
    // Every star carries its temperature; the bright ones carry it fully.
    const sat = 0.6 + m * 0.55;
    colors[i * 3] = 0.94 + (cr - 0.94) * sat;
    colors[i * 3 + 1] = 0.96 + (cg - 0.96) * sat;
    colors[i * 3 + 2] = 1.0 + (cb2 - 1.0) * sat;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("aColor", new Float32BufferAttribute(colors, 3));
  geo.setAttribute("aMag", new Float32BufferAttribute(mags, 1));
  geo.boundingSphere = new Sphere(new Vector3(), R_OUTER * 1.2);
  return geo;
}

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aMag;

  uniform float uPixelRatio;
  uniform float uScale;

  varying vec3 vColor;
  varying float vMag;
  varying float vSize;
  varying float vMagnify;

  ${LENS_GLSL}

  void main() {
    // Gravitational lensing: move the star to where the mass makes it appear,
    // keeping its distance, so depth — and the planet's occlusion — still hold.
    vec3 world = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 ray = world - cameraPosition;
    float dist = length(ray);
    vec3 dir = ray / dist;
    vec3 image = lensImage(dir);
    world = cameraPosition + image * dist;

    // ...and brighten it. A lens does not only move a point source, it
    // amplifies it: μ = (θ/β)·(dθ/dβ), and for this field dβ/dθ is exactly the
    // Newton derivative lensImage already uses. Near the limb at closest
    // approach μ ≈ 2.4, so the stars hugging the planet glint as the camera
    // swings through periapsis. Capped at 3 so none blows out. (The band is
    // left alone: lensing conserves surface brightness.)
    vMagnify = 1.0;
    if (uLensThetaE > 0.0) {
      float beta = acos(clamp(dot(dir, uLensDir), -1.0, 1.0));
      float theta = acos(clamp(dot(image, uLensDir), -1.0, 1.0));
      float a = lensAlpha(theta);
      float slope = 1.0 + a * (1.0 / max(theta, 1e-4) + 2.0 * theta / (uLensTaper * uLensTaper));
      vMagnify = clamp(theta / max(beta, 1e-4) / slope, 1.0, 3.0);
    }

    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    // Bright stars are physically larger on screen because their airy disc and
    // bloom spread further, not because they are nearer.
    float size = mix(1.0, 4.4, pow(aMag, 0.75));

    // Mild perspective attenuation. Kept mild on purpose: real stars are at
    // effectively infinite distance and must not visibly swell as we fly.
    float atten = 2600.0 / max(1.0, -mv.z);
    gl_PointSize = clamp(size * uScale * atten * uPixelRatio, 1.4, 11.0);
    vSize = gl_PointSize;

    vColor = aColor;
    vMag = aMag;
  }
`;

const FRAG = /* glsl */ `
  uniform float uIntensity;

  varying vec3 vColor;
  varying float vMag;
  varying float vSize;
  varying float vMagnify;

  void main() {
    // Two lobes: a tight core plus a very faint halo. The halo is what stops
    // the field looking like aliased pixels, and does the job of bloom without
    // a post-processing pass.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;

    float core = exp(-d * d * 8.0);
    // The halo widens with magnitude: bright stars scatter further in any real
    // optic. This is doing the job of a bloom pass, for free.
    float halo = exp(-d * d * 1.8) * mix(0.10, 0.30, vMag);
    float a = core + halo;

    // Energy conservation: a sprite's light integrates over its area, so a
    // 1.4px star loses most of its flux to the gaussian falloff and vanishes.
    // Give the small ones it back, or the faint half of the sky disappears.
    float gain = clamp(3.4 / vSize, 1.0, 2.6);

    float brightness = (0.05 + 0.95 * pow(vMag, 1.15)) * uIntensity * gain * vMagnify;

    gl_FragColor = vec4(vColor * a * brightness, 1.0);
  }
`;

export function Starfield({ intensity = 1.0 }: { intensity?: number }) {
  const ref = useRef<Points>(null);
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(buildGeometry, []);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uPixelRatio: { value: 1 },
          uScale: { value: 1 },
          uIntensity: { value: 1.35 * intensity },
          ...lensUniforms,
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        // Depth-tested so the planet occludes the sky. renderOrder alone is not
        // enough: three draws every transparent material after every opaque one,
        // whatever the order says, so without this the stars punch through the
        // planet's night side.
        depthTest: true,
      }),
    [intensity]
  );

  useFrame(({ size }) => {
    material.uniforms.uPixelRatio.value = dpr;
    // Keep apparent star size constant in physical terms as the window changes,
    // so the sky does not get denser-looking on small screens.
    material.uniforms.uScale.value = clamp(size.height / 900, 0.72, 1.35);
  });

  return (
    <points
      ref={ref}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={-10}
    />
  );
}
