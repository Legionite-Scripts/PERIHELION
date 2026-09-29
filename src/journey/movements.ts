/**
 * The five movements of the flight, as the journey indicator names them.
 * Boundaries are the treatment's; they are wayfinding, not chapters — the film
 * never shows a seam between them.
 */
export const MOVEMENTS = [
  { numeral: "I", name: "Far field", at: 0 },
  { numeral: "II", name: "Ingress", at: 0.12 },
  { numeral: "III", name: "The fold", at: 0.42 },
  { numeral: "IV", name: "Egress", at: 0.62 },
  { numeral: "V", name: "Drift", at: 0.8 },
] as const;

/**
 * Slack at each boundary, in t. The scroll spring approaches a target
 * asymptotically, so arriving at a movement from the journey indicator leaves
 * t a hair short of its start — it should still count as having arrived.
 */
const ARRIVAL = 0.002;

/** Index of the movement containing journey position t. */
export function movementAt(t: number): number {
  let i = 0;
  while (i < MOVEMENTS.length - 1 && t >= MOVEMENTS[i + 1].at - ARRIVAL) i++;
  return i;
}
