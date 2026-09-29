import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  Scene,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { NOISE3_GLSL } from "@/scene/shaders/noise3";
import {
  CLOUD_AXIS,
  CLOUD_ENVELOPE,
  CLOUD_NOISE_SCALE,
  CLOUD_U,
  CLOUD_V,
  NURSERY_UNIFORM,
  SLICE_DISTANCES,
  SLICE_HALF_ANGLE,
  SLICE_TEXELS,
} from "./constants";

/**
 * The molecular cloud's density, baked once.
 *
 * One continuous 3D field — dust complexes, filaments, and cavities blown open
 * by the nurseries — sampled on the three slice planes and stored as a single
 * R8 atlas, slices stacked vertically. Per frame the cloud only reads it back;
 * evaluating ~15 octaves of 3D noise per pixel three times over would be
 * unshippable on integrated graphics, and once into a texture it costs nothing.
 *
 * The same pattern as the planet's surface bake, and the same replaceable seam:
 * a generated density map could stand in for this file without the cloud
 * material changing.
 */

export interface CloudDensity {
  texture: Texture;
  dispose: () => void;
}

const BAKE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const BAKE_FRAG = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform vec3  uA;          // cloud axis (depth)
  uniform vec3  uU;          // along the galactic plane
  uniform vec3  uV;          // across it
  uniform vec3  uDist;       // slice distances along uA
  uniform vec2  uHalf;       // angular half-extent of each slice
  uniform vec2  uCentre;     // envelope centre, radians
  uniform vec2  uExtent;     // envelope half-size, radians
  uniform float uScale;      // world units per noise unit
  uniform vec4  uNursery[3]; // xyz position, w radius

  ${NOISE3_GLSL}

  /** Ridged noise: sharp creases where the value crosses its midpoint — filaments. */
  float ridge(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) {
      float n = 1.0 - abs(2.0 * vnoise3(p) - 1.0);
      s += a * n * n;
      p *= 2.13;
      a *= 0.5;
    }
    return s / 0.875;
  }

  float density(vec3 P) {
    float depth = dot(P, uA);
    vec2 ang = vec2(atan(dot(P, uU), depth), atan(dot(P, uV), depth));
    vec3 p = P / uScale;

    // The complex as a whole: a large region with a torn, irregular boundary.
    float e = fbm3_low(p * 0.35 + 3.1);
    vec2 q = (ang - uCentre) / uExtent;
    float r = length(q) + (e - 0.5) * 0.9;
    float env = 1.0 - smoothstep(0.25, 1.0, r);

    // Guard band: nothing may reach a slice's edge. That is what keeps the
    // mip chain from bleeding one slice into the next, and what guarantees no
    // slice boundary can ever be seen.
    vec2 edge = abs(ang) / uHalf;
    env *= (1.0 - smoothstep(0.80, 0.93, edge.x)) * (1.0 - smoothstep(0.76, 0.90, edge.y));
    if (env <= 0.0) return 0.0;

    // Domain warp, so the structure folds and streams rather than blotches.
    vec3 w = vec3(
      fbm3_low(p * 0.6),
      fbm3_low(p * 0.6 + vec3(17.3, 5.1, 9.7)),
      fbm3_low(p * 0.6 + vec3(41.7, 23.9, 3.3))
    ) - 0.5;
    vec3 pw = p + w * 1.8;

    float base = fbm3(pw);
    float fil = ridge(pw * 2.4);

    // Thresholded, so most of the region is empty: negative space is the
    // default and dust is the exception.
    float d = smoothstep(0.46, 0.72, base + (fil - 0.5) * 0.18);
    d *= 0.45 + 0.75 * fil;

    // Cavities: the nurseries have cleared the dust around themselves. The
    // walls are noisy, so what is left reads as eroded rims, not spheres.
    for (int i = 0; i < 3; i++) {
      vec4 n = uNursery[i];
      float dist = length(P - n.xyz) / n.w + (fbm3_low(p * 1.7 + float(i) * 7.0) - 0.5) * 0.6;
      d *= smoothstep(0.55, 1.05, dist);
    }

    return clamp(d * env, 0.0, 1.0);
  }

  void main() {
    // Which slice this row belongs to, and where within it.
    float fy = vUv.y * 3.0;
    float k = min(floor(fy), 2.0);
    float ly = fy - k;
    float D = k < 0.5 ? uDist.x : (k < 1.5 ? uDist.y : uDist.z);

    float au = (vUv.x * 2.0 - 1.0) * uHalf.x;
    float av = (ly * 2.0 - 1.0) * uHalf.y;
    vec3 P = uA * D + uU * (D * tan(au)) + uV * (D * tan(av));

    gl_FragColor = vec4(density(P), 0.0, 0.0, 1.0);
  }
`;

/** Renders the atlas. Synchronous, one-time, restores the caller's render target. */
export function bakeCloudDensity(renderer: WebGLRenderer): CloudDensity {
  const target = new WebGLRenderTarget(SLICE_TEXELS.u, SLICE_TEXELS.v * 3, {
    format: RedFormat,
    type: UnsignedByteType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    colorSpace: NoColorSpace,
    depthBuffer: false,
  });
  target.texture.wrapS = ClampToEdgeWrapping;
  target.texture.wrapT = ClampToEdgeWrapping;

  const material = new ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    uniforms: {
      uA: { value: CLOUD_AXIS },
      uU: { value: CLOUD_U },
      uV: { value: CLOUD_V },
      uDist: { value: SLICE_DISTANCES },
      uHalf: { value: new Vector2(SLICE_HALF_ANGLE.u, SLICE_HALF_ANGLE.v) },
      uCentre: { value: new Vector2(CLOUD_ENVELOPE.centre.u, CLOUD_ENVELOPE.centre.v) },
      uExtent: { value: new Vector2(CLOUD_ENVELOPE.extent.u, CLOUD_ENVELOPE.extent.v) },
      uScale: { value: CLOUD_NOISE_SCALE },
      uNursery: { value: NURSERY_UNIFORM },
    },
    depthTest: false,
    depthWrite: false,
  });

  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new Mesh(new PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  scene.add(quad);

  const previousTarget = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  renderer.setRenderTarget(previousTarget);

  quad.geometry.dispose();
  material.dispose();

  return { texture: target.texture, dispose: () => target.dispose() };
}

/**
 * Per-renderer cache, for the same StrictMode reason as the planet bake (see
 * surfaceBake.ts): the atlas lives as long as the WebGL context, never as long
 * as a component.
 */
const cache = new WeakMap<WebGLRenderer, CloudDensity>();

export function getCloudDensity(renderer: WebGLRenderer): CloudDensity {
  let density = cache.get(renderer);
  if (!density) {
    density = bakeCloudDensity(renderer);
    cache.set(renderer, density);
  }
  return density;
}
