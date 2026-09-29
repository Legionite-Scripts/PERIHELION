import {
  ClampToEdgeWrapping,
  HalfFloatType,
  LinearMipmapLinearFilter,
  LinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Texture,
  UnsignedByteType,
  WebGLRenderTarget,
  WebGLRenderer,
} from "three";
import { NOISE3_GLSL } from "@/scene/shaders/noise3";
import { SURFACE_MAP_SIZE, SURFACE_RELIEF } from "./constants";
import { FEATURE_UNIFORMS } from "./features";

/**
 * THE REPLACEABLE PART.
 *
 * Everything procedural about the planet lives in this one file (plus the
 * positions of its few named features, in features.ts). It bakes two
 * equirectangular maps once, at mount, and is never touched again:
 *
 *   albedo   RGB   surface colour, linear
 *   surface  R     elevation in world units
 *            G     roughness
 *            B     ambient occlusion
 *
 * The planet material knows nothing about noise, craters or lava plains — it
 * only knows those two textures. Swapping in Higgsfield-generated maps means
 * deleting this file and handing `PlanetMaps` a pair of loaded textures. No
 * other file changes.
 *
 * Baking rather than evaluating per-frame is the whole reason this is
 * affordable: three octaves of 3D Worley is ~81 cell lookups per sample, and
 * the normal derivation needs four more samples on top. Per pixel per frame
 * that is unshippable; once into a texture it costs a few hundred milliseconds
 * at startup, while the planet is twenty pixels wide and nobody is looking.
 */

export interface PlanetMaps {
  albedo: Texture;
  surface: Texture;
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

  uniform int   uPass;     // 0 = albedo, 1 = surface
  uniform float uRelief;   // global trim on all of the amplitudes below

  // Relief amplitudes, in WORLD UNITS, one per feature family.
  //
  // A single global relief scalar does not work: crater families differ in
  // width by two orders of magnitude, and what the eye reads is slope, not
  // height. A 0.6-unit-wide crater and a 5-unit-wide basin scaled by the same
  // number leaves the small one geometrically flat and invisible. So each
  // family carries its own depth, set from the depth-to-diameter ratio real
  // impacts leave behind — roughly 1:8 fresh, shallower as they degrade — which
  // puts crater walls at 15-25°, where the Moon's are.
  uniform float uBasinRelief;
  uniform float uMidRelief;
  uniform float uSmallRelief;
  uniform float uCoarseRelief;
  uniform float uMediumRelief;
  uniform float uStreakRelief;

  // Named geology (features.ts): basins, fresh ray craters, fractures.
  uniform vec4  uBasin[2];     // xyz centre, w inner-ring radius (rad)
  uniform vec4  uRay[7];       // xyz centre, w crater radius (rad)
  uniform vec4  uFaultN[3];    // xyz great-circle normal, w half-length (rad)
  uniform vec3  uFaultMid[3];  // arc midpoint
  uniform float uRingRelief;
  uniform float uRayRelief;
  uniform float uFaultRelief;

  varying vec2 vUv;

  ${NOISE3_GLSL}

  const float PI = 3.141592653589793;

