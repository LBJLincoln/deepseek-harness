/** Display width of text, counted per code point over a fixed table of ranges. */

/** Code points that render on the previous one and take no column of their own. */
const ZERO_WIDTH = [[0x0300, 0x036F], [0x1AB0, 0x1AFF], [0x20D0, 0x20F0], [0xFE20, 0xFE2F]]

/** Code points that occupy two columns. */
const WIDE = [
  [0x1100, 0x115F], [0x2E80, 0xA4CF], [0xAC00, 0xD7A3],
  [0xF900, 0xFAFF], [0xFE30, 0xFE4F], [0xFF00, 0xFF60], [0xFFE0, 0xFFE6],
]

/** The character that marks a permitted break inside a word. */
export const SOFT_HYPHEN = '\u00AD'

/** Whether a code point falls in one of a table's inclusive ranges. */
function inRanges(code, ranges) {
  return ranges.some(([low, high]) => code >= low && code <= high)
}

/**
 * Columns one code point occupies.
 * @param code - the code point.
 * @returns 0, 1, or 2.
 */
export function codeWidth(code) {
  if (inRanges(code, ZERO_WIDTH)) return 0
  return inRanges(code, WIDE) ? 2 : 1
}

/**
 * Columns a string occupies, ignoring any soft hyphen it still carries.
 * @param text - the text to measure.
 * @returns the total column count.
 */
export function width(text) {
  let total = 0
  for (const character of text) {
    if (character === SOFT_HYPHEN) continue
    total += codeWidth(character.codePointAt(0))
  }
  return total
}
