"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  AddEquation,
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  Quaternion,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
} from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { journey } from "@/journey/store";
import { cloud, cloudPresence, nebulaPresence } from "@/journey/environment";
import { LENS_GLSL, lensUniforms } from "@/scene/gravity/lens";
import { NOISE_GLSL } from "@/scene/shaders/noise";
import { clamp, kelvinToRGB, mulberry32 } from "@/lib/math";
import { exposeDevHandles, removeDevHandles } from "@/dev/handles";
import { bakeCloudDensity, getCloudDensity } from "./cloudBake";
import { NEBULA_DISTANCES, getNebula } from "./nebulaBake";
import {
  CLOUD_AXIS,
  CLOUD_U,
  CLOUD_V,
  DUST_KAPPA,
  NURSERY_LIGHT,
  NURSERY_UNIFORM,
  SHELL_CAP_ANGLE,
  SHELL_RADIUS,
  SLICE_DISTANCES,
  SLICE_HALF_ANGLE,
  YOUNG_STAR_COUNT,
} from "./constants";

/**
 * The second environment: a distant molecular cloud and its nurseries.
 *
 * Three draws, all only while the cloud is present (t > 0.66); before that
 * none is submitted at all. (The third — near-field dust grains around the
 * camera — is described at buildGrains.)
 *
 *  • The dust. One camera-locked shell covering the half of the sky the cloud
 *    can occupy. Its fragment shader follows each view ray through the three
 *    slice planes — real planes, fixed in the world — reads the baked density
 *    where the ray crosses each, and composites them back to front. Because
 *    the slices are intersected rather than drawn as quads, there are no card
 *    edges to see, and because they are fixed in the world, the camera's travel
 *    slides near slices against far ones: that is the parallax.
 *
 *  • The young stars. ~150 points placed inside the volume, mostly in the
 *    nurseries. Each is dimmed by exactly the dust that lies between it and the
 *    camera, which is what puts it *inside* the cloud rather than on top of it.
 *
 * The dust is mostly absorption. It is seen chiefly by what it hides — the
 * band and the 11,000 stars behind it — plus a very faint scattered glow, a
 * warm rim where ionised gas meets the cavity walls, and a cool reflection
 * close to the brightest nurseries. Premultiplied "over" blending, so dense
 * dust genuinely removes the light behind it and the blacks stay black.
 *
 * Gravity: both read the shared lens uniforms, as the band and the starfield
 * do, and write nothing. Dust looks up where each ray came from before the mass
 * bent it (like the band); stars are moved to where the mass makes them appear
 * (like the starfield). At t ≈ 0.68 the lens field still reaches the cloud's
 * edge, and the two stay locked together.
 */

/** Uniforms shared by the dust and the young stars, so one update drives both. */
function sharedUniforms(texture: Texture) {
  return {
    uDensity: { value: texture },
    uA: { value: CLOUD_AXIS },
    uU: { value: CLOUD_U },
    uV: { value: CLOUD_V },
    uDist: { value: SLICE_DISTANCES },
    uHalf: { value: new Vector2(SLICE_HALF_ANGLE.u, SLICE_HALF_ANGLE.v) },
    uKappa: { value: DUST_KAPPA },
    uPresence: { value: 0 },
  };
}