  /**
   * One family of impact craters.
   *
   * Accumulated over the neighbouring cells rather than taken from Worley's
   * nearest feature. That distinction is not academic: an F1 lookup changes
   * which feature it belongs to across the Voronoi boundary, and since each
   * feature has its own radius the height jumps there. Finite-differencing that
   * for the normal produces black seams along every cell edge — and Voronoi
   * edges are straight, so the surface ends up cracked with what look like
   * tectonic faults.
   *
   * Summing compactly-supported profiles is continuous everywhere, and has the
   * happy side effect of being more truthful: overlapping impacts overprint
   * each other rather than one winning outright.
   *
   * Each profile is a bowl with a raised rim — what an impact actually leaves,
   * and the difference between craters and lumpy noise.
   */
  float craters(vec3 p, float scale, float density, out float rim, out float floorMask) {
    vec3 q = p * scale;
    vec3 ip = floor(q);
    vec3 fp = fract(q);

    float total = 0.0;
    rim = 0.0;
    floorMask = 0.0;

    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 g = vec3(float(x), float(y), float(z));
      vec3 o = hash33(ip + g);
      float id = fract(o.x * 37.13 + o.y * 17.71 + o.z * 7.37);
      if (id > density) continue;          // most cells hold nothing

      // Capped at 0.74 so a crater's support (1.25 radii) always stays inside
      // the 3x3x3 neighbourhood being summed.
      float radius = mix(0.16, 0.74, fract(id * 91.7));
      float t = length(g + o - fp) / radius;
      if (t > 1.25) continue;

      // Older craters are shallower. Squaring the age biases the population
      // toward degraded ones, which is what an ancient surface looks like.
      float age = fract(id * 53.3);
      float depth = mix(0.20, 1.0, age * age);

      // Smooth window to exactly zero at the edge of support.
      float window = 1.0 - smoothstep(1.0, 1.25, t);

      float bowl = -smoothstep(1.0, 0.10, t);
      float ring = exp(-pow((t - 0.88) / 0.18, 2.0));

      total     += (bowl * 0.55 + ring * 0.85) * depth * window;
      rim       += ring * depth * window;
      floorMask += smoothstep(0.85, 0.30, t) * depth * window;
    }

