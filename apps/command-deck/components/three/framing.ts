/**
 * Keeping a subject in frame whatever the stage's shape.
 *
 * A camera distance is designed on one stage, and a stage narrower than that
 * one crops a wide subject at its sides: the enterprise graph and the code
 * city on a phone held upright, the pipeline on a laptop's square stage. Each
 * view states its subject's half-width and half-height; the camera stands back
 * by as much as the narrower stage needs, and never closer than designed.
 */

/**
 * The stage's aspect, width over height, with the panel open on a 1600×900
 * screen: the stage every designed camera distance in the deck was tuned on.
 */
export const DESIGN_ASPECT = 1.47

/**
 * The reach that decides a framing at one aspect: the subject's half-height,
 * or its half-width divided by the aspect, whichever needs the camera further
 * back. The workflow view frames its growing graph by this reach directly.
 * @param halfWidth - Half the subject's width, in scene units.
 * @param halfHeight - Half the subject's height, in scene units.
 * @param aspect - The stage's width over its height.
 * @returns The reach, in scene units.
 */
export function framingReach(halfWidth: number, halfHeight: number, aspect: number): number {
  return Math.max(halfHeight, halfWidth / (aspect > 0 ? aspect : 1))
}

/**
 * How much further back than its designed distance a camera must stand on
 * this stage to keep the same subject in frame.
 * @param halfWidth - Half the subject's width, in scene units.
 * @param halfHeight - Half the subject's height, in scene units.
 * @param aspect - The stage's width over its height.
 * @returns `1` on the design stage or a wider one; more on a narrower stage.
 */
export function aspectStretch(halfWidth: number, halfHeight: number, aspect: number): number {
  return Math.max(1, framingReach(halfWidth, halfHeight, aspect) / framingReach(halfWidth, halfHeight, DESIGN_ASPECT))
}
