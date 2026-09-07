/**
 * Fixed-width plain-text tables: display width, wrapping, padding and layout.
 */

/** Error raised for invalid table input. */
export class TableError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.name = 'TableError';
    this.code = code;
  }
}

const ZERO_WIDTH = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);

const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1f64f],
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

const ALIGNMENTS = new Set(['left', 'right', 'center']);

/**
 * Display width of one code point.
 *
 * @param {number} codePoint Unicode code point.
 * @returns {0|1|2} Column count.
 */
function codePointWidth(codePoint) {
  if (codePoint < 0x20 || codePoint === 0x7f) return 0;
  if (ZERO_WIDTH.has(codePoint)) return 0;
  if (codePoint >= 0x0300 && codePoint <= 0x036f) return 0;
  for (const [low, high] of WIDE_RANGES) {
    if (codePoint >= low && codePoint <= high) return 2;
  }
  return 1;
}

/**
 * Display width of a string in terminal columns.
 *
 * @param {string} text Text to measure.
 * @returns {number} Column count.
 */
export function stringWidth(text) {
  if (typeof text !== 'string') throw new TableError('BAD_CELL', 'cell must be a string');
  let width = 0;
  for (const character of text) width += codePointWidth(character.codePointAt(0));
  return width;
}

/**
 * Split one word into chunks no wider than `width` columns.
 *
 * @param {string} word Word without spaces.
 * @param {number} width Column budget.
 * @returns {string[]} Chunks in order.
 */
function chunkWord(word, width) {
  const chunks = [];
  let current = '';
  let currentWidth = 0;
  for (const character of word) {
    const characterWidth = codePointWidth(character.codePointAt(0));
    if (characterWidth > width) {
      throw new TableError('UNWRAPPABLE', 'character is wider than the column');
    }
    if (currentWidth + characterWidth > width) {
      chunks.push(current);
      current = character;
      currentWidth = characterWidth;
    } else {
      current += character;
      currentWidth += characterWidth;
    }
  }
  chunks.push(current);
  return chunks;
}

/**
 * Wrap cell text to a column width.
 *
 * @param {string} text Cell text; explicit newlines start a new line.
 * @param {number} width Column width in display columns.
 * @returns {string[]} Wrapped lines, at least one.
 */
export function wrapCell(text, width) {
  if (typeof text !== 'string') throw new TableError('BAD_CELL', 'cell must be a string');
  if (!Number.isInteger(width) || width < 1) {
    throw new TableError('BAD_WIDTH', 'width must be a positive integer');
  }
  const output = [];
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(' ').filter((word) => word !== '');
    const pieces = [];
    for (const word of words) {
      for (const chunk of chunkWord(word, width)) pieces.push(chunk);
    }
    if (pieces.length === 0) {
      output.push('');
      continue;
    }
    let line = pieces[0];
    let lineWidth = stringWidth(line);
    for (const piece of pieces.slice(1)) {
      const pieceWidth = stringWidth(piece);
      if (lineWidth + 1 + pieceWidth > width) {
        output.push(line);
        line = piece;
        lineWidth = pieceWidth;
      } else {
        line += ` ${piece}`;
        lineWidth += 1 + pieceWidth;
      }
    }
    output.push(line);
  }
  return output;
}

/**
 * Pad a single line to an exact display width.
 *
 * @param {string} text Line that already fits.
 * @param {number} width Target column width.
 * @param {'left'|'right'|'center'} [align] Alignment, left by default.
 * @returns {string} Padded line.
 */
export function padCell(text, width, align = 'left') {
  if (typeof text !== 'string') throw new TableError('BAD_CELL', 'cell must be a string');
  if (!Number.isInteger(width) || width < 1) {
    throw new TableError('BAD_WIDTH', 'width must be a positive integer');
  }
  if (!ALIGNMENTS.has(align)) throw new TableError('BAD_ALIGN', `unknown alignment: ${align}`);
  const used = stringWidth(text);
  if (used > width) throw new TableError('CELL_TOO_WIDE', 'content is wider than the column');
  const pad = width - used;
  if (align === 'left') return text + ' '.repeat(pad);
  if (align === 'right') return ' '.repeat(pad) + text;
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + text + ' '.repeat(pad - left);
}

/**
 * Render rows as a fixed-width table.
 *
 * @param {string[][]} rows Rows of cells.
 * @param {{widths: number[], align?: string[], header?: boolean}} options Layout options.
 * @returns {string} Table text without a trailing newline.
 */
export function formatTable(rows, options) {
  if (typeof options !== 'object' || options === null) {
    throw new TableError('BAD_OPTIONS', 'options must be an object');
  }
  const { widths, align, header = false } = options;
  if (!Array.isArray(widths) || widths.length === 0 || !widths.every((w) => Number.isInteger(w) && w >= 1)) {
    throw new TableError('BAD_WIDTH', 'widths must be a non-empty array of positive integers');
  }
  const alignments = align === undefined ? widths.map(() => 'left') : align;
  if (!Array.isArray(alignments) || alignments.length !== widths.length) {
    throw new TableError('BAD_ALIGN', `align must have ${widths.length} entries`);
  }
  for (const value of alignments) {
    if (!ALIGNMENTS.has(value)) throw new TableError('BAD_ALIGN', `unknown alignment: ${value}`);
  }
  if (!Array.isArray(rows)) throw new TableError('BAD_ROWS', 'rows must be an array');
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== widths.length) {
      const count = Array.isArray(row) ? row.length : 0;
      throw new TableError('BAD_ROW_LENGTH', `row ${rowIndex} has ${count} cells, expected ${widths.length}`);
    }
    row.forEach((cell, columnIndex) => {
      if (typeof cell !== 'string') {
        throw new TableError('BAD_CELL', `cell at row ${rowIndex}, column ${columnIndex} is not a string`);
      }
    });
  });
  if (rows.length === 0) return '';

  const lines = [];
  rows.forEach((row, rowIndex) => {
    const blocks = row.map((cell, columnIndex) => wrapCell(cell, widths[columnIndex]));
    const height = Math.max(...blocks.map((block) => block.length));
    for (let line = 0; line < height; line += 1) {
      lines.push(
        blocks
          .map((block, columnIndex) => padCell(block[line] ?? '', widths[columnIndex], alignments[columnIndex]))
          .join(' | '),
      );
    }
    if (header && rowIndex === 0) {
      lines.push(widths.map((width) => '-'.repeat(width)).join('-+-'));
    }
  });
  return lines.join('\n');
}
