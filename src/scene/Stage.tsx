"use client";

import { Canvas } from "@react-three/fiber";
import { Driver } from "./Driver";
import { CameraRig } from "./rig/CameraRig";
import { Starfield } from "./world/Starfield";
import { GalacticBand } from "./world/GalacticBand";
import { Motes } from "./world/Motes";
import { Planet } from "./world/planet/Planet";
import { GravityLens } from "./gravity/GravityLens";
import { UiDriver } from "./UiDriver";
import { MolecularCloud } from "./world/cloud/MolecularCloud";
import { SceneLine } from "./type/SceneLine";
import { Star } from "./world/Star";
import { FilmGrain } from "./grade/FilmGrain";
import { exposeDevHandles } from "@/dev/handles";

/**
 * One Canvas for the entire site. It mounts once and never unmounts — there are
 * no per-section scenes, because there are no sections.
 *
 * Render order matters and is explicit:
 *
 *   -20  galactic band   background at infinity, no depth
 *   -10  starfield       no depth, drawn before anything solid
 *    -5  molecular cloud premultiplied "over", depth-tested — dims the sky
 *                         behind it, hidden by the planet (t > 0.66 only)
 *    -4  young stars     additive, depth-tested, inside the cloud (t > 0.66 only)
 *    -3  scene line      one narrative line hung behind the planet, which
 *                         eclipses it by depth (t 0.17–0.28 only)
 *    -2  star            the light source, at infinity; additive, depth-tested,
 *                         frustum-culled — in shot only during the ingress glance
 *     0  planet          opaque, writes depth — occludes both of the above
 *     1  atmosphere      additive, depth-tested against the planet
 *     2  dust motes      additive, depth-tested — passes in front of the world
 *     2  cloud grains    the same, inside the molecular cloud (t > 0.66 only)
 *  1000  film grain      one full-screen triangle, screen-blended, last
 *
 * Gravity adds no pass of its own: GravityLens updates shared uniforms that
 * the band and the starfield bend themselves by (see gravity/lens.ts).
 */
export function Stage() {
  return (
    <div className="stage">
      <Canvas
        dpr={[1, 1.75]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
          // Nothing in the scene is translucent over the page, and a clean
          // opaque buffer keeps the blacks genuinely black.
          stencil: false,
          depth: true,
        }}
        camera={{ fov: 38, near: 0.5, far: 9000, position: [0, 0, 900] }}
        onCreated={(state) => {
          state.gl.setClearColor(0x000000, 1);
          // Deleted outright from production builds — see dev/handles.
          if (process.env.NODE_ENV !== "production") {
            exposeDevHandles({
              __perihelionGL: state.gl,
              __perihelionCamera: state.camera,
              __perihelionScene: state.scene,
            });
          }
        }}
      >
        <Driver />
        <CameraRig />
        <UiDriver />
        <GravityLens />

        <GalacticBand />
        <Starfield />
        <MolecularCloud />
        <SceneLine />
        <Star />
        <FilmGrain />
        <Planet />
        <Motes />
      </Canvas>
    </div>
  );
}
