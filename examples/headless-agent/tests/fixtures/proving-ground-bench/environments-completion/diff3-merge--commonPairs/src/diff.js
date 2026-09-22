/** Longest common subsequence over lines, and the changed regions it implies. */

/**
 * The matched index pairs of a longest common subsequence, taking the earliest
 * match whenever two subsequences are equally long.
 * @param left - the first line array.
 * @param right - the second line array.
 * @returns pairs `[leftIndex, rightIndex]`, ascending in both coordinates.
 */
export function commonPairs(left, right) {
  throw new Error('not implemented')
}

/**
 * The regions in which `other` departs from `base`, as replacements of a run of
 * `base` by a run of `other`; a pure insertion has a base length of 0 and a pure
 * deletion an other length of 0.
 * @param base - the common ancestor's lines.
 * @param other - the derived lines.
 * @returns the changed regions, in base order.
 */
export function changes(base, other) {
  const out = []
  let baseAt = 0
  let otherAt = 0
  for (const [basePair, otherPair] of [...commonPairs(base, other), [base.length, other.length]]) {
    if (basePair > baseAt || otherPair > otherAt) {
      out.push({ baseStart: baseAt, baseLength: basePair - baseAt, otherStart: otherAt, otherLength: otherPair - otherAt })
    }
    baseAt = basePair + 1
    otherAt = otherPair + 1
  }
  return out
}