/** GLSL for reading one slice where a ray from the camera crosses it. */
const SLICE_GLSL = /* glsl */ `
  uniform sampler2D uDensity;
  uniform vec3  uA;
  uniform vec3  uU;
  uniform vec3  uV;
  uniform vec3  uDist;
  uniform vec2  uHalf;
  uniform float uKappa;
  uniform float uPresence;

  /**
   * atan for the slice mapping, without the transcendental: an odd minimax
   * polynomial on [0, 1], and atan(q) = π/2 − atan(1/q) beyond it. Worst-case
   * error 1.7e-6 rad — 0.16% of one atlas texel, invisible in 8-bit output.
   */
  float sliceAtan(float q) {
    float a = abs(q);
    float z = a > 1.0 ? 1.0 / a : a;
    float z2 = z * z;
    float r = z * (0.99997726 + z2 * (-0.33262347 + z2 * (0.19354346
            + z2 * (-0.11643287 + z2 * (0.05265332 + z2 * -0.01172120)))));
    r = a > 1.0 ? 1.57079633 - r : r;
    return sign(q) * r;
  }

  /**
   * Density where the ray (cameraPosition, rd) crosses slice k at distance D,
   * and the world point it crosses at. Branch-free, so the texture's implicit
   * derivatives stay well defined across the cloud's boundary.
   */
  float sliceDensityBias(vec3 rd, float D, float k, out vec3 P, float softness) {
    float along = dot(rd, uA);
    float s = (D - dot(cameraPosition, uA)) / max(along, 1e-3);
    P = cameraPosition + rd * s;
    vec2 f = vec2(sliceAtan(dot(P, uU) / D), sliceAtan(dot(P, uV) / D)) / uHalf;
    float inside = step(max(abs(f.x), abs(f.y)), 1.0) * step(1e-3, along) * step(0.0, s);
    vec2 uv = vec2(0.5 + 0.5 * clamp(f.x, -1.0, 1.0), (k + 0.5 + 0.5 * clamp(f.y, -1.0, 1.0)) / 3.0);
    return SAMPLE_DENSITY(uv, softness) * inside;
  }

  float sliceDensity(vec3 rd, float D, float k, out vec3 P) {
    return sliceDensityBias(rd, D, k, P, 0.0);
  }
`;

