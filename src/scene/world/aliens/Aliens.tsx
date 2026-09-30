"use client";

import { useMemo, useRef } from "react";
import {
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  CustomBlending,
  DstColorFactor,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  SrcColorFactor,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { useFrame } from "@react-three/fiber";
import { zoom } from "@/journey/zoom";
import { mulberry32 } from "@/lib/math";
import { EXPOSURE, SUN_COLOR, SUN_DIRECTION } from "@/scene/lighting";
import { NOISE3_GLSL } from "@/scene/shaders/noise3";
import { TONEMAP_GLSL } from "@/scene/shaders/tonemap";
import { PLANET_RADIUS } from "../planet/constants";

/**
 * Somebody lives here.
 *
 * A handful of figures on the surface, only resolvable through the telescope.
 * They stand where the zoom lands (zoom.focus, picked by the camera rig for a
 * low, sunlit view), which is honest to what a visitor can know: at 1× the
 * whole group is far below a pixel.
 *
 * Played straight, like a nature photograph: modelled anatomy rather than
 * toys, lit only by the planet's star with the same exposure and tone curve as
 * the ground, casting real shadows across it, standing on ground that has been
 * given the fine grit and stones the planet's own maps are too coarse to hold.
 *
 * Cheap by construction: everything is instanced, and the whole group is
 * hidden unless the lens is past 1.5×.
 */

/** Figure height range, world units. */
const SIZE_MIN = 0.1;
const SIZE_MAX = 0.13;
/** Radius of the ground patch given extra detail, world units. */
const GROUND = 0.55;
/** Lift above the true sphere: clears the planet mesh's facets. */
const LIFT = 0.0009;

// -----------------------------------------------------------------------------
// Anatomy. Each figure is 1 unit tall, feet at y = 0, facing +z.
// -----------------------------------------------------------------------------

type P = [number, number, number];

function limb(points: P[], radius: number, out: BufferGeometry[]) {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)));
  out.push(new TubeGeometry(curve, 10, radius, 7, false));
  // Rounded ends so the joints read as joints, not cut pipe.
  for (const p of [points[0], points[points.length - 1]]) {
    const cap = new SphereGeometry(radius, 7, 5);
    cap.translate(...p);
    out.push(cap);
  }
}

/** Three long fingers from the wrist, fanning slightly, along `dir`. */
function hand(wrist: P, dir: P, out: BufferGeometry[]) {
  const d = new Vector3(...dir).normalize();
  const side = new Vector3(1, 0, 0);
  for (const k of [-1, 0, 1]) {
    const tip = new Vector3(...wrist)
      .addScaledVector(d, 0.075)
      .addScaledVector(side, k * 0.012);
    const mid = new Vector3(...wrist)
      .addScaledVector(d, 0.04)
      .addScaledVector(side, k * 0.006);
    limb([wrist, mid.toArray() as P, tip.toArray() as P], 0.0055, out);
  }
}

type Pose = "stand" | "walk" | "point";

