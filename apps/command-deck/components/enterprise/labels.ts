/**
 * Where an anchored label is allowed to sit.
 *
 * Labels are portaled beside the canvas, not inside it, so nothing clips them:
 * a division at the edge of the orbit would otherwise print its name over the
 * header or over the detail panel. An anchor that has left the frame takes its
 * label off the stage entirely rather than sliding it to the nearest edge,
 * which would stack every off-screen name along the same border.
 *
 * Labels that share a {@link LabelField} also keep clear of each other and of
 * the stage's own copy, the title block, the hint or a ticker drawn over the
 * canvas: each one takes the first of a few nearby spots that overlaps least,
 * in the order the labels are placed each frame, and keeps its spot while it
 * is still as good as the best, so labels do not trade places on every frame.
 */

import { Vector3, type Camera, type Object3D } from 'three'

/** Clear space kept between a label and the edge of the stage, in pixels. */
const MARGIN = 14

/** Where a label whose anchor has left the frame is parked. */
const OFF_STAGE = [-10_000, -10_000]

/** How often the stage copy labels keep clear of is measured again, in milliseconds. */
const MEASURE_MS = 500

/** Space kept between two labels, and between a label and the stage copy, in pixels. */
const GAP = 4

/**
 * The spots a label tries, as multiples of its own height (first) and width
 * (second) away from where its anchor projects: in place, then above and below,
 * then beside.
 */
const SPOTS: readonly (readonly [number, number])[] = [
  [0, 0], [-1, 0], [1, 0], [-2, 0], [2, 0], [0, 1], [0, -1], [-3, 0], [3, 0],
]

const PROJECTED = new Vector3()

/** A rectangle on the stage, in canvas pixels. */
interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** The drei `Html` position callback these helpers produce. */
type CalculatePosition = (el: Object3D, camera: Camera, size: { width: number; height: number }) => number[]

/**
 * The labels of one scene placed so far in the current frame, and the parts
 * of the stage no label may cover.
 */
export interface LabelField {
  /** Boxes the labels took this frame, in the order they were placed. */
  placed: Box[]
  /** The stage copy over the canvas, measured against the canvas. */
  keepOut: Box[]
  /** When {@link LabelField.keepOut} was last measured, in `performance.now()` milliseconds. */
  measuredAt: number
}

/** @returns A field with nothing placed and nothing measured. */
export function createLabelField(): LabelField {
  return { placed: [], keepOut: [], measuredAt: Number.NEGATIVE_INFINITY }
}

/**
 * Start one frame of a field: forget the boxes the last frame placed and,
 * twice a second, measure again the stage copy the labels keep clear of. Call
 * it from a `useFrame` whose priority runs before the labels' own (a negative one).
 * @param field - The scene's field.
 * @param canvas - The scene's canvas.
 * @param selectors - CSS selectors of the copy over the canvas, looked up in
 * the nearest ancestor of the canvas that holds any of them.
 */
export function beginLabelFrame(field: LabelField, canvas: HTMLCanvasElement, selectors: readonly string[]): void {
  field.placed.length = 0
  const now = performance.now()
  if (now - field.measuredAt < MEASURE_MS) return
  field.measuredAt = now
  const query = selectors.join(', ')
  let root = canvas.parentElement
  while (root !== null && root.querySelector(query) === null) root = root.parentElement
  const origin = canvas.getBoundingClientRect()
  field.keepOut = [...root?.querySelectorAll(query) ?? []].flatMap((element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return []
    return [{
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      right: rect.right - origin.left,
      bottom: rect.bottom - origin.top,
    }]
  })
}

/**
 * How much of one box another covers.
 * @param a - One box.
 * @param b - The other.
 * @returns The area of their overlap, in square pixels, widened by the gap kept between them.
 */
function overlap(a: Box, b: Box): number {
  const width = Math.min(a.right, b.right + GAP) - Math.max(a.left, b.left - GAP)
  const height = Math.min(a.bottom, b.bottom + GAP) - Math.max(a.top, b.top - GAP)
  return width > 0 && height > 0 ? width * height : 0
}

