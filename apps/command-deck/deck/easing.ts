/**
 * The deck's one easing curve.
 *
 * Every camera flight and every counter tween in the deck eases through the
 * same cubic, so the enterprise fly-to, the process director's opening move,
 * the code city's fly-over and a rolling number all start and settle without a
 * visible cut at either end.
 */

/**
 * Cubic ease in and out over the unit interval.
 * @param t - Progress, clamped by the caller to `0..1`.
 * @returns The eased progress, at zero velocity at both ends.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2
}