function figure(pose: Pose) {
  const skin: BufferGeometry[] = [];
  const eyes: BufferGeometry[] = [];

  // Torso: narrow pelvis, pinched waist, shallow chest, sloping shoulders.
  const torso = new LatheGeometry(
    [
      [0.0, 0.445],
      [0.06, 0.455],
      [0.072, 0.49],
      [0.058, 0.54],
      [0.054, 0.57],
      [0.07, 0.63],
      [0.078, 0.68],
      [0.07, 0.725],
      [0.04, 0.755],
      [0.0, 0.765],
    ].map(([r, y]) => new Vector2(r, y)),
    18
  );
  torso.scale(1, 1, 0.68);
  skin.push(torso);

  // Neck, and a head that is mostly cranium: wide dome, long tapering jaw.
  limb([[0, 0.745, 0], [0, 0.79, 0.006], [0, 0.815, 0.01]], 0.017, skin);
  const head = new LatheGeometry(
    [
      [0.0, 0.795],
      [0.014, 0.8],
      [0.032, 0.815],
      [0.05, 0.84],
      [0.068, 0.87],
      [0.082, 0.9],
      [0.088, 0.93],
      [0.084, 0.96],
      [0.068, 0.985],
      [0.04, 1.0],
      [0.0, 1.006],
    ].map(([r, y]) => new Vector2(r, y)),
    22
  );
  head.scale(1, 1, 1.12);
  head.translate(0, 0, 0.012);
  skin.push(head);

  // Large almond eyes, wrapped onto the face and tilted up at the outer edge.
  for (const s of [-1, 1]) {
    const eye = new SphereGeometry(1, 16, 12);
    eye.scale(0.032, 0.017, 0.014);
    eye.rotateZ(s * 0.42);
    eye.rotateY(s * 0.45);
    eye.translate(s * 0.036, 0.878, 0.076);
    eyes.push(eye);
  }

  // Legs: long, thin, knees soft.
  const leg = (s: number, knee: P, ankle: P, toe: P) => {
    limb([[s * 0.04, 0.47, 0], knee], 0.022, skin);
    limb([knee, ankle], 0.016, skin);
    limb([ankle, toe], 0.013, skin);
  };
  // Arms: long enough to hang past the hip.
  const arm = (s: number, elbow: P, wrist: P, fingers: P) => {
    limb([[s * 0.078, 0.715, 0], elbow], 0.014, skin);
    limb([elbow, wrist], 0.011, skin);
    hand(wrist, fingers, skin);
  };

  if (pose === "walk") {
    leg(1, [0.045, 0.26, 0.06], [0.045, 0.035, 0.02], [0.048, 0.01, 0.075]);
    leg(-1, [-0.045, 0.25, -0.035], [-0.048, 0.07, -0.12], [-0.05, 0.012, -0.075]);
    arm(1, [0.1, 0.56, -0.045], [0.105, 0.4, -0.06], [0.01, -1, -0.2]);
    arm(-1, [-0.1, 0.56, 0.04], [-0.1, 0.41, 0.08], [0, -1, 0.3]);
  } else {
    leg(1, [0.048, 0.25, 0.012], [0.048, 0.03, -0.004], [0.05, 0.008, 0.055]);
    leg(-1, [-0.048, 0.25, 0.012], [-0.048, 0.03, -0.004], [-0.05, 0.008, 0.055]);
    arm(-1, [-0.104, 0.55, -0.01], [-0.108, 0.39, 0.012], [0, -1, 0.1]);
    if (pose === "point") {
      // One arm raised to the sky: at us.
      arm(1, [0.12, 0.86, 0.05], [0.135, 1.0, 0.11], [0.08, 1, 0.45]);
    } else {
      arm(1, [0.104, 0.55, -0.01], [0.108, 0.39, 0.012], [0, -1, 0.1]);
    }
  }

  return { skin: mergeGeometries(skin), eyes: mergeGeometries(eyes) };
}

