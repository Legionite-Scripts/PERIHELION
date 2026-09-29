/**
 * Linear light → display.
 *
 * Stage 1's starfield is authored directly in display space, which is fine for
 * additive points where "physically correct" means nothing. The planet is not:
 * its terminator falloff, its albedo and the scattering in its atmosphere are
 * all real light transport, and they have to be computed linearly and encoded
 * once at the end or the terminator rolls off wrongly.
 *
 * So the lit world runs through this and the sky does not. That inconsistency
 * is deliberate and temporary — Stage 8's composer will put the whole frame
 * through one grade and this chunk goes away.
 */
export const TONEMAP_GLSL = /* glsl */ `
vec3 toDisplay(vec3 c) {
  // A gentle shoulder. Not a film curve — just enough to stop the lit limb
  // clipping to flat white where the surface faces the star directly.
  c = c / (1.0 + c * 0.35);
  return pow(max(c, 0.0), vec3(1.0 / 2.2));
}
`;
