/** Longest common subsequence over lines, and the changed regions it implies. */

/**
 * The matched index pairs of a longest common subsequence, taking the earliest
 * match whenever two subsequences are equally long.
 * @param left - the first line array.
 * @param right - the second line array.
 * @returns pairs `[leftIndex, rightIndex]`, ascending in both coordinates.
 */
export function commonPairs(left, right) {
  const table = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0))
  for (let index = left.length - 1; index >= 0; index -= 1) {
    for (let other = right.length - 1; other >= 0; other -= 1) {
      table[index][other] = left[index] === right[other]
        ? table[index + 1][other + 1] + 1
        : Math.max(table[index + 1][other], table[index][other + 1])
    }
  }
  const pairs = []
  let index = 0
  let other = 0
  while (index < left.length && other < right.length) {
    if (left[index] === right[other]) {
      pairs.push([index, other])
      index += 1
      other += 1
    } else if (table[index + 1][other] >= table[index][other + 1]) index += 1
    else other += 1
  }
  return pairs
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