    rim = clamp(rim, 0.0, 1.0);
    floorMask = clamp(floorMask, 0.0, 1.0);
    return clamp(total, -1.5, 1.2);
  }

  /** Azimuth of d around centre c — seam-free, as a point on the unit circle. */
  vec2 azimuth(vec3 d, vec3 c) {
    vec3 e1 = normalize(cross(c, normalize(vec3(0.31, 1.0, 0.17))));
    vec3 e2 = cross(c, e1);
    vec3 v = d - c * dot(d, c);
    float phi = atan(dot(v, e2), dot(v, e1));
    return vec2(cos(phi), sin(phi));
  }

  /**
   * A multi-ring impact basin: a flooded, slightly sunken interior inside
   * three concentric scarps. The rings wander in radius and break into arcs —
   * a real basin's rings are eroded and overprinted, and a clean set of
   * circles reads instantly as a target, the artefact to avoid.
   */
  float basin(vec3 d, vec4 b, float seed, out float ringMask, out float flood) {
    ringMask = 0.0;
    flood = 0.0;
    float a = acos(clamp(dot(d, b.xyz), -1.0, 1.0));
    float R = b.w;
    if (a > R * 2.5) return 0.0;
    vec3 circ = vec3(azimuth(d, b.xyz), seed);
    float h = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      float Rk = R * (fk == 0.0 ? 1.0 : (fk == 1.0 ? 1.42 : 1.95));
      float amp = fk == 0.0 ? 1.0 : (fk == 1.0 ? 0.55 : 0.32);
      // Never narrower than ~3 texels of the height map: under a low sun a
      // thinner ridge shades as a hard drawn line — the stamped-target look.
      float w = max(R * (0.09 + 0.04 * fk), 0.009);
      float wobble = (vnoise3(circ * 3.0 + fk * 4.1) - 0.5) * R * 0.18;
      float ridge = exp(-pow((a - Rk - wobble) / w, 2.0));
      float arcs = smoothstep(0.35, 0.7, vnoise3(circ * 2.3 + fk * 9.7 + seed));
      ridge *= mix(0.08, 1.0, arcs) * amp;
      h += ridge;
      ringMask = max(ringMask, ridge);
    }
    flood = smoothstep(R * 0.95, R * 0.55, a);
    return h - flood * 0.35;
  }

  /**
   * A young crater that has not yet been darkened by space weathering: a
   * crisp bowl, a blanket of brighter ejecta, and thin rays thrown far out.
   * Fresh basalt glass is faintly cooler in tone than weathered regolith —
   * that is the blue-grey, kept to a whisper.
   */
  float rayCrater(vec3 d, vec4 c, float seed, out float ejecta) {
    ejecta = 0.0;
    float a = acos(clamp(dot(d, c.xyz), -1.0, 1.0));
    float t = a / c.w;
    if (t > 12.0) return 0.0;
    // Rim and bowl kept several texels wide: at this size a crisp profile
    // aliases in the height map and shades as a polygon.
    float window = 1.0 - smoothstep(1.1, 1.5, t);
    float bowl = -smoothstep(1.05, 0.2, t);
    float rim = exp(-pow((t - 0.95) / 0.3, 2.0));
    vec3 circ = vec3(azimuth(d, c.xyz) * 1.0, seed);
    // No hard edges anywhere: the blanket feathers into the rim and out, and
    // the rays are thin, uneven and fade along their length.
    float blanket = smoothstep(3.0, 1.1, t) * smoothstep(0.6, 1.0, t);
    // Uneven by design: each ray has its own length, and brightens and fades
    // along it, so the system never reads as the spokes of a starburst.
    float reach = mix(2.5, 8.0, pow(vnoise3(circ * 1.7 + 3.0), 1.5));
    float streaks = pow(vnoise3(circ * 11.0), 4.0) * 2.7;
    float along = mix(0.35, 1.0, vnoise3(vec3(circ.xy * 3.0, t * 0.7 + seed)));
    float rays = streaks * along * smoothstep(1.2, 2.2, t) * (1.0 - smoothstep(reach * 0.3, reach, t));
    ejecta = clamp(blanket * 0.75 + rays, 0.0, 1.0);
    return (bowl * 0.6 + rim * 0.6) * window;
  }

  /**
   * A graben: a narrow flat-floored trough between two faults, running
   * straight along a great circle and tapering out at its ends. The line is
   * jittered by a fraction of its width so it reads as geology, not a ruler.
   */
  float fracture(vec3 d, vec4 n, vec3 mid, float seed, out float trough) {
    trough = 0.0;
    float s = asin(clamp(dot(d, n.xyz), -1.0, 1.0));
    if (abs(s) > 0.03) return 0.0;
    vec3 q = normalize(d - n.xyz * dot(d, n.xyz));
    float along = acos(clamp(dot(q, mid), -1.0, 1.0));
    float ends = 1.0 - smoothstep(n.w * 0.55, n.w, along);
    if (ends <= 0.0) return 0.0;
    s += (vnoise3(d * 55.0 + seed) - 0.5) * 0.002;
    // Segmented along its length — faults break into offset stretches rather
    // than running as one clean cut.
    float segments = smoothstep(0.25, 0.6, vnoise3(q * 14.0 + seed));
    // Soft-walled: under the low sun near the terminator any crisp edge
    // reads as a scratch in the image rather than a valley in the ground.
    float w = 0.006;
    float floorProfile = 1.0 - smoothstep(w * 0.3, w * 1.6, abs(s));
    float shoulder = exp(-pow((abs(s) - w * 1.9) / w, 2.0));
    trough = floorProfile * ends * segments;
    return (-floorProfile + shoulder * 0.35) * ends * segments;
  }

  /** Direction on the sphere for an equirect uv, matching three's SphereGeometry. */
  vec3 direction(vec2 uv) {
    float theta = (1.0 - uv.y) * PI;
    float phi = uv.x * 2.0 * PI;
    float st = sin(theta);
    return vec3(-cos(phi) * st, cos(theta), sin(phi) * st);
  }

  void main() {
    vec3 d = direction(vUv);

    // ---- ancient lava plains -------------------------------------------
    // Large, smooth, darker basins that flooded and erased what was beneath
    // them. This mask is the largest-scale structure on the world and most of
    // what reads at distance.
    float mareField = fbm3_low(d * 1.15 + 3.7);
    float mare = smoothstep(0.35, 0.53, mareField);

    // ---- named geology (features.ts) ----------------------------------------
    // Basin interiors flooded with the same dark basalt as the plains, so
    // they join the plains mask and inherit everything the plains do.
    float ringA, floodA, ringB, floodB;
    float basinA = basin(d, uBasin[0], 1.3, ringA, floodA);
    float basinB = basin(d, uBasin[1], 7.9, ringB, floodB);
    float ring = max(ringA, ringB);
    mare = max(mare, max(floodA, floodB) * 0.9);

    float ejecta = 0.0;
    float rayRelief = 0.0;
    for (int i = 0; i < 7; i++) {
      float e;
      rayRelief += rayCrater(d, uRay[i], float(i) * 2.17, e);
      ejecta = max(ejecta, e);
    }

    float trough = 0.0;
    float faultRelief = 0.0;
    for (int i = 0; i < 3; i++) {
      float tr;
      faultRelief += fracture(d, uFaultN[i], uFaultMid[i], float(i) * 5.3, tr);
      trough = max(trough, tr);
    }

    // ---- impact history --------------------------------------------------
    float rimBig, floorBig, rimMid, floorMid, rimSmall, floorSmall;
    float basins = craters(d + 1.7, 1.7, 0.10, rimBig, floorBig);
    float mid    = craters(d + 4.1, 7.2, 0.12, rimMid, floorMid);
    float small  = craters(d + 8.3, 26.0, 0.15, rimSmall, floorSmall);

    // ---- terrain ----------------------------------------------------------
    float coarse = fbm3(d * 3.1) - 0.5;
    float medium = fbm3(d * 11.0) - 0.5;

    // Wind-polished streaking. On a tidally locked world there is a permanent
    // day-to-night circulation, so the fine texture is stretched east-west.
    // Scaling the polar axis up stretches features along latitude, seamlessly.
    float streak = fbm3(vec3(d.x, d.y * 7.5, d.z) * 17.0) - 0.5;

    // Plains post-date most of the bombardment, so they keep only the oldest,
    // largest scars and the very newest small ones.
    float elevation = (
        basins * uBasinRelief  * (1.0 - mare * 0.30)
      + mid    * uMidRelief    * (1.0 - mare * 0.95)
      + small  * uSmallRelief  * (1.0 - mare * 0.60)
      + coarse * uCoarseRelief * (1.0 - mare * 0.75)
      + medium * uMediumRelief * (1.0 - mare * 0.55)
      + streak * uStreakRelief
      + (basinA + basinB) * uRingRelief
      + rayRelief * uRayRelief
      + faultRelief * uFaultRelief
    ) * uRelief;

    // Normalised shape, for albedo and occlusion only.
    float relief = elevation / max(uBasinRelief * uRelief, 1e-4);

    if (uPass == 0) {
      // ---- albedo ---------------------------------------------------------
      // Basalt. Real values sit around 0.06–0.12 — far darker than instinct
      // says, and the darkness is most of why this reads as a world rather
      // than a grey ball. Chroma is almost nil: a faint warm iron cast, no
      // more, so the only real colour in frame comes from the star.
      float base = 0.078;

      // Plains against highlands: the two-tone structure that reads from far
      // away. Kept inside real basalt/anorthosite-poor albedos.
      base -= mare * 0.040;                       // plains are darker still
      base += (1.0 - mare) * 0.004;               // highlands a shade lighter
      base += (rimBig * 0.012 + rimMid * 0.014 + rimSmall * 0.009); // fresh ejecta
      base -= (floorBig + floorMid) * 0.006;      // shadowed, infilled floors
      base += coarse * 0.016;
      base += medium * 0.008;
      base += streak * 0.005;
      base += ring * 0.006;                       // basin scarps: fresher rock
      base += ejecta * 0.024;                     // young ejecta and rays
      base -= trough * 0.004;                     // graben floors

      base = clamp(base, 0.030, 0.140);

      // Dust tint: very slightly warm, desaturated almost to grey.
      // Almost no chroma of its own. Every warm note in the frame should be
      // coming from the star, not from the rock.
      vec3 tint = mix(vec3(1.0, 0.982, 0.958), vec3(1.0, 0.995, 0.996), mare);
      // Unweathered ejecta is a touch cooler — the faint blue-grey.
      tint = mix(tint, vec3(0.935, 0.975, 1.045), ejecta * 0.8);
      gl_FragColor = vec4(vec3(base) * tint, 1.0);

    } else {
      // ---- height / roughness / occlusion ---------------------------------
      float height = elevation;

      // Plains are smoother; crater rims and highlands are rougher. Basalt is
      // never glossy, so the whole range sits high.
      float rough = 0.86
                  - mare * 0.10
                  + (rimBig + rimMid + rimSmall) * 0.05
                  + abs(medium) * 0.06
                  + ejecta * 0.04;
      rough = clamp(rough, 0.68, 0.99);

      // Cheap cavity occlusion: crater floors and low ground see less sky.
      float ao = 1.0
               - (floorBig * 0.30 + floorMid * 0.22 + floorSmall * 0.10)
               - smoothstep(0.1, -0.35, relief) * 0.12
               - trough * 0.12;
      ao = clamp(ao, 0.45, 1.0);

      gl_FragColor = vec4(height, rough, ao, 1.0);
    }
  }
