/**
 * Line diff with unified output.
 *
 * Texts are compared line by line with a longest-common-subsequence walk;
 * output follows the unified diff format: two file headers, then one hunk per
 * changed region with up to `context` unchanged lines on each side.
 *
 * A line carries whether it ended with a newline, so the last line of a file
 * that does not end with one never matches the same text terminated normally.
 */

/** Marker printed after a line that is the end of a file without a newline. */
const NO_NEWLINE = '\\ No newline at end of file';

/**
 * Splits a text into lines and reports whether it ended with a newline.
 * @param {string} text Text to split.
 * @returns {{lines: string[], newlineAtEnd: boolean}} Lines without their terminators.
 * @throws {TypeError} When the text is not a string.
 */
export function splitLines(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  if (text === '') return { lines: [], newlineAtEnd: true };
  const newlineAtEnd = text.endsWith('\n');
  const body = newlineAtEnd ? text.slice(0, -1) : text;
  return { lines: body.split('\n'), newlineAtEnd };
}

/**
 * Turns a split text into tokens that remember their terminator.
 * @param {{lines: string[], newlineAtEnd: boolean}} split Result of `splitLines`.
 * @returns {Array<{text: string, terminated: boolean}>} One token per line.
 */
function tokenize(split) {
  return split.lines.map((text, index) => ({
    text,
    terminated: index < split.lines.length - 1 || split.newlineAtEnd,
  }));
}

/**
 * Builds the suffix table of longest-common-subsequence lengths.
 * @param {unknown[]} before Old items.
 * @param {unknown[]} after New items.
 * @param {(a: unknown, b: unknown) => boolean} same Item equality.
 * @returns {number[][]} Table where cell `i,j` is the LCS length of the suffixes.
 */
