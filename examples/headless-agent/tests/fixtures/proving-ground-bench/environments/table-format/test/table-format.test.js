import test from 'node:test';
import assert from 'node:assert/strict';
import { TableError, formatTable, padCell, stringWidth, wrapCell } from '../src/index.js';

/** Deterministic 32-bit PRNG so the generated cases replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('stringWidth counts terminal columns, not code units', () => {
  const cases = [
    ['', 0],
    ['abc', 3],
    ['日本語', 6],
    ['こんにちは', 10],
    ['한글', 4],
    ['ＡＢ', 4],
    ['ｱｲｳ', 3],
    ['👍', 2],
    ['\u00e9', 1],
    ['caf\u00e9', 4],
    ['cafe\u0301', 4],
    ['a\u200bb', 2],
    ['a\ufeffb', 2],
    ['\u3000', 2],
    ['①', 1],
    ['—', 1],
    ['\t', 0],
    ['ab', 2],
    ['🧩🧩', 4],
    ['日a本', 5],
  ];
  for (const [text, expected] of cases) {
    assert.equal(stringWidth(text), expected, `width of ${JSON.stringify(text)}`);
  }
  assert.throws(() => stringWidth(42), { name: 'TableError', code: 'BAD_CELL', message: 'cell must be a string' });
});

test('padCell aligns within an exact width', () => {
  assert.equal(padCell('ab', 5), 'ab   ');
  assert.equal(padCell('ab', 5, 'left'), 'ab   ');
  assert.equal(padCell('ab', 5, 'right'), '   ab');
  assert.equal(padCell('ab', 5, 'center'), ' ab  ');
  assert.equal(padCell('ab', 4, 'center'), ' ab ');
  assert.equal(padCell('', 3), '   ');
  assert.equal(padCell('日本', 4), '日本');
  assert.equal(padCell('日', 4, 'center'), ' 日 ');
  assert.equal(padCell('日', 5, 'right'), '   日');
  assert.equal(stringWidth(padCell('éx', 6, 'center')), 6);
});

test('padCell rejects impossible requests', () => {
  assert.throws(() => padCell('abc', 2), { code: 'CELL_TOO_WIDE', message: 'content is wider than the column' });
  assert.throws(() => padCell('日', 1), { code: 'CELL_TOO_WIDE' });
  assert.throws(() => padCell('a', 0), { code: 'BAD_WIDTH', message: 'width must be a positive integer' });
  assert.throws(() => padCell('a', 2.5), { code: 'BAD_WIDTH' });
  assert.throws(() => padCell('a', 3, 'middle'), { code: 'BAD_ALIGN', message: 'unknown alignment: middle' });
  assert.throws(() => padCell(null, 3), { code: 'BAD_CELL' });
});

test('wrapCell breaks on spaces and keeps every line inside the width', () => {
  assert.deepEqual(wrapCell('', 5), ['']);
  assert.deepEqual(wrapCell('hello world', 11), ['hello world']);
  assert.deepEqual(wrapCell('hello world', 10), ['hello', 'world']);
  assert.deepEqual(wrapCell('hello world', 5), ['hello', 'world']);
  assert.deepEqual(wrapCell('a b c d', 3), ['a b', 'c d']);
  assert.deepEqual(wrapCell('  spaced   out  ', 20), ['spaced out']);
  assert.deepEqual(wrapCell('   ', 4), ['']);
});

test('wrapCell hard-breaks over-long words and honours explicit newlines', () => {
  assert.deepEqual(wrapCell('abcdefgh', 3), ['abc', 'def', 'gh']);
  assert.deepEqual(wrapCell('ab', 1), ['a', 'b']);
  assert.deepEqual(wrapCell('one\ntwo', 5), ['one', 'two']);
  assert.deepEqual(wrapCell('one\n\ntwo', 5), ['one', '', 'two']);
  assert.deepEqual(wrapCell('long-word here', 4), ['long', '-wor', 'd', 'here']);
});

test('wrapCell never splits a wide character across lines', () => {
  assert.deepEqual(wrapCell('日本語テスト', 5), ['日本', '語テ', 'スト']);
  assert.deepEqual(wrapCell('日本語テスト', 6), ['日本語', 'テスト']);
  assert.deepEqual(wrapCell('日 本', 2), ['日', '本']);
  assert.deepEqual(wrapCell('éabc', 2), ['éa', 'bc']);
  assert.deepEqual(wrapCell('​a​b', 2), ['​a​b']);
  assert.deepEqual(wrapCell('éabc', 2), ['éa', 'bc']);
  assert.throws(() => wrapCell('日', 1), { code: 'UNWRAPPABLE', message: 'character is wider than the column' });
  assert.throws(() => wrapCell('x', 0), { code: 'BAD_WIDTH' });
  assert.throws(() => wrapCell(7, 3), { code: 'BAD_CELL' });
});

test('formatTable lays out a simple grid', () => {
  assert.equal(formatTable([['a', 'b'], ['c', 'd']], { widths: [3, 3] }), 'a   | b  \nc   | d  ');
  assert.equal(formatTable([], { widths: [3] }), '');
  assert.equal(formatTable([], { widths: [3], header: true }), '');
  assert.equal(formatTable([['x']], { widths: [1] }), 'x');
});

test('formatTable draws a header rule of the full table width', () => {
  const table = formatTable([['id', 'name'], ['1', 'ada']], { widths: [3, 5], header: true });
  const lines = table.split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'id  | name ');
  assert.equal(lines[1], '----+------');
  assert.equal(lines[2], '1   | ada  ');
  assert.equal(new Set(lines.map((line) => stringWidth(line))).size, 1);
});

test('formatTable stacks wrapped cells and pads the short ones', () => {
  const table = formatTable([['hello world', 'x']], { widths: [5, 1] });
  assert.equal(table, 'hello | x\nworld |  ');
  const wide = formatTable([['日本語テスト', 'ok']], { widths: [4, 2], align: ['left', 'right'] });
  assert.equal(wide, '日本 | ok\n語テ |   \nスト |   ');
});

test('formatTable applies per-column alignment', () => {
  const table = formatTable([['a', 'b', 'c']], { widths: [5, 5, 5], align: ['left', 'center', 'right'] });
  assert.equal(table, 'a     |   b   |     c');
});

test('formatTable rejects malformed input', () => {
  assert.throws(() => formatTable([['a']], null), { code: 'BAD_OPTIONS', message: 'options must be an object' });
  assert.throws(() => formatTable([['a']], {}), { code: 'BAD_WIDTH' });
  assert.throws(() => formatTable([['a']], { widths: [] }), { code: 'BAD_WIDTH' });
  assert.throws(() => formatTable([['a']], { widths: [0] }), { code: 'BAD_WIDTH' });
  assert.throws(() => formatTable([['a']], { widths: [2], align: ['left', 'left'] }), {
    code: 'BAD_ALIGN',
    message: 'align must have 1 entries',
  });
  assert.throws(() => formatTable([['a']], { widths: [2], align: ['start'] }), {
    code: 'BAD_ALIGN',
    message: 'unknown alignment: start',
  });
  assert.throws(() => formatTable('rows', { widths: [2] }), { code: 'BAD_ROWS', message: 'rows must be an array' });
  assert.throws(() => formatTable([['a', 'b']], { widths: [2] }), {
    code: 'BAD_ROW_LENGTH',
    message: 'row 0 has 2 cells, expected 1',
  });
  assert.throws(() => formatTable([['a'], ['b', 'c']], { widths: [2] }), {
    code: 'BAD_ROW_LENGTH',
    message: 'row 1 has 2 cells, expected 1',
  });
  assert.throws(() => formatTable([['a'], [7]], { widths: [2] }), {
    code: 'BAD_CELL',
    message: 'cell at row 1, column 0 is not a string',
  });
  assert.equal(new TableError('X', 'y') instanceof Error, true);
});

test('wrapped lines always fit their column for generated text', () => {
  const pick = mulberry32(31337);
  const alphabet = ['a', 'b', ' ', ' ', '日', '语', 'x', 'é', '👍', 'z', '\u200b'];
  for (let round = 0; round < 300; round += 1) {
    const width = 2 + Math.floor(pick() * 7);
    const length = Math.floor(pick() * 24);
    let text = '';
    for (let i = 0; i < length; i += 1) text += alphabet[Math.floor(pick() * alphabet.length)];
    const lines = wrapCell(text, width);
    assert.ok(lines.length >= 1, 'at least one line');
    for (const line of lines) {
      assert.ok(stringWidth(line) <= width, `line ${JSON.stringify(line)} fits width ${width}`);
      assert.equal(line.startsWith(' ') || line.endsWith(' '), false, 'no leading or trailing spaces');
    }
    assert.equal(
      lines.join('').replace(/ /g, ''),
      text.replace(/[ \n]/g, ''),
      'wrapping preserves every non-space character in order',
    );
  }
});

test('every rendered line has the same width for generated tables', () => {
  const pick = mulberry32(9001);
  const alphabet = ['a', 'b', ' ', '日', '语', 'w', 'é', 'q'];
  for (let round = 0; round < 120; round += 1) {
    const columns = 1 + Math.floor(pick() * 4);
    const widths = Array.from({ length: columns }, () => 2 + Math.floor(pick() * 6));
    const align = Array.from({ length: columns }, () => ['left', 'right', 'center'][Math.floor(pick() * 3)]);
    const rows = Array.from({ length: 1 + Math.floor(pick() * 4) }, () =>
      Array.from({ length: columns }, () => {
        const length = Math.floor(pick() * 12);
        let cell = '';
        for (let i = 0; i < length; i += 1) cell += alphabet[Math.floor(pick() * alphabet.length)];
        return cell;
      }),
    );
    const header = pick() < 0.5;
    const lines = formatTable(rows, { widths, align, header }).split('\n');
    const expected = widths.reduce((sum, width) => sum + width, 0) + 3 * (columns - 1);
    for (const line of lines) {
      assert.equal(stringWidth(line), expected, `line ${JSON.stringify(line)} in round ${round}`);
    }
    assert.ok(lines.length >= rows.length + (header ? 1 : 0), 'never fewer lines than rows');
  }
});
