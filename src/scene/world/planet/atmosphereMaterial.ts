import { AdditiveBlending, FrontSide, ShaderMaterial, Vector3 } from "three";
import { EXPOSURE, SUN_COLOR, SUN_DIRECTION } from "@/scene/lighting";
import { TONEMAP_GLSL } from "@/scene/shaders/tonemap";
import { ATMOSPHERE_RADIUS, PLANET_RADIUS } from "./constants";

/**
 * A thin dusty atmosphere, by single-scattering integration.
 *
 * Not a Fresnel rim. A Fresnel term is a function of the angle between the
 * normal and the eye, which means it draws an even outline around the whole
 * silhouette regardless of where the light is — the giveaway of every glowing
 * planet on the internet. This instead marches the actual view ray through the
 * shell and accumulates what a dust particle at each point would scatter toward
 * the camera. That gets three things right for free:
 *
 *   • the glow is brightest where the ray grazes the surface, because that is
 *     where the path through the air is longest;
 *   • it is brightest on the lit side and dies at the terminator, because the
 *     particles there are in the planet's shadow;
 *   • it goes warm at the terminator, because light reaching that air has
 *     travelled the longest path through dust and lost its short wavelengths.
 *
 * And because the shell is only 2.2% thicker than the planet, it vanishes on
 * its own at distance. No fade is authored anywhere.
 */

const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform float uRp;          // planet radius
  uniform float uRa;          // top of atmosphere
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform vec3  uDustColor;   // Mie — warm, the dominant term in thin dust
  uniform vec3  uAirColor;    // Rayleigh — cool, what little there is of it
  uniform vec3  uTwilight;    // colour of sunlight that has grazed the limb
  uniform float uDensityFalloff;
  uniform float uMie;
  uniform float uRayleigh;
  uniform float uIntensity;
  uniform float uExposure;

  varying vec3 vWorldPos;

  ${TONEMAP_GLSL}

  const float PI = 3.141592653589793;
  const int STEPS = 8;

  /** vec2(tNear, tFar); x > y means no intersection. */
  vec2 raySphere(vec3 ro, vec3 rd, float r) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    if (h < 0.0) return vec2(1.0, -1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  float henyeyGreenstein(float cosT, float g) {
    float g2 = g * g;
    return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosT, 1.5));
  }

  void main() {
    vec3 ro = cameraPosition;
    vec3 rd = normalize(vWorldPos - ro);

    vec2 atmo = raySphere(ro, rd, uRa);
    if (atmo.x > atmo.y) discard;

    float t0 = max(atmo.x, 0.0);
    float t1 = atmo.y;

    // Stop at the ground. This is what makes the shell correctly disappear
    // behind the planet instead of haloing over it.
    vec2 ground = raySphere(ro, rd, uRp);
    if (ground.x <= ground.y && ground.x > 0.0) t1 = min(t1, ground.x);
    if (t1 <= t0) discard;

    // Scattering angle: 1 when looking straight into the light, which is the
    // backlit crescent — where a dusty atmosphere is at its most spectacular.
    float cosTheta = dot(rd, uSunDir);
    float mie = henyeyGreenstein(cosTheta, 0.65) * uMie;
    float rayleigh = (3.0 / (16.0 * PI)) * (1.0 + cosTheta * cosTheta) * uRayleigh;

    float segment = (t1 - t0) / float(STEPS);
    vec3 accum = vec3(0.0);

    for (int i = 0; i < STEPS; i++) {
      vec3 p = ro + rd * (t0 + segment * (float(i) + 0.5));
      float r = length(p);

      float altitude = clamp((r - uRp) / (uRa - uRp), 0.0, 1.0);
      float density = exp(-altitude * uDensityFalloff);

      // Is this parcel of air in sunlight? Softened, because the planet's
      // shadow has a penumbra and because air just past the terminator is
      // still lit from above.
      float sunN = dot(p / r, uSunDir);
      float sunlit = smoothstep(-0.28, 0.10, sunN);

      // Light that reaches the terminator has come the long way through dust
      // and arrives reddened. This is where the warm arc comes from — it is
      // the illumination, not a decorative line on the edge.
      vec3 incoming = mix(uTwilight, uSunColor, smoothstep(0.0, 0.48, sunN));

      accum += (uDustColor * mie + uAirColor * rayleigh)
             * density * sunlit * incoming * segment;
    }

    gl_FragColor = vec4(toDisplay(accum * uIntensity * uExposure), 1.0);
  }
`;

export function createAtmosphereMaterial() {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uRp: { value: PLANET_RADIUS },
      uRa: { value: ATMOSPHERE_RADIUS },
      uSunDir: { value: SUN_DIRECTION.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
      // Suspended dust: warm, low chroma.
      uDustColor: { value: new Vector3(0.80, 0.71, 0.62) },
      // The treatment's cool tone. There is very little air to do this.
      uAirColor: { value: new Vector3(0.43, 0.545, 0.66) },
      // Sunlight that has grazed the limb: the treatment's warm.
      uTwilight: { value: new Vector3(0.78, 0.53, 0.35) },
      uDensityFalloff: { value: 6.5 },
      uMie: { value: 0.40 },
      uRayleigh: { value: 0.22 },
      uIntensity: { value: 1.15 },
      uExposure: { value: EXPOSURE },
    },
    side: FrontSide,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
}