function lcsTable(before, after, same) {
  const rows = before.length;
  const columns = after.length;
  const table = Array.from({ length: rows + 1 }, () => new Array(columns + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i][j] = same(before[i], after[j])
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * Diffs two sequences.
 *
 * Where a deletion and an insertion are equally good, the deletion is emitted
 * first, so a replaced item reads as `-old` then `+new`.
 * @param {unknown[]} before Old items.
 * @param {unknown[]} after New items.
 * @param {(a: unknown, b: unknown) => boolean} same Item equality.
 * @returns {Array<{type: 'equal' | 'delete' | 'insert', item: unknown}>} Operations in file order.
 */
function diffSequence(before, after, same) {
  const table = lcsTable(before, after, same);
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (same(before[i], after[j])) {
      ops.push({ type: 'equal', item: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] > table[i][j + 1]) {
      ops.push({ type: 'delete', item: before[i] });
      i += 1;
    } else {
      ops.push({ type: 'insert', item: after[j] });
      j += 1;
    }
  }
  while (i < before.length) {
    ops.push({ type: 'delete', item: before[i] });
    i += 1;
  }
  while (j < after.length) {
    ops.push({ type: 'insert', item: after[j] });
    j += 1;
  }
  return ops;
}

/**
 * Diffs two line arrays, comparing line text alone.
 * @param {string[]} before Old lines.
 * @param {string[]} after New lines.
 * @returns {Array<{type: 'equal' | 'delete' | 'insert', line: string}>} Operations in file order.
 * @throws {TypeError} When either argument is not an array of strings.
 */
export function diffLines(before, after) {
  checkLines(before);
  checkLines(after);
  return diffSequence(before, after, (a, b) => a === b).map((op) => ({ type: op.type, line: op.item }));
}

/**
 * Counts added, removed, and unchanged lines between two texts.
 * @param {string} oldText Text before the change.
 * @param {string} newText Text after the change.
 * @returns {{added: number, removed: number, unchanged: number}} Line counts.
 */
export function diffStats(oldText, newText) {
  const ops = diffLines(splitLines(oldText).lines, splitLines(newText).lines);
  const stats = { added: 0, removed: 0, unchanged: 0 };
  for (const op of ops) {
    if (op.type === 'insert') stats.added += 1;
    else if (op.type === 'delete') stats.removed += 1;
    else stats.unchanged += 1;
  }
  return stats;
}

/**
 * Groups the changed operations into hunks, each padded with context.
 *
 * Two changed regions separated by at most `2 * context` unchanged lines share
 * one hunk, since their context windows would otherwise overlap or touch.
 * @param {Array<{type: string}>} ops Operations to group.
 * @param {number} context Context lines on each side.
 * @returns {Array<{start: number, end: number}>} Inclusive operation ranges.
 */
function groupHunks(ops, context) {
  const changed = [];
  ops.forEach((op, index) => {
    if (op.type !== 'equal') changed.push(index);
  });
  if (changed.length === 0) return [];
  const runs = [];
  let start = changed[0];
  let end = changed[0];
  for (const index of changed.slice(1)) {
    if (index - end <= context * 2) {
      end = index;
    } else {
      runs.push([start, end]);
      start = index;
      end = index;
    }
  }
  runs.push([start, end]);
  return runs.map(([from, to]) => ({
    start: Math.max(0, from - context + 1),
    end: Math.min(ops.length - 1, to + context),
  }));
}

/**
 * Formats one side of a hunk header.
 * @param {number} start First line number, or the line before an empty range.
 * @param {number} count How many lines the hunk covers on this side.
 * @returns {string} Start and count, with the count omitted when it is one.
 */
function formatRange(start, count) {
  return count === 1 ? `${start}` : `${start},${count}`;
}

/**
 * Renders a unified diff.
 * @param {string} oldText Text before the change.
 * @param {string} newText Text after the change.
 * @param {{context?: number, oldName?: string, newName?: string}} [options] Rendering options.
 * @returns {string} Unified diff, or an empty string when the texts match.
 * @throws {TypeError} When a text or a name is not a string.
 * @throws {RangeError} When the context is not a non-negative integer.
 */
export function unifiedDiff(oldText, newText, options = {}) {
  if (typeof options !== 'object' || options === null) throw new TypeError('options must be an object');
  const { context = 3, oldName = 'a', newName = 'b' } = options;
  if (!Number.isSafeInteger(context) || context < 0) throw new RangeError('context must be a non-negative integer');
  if (typeof oldName !== 'string' || typeof newName !== 'string') throw new TypeError('name must be a string');
  const before = tokenize(splitLines(oldText));
  const after = tokenize(splitLines(newText));
  const ops = diffSequence(before, after, (a, b) => a.text === b.text && a.terminated === b.terminated);

  const hunks = groupHunks(ops, context);
  if (hunks.length === 0) return '';

  let oldNumber = 1;
  let newNumber = 1;
  const positions = ops.map((op) => {
    const at = { oldNumber, newNumber };
    if (op.type !== 'insert') oldNumber += 1;
    if (op.type !== 'delete') newNumber += 1;
    return at;
  });

  const out = [`--- ${oldName}`, `+++ ${newName}`];
  for (const hunk of hunks) {
    let oldCount = 0;
    let newCount = 0;
    for (let index = hunk.start; index <= hunk.end; index += 1) {
      if (ops[index].type !== 'insert') oldCount += 1;
      if (ops[index].type !== 'delete') newCount += 1;
    }
    const oldStart = positions[hunk.start].oldNumber;
    const newStart = positions[hunk.start].newNumber;
    out.push(`@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@`);
    for (let index = hunk.start; index <= hunk.end; index += 1) {
      const op = ops[index];
      if (op.type === 'equal') {
        out.push(` ${op.item.text}`);
        if (!op.item.terminated) out.push(NO_NEWLINE);
      } else if (op.type === 'delete') {
        out.push(`-${op.item.text}`);
        if (!op.item.terminated) out.push(NO_NEWLINE);
      } else {
        out.push(`+${op.item.text}`);
      }
    }
  }
  return `${out.join('\n')}\n`;
}

/**
 * Rebuilds the new text from the old text and a unified diff.
 *
 * Context and deleted lines are checked against the old text, so a patch that
 * does not describe this text is rejected rather than applied loosely.
 * @param {string} oldText Text the patch was made against.
 * @param {string} patch Unified diff produced by `unifiedDiff`.
 * @returns {string} Text the patch produces.
 * @throws {TypeError} When an argument is not a string.
 * @throws {Error} When the patch is malformed or does not match the old text.
 */
export function applyUnified(oldText, patch) {
  const before = splitLines(oldText);
  if (typeof patch !== 'string') throw new TypeError('patch must be a string');
  if (patch === '') return oldText;
  const rows = patch.split('\n');
  if (rows[rows.length - 1] === '') rows.pop();
  if (rows.length < 2 || !rows[0].startsWith('--- ') || !rows[1].startsWith('+++ ')) {
    throw new Error('patch is missing its file headers');
  }
  const out = [];
  let cursor = 0;
  let missingNewline = !before.newlineAtEnd;
  let previous = '';
  for (let index = 2; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.startsWith('@@')) {
      const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(row);
      if (header === null) throw new Error(`malformed hunk header: ${row}`);
      const start = Number(header[1]);
      const count = header[2] === undefined ? 1 : Number(header[2]);
      const from = count === 0 ? start : start - 1;
      while (cursor < from) {
        out.push(before.lines[cursor]);
        cursor += 1;
        missingNewline = !before.newlineAtEnd && cursor === before.lines.length;
      }
      previous = '@';
      continue;
    }
    if (row.startsWith('\\')) {
      if (previous !== '-') missingNewline = true;
      continue;
    }
    const kind = row[0];
    const text = row.slice(1);
    if (kind !== ' ' && kind !== '-' && kind !== '+') throw new Error(`malformed patch line: ${row}`);
    if (kind === ' ' || kind === '-') {
      if (before.lines[cursor] !== text) throw new Error(`patch does not apply at line ${cursor + 1}`);
      cursor += 1;
    }
    if (kind === ' ' || kind === '+') {
      out.push(text);
      missingNewline = false;
    }
    previous = kind;
  }
  while (cursor < before.lines.length) {
    out.push(before.lines[cursor]);
    cursor += 1;
    missingNewline = !before.newlineAtEnd && cursor === before.lines.length;
  }
  if (out.length === 0) return '';
  return missingNewline ? out.join('\n') : `${out.join('\n')}\n`;
}

/**
 * Validates an array of lines.
 * @param {unknown} lines Candidate line array.
 * @returns {void}
 * @throws {TypeError} When the value is not an array of strings.
 */
function checkLines(lines) {
  if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) {
    throw new TypeError('lines must be an array of strings');
  }
}
