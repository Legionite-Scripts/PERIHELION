import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
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
  CLOUD_NOISE_SCALE,
  CLOUD_U,
  CLOUD_V,
  NURSERY_UNIFORM,
  SLICE_HALF_ANGLE,
} from "./constants";

/**
 * The emission nebula — the glowing gas of the star-forming region, baked once.
 *
 * A second procedural field, separate from the dust: ionised gas lit by the
 * nurseries' young stars. Two depth layers (NEBULA_DISTANCES), stacked in one
 * RGBA atlas, colour and opacity already resolved:
 *
 *   rgb  emitted light, display space
 *   a    the gas's own (slight) opacity
 *
 * The colour is structural, not a tint: turquoise where the hottest stars
 * ionise oxygen close in, rose and magenta in the hydrogen shells beyond,
 * cobalt and violet in the broad diffuse gas, warm amber on the edges where
 * gas meets dust. Luminous rims trace ionisation fronts; brightness varies at
 * the largest scale so the whole never reads as a coloured fog. The dust
 * slices are composited between these layers at render time, so dark lanes
 * silhouette the glow.
 */

export interface NebulaMaps {
  texture: Texture;
  dispose: () => void;
}

/** Distances of the two emission layers along the cloud axis: behind and among the dust. */
export const NEBULA_DISTANCES = new Vector2(6300, 4500);
export const NEBULA_TEXELS = { u: 1536, v: 768 };

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform vec3  uA;
  uniform vec3  uU;
  uniform vec3  uV;
  uniform vec2  uDist;       // far, mid
  uniform vec2  uHalf;
  uniform float uScale;
  uniform vec4  uNursery[3];

  ${NOISE3_GLSL}

  float ridge(vec3 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) {
      float n = 1.0 - abs(2.0 * vnoise3(p) - 1.0);
      s += a * n * n;
      p *= 2.11;
      a *= 0.5;
    }
    return s / 0.875;
  }

  // The palette. Display space, deliberately a little restrained per colour —
  // the richness comes from their mixture across the field.
  const vec3 COBALT    = vec3(0.10, 0.22, 0.72);
  const vec3 VIOLET    = vec3(0.40, 0.20, 0.70);
  const vec3 MAGENTA   = vec3(0.70, 0.15, 0.52);
  const vec3 ROSE      = vec3(0.92, 0.40, 0.48);
  const vec3 TURQUOISE = vec3(0.14, 0.68, 0.70);
  const vec3 AMBER     = vec3(0.96, 0.62, 0.28);

  vec4 nebula(vec3 P, float layer) {
    float depth = dot(P, uA);
    vec2 ang = vec2(atan(dot(P, uU), depth), atan(dot(P, uV), depth));
    vec3 p = P / (uScale * 1.6);

    // Region: large, torn, and biased toward the middle of the drift view.
    float e = fbm3_low(p * 0.3 + 11.0);
    vec2 q = ang / vec2(0.95, 0.5);
    float env = 1.0 - smoothstep(0.2, 1.05, length(q) + (e - 0.5) * 0.8);
    vec2 edge = abs(ang) / uHalf;
    env *= (1.0 - smoothstep(0.8, 0.93, edge.x)) * (1.0 - smoothstep(0.76, 0.9, edge.y));
    if (env <= 0.0) return vec4(0.0);

    // Gas mass: domain-warped, so it billows and streams.
    vec3 w = vec3(fbm3_low(p * 0.7), fbm3_low(p * 0.7 + vec3(13.1, 7.7, 2.9)), fbm3_low(p * 0.7 + vec3(5.3, 29.3, 17.1))) - 0.5;
    vec3 pw = p + w * 2.2;
    float body = fbm3(pw);
    float mass = smoothstep(0.38, 0.7, body) * env;

    // Ionisation fronts: the bright rims where the gas mass falls away.
    float rim = exp(-pow((body - 0.5) / 0.045, 2.0)) * env;
    // Fine filaments inside the gas.
    float fil = pow(ridge(pw * 2.6), 3.0) * mass;

    // Large-scale brightness variation: some regions blaze, some barely glow.
    float bright = mix(0.25, 1.35, smoothstep(0.3, 0.75, fbm3_low(p * 0.45 + 3.3)));

    // Proximity to the nurseries: hot, oxygen-bright cores — plus broader
    // zones where the gas is highly ionised, so turquoise is a region of the
    // nebula, not only a dot at each cluster.
    float hot = 0.0;
    for (int i = 0; i < 3; i++) {
      vec3 d = (P - uNursery[i].xyz) / (uNursery[i].w * 4.5);
      hot += exp(-dot(d, d));
    }
    float oxygen = smoothstep(0.58, 0.72, fbm3_low(p * 0.5 + vec3(21.0, 3.0, 11.0)));
    hot = clamp(hot + oxygen * 0.7, 0.0, 1.0);

    // Hue: two smooth fields steer the broad colour; physics steers the rest.
    float k1 = fbm3_low(p * 0.55 + vec3(3.0, 1.0, 7.0));
    float k2 = fbm3_low(p * 0.4 + vec3(9.0, 4.0, 2.0));
    vec3 diffuse = mix(COBALT, VIOLET, smoothstep(0.35, 0.65, k2));
    vec3 hydrogen = mix(MAGENTA, ROSE, smoothstep(0.4, 0.7, k1));
    vec3 col = mix(diffuse, hydrogen, smoothstep(0.42, 0.62, k1 + layer * 0.06));
    col = mix(col, TURQUOISE, hot * 0.85);
    // Warm edges where the gas thins toward the dust.
    col = mix(col, AMBER, clamp(rim * smoothstep(0.35, 0.6, k2) * 0.9, 0.0, 0.85));

    float glow = (mass * 0.32 + rim * 0.95 + fil * 0.5 + hot * mass * 0.6) * bright;
    return vec4(col * glow, clamp(mass * 0.25, 0.0, 1.0));
  }

  void main() {
    float fy = vUv.y * 2.0;
    float k = min(floor(fy), 1.0);
    float ly = fy - k;
    float D = k < 0.5 ? uDist.x : uDist.y;
    float au = (vUv.x * 2.0 - 1.0) * uHalf.x;
    float av = (ly * 2.0 - 1.0) * uHalf.y;
    vec3 P = uA * D + uU * (D * tan(au)) + uV * (D * tan(av));
    vec4 n = nebula(P, k);
    gl_FragColor = vec4(clamp(n.rgb, 0.0, 1.0), n.a);
  }
`;

export function bakeNebula(renderer: WebGLRenderer): NebulaMaps {
  const target = new WebGLRenderTarget(NEBULA_TEXELS.u, NEBULA_TEXELS.v * 2, {
    format: RGBAFormat,
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
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uA: { value: CLOUD_AXIS },
      uU: { value: CLOUD_U },
      uV: { value: CLOUD_V },
      uDist: { value: NEBULA_DISTANCES },
      uHalf: { value: new Vector2(SLICE_HALF_ANGLE.u, SLICE_HALF_ANGLE.v) },
      uScale: { value: CLOUD_NOISE_SCALE },
      uNursery: { value: NURSERY_UNIFORM },
    },
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
  return { texture: target.texture, dispose: () => target.dispose() };
}

const cache = new WeakMap<WebGLRenderer, NebulaMaps>();

/** Per-renderer cache — same lifetime reasoning as the other bakes. */
export function getNebula(renderer: WebGLRenderer): NebulaMaps {
  let n = cache.get(renderer);
  if (!n) {
    n = bakeNebula(renderer);
    cache.set(renderer, n);
  }
  return n;
}
