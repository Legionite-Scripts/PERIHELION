/**
 * The narrative — first draft, approved for implementation, not yet final.
 *
 * One beat at a time. Each is shown over a window of journey t and placed
 * where the frame leaves room at that moment. The words answer what the image
 * cannot: scale, distance, what is hidden in the dark. They never describe
 * what is already visible.
 *
 * The figures are the model's own, at real scale (planet radius 7 units =
 * 1.8 Earth radii, so 1 unit ≈ 1,638 km):
 *   · 1.47 million km out at t = 0, 1.07 million by t = 0.11
 *   · closest approach 21,300 km from the centre — 9,830 km above the surface
 *   · the path turns through 77.3° between arrival and departure
 *     (2·asin(1/e) = 77.4° for the full hyperbola, e = 1.6)
 *   · e > 1: the orbit is open, and never returns
 */

export type BeatPlace =
  | "lower-left"
  | "right"
  | "mid-left"
  | "top-left"
  | "top-right"
  | "lower-right"
  | "upper-left"
  | "centre";

export interface Beat {
  /** Journey t the beat starts fading in, and finishes fading out. */
  from: number;
  to: number;
  line: string;
  /** Optional scientific label above the line. */
  label?: string;
  place: BeatPlace;
  /** The last beat stays: the film ends on it rather than fading it out. */
  holds?: boolean;
  /**
   * Set inside the 3D scene instead of over it (scene/type/SceneLine.tsx), so
   * the planet can pass in front of it. The DOM copy stays for screen readers.
   */
  inScene?: boolean;
}

export const SCRIPT: Beat[] = [
  {
    from: 0.05,
    to: 0.11,
    line: "A million and a half kilometres out, it is barely a shape.",
    place: "lower-left",
  },
  {
    from: 0.17,
    to: 0.28,
    line: "We come in over the night side.",
    place: "right",
    // Written into the sky just beside the planet: as we close in, the night
    // side grows across it and swallows the first words.
    inScene: true,
  },
  {
    from: 0.36,
    to: 0.45,
    line: "Everything dark in front of you is the planet.",
    place: "mid-left",
  },
  {
    from: 0.48,
    to: 0.56,
    // Non-breaking space: a figure never wraps away from its unit.
    label: "Closest approach · 9,800\u00a0km above the surface",
    line: "Its gravity turns our path through seventy-seven degrees.",
    // The lit, cratered surface fills the left of this frame; the open,
    // dark side is on the right.
    place: "top-right",
  },
  {
    from: 0.6,
    to: 0.67,
    line: "The day side comes round.",
    place: "lower-right",
  },
  {
    from: 0.72,
    to: 0.8,
    line: "Behind it, all along: a cloud of cold dust.",
    place: "lower-left",
  },
  {
    from: 0.86,
    to: 0.94,
    label: "Molecular cloud · Star-forming region",
    line: "Stars form here, slowly, out of the dark.",
    place: "upper-left",
  },
  {
    from: 0.97,
    to: 1.0,
    // Two sentences, two lines: `\n` renders as a line break (pre-line).
    line: "The orbit does not close.\nWe will not pass this way again.",
    place: "centre",
    holds: true,
  },
];
