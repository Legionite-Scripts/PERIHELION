/**
 * 3D value noise and Worley cellular noise.
 *
 * Used only by the one-time surface bake, never per frame, so these are written
 * for clarity over speed.
 */
export const NOISE3_GLSL = /* glsl */ `
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

// Sin-free. The small-crater octave samples coordinates in the hundreds, and
// sin(dot(p, large)) loses all its entropy there — it degenerates into visible
// banding rather than noise.
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

float vnoise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i);
  float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float fbm3(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise3(p); p *= 2.07; a *= 0.5; }
  return s;
}

float fbm3_low(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise3(p); p *= 2.11; a *= 0.5; }
  return s;
}

/** x = distance to the nearest feature point, y = a random id for that cell. */
vec2 worley(vec3 p) {
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float best = 8.0;
  float id = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash33(ip + g);
    float d = length(g + o - fp);
    if (d < best) { best = d; id = fract(o.x * 37.13 + o.y * 17.71 + o.z * 7.37); }
  }
  return vec2(best, id);
}
`;
