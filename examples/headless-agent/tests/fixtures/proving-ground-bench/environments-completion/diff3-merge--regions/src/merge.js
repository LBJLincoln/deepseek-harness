/** The three-way region walk and the verdict each region earns. */

import { changes } from './diff.js'

/** Whether two line arrays hold the same lines in the same order. */
function same(left, right) {
  return left.length === right.length && left.every((line, index) => line === right[index])
}

/**
 * Split the three documents into regions: runs the two sides left alone, runs
 * only one side touched, and runs both touched.
 * @param mine - the first side's lines.
 * @param base - the common ancestor's lines.
 * @param theirs - the second side's lines.
 * @returns the regions in base order, each carrying the lines it resolves to and its kind.
 */
export function regions(mine, base, theirs) {
  throw new Error('not implemented')
}

/**
 * Render the regions as merged text.
 * @param parts - the regions from {@link regions}.
 * @param withBase - whether a conflict shows the base section between its sides.
 * @returns the merged lines.
 */
export function render(parts, withBase) {
  const out = []
  for (const region of parts) {
    if (region.kind !== 'conflict') {
      out.push(...region.lines)
      continue
    }
    out.push('<<<<<<< mine', ...region.mine)
    if (withBase) out.push('||||||| base', ...region.base)
    out.push('=======', ...region.theirs, '>>>>>>> theirs')
  }
  return out
}

/**
 * Render the regions as one classification line each.
 * @param parts - the regions from {@link regions}.
 * @returns the report lines.
 */
export function describe(parts) {
  return parts.map(region => (region.kind === 'conflict'
    ? `conflict mine=${region.mine.length} base=${region.base.length} theirs=${region.theirs.length}`
    : `${region.kind} ${region.lines.length}`))
}
