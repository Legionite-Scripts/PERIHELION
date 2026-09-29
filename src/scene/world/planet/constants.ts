/**
 * Planet scale — derived from the approved trajectory, not chosen to taste.
 *
 * Periapsis is fixed at 13 world units by Stage 1. Given a planet radius R, the
 * angular radius of the disc at distance r is asin(R/r), and the camera's
 * vertical field of view is 38°, so half the frame is 19° and half the frame
 * width (16:9) is ~31.5°.
 *
 * R = 7 gives:
 *
 *   t      r      angular radius   reads as
 *   0.00   900    0.45°            a disc ~20px tall. present, barely.
 *   0.12   604    0.66°            beginning to be a thing with an edge
 *   0.25   107    3.7°             unmistakably a world, 20% of frame height
 *   0.42   15.2   27.4°            enormous. exceeds the frame vertically.
 *   0.52   13     32.6°            just past the frame horizontally too
 *   0.62   15.8   26.3°            receding
 *   0.80   180    2.2°             space has taken the frame back
 *   1.00   900    0.45°            gone
 *
 * The important property is at periapsis: at 32.6° the limb sits just outside
 * the frame edge, so the world fills the view — but because the camera aims
 * ~16° off the planet's centre, open sky is always left in one corner. That
 * corner is where Stage 5's lensed starfield has to happen. A larger planet
 * would fill the frame completely and leave the gravitational lens nothing to
 * bend.
 *
 * Periapsis sits at 1.86 R — a close flyby, above any atmosphere.
 */
export const PLANET_RADIUS = 7.0;

/**
 * Top of the atmosphere, as a multiple of the planet radius.
 *
 * 2.2% — thin, and close to Earth's visible limb (~1.5%). A "thin dusty
 * atmosphere" means this shell is nearly invisible except edge-on, which is
 * exactly the brief. It also means the atmosphere disappears on its own at
 * distance: at t = 0 the shell is 2% of a 20px disc, well under a pixel. No
 * fade needs to be authored; the geometry does it.
 */
export const ATMOSPHERE_SCALE = 1.022;

export const ATMOSPHERE_RADIUS = PLANET_RADIUS * ATMOSPHERE_SCALE;

/**
 * Surface map resolution, equirectangular.
 *
 * 2048 across 360° of longitude puts ~1024 texels across the visible hemisphere
 * at closest approach, against ~1600 screen pixels — slightly under-sampled,
 * which on a low-contrast basalt surface reads as softness rather than blur.
 * Deliberately not pushed higher: this is a placeholder, and the real maps are
 * a Higgsfield decision, not a bake-time one.
 */
export const SURFACE_MAP_SIZE = 2048;

/**
 * Global trim on surface relief. The real amplitudes are per-feature-family and
 * live in the bake; this is the single dial for "more geology" / "less".
 * 1.0 = the physically-reasoned values.
 */
export const SURFACE_RELIEF = 1.0;

/** Geometry resolution. Silhouette error at periapsis is ~0.1px. */
export const SPHERE_SEGMENTS = 256;