`;

/**
 * Renders both maps. Synchronous, one-time, and restores whatever render target
 * the caller had bound.
 */
export function bakeSurfaceMaps(
  renderer: WebGLRenderer,
  size = SURFACE_MAP_SIZE
): PlanetMaps {
  const albedoTarget = new WebGLRenderTarget(size, size / 2, {
    type: UnsignedByteType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    // Values written are already linear albedo — no transfer function on read.
    colorSpace: NoColorSpace,
  });

  // Half float, not bytes: height is finite-differenced to build the normal,
  // and 8-bit quantisation terraces visibly into the lighting.
  const surfaceTarget = new WebGLRenderTarget(size, size / 2, {
    type: HalfFloatType,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    colorSpace: NoColorSpace,
  });

  for (const t of [albedoTarget, surfaceTarget]) {
    t.texture.wrapS = RepeatWrapping; // longitude wraps
    t.texture.wrapT = ClampToEdgeWrapping; // latitude does not
    t.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  const material = new ShaderMaterial({
    vertexShader: BAKE_VERT,
    fragmentShader: BAKE_FRAG,
    uniforms: {
      uPass: { value: 0 },
      uRelief: { value: SURFACE_RELIEF },
      uBasinRelief: { value: 0.30 },
      uMidRelief: { value: 0.115 },
      uSmallRelief: { value: 0.030 },
      uCoarseRelief: { value: 0.085 },
      uMediumRelief: { value: 0.026 },
      uStreakRelief: { value: 0.007 },
      // Named geology, same depth-to-width reasoning as the crater families.
      uRingRelief: { value: 0.06 },
      uRayRelief: { value: 0.02 },
      uFaultRelief: { value: 0.009 },
      ...Object.fromEntries(
        Object.entries(FEATURE_UNIFORMS).map(([k, v]) => [k, { value: v }])
      ),
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

  material.uniforms.uPass.value = 0;
  renderer.setRenderTarget(albedoTarget);
  renderer.render(scene, camera);

  material.uniforms.uPass.value = 1;
  renderer.setRenderTarget(surfaceTarget);
  renderer.render(scene, camera);

  renderer.setRenderTarget(previousTarget);

  quad.geometry.dispose();
  material.dispose();

  return {
    albedo: albedoTarget.texture,
    surface: surfaceTarget.texture,
    dispose: () => {
      albedoTarget.dispose();
      surfaceTarget.dispose();
    },
  };
}

/**
 * Per-renderer cache.
 *
 * React StrictMode mounts, tears down and remounts every component in
 * development. `useMemo` does not re-run across that, but effect cleanups do —
 * so baking in a memo and disposing in a cleanup destroys textures that are
 * still bound, and the bake then silently runs twice. (You can see it: the
 * renderer reports four textures in development and two in production.)
 *
 * These maps live exactly as long as the WebGL context does, so they are cached
 * against the renderer and never disposed by a component. Nothing leaks: when
 * the context goes, they go.
 */
const cache = new WeakMap<WebGLRenderer, PlanetMaps>();

export function getSurfaceMaps(renderer: WebGLRenderer): PlanetMaps {
  let maps = cache.get(renderer);
  if (!maps) {
    maps = bakeSurfaceMaps(renderer);
    cache.set(renderer, maps);
  }
  return maps;
}
