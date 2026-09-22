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
  const hunks = [
    ...changes(base, mine).map(hunk => ({ ...hunk, side: 'mine' })),
    ...changes(base, theirs).map(hunk => ({ ...hunk, side: 'theirs' })),
  ].sort((left, right) => left.baseStart - right.baseStart)
  const out = []
  let at = 0
  const stableTo = end => {
    if (end > at) out.push({ kind: 'stable', lines: base.slice(at, end) })
    at = end
  }
  while (hunks.length > 0) {
    const first = hunks.shift()
    const start = first.baseStart
    let end = first.baseStart + first.baseLength
    const group = [first]
    stableTo(start)
    while (hunks.length > 0 && hunks[0].baseStart <= end) {
      end = Math.max(end, hunks[0].baseStart + hunks[0].baseLength)
      group.push(hunks.shift())
    }
    if (group.length === 1) {
      const lines = (first.side === 'mine' ? mine : theirs).slice(first.otherStart, first.otherStart + first.otherLength)
      out.push({ kind: first.side, lines })
      at = end
      continue
    }
    // Both sides reach into this region, so each side's extent is its own
    // hunks' span widened by however much the region overruns them in the base.
    const extent = side => {
      const own = group.filter(hunk => hunk.side === side)
      if (own.length === 0) return { from: 0, to: 0 }
      const from = Math.min(...own.map(hunk => hunk.otherStart))
      const to = Math.max(...own.map(hunk => hunk.otherStart + hunk.otherLength))
      const baseFrom = Math.min(...own.map(hunk => hunk.baseStart))
      const baseTo = Math.max(...own.map(hunk => hunk.baseStart + hunk.baseLength))
      return { from: from + (start - baseFrom), to: to + (end - baseTo) }
    }
    const mineSpan = extent('mine')
    const theirsSpan = extent('theirs')
    const mineLines = mine.slice(mineSpan.from, mineSpan.to)
    const theirsLines = theirs.slice(theirsSpan.from, theirsSpan.to)
    const baseLines = base.slice(start, end)
    if (same(mineLines, theirsLines)) out.push({ kind: 'both', lines: mineLines })
    else if (same(mineLines, baseLines)) out.push({ kind: 'theirs', lines: theirsLines })
    else if (same(theirsLines, baseLines)) out.push({ kind: 'mine', lines: mineLines })
    else out.push({ kind: 'conflict', mine: mineLines, base: baseLines, theirs: theirsLines })
    at = end
  }
  stableTo(base.length)
  return out
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