const DUST_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const DUST_FRAG = /* glsl */ `
  varying vec3 vWorld;

  uniform vec4 uNursery[3];
  uniform vec3 uNurseryLight;
  uniform vec3 uDustGlow;
  uniform vec3 uWarm;
  uniform vec3 uCool;

  // The emission nebula (nebulaBake.ts): two depth layers in one atlas.
  uniform sampler2D uNebula;
  uniform vec2  uNebDist;      // far, mid
  uniform float uNebPresence;  // nebulaPresence(t)
  uniform float uNebGain;

  // Fragment stage: the far slices may be read a little softer (mip bias).
  #define SAMPLE_DENSITY(uv, bias) texture2D(uDensity, uv, bias).r
  ${SLICE_GLSL}
  ${LENS_GLSL}
  ${NOISE_GLSL}

  /** Light the dust at P, of density d, gives back toward the camera. Display space. */
  vec3 dustLight(vec3 P, float d) {
    float warm = 0.0;
    float cool = 0.0;
    for (int i = 0; i < 3; i++) {
      vec3 dv = (P - uNursery[i].xyz) / uNursery[i].w;
      float r2 = dot(dv, dv);
      float L = uNurseryLight[i];
      warm += L / (1.0 + r2 * 0.35);
      cool += L / (1.0 + r2 * 2.5);
    }
    // Ionisation fronts sit where the dust is thinning out, not in its core.
    float rim = d * (1.0 - d) * 4.0;
    return uDustGlow * d + uWarm * warm * rim + uCool * cool * d;
  }

  /**
   * Shade one slice sample. Empty dust contributes exactly nothing, so skip it.
   *
   * Atmospheric perspective across the three depths (depth: 0 near, 1 far).
   * The far slice is seen through more of the cloud's own diffuse glow, so it
   * is hazier, cooler and lower in contrast; the near slice is dense, dark and
   * sharp. It is the cue a real dust complex gives about which structure lies
   * in front — and it costs a few multiplies.
   */
  vec4 shade(vec3 P, float d, float depth) {
    if (d <= 0.0) return vec4(0.0);
    float kappa = uKappa * mix(1.3, 0.85, depth);
    float a = 1.0 - exp(-d * kappa * uPresence);
    vec3 haze = mix(vec3(0.8, 0.74, 0.68), vec3(0.94, 0.98, 1.08), depth);
    vec3 light = dustLight(P, d) * mix(0.5, 1.1, depth) * haze;
    // As the nebula's own light comes up, the dust's grey scatter gives way:
    // lanes become silhouettes against the glow (their coloured rims are added
    // from the gas behind them in main()).
    light *= 1.0 - 0.75 * uNebPresence;
    return vec4(light * uPresence, a);
  }

  /** The emission nebula's light where the ray crosses layer k (0 far, 1 mid). */
  vec4 nebulaAt(vec3 rd, float D, float k) {
    float along = dot(rd, uA);
    float s = (D - dot(cameraPosition, uA)) / max(along, 1e-3);
    vec3 P = cameraPosition + rd * s;
    vec2 f = vec2(atan(dot(P, uU) / D), atan(dot(P, uV) / D)) / uHalf;
    float inside = step(max(abs(f.x), abs(f.y)), 1.0) * step(1e-3, along) * step(0.0, s);
    vec2 uv = vec2(0.5 + 0.5 * clamp(f.x, -1.0, 1.0), (k + 0.5 + 0.5 * clamp(f.y, -1.0, 1.0)) / 2.0);
    return texture2D(uNebula, uv) * inside;
  }

  void main() {
    // Where this ray came from before the planet bent it — as the band does.
    // Once gravity has fallen away (Einstein angle under 0.01 rad, from about
    // t ≈ 0.77) the deflection here is below a tenth of a pixel, so the lens
    // step is skipped for its cost.
    vec3 rd = normalize(vWorld - cameraPosition);
    if (uLensThetaE > 0.01) rd = lensSource(rd);

    // The glowing gas, read at its two depths — behind the far dust, and in
    // among the slices — in the same uniform control flow as the dust.
    vec4 ef = nebulaAt(rd, uNebDist.x, 0.0);
    vec4 em = nebulaAt(rd, uNebDist.y, 1.0);

    // All three reads first, in uniform control flow (the texture's implicit
    // derivatives need that), then bail out wherever there is no dust at all —
    // most of the sky. Such a pixel contributed exactly zero before, so
    // discarding it changes nothing but the cost: no lighting, no blend.
    vec3 Pf, Pm, Pn;
    // The far slice is read one mip softer, the middle half a mip: distant
    // structure loses definition through the medium in front of it.
    float df = sliceDensityBias(rd, uDist.z, 2.0, Pf, 1.0);
    float dm = sliceDensityBias(rd, uDist.y, 1.0, Pm, 0.5);
    float dn = sliceDensity(rd, uDist.x, 0.0, Pn);
    float gas = (ef.a + em.a + dot(ef.rgb + em.rgb, vec3(1.0))) * uNebPresence;
    if (df + dm + dn + gas <= 0.0) discard;

    vec4 far  = shade(Pf, df, 1.0);
    vec4 mid  = shade(Pm, dm, 0.5);
    vec4 near = shade(Pn, dn, 0.0);

    float nk = uNebPresence * uNebGain;
    // The first light is blue and violet — the faint outer, reflection-lit
    // gas — and the full palette comes up with the reveal. Same brightness,
    // hue pulled toward cobalt/violet while presence is low.
    float early = (1.0 - smoothstep(0.25, 0.65, uNebPresence)) * 0.75;
    vec3 coolF = vec3(0.24, 0.26, 0.78) * dot(ef.rgb, vec3(0.3, 0.5, 0.2)) * 2.2;
    vec3 coolM = vec3(0.34, 0.24, 0.74) * dot(em.rgb, vec3(0.3, 0.5, 0.2)) * 2.2;
    vec3 glowFar = mix(ef.rgb, coolF, early) * nk;
    vec3 glowMid = mix(em.rgb, coolM, early) * nk;

    // Dust edges catch the colour of the gas glowing behind them — the lit
    // rims that make a dust lane read as a solid thing in front of the light.
    far.rgb += glowFar * (df * (1.0 - df) * 4.0) * 0.5;
    mid.rgb += (glowFar + glowMid) * (dm * (1.0 - dm) * 4.0) * 0.35;
    near.rgb += (glowFar + glowMid) * (dn * (1.0 - dn) * 4.0) * 0.25;

    // Back to front, premultiplied: far gas → far dust → mid gas → mid dust →
    // near dust. Every dust slice absorbs the glow behind it.
    vec3 c = glowFar;
    float a = ef.a * uNebPresence;
    c = far.rgb + (1.0 - far.a) * c;
    a = far.a + (1.0 - far.a) * a;
    c = glowMid + (1.0 - em.a * uNebPresence) * c;
    a = em.a * uNebPresence + (1.0 - em.a * uNebPresence) * a;
    c = mid.rgb + (1.0 - mid.a) * c;
    a = mid.a + (1.0 - mid.a) * a;
    c = near.rgb + (1.0 - near.a) * c;
    a = near.a + (1.0 - near.a) * a;

    // Same sub-code-value dither as the band: the glow is a very dark, very
    // smooth gradient and 8-bit output would otherwise step it.
    c += (hash21(gl_FragCoord.xy) - 0.5) / 255.0 * step(0.001, a);

    gl_FragColor = vec4(c, a);
  }
`;