/**
 * Project a label anchor and hold the result inside the stage.
 * @param halfWidth - Half the label's width, in pixels; the label is centred on the result.
 * @param halfHeight - Half the label's height, in pixels.
 * @returns A `calculatePosition` for drei's `Html`.
 */
export function stageClamped(halfWidth: number, halfHeight: number): CalculatePosition {
  return (el, camera, size) => {
    PROJECTED.setFromMatrixPosition(el.matrixWorld).project(camera)
    if (Math.abs(PROJECTED.x) > 1 || Math.abs(PROJECTED.y) > 1) return OFF_STAGE
    const x = (PROJECTED.x * size.width * 0.5) + (size.width * 0.5)
    const y = (-PROJECTED.y * size.height * 0.5) + (size.height * 0.5)
    return [clampX(x, halfWidth, size.width), clampY(y, halfHeight, size.height)]
  }
}

/**
 * @param x - A label centre's x.
 * @param halfWidth - Half the label's width.
 * @param width - The stage's width.
 * @returns The x that keeps the label inside the stage's margin.
 */
function clampX(x: number, halfWidth: number, width: number): number {
  return Math.min(Math.max(x, halfWidth + MARGIN), Math.max(halfWidth + MARGIN, width - halfWidth - MARGIN))
}

/**
 * @param y - A label centre's y.
 * @param halfHeight - Half the label's height.
 * @param height - The stage's height.
 * @returns The y that keeps the label inside the stage's margin.
 */
function clampY(y: number, halfHeight: number, height: number): number {
  return Math.min(Math.max(y, halfHeight + MARGIN), Math.max(halfHeight + MARGIN, height - halfHeight - MARGIN))
}

/**
 * Like {@link stageClamped}, and clear of the other labels of the field and of
 * the stage copy it measured: the label takes the spot, of {@link SPOTS}, that
 * overlaps them least, keeps the spot it had while that is still as good, and
 * adds its box to the field for the labels placed after it in the frame.
 * @param field - The field the scene's labels share, begun each frame by {@link beginLabelFrame}.
 * @param halfWidth - Half the label's width, in pixels.
 * @param halfHeight - Half the label's height, in pixels.
 * @returns A `calculatePosition` for drei's `Html`; make one per label, since it remembers the label's spot.
 */
export function fieldPlaced(field: LabelField, halfWidth: number, halfHeight: number): CalculatePosition {
  const projected = stageClamped(halfWidth, halfHeight)
  let kept = 0
  return (el, camera, size) => {
    const at = projected(el, camera, size)
    const [x = 0, y = 0] = at
    if (at === OFF_STAGE) return at
    const boxAt = (spot: number): Box => {
      const [down = 0, across = 0] = SPOTS[spot] ?? [0, 0]
      const cx = clampX(x + (across * ((halfWidth * 2) + GAP)), halfWidth, size.width)
      const cy = clampY(y + (down * ((halfHeight * 2) + GAP)), halfHeight, size.height)
      return { left: cx - halfWidth, top: cy - halfHeight, right: cx + halfWidth, bottom: cy + halfHeight }
    }
    const cost = (box: Box): number => [...field.placed, ...field.keepOut].reduce((total, other) => total + overlap(box, other), 0)
    // In place when that is clear; else the spot it had, unless another is strictly clearer.
    let best = 0
    let bestBox = boxAt(0)
    let bestCost = cost(bestBox)
    for (const spot of [kept, ...SPOTS.keys()]) {
      if (bestCost === 0) break
      if (spot === best) continue
      const box = boxAt(spot)
      const spent = cost(box)
      if (spent < bestCost) {
        best = spot
        bestBox = box
        bestCost = spent
      }
    }
    kept = best
    field.placed.push(bestBox)
    return [(bestBox.left + bestBox.right) / 2, (bestBox.top + bestBox.bottom) / 2]
  }
}