/** A small boulder: a lumpy, flattened icosahedron, 1 unit across. */
function boulder() {
  // Indexed, so the lumps shade smoothly rather than as facets.
  const g = mergeVertices(new IcosahedronGeometry(0.5, 3).deleteAttribute("uv").deleteAttribute("normal"));
  const pos = g.getAttribute("position");
  const rand = mulberry32(0xb01d);
  const v = new Vector3();
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Same displacement for vertices that share a position, or it cracks.
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    let k = seen.get(key);
    if (k === undefined) {
      k = 0.8 + rand() * 0.28 + 0.12 * Math.sin(v.x * 9 + v.z * 5);
      seen.set(key, k);
    }
    v.multiplyScalar(k);
    v.y = v.y * 0.62 + 0.14;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// -----------------------------------------------------------------------------
// Shading. Linear light, the planet's exposure and tone curve.
// -----------------------------------------------------------------------------

const BODY_VERT = /* glsl */ `
  attribute vec3 aTint;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vObj;
  varying vec3 vTint;
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vWorld = world.xyz;
    vObj = position;
    vTint = aTint;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const BODY_FRAG = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uExposure;
  uniform float uGloss;
  uniform float uSpec;
  uniform float uMottle;
  varying vec3 vNormal;
  varying vec3 vWorld;
  varying vec3 vObj;
  varying vec3 vTint;
  ${NOISE3_GLSL}
  ${TONEMAP_GLSL}
  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 L = uSunDir;
    vec3 up = normalize(vWorld);

    // Skin is never one flat colour: blotches and a finer grain.
    float m = fbm3(vObj * 18.0) * 0.7 + vnoise3(vObj * 90.0) * 0.3;
    vec3 albedo = vTint * mix(1.0, 0.72 + 0.5 * m, uMottle);

    // Wrapped diffuse: thin, translucent tissue lets light round the edge,
    // and what comes through is warmer.
    float ndl = dot(N, L);
    float wrap = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
    float direct = clamp(ndl, 0.0, 1.0);
    vec3 diffuse = albedo * mix(wrap, direct, 0.55);
    diffuse += albedo * vec3(0.5, 0.18, 0.1) * (wrap - direct) * 0.5;

    // Sheen: moist skin, glossy eyes.
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), uGloss) * uSpec * step(0.0, ndl);
    float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);

    // Light bounced up off the sunlit ground, and the faint night sky.
    float ground = max(dot(up, L), 0.0) * 0.07 * clamp(0.5 - 0.5 * dot(N, up), 0.0, 1.0);
    vec3 col = uSunColor * (diffuse + spec + fres * uSpec * 0.08 * direct)
             + albedo * (ground * vec3(0.9, 0.8, 0.7) + 0.004);

    gl_FragColor = vec4(toDisplay(col * uExposure * 1.3), 1.0);
  }
`;

/**
 * Shadows: each figure again, flattened onto its patch of ground along the
 * sun direction, multiplied into the frame. Depth-tested and depth-writing on
 * a single plane per figure, so where limbs overlap the shadow is not
 * darkened twice.
 */
const SHADOW_VERT = /* glsl */ `
  uniform vec3 uSunDir;
  varying float vFade;
  void main() {
    vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 n = normalize(origin);
    vec3 world = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
    float elev = dot(n, uSunDir);
    vFade = smoothstep(0.0, 0.08, elev);
    float h = dot(n, world - origin);
    world -= uSunDir * h / max(elev, 0.12);
    world += n * 0.0012;
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const SHADOW_FRAG = /* glsl */ `
  uniform float uStrength;
  varying float vFade;
  void main() {
    // Blending doubles: result = 2 · src · dst. 0.5 leaves the ground as it was.
    gl_FragColor = vec4(vec3(0.5 * (1.0 - uStrength * vFade)), 1.0);
  }
`;

/** Fine regolith and stones over the ground under the group. */
const GROUND_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const GROUND_FRAG = /* glsl */ `
  uniform vec3 uCentre;
  uniform vec3 uE1;
  uniform vec3 uE2;
  uniform vec3 uSunDir;
  uniform float uRadius;
  varying vec3 vWorld;
  ${NOISE3_GLSL}

  float height(vec2 p) {
    // Grit, gravel, and scattered stones (cells of a Worley field).
    float grit = vnoise3(vec3(p * 900.0, 1.0)) * 0.25 + vnoise3(vec3(p * 320.0, 2.0)) * 0.35;
    vec2 w = worley(vec3(p * 70.0, 3.0));
    float stone = smoothstep(0.42, 0.12, w.x) * step(0.55, hash13(vec3(floor(p * 70.0), 4.0)));
    float pebble = smoothstep(0.35, 0.1, worley(vec3(p * 190.0, 5.0)).x) * 0.6;
    float drift = fbm3(vec3(p * 12.0, 6.0));
    return grit * 0.3 + pebble * 0.5 + stone + drift * 0.4;
  }

  void main() {
    vec3 d = vWorld - uCentre;
    vec2 p = vec2(dot(d, uE1), dot(d, uE2));
    float r = length(p) / uRadius;
    float fade = 1.0 - smoothstep(0.55, 1.0, r);

    // Shade the relief by the sun, in the ground plane.
    float e = 0.0008;
    float h0 = height(p);
    vec2 grad = vec2(height(p + vec2(e, 0.0)) - h0, height(p + vec2(0.0, e)) - h0) / e;
    vec3 n = normalize(vWorld);
    vec2 sunFlat = vec2(dot(uSunDir, uE1), dot(uSunDir, uE2));
    float elev = max(dot(n, uSunDir), 0.02);
    float relief = clamp(-dot(grad, sunFlat) * 0.0022 / elev, -0.45, 0.45);
    float tone = (1.0 + relief) * (0.82 + 0.3 * h0);

    gl_FragColor = vec4(vec3(0.5 * mix(1.0, tone, fade)), 1.0);
  }
`;

const DOUBLE_MULTIPLY = {
  transparent: true,
  blending: CustomBlending,
  blendSrc: DstColorFactor,
  blendDst: SrcColorFactor,
} as const;

// -----------------------------------------------------------------------------

const POSES: Pose[] = ["stand", "walk", "point"];
/** How many of each pose. */
const MIX: Record<Pose, number> = { stand: 7, walk: 4, point: 2 };
const BOULDERS = 14;

interface Placement {
  u: number;
  v: number;
  size: number;
  /** Heading relative to facing the lens, radians. */
  turn: number;
  phase: number;
}

const _m = new Matrix4();
const _q = new Quaternion();
const _p = new Vector3();
const _g = new Vector3();
const _f = new Vector3();
const _x = new Vector3();
const _s = new Vector3();
const _n = new Vector3();
const _e1 = new Vector3();
const _e2 = new Vector3();
const _basis = new Matrix4();
const Y = new Vector3(0, 1, 0);

export function Aliens() {
  const group = useRef<Group>(null);
  const calm = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  const parts = useMemo(() => {
    const rand = mulberry32(0xa11e25);

    const bodyUniforms = () => ({
      uSunDir: { value: SUN_DIRECTION },
      uSunColor: { value: SUN_COLOR },
      uExposure: { value: EXPOSURE },
      uGloss: { value: 28 },
      uSpec: { value: 0.12 },
      uMottle: { value: 1 },
    });
    const skinMaterial = new ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: bodyUniforms(),
    });
    const eyeMaterial = new ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: { ...bodyUniforms(), uGloss: { value: 220 }, uSpec: { value: 2.4 }, uMottle: { value: 0 } },
    });
    const rockMaterial = new ShaderMaterial({
      vertexShader: BODY_VERT,
      fragmentShader: BODY_FRAG,
      uniforms: { ...bodyUniforms(), uGloss: { value: 8 }, uSpec: { value: 0.02 } },
    });
    const shadowMaterial = new ShaderMaterial({
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: { uSunDir: { value: SUN_DIRECTION }, uStrength: { value: 0.62 } },
      ...DOUBLE_MULTIPLY,
      depthWrite: true,
    });

    // Groups of two or three, as people stand, rather than an even scatter.
    const placements: Placement[] = [];
    const clusters = Array.from({ length: 5 }, () => {
      const a = rand() * Math.PI * 2;
      const r = 0.08 + rand() * 0.26;
      return [Math.cos(a) * r, Math.sin(a) * r];
    });
    const total = MIX.stand + MIX.walk + MIX.point;
    while (placements.length < total) {
      const [cu, cv] = clusters[placements.length % clusters.length];
      const u = cu + (rand() - 0.5) * 0.16;
      const v = cv + (rand() - 0.5) * 0.16;
      if (placements.some((q) => Math.hypot(q.u - u, q.v - v) < 0.05)) continue;
      placements.push({
        u,
        v,
        size: SIZE_MIN + rand() * (SIZE_MAX - SIZE_MIN),
        turn: (rand() - 0.5) * 2.2,
        phase: rand() * Math.PI * 2,
      });
    }

    // Skin tones: greys with a cast of olive, slate or clay.
    const casts = [new Color(0.19, 0.22, 0.16), new Color(0.16, 0.18, 0.22), new Color(0.23, 0.18, 0.15)];
    const tone = () =>
      new Color(0.2, 0.2, 0.19).lerp(casts[Math.floor(rand() * 3)], 0.4 + rand() * 0.6);

    let next = 0;
    const kinds = POSES.map((pose) => {
      const geo = figure(pose);
      const count = MIX[pose];
      const own = placements.slice(next, next + count);
      next += count;
      if (pose === "point") own.forEach((q) => (q.turn *= 0.15)); // they face us
      const tints = new Float32Array(count * 3);
      own.forEach((_, i) => tone().toArray(tints, i * 3));
      geo.skin.setAttribute("aTint", new InstancedBufferAttribute(tints, 3));
      const eyeTints = new Float32Array(count * 3).fill(0.012);
      geo.eyes.setAttribute("aTint", new InstancedBufferAttribute(eyeTints, 3));

      const skin = new InstancedMesh(geo.skin, skinMaterial, count);
      const eyes = new InstancedMesh(geo.eyes, eyeMaterial, count);
      const shadow = new InstancedMesh(geo.skin, shadowMaterial, count);
      // One set of transforms for body, eyes and shadow.
      eyes.instanceMatrix = skin.instanceMatrix;
      shadow.instanceMatrix = skin.instanceMatrix;
      shadow.renderOrder = 1;
      return { pose, own, skin, eyes, shadow };
    });

    // Boulders for scale, the same basalt as the planet.
    const rocks: Placement[] = Array.from({ length: BOULDERS }, () => {
      const a = rand() * Math.PI * 2;
      const r = 0.06 + Math.sqrt(rand()) * 0.36;
      return {
        u: Math.cos(a) * r,
        v: Math.sin(a) * r,
        size: 0.012 + Math.pow(rand(), 2.5) * 0.06,
        turn: rand() * Math.PI * 2,
        phase: 0,
      };
    });
    const rockGeo = boulder();
    // The body shader runs a little brighter than the planet; this matches its basalt.
    const rockTints = new Float32Array(BOULDERS * 3).fill(0.055);
    rockGeo.setAttribute("aTint", new InstancedBufferAttribute(rockTints, 3));
    const boulders = new InstancedMesh(rockGeo, rockMaterial, BOULDERS);
    const boulderShadows = new InstancedMesh(rockGeo, shadowMaterial, BOULDERS);
    boulderShadows.instanceMatrix = boulders.instanceMatrix;
    boulderShadows.renderOrder = 1;

    // The ground: a cap of the sphere, pole up, just above the planet.
    const groundMaterial = new ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      uniforms: {
        uCentre: { value: new Vector3() },
        uE1: { value: new Vector3() },
        uE2: { value: new Vector3() },
        uSunDir: { value: SUN_DIRECTION },
        uRadius: { value: GROUND },
      },
      ...DOUBLE_MULTIPLY,
      depthWrite: false,
    });
    const ground = new Mesh(
      new SphereGeometry(PLANET_RADIUS + LIFT * 0.5, 96, 24, 0, Math.PI * 2, 0, GROUND / PLANET_RADIUS),
      groundMaterial
    );
    ground.renderOrder = 0.5;

    for (const mesh of [...kinds.flatMap((k) => [k.skin, k.eyes, k.shadow]), boulders, boulderShadows]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
    }
    ground.frustumCulled = false;

    return { kinds, rocks, boulders, boulderShadows, ground, groundMaterial };
  }, []);

  useFrame(({ camera, clock }) => {
    const g = group.current;
    if (!g) return;
    const show = zoom.focused && zoom.level > 1.5;
    g.visible = show;
    if (!show) return;

    const { kinds, rocks, boulders, ground, groundMaterial } = parts;
    const time = clock.elapsedTime;

    // The ground frame at the focus: n up, e1/e2 across it.
    const n = _n.copy(zoom.focus).normalize();
    const e1 = _e1.set(0, 1, 0).cross(n);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0);
    e1.normalize();
    const e2 = _e2.crossVectors(n, e1);

    const onGround = (u: number, v: number, out: Vector3) =>
      out
        .copy(n)
        .multiplyScalar(PLANET_RADIUS)
        .addScaledVector(e1, u)
        .addScaledVector(e2, v)
        .normalize()
        .multiplyScalar(PLANET_RADIUS + LIFT);

    /** Upright on the ground at (u, v), turned `turn` from facing the lens. */
    const stand = (mesh: InstancedMesh, i: number, q: Placement, scaleY = 1) => {
      onGround(q.u, q.v, _p);
      const up = _g.copy(_p).normalize();
      _f.subVectors(camera.position, _p);
      _f.addScaledVector(up, -_f.dot(up));
      if (_f.lengthSq() < 1e-12) _f.copy(e1);
      _f.normalize().applyAxisAngle(up, q.turn);
      _x.crossVectors(up, _f);
      _basis.makeBasis(_x, up, _f);
      _q.setFromRotationMatrix(_basis);
      _m.compose(_p, _q, _s.set(q.size, q.size * scaleY, q.size));
      mesh.setMatrixAt(i, _m);
    };

    for (const k of kinds) {
      k.own.forEach((q, i) => {
        // Breathing, barely: a figure held perfectly still reads as a statue.
        const breathe = calm ? 1 : 1 + 0.006 * Math.sin(time * 1.3 + q.phase);
        stand(k.skin, i, q, breathe);
      });
      k.skin.instanceMatrix.needsUpdate = true;
    }
    rocks.forEach((q, i) => stand(boulders, i, q));
    boulders.instanceMatrix.needsUpdate = true;

    onGround(0, 0, _p);
    ground.quaternion.setFromUnitVectors(Y, n);
    groundMaterial.uniforms.uCentre.value.copy(_p);
    groundMaterial.uniforms.uE1.value.copy(e1);
    groundMaterial.uniforms.uE2.value.copy(e2);
  });

  return (
    <group ref={group} visible={false}>
      <primitive object={parts.ground} />
      <primitive object={parts.boulders} />
      <primitive object={parts.boulderShadows} />
      {parts.kinds.map((k) => (
        <group key={k.pose}>
          <primitive object={k.skin} />
          <primitive object={k.eyes} />
          <primitive object={k.shadow} />
        </group>
      ))}
    </group>
  );
}