const STAR_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aMag;

  uniform float uPixelRatio;
  uniform float uScale;

  varying vec3 vColor;
  varying float vMag;
  varying float vSize;
  varying float vTransmit;

  // Vertex stage: no implicit derivatives, so no bias — the base level.
  #define SAMPLE_DENSITY(uv, bias) texture2D(uDensity, uv).r
  ${SLICE_GLSL}
  ${LENS_GLSL}

  void main() {
    vec3 ray = position - cameraPosition;
    float dist = length(ray);
    vec3 dir = ray / dist;

    // Extinction by the slices that lie between the camera and this star,
    // read along its true ray — the same dust the lensed dust shows around it.
    float depth = dot(position, uA);
    vec3 P;
    float tau = 0.0;
    tau += step(uDist.x, depth) * sliceDensity(dir, uDist.x, 0.0, P);
    tau += step(uDist.y, depth) * sliceDensity(dir, uDist.y, 1.0, P);
    tau += step(uDist.z, depth) * sliceDensity(dir, uDist.z, 2.0, P);
    vTransmit = exp(-tau * uKappa * uPresence);

    // Lensed exactly like the starfield.
    vec3 world = cameraPosition + lensImage(dir) * dist;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;

    float size = mix(1.0, 4.4, pow(aMag, 0.75));
    float atten = 2600.0 / max(1.0, -mv.z);
    gl_PointSize = clamp(size * uScale * atten * uPixelRatio, 1.4, 11.0);
    vSize = gl_PointSize;

    vColor = aColor;
    vMag = aMag;
  }
`;

const STAR_FRAG = /* glsl */ `
  uniform float uIntensity;
  uniform float uPresence;

  varying vec3 vColor;
  varying float vMag;
  varying float vSize;
  varying float vTransmit;

  void main() {
    // The starfield's own sprite: tight core, faint magnitude-scaled halo.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float core = exp(-d * d * 8.0);
    float halo = exp(-d * d * 1.8) * mix(0.10, 0.30, vMag);
    float gain = clamp(3.4 / vSize, 1.0, 2.6);
    float brightness = (0.05 + 0.95 * pow(vMag, 1.15)) * uIntensity * gain * uPresence * vTransmit;
    gl_FragColor = vec4(vColor * (core + halo) * brightness, 1.0);
  }
`;

/**
 * Near-field dust grains — the cloud around the camera, not in front of it.
 *
 * The same trick as the Stage 1 motes, which are the whole parallax budget of
 * the flight: a few hundred points tiled in a cell around the camera, so there
 * is always dust nearby. These belong to the cloud — warmer, a little larger,
 * thickening with its presence — so as the camera travels during the drift
 * they stream past it, and the visitor is moving through the medium rather
 * than looking at a picture of it.
 */
// Dense enough that a few dozen are always within ~25 units of the lens —
// sparser, and the camera sees one or two and no sense of a medium at all.
const GRAIN_COUNT = 1600;
const GRAIN_CELL = 56;

function buildGrains() {
  const rand = mulberry32(0x9a17d5);
  const positions = new Float32Array(GRAIN_COUNT * 3);
  const seeds = new Float32Array(GRAIN_COUNT);
  for (let i = 0; i < GRAIN_COUNT; i++) {
    positions[i * 3] = rand() * GRAIN_CELL;
    positions[i * 3 + 1] = rand() * GRAIN_CELL;
    positions[i * 3 + 2] = rand() * GRAIN_CELL;
    seeds[i] = rand();
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new Float32BufferAttribute(seeds, 1));
  geo.boundingSphere = new Sphere(new Vector3(), GRAIN_CELL * 4);
  return geo;
}

const GRAIN_VERT = /* glsl */ `
  attribute float aSeed;
  uniform vec3  uCam;
  uniform float uCell;
  uniform float uPixelRatio;
  varying float vAlpha;

  void main() {
    vec3 half3 = vec3(uCell * 0.5);
    vec3 rel = mod(position - uCam + half3, uCell) - half3;
    vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
    gl_Position = projectionMatrix * mv;

    float dist = length(rel);
    float far  = smoothstep(uCell * 0.5, uCell * 0.3, dist);
    float near = smoothstep(1.0, 5.0, dist);
    float size = mix(1.2, 3.4, aSeed * aSeed);
    gl_PointSize = clamp(size * uPixelRatio * (40.0 / max(1.0, -mv.z) + 0.6), 0.8, 5.0);
    vAlpha = far * near * (0.3 + 0.7 * aSeed);
  }
