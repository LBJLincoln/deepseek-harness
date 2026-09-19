/**
 * Where an anchored label is allowed to sit.
 *
 * Labels are portaled beside the canvas, not inside it, so nothing clips them:
 * a division at the edge of the orbit would otherwise print its name over the
 * header or over the detail panel. An anchor that has left the frame takes its
 * label off the stage entirely rather than sliding it to the nearest edge,
 * which would stack every off-screen name along the same border.
 */

import { Vector3, type Camera, type Object3D } from 'three'

/** Clear space kept between a label and the edge of the stage, in pixels. */
const MARGIN = 14

/** Where a label whose anchor has left the frame is parked. */
const OFF_STAGE = [-10_000, -10_000]

const PROJECTED = new Vector3()

/**
 * Project a label anchor and hold the result inside the stage.
 * @param halfWidth - Half the label's width, in pixels; the label is centred on the result.
 * @param halfHeight - Half the label's height, in pixels.
 * @returns A `calculatePosition` for drei's `Html`.
 */
export function stageClamped(
  halfWidth: number,
  halfHeight: number,
): (el: Object3D, camera: Camera, size: { width: number; height: number }) => number[] {
  return (el, camera, size) => {
    PROJECTED.setFromMatrixPosition(el.matrixWorld).project(camera)
    if (Math.abs(PROJECTED.x) > 1 || Math.abs(PROJECTED.y) > 1) return OFF_STAGE
    const x = (PROJECTED.x * size.width * 0.5) + (size.width * 0.5)
    const y = (-PROJECTED.y * size.height * 0.5) + (size.height * 0.5)
    return [
      Math.min(Math.max(x, halfWidth + MARGIN), Math.max(halfWidth + MARGIN, size.width - halfWidth - MARGIN)),
      Math.min(Math.max(y, halfHeight + MARGIN), Math.max(halfHeight + MARGIN, size.height - halfHeight - MARGIN)),
    ]
  }
}
