import { Vector3 } from "three";

/**
 * The light in PERIHELION.
 *
 * There is exactly one: a cool orange dwarf, effectively at infinity. No fill,
 * no rim, no ambient, no environment map. Every lit surface in the scene reads
 * from this one direction, which is what keeps the frame reading as a real
 * place rather than a studio.
 *
 * SUN_DIRECTION points FROM the planet TOWARD the star.
 *
 * The specific direction is not arbitrary. It was solved against the approved
 * trajectory so that the illuminated fraction of the planet evolves the way the
 * treatment describes, purely as a consequence of the camera's flight:
 *
 *   t = 0.00   15% lit   a thin crescent, very far away
 *   t = 0.25   10% lit   a dark mass with a blade of light on its edge
 *   t = 0.42   22% lit   enormous, still mostly night
 *   t = 0.52   50% lit   the terminator runs straight down the encounter
 *   t = 0.62   81% lit   the slingshot swings the day side into view
 *   t = 1.00   85% lit   receding, finally revealed, and now tiny
 *
 * The world stays hidden through the entire approach and is only disclosed by
 * the encounter itself. That arc is free — it falls out of the orbit. Change
 * this vector and you re-edit the film.
 */
export const SUN_DIRECTION = new Vector3(-0.567, 0.233, 0.79).normalize();

/**
 * ~4200K. Warm, but nowhere near the saturated orange that reads as sci-fi —
 * it behaves like white light of a different colour rather than an orange gel.
 *
 * Deliberately pulled back from where a literal 4000K blackbody sits. The
 * treatment asks for the warmth to arrive through atmospheric scattering rather
 * than as a tint on the rock, so the direct light is kept close to neutral and
 * the orange is left to the twilight term in the atmosphere, where it is
 * physically produced by the long path through dust.
 */
export const SUN_COLOR = new Vector3(1.0, 0.86, 0.74);

/** Irradiance at the planet. One, by definition — everything else is relative. */
export const SUN_INTENSITY = 1.0;

/**
 * Exposure.
 *
 * Basalt has an albedo around 0.07, and rendered at unit exposure that is a
 * perfectly correct pale grey — the Moon photographs light grey for exactly
 * this reason. Correct, and wrong for this film: the treatment is built on deep
 * blacks and a world that stays mysterious.
 *
 * So the fix is the one a cinematographer would use — stop down — rather than
 * lying about the albedo. It is one number, it is honest about what it is doing,
 * and when Stage 8's grade takes over exposure globally this is what it replaces.
 */
export const EXPOSURE = 0.42;
