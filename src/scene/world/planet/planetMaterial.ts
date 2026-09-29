import { ShaderMaterial, Texture, Vector2, Vector3 } from "three";
import { EXPOSURE, SUN_COLOR, SUN_DIRECTION, SUN_INTENSITY } from "@/scene/lighting";
import { TONEMAP_GLSL } from "@/scene/shaders/tonemap";
import { PLANET_RADIUS, SURFACE_MAP_SIZE } from "./constants";
import type { PlanetMaps } from "./surfaceBake";

/**
 * The planet surface.
 *
 * A custom shader rather than MeshStandardMaterial, for three reasons that all
 * matter to the look: the terminator needs to be shaped deliberately, the
 * diffuse needs to be Oren–Nayar rather than Lambert because basalt regolith is
 * extremely rough, and the whole thing has to resolve in linear light and be
 * encoded once at the end.
 *
 * It reads exactly two textures. What produced them is not its business.
 */

const VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uAlbedoMap;
  uniform sampler2D uSurfaceMap;   // r = height (world units), g = roughness, b = ao
  uniform vec2  uTexel;
  uniform float uRadius;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uSunIntensity;
  uniform float uNormalStrength;
  uniform float uNightLevel;
  uniform float uExposure;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec2 vUv;

  ${TONEMAP_GLSL}

  const float PI = 3.141592653589793;

  /**
   * Surface normal from the height field.
   *
   * Done analytically in texture space rather than with screen-space
   * derivatives: stable at grazing angles, correct under mipmapping, and — the
   * point — identical in form to what a real Higgsfield height map will need.
   * The sphere's tangent frame is analytic, so no tangent attribute is required
   * on the geometry.
   */
  vec3 perturbedNormal(vec3 N, vec2 uv) {
    float theta = (1.0 - uv.y) * PI;
    float phi = uv.x * 2.0 * PI;
    float sinTheta = max(sin(theta), 0.03);   // clamped: the poles are singular

    float hL = texture2D(uSurfaceMap, uv - vec2(uTexel.x, 0.0)).r;
    float hR = texture2D(uSurfaceMap, uv + vec2(uTexel.x, 0.0)).r;
    float hD = texture2D(uSurfaceMap, uv - vec2(0.0, uTexel.y)).r;
    float hU = texture2D(uSurfaceMap, uv + vec2(0.0, uTexel.y)).r;

    // Arc length per unit uv, so the gradient is a true slope and the bump
    // never exaggerates itself near the poles.
    float dEast  = (hR - hL) / (2.0 * uTexel.x * uRadius * 2.0 * PI * sinTheta);
    float dNorth = (hU - hD) / (2.0 * uTexel.y * uRadius * PI);

    vec3 east  = vec3(sin(phi), 0.0, cos(phi));
    vec3 north = vec3(cos(phi) * cos(theta), sin(theta), -sin(phi) * cos(theta));

    return normalize(N - (east * dEast + north * dNorth) * uNormalStrength);
  }

  /**
   * Oren–Nayar. Lambert is wrong here: a rough regolith scatters much more
   * light back toward the viewer at grazing incidence, which flattens the
   * falloff and widens the terminator. It is most of why the Moon reads as a
   * disc rather than a ball, and it is the single biggest difference between
   * this and a default lit sphere.
   */
  float orenNayar(vec3 N, vec3 V, vec3 L, float roughness) {
    float s2 = roughness * roughness;
    float A = 1.0 - 0.5 * s2 / (s2 + 0.33);
    float B = 0.45 * s2 / (s2 + 0.09);

    float NdotL = dot(N, L);
    float NdotV = dot(N, V);
    if (NdotL <= 0.0) return 0.0;

    float thetaI = acos(clamp(NdotL, -1.0, 1.0));
    float thetaR = acos(clamp(NdotV, -1.0, 1.0));
    float alpha = max(thetaI, thetaR);
    float beta  = min(thetaI, thetaR);

    vec3 Lp = normalize(L - N * NdotL);
    vec3 Vp = normalize(V - N * NdotV);
    float cosPhi = max(dot(Lp, Vp), 0.0);

    // The qualitative model's sin(alpha)·tan(beta) term is unbounded: when both
    // the light and the eye graze — which is most of a planet's limb — tan runs
    // away and the surface returns several times the light falling on it. Left
    // unclamped this turns dark basalt into pale concrete. Clamped to 1, peak
    // response is A + B ≈ 1.05, which is physical.
    float t = min(sin(alpha) * tan(min(beta, 1.40)), 1.0);
    return NdotL * (A + B * cosPhi * t);
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 L = uSunDir;

    vec3 albedo = texture2D(uAlbedoMap, vUv).rgb;
    vec3 surf = texture2D(uSurfaceMap, vUv).rgb;
    float roughness = surf.g;
    float ao = surf.b;

    vec3 Nb = perturbedNormal(N, vUv);

    // The geometric terminator is softened very slightly — sub-texel relief and
    // the first scale height of dust both blur it. Small: a rocky world's
    // terminator is nearly sharp, and over-softening it is what makes planets
    // look like billiard balls wrapped in gauze.
    //
    // And it is ragged. Ground standing above the mean surface sees past the
    // geometric horizon — by the dip angle, √(2h/R) — so crater rims and scarps
    // facing the star stay lit a few degrees into the night, as isolated
    // points of light beyond the line. Only relief that actually faces the star
    // (the Oren–Nayar term below uses the bumped normal) catches it; flat high
    // ground stays dark. It is the view from low orbit, and the one thing on
    // the planet that only closest approach can show.
    // The baked height is a 2048-texel average: rims and peaks stand well
    // above their texel's mean, so the map's own value understates how far
    // they see. Twice it is a fair reconstruction of the crest.
    float h = max(surf.r, 0.0) * 2.0;
    float dip = sqrt(2.0 * h / uRadius);
    float gate = smoothstep(-0.055, 0.105, dot(N, L) + dip);

    float diffuse = orenNayar(Nb, V, L, roughness) * gate;

    vec3 lit = albedo * uSunColor * uSunIntensity * diffuse * ao;

    // Planetary night. Not ambient fill — this is the light of the rest of the
    // sky, and it is almost nothing. Enough that the dark limb separates from
    // space by a hair, and no more.
    vec3 night = albedo * uNightLevel * ao;

    gl_FragColor = vec4(toDisplay((lit + night) * uExposure), 1.0);
  }
`;

export function createPlanetMaterial(maps: PlanetMaps) {
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uAlbedoMap: { value: maps.albedo as Texture },
      uSurfaceMap: { value: maps.surface as Texture },
      uTexel: { value: new Vector2(1 / SURFACE_MAP_SIZE, 2 / SURFACE_MAP_SIZE) },
      uRadius: { value: PLANET_RADIUS },
      uSunDir: { value: SUN_DIRECTION.clone() },
      uSunColor: { value: SUN_COLOR.clone() },
      uSunIntensity: { value: SUN_INTENSITY },
      uNormalStrength: { value: 1.0 },
      uNightLevel: { value: 0.0007 },
      uExposure: { value: EXPOSURE },
    },
  });
}

export type PlanetMaterial = ReturnType<typeof createPlanetMaterial>;

/** Kept for the console while art-directing. */
export const _sunDirection = new Vector3().copy(SUN_DIRECTION);