`;

const GRAIN_FRAG = /* glsl */ `
  uniform float uPresence;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = exp(-d * d * 2.6) * vAlpha * uPresence * 0.24;
    gl_FragColor = vec4(vec3(0.78, 0.72, 0.66) * a, 1.0);
  }
`;

function buildStars() {
  const rand = mulberry32(0x7a55e1);
  const positions = new Float32Array(YOUNG_STAR_COUNT * 3);
  const colors = new Float32Array(YOUNG_STAR_COUNT * 3);
  const mags = new Float32Array(YOUNG_STAR_COUNT);
  const gauss = () =>
    Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(Math.PI * 2 * rand());

  const weights = NURSERY_LIGHT.toArray();
  const total = weights.reduce((a, b) => a + b, 0);
  const p = new Vector3();

  for (let i = 0; i < YOUNG_STAR_COUNT; i++) {
    const kind = rand();
    if (kind < 0.18) {
      // Foreground: already inside the outskirts of the complex, in front of
      // the near slice — the stars that slide most against the dust behind.
      const depth = 1500 + rand() * 1000;
      const u = (rand() * 2 - 1) * 0.55;
      const v = (rand() * 2 - 1) * 0.25;
      p.copy(CLOUD_AXIS)
        .multiplyScalar(depth)
        .addScaledVector(CLOUD_U, depth * Math.tan(u))
        .addScaledVector(CLOUD_V, depth * Math.tan(v));
    } else if (kind < 0.7) {
      // In a nursery, weighted by how bright that nursery is.
      let pick = rand() * total;
      let n = 0;
      while (n < weights.length - 1 && pick > weights[n]) pick -= weights[n++];
      const c = NURSERY_UNIFORM[n];
      const spread = c.w * 0.9;
      p.set(c.x + gauss() * spread, c.y + gauss() * spread, c.z + gauss() * spread);
    } else {
      // Scattered through the complex, from its near face to beyond the far
      // slice.
      const depth = 2700 + rand() * 3100;
      const u = (rand() * 2 - 1) * 0.6;
      const v = (rand() * 2 - 1) * 0.22;
      p.copy(CLOUD_AXIS)
        .multiplyScalar(depth)
        .addScaledVector(CLOUD_U, depth * Math.tan(u))
        .addScaledVector(CLOUD_V, depth * Math.tan(v));
    }
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;

    // Young and hot: a handful of bright anchors, most faint.
    const r = rand();
    const m = r > 0.94 ? 0.62 + rand() * 0.3 : Math.pow(r, 2.4) * 0.6;
    mags[i] = m;

    // Blue-white, heavily desaturated like everything else in the sky.
    const [cr, cg, cb] = kelvinToRGB(9000 + rand() * 16000);
    const sat = 0.25 + m * 0.35;
    colors[i * 3] = 0.94 + (cr - 0.94) * sat;
    colors[i * 3 + 1] = 0.96 + (cg - 0.96) * sat;
    colors[i * 3 + 2] = 1.0 + (cb - 1.0) * sat;
  }

  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("aColor", new Float32BufferAttribute(colors, 3));
  geo.setAttribute("aMag", new Float32BufferAttribute(mags, 1));
  geo.boundingSphere = new Sphere(new Vector3(), 9000);
  return geo;
}

export function MolecularCloud() {
  const gl = useThree((s) => s.gl);
  const dpr = useThree((s) => s.viewport.dpr);
  const dustRef = useRef<Mesh>(null);
  const starsRef = useRef<Points>(null);
  const grainsRef = useRef<Points>(null);

  // One-time bake, cached against the renderer (see cloudBake.ts).
  const density = useMemo(() => getCloudDensity(gl), [gl]);

  const shared = useMemo(() => sharedUniforms(density.texture), [density]);
  const nebula = useMemo(() => getNebula(gl), [gl]);

  // A cap about the cloud axis covering exactly the directions the cloud can
  // occupy from anywhere on the drift (see SHELL_CAP_ANGLE), and no more.
  const shell = useMemo(() => {
    const g = new SphereGeometry(SHELL_RADIUS, 64, 24, 0, Math.PI * 2, 0, SHELL_CAP_ANGLE);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), CLOUD_AXIS));
    return g;
  }, []);

  const dust = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        uniforms: {
          ...shared,
          uNursery: { value: NURSERY_UNIFORM },
          uNurseryLight: { value: NURSERY_LIGHT },
          // Display-space light levels. The band peaks near 0.04; the cloud's
          // brightest rim is kept just above it and its body far below.
          uDustGlow: { value: new Vector3(0.55, 0.5, 0.46).multiplyScalar(0.02) },
          uWarm: { value: new Vector3(0.8, 0.5, 0.42).multiplyScalar(0.05) },
          uCool: { value: new Vector3(0.5, 0.6, 0.75).multiplyScalar(0.035) },
          uNebula: { value: nebula.texture },
          uNebDist: { value: NEBULA_DISTANCES },
          uNebPresence: { value: 0 },
          uNebGain: { value: 0.9 },
          ...lensUniforms,
        },
        side: BackSide,
        transparent: true,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        depthWrite: false,
        // Depth-tested so the planet occludes the cloud; it sits far behind it.
        depthTest: true,
      }),
    [shared, nebula]
  );

  const starGeometry = useMemo(buildStars, []);
  const stars = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: {
          ...shared,
          uPixelRatio: { value: 1 },
          uScale: { value: 1 },
          uIntensity: { value: 1.35 },
          ...lensUniforms,
        },
        transparent: true,
        blending: CustomBlending,
        blendEquation: AddEquation,
        blendSrc: OneFactor,
        blendDst: OneFactor,
        depthWrite: false,
        depthTest: true,
      }),
    [shared]
  );

  const grainGeometry = useMemo(buildGrains, []);
  const grains = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: GRAIN_VERT,
        fragmentShader: GRAIN_FRAG,
        uniforms: {
          uCam: { value: new Vector3() },
          uCell: { value: GRAIN_CELL },
          uPixelRatio: { value: 1 },
          uPresence: shared.uPresence,
        },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: true,
      }),
    [shared]
  );

  // Dev-only: re-run the bake on demand so its cost can be timed.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      exposeDevHandles({ __perihelionCloudBake: () => bakeCloudDensity(gl) });
      return () => removeDevHandles("__perihelionCloudBake");
    }
  }, [gl]);

  useFrame(({ camera, size }) => {
    const p = cloud.enabled ? cloudPresence(journey.t) : 0;
    const n = cloud.enabled ? nebulaPresence(journey.t) : 0;
    const on = p > 0 || n > 0;
    if (dustRef.current) dustRef.current.visible = on;
    if (starsRef.current) starsRef.current.visible = on;
    if (grainsRef.current) grainsRef.current.visible = on;
    if (!on) return;

    grains.uniforms.uCam.value.copy(camera.position);
    grains.uniforms.uPixelRatio.value = dpr;

    shared.uPresence.value = p;
    dust.uniforms.uNebPresence.value = n;
    // The embedded young stars brighten as the region's light comes up.
    stars.uniforms.uIntensity.value = 1.35 * (1 + 0.6 * n);
    // Background at infinity for the shell itself; the slices inside it are
    // world-fixed, so parallax comes from them, not from this.
    dustRef.current?.position.copy(camera.position);
    stars.uniforms.uPixelRatio.value = dpr;
    stars.uniforms.uScale.value = clamp(size.height / 900, 0.72, 1.35);
  });

  return (
    <>
      <mesh
        ref={dustRef}
        geometry={shell}
        material={dust}
        frustumCulled={false}
        renderOrder={-5}
        visible={false}
      />
      <points
        ref={starsRef}
        geometry={starGeometry}
        material={stars}
        frustumCulled={false}
        renderOrder={-4}
        visible={false}
      />
      <points
        ref={grainsRef}
        geometry={grainGeometry}
        material={grains}
        frustumCulled={false}
        renderOrder={2}
        visible={false}
      />
    </>
  );
}
