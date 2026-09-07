import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyUnified, diffLines, diffStats, splitLines, unifiedDiff } from '../src/diff.js';

/**
 * Deterministic 32-bit PRNG.
 * @param {number} seed Initial state.
 * @returns {() => number} Generator returning floats in [0, 1).
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rebuilds the new text from a unified diff without using the module, checking
 * the header line numbers and counts on the way.
 * @param {string} oldText Text the patch was made against.
 * @param {string} patch Unified diff.
 * @param {string} label Assertion label.
 * @returns {string} Text the patch describes.
 */
function rebuild(oldText, patch, label) {
  if (patch === '') return oldText;
  const oldNewline = oldText === '' || oldText.endsWith('\n');
  const oldLines = oldText === '' ? [] : (oldNewline ? oldText.slice(0, -1) : oldText).split('\n');
  const rows = patch.split('\n');
  assert.equal(rows.pop(), '', `${label}: patch must end with a newline`);
  assert.deepEqual(rows.slice(0, 2), ['--- a', '+++ b'], `${label}: file headers`);
  const out = [];
  let cursor = 0;
  let missingNewline = !oldNewline;
  let previous = '';
  let seen = null;
  const checkHunk = () => {
    if (seen !== null) assert.deepEqual([seen.oldSeen, seen.newSeen], [seen.oldCount, seen.newCount], `${label}: hunk counts`);
  };
  for (const row of rows.slice(2)) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(row);
    if (header !== null) {
      checkHunk();
      const oldCount = header[2] === undefined ? 1 : Number(header[2]);
      const newCount = header[4] === undefined ? 1 : Number(header[4]);
      const from = oldCount === 0 ? Number(header[1]) : Number(header[1]) - 1;
      while (cursor < from) {
        out.push(oldLines[cursor]);
        cursor += 1;
        missingNewline = !oldNewline && cursor === oldLines.length;
      }
      assert.equal(cursor, from, `${label}: old start`);
      assert.equal(Number(header[3]), newCount === 0 ? out.length : out.length + 1, `${label}: new start`);
      seen = { oldCount, newCount, oldSeen: 0, newSeen: 0 };
      previous = '@';
      continue;
    }
    if (row.startsWith('\\')) {
      assert.equal(row, '\\ No newline at end of file', `${label}: marker text`);
      if (previous !== '-') missingNewline = true;
      continue;
    }
    if (row[0] === ' ' || row[0] === '-') {
      assert.equal(oldLines[cursor], row.slice(1), `${label}: old line ${cursor + 1}`);
      cursor += 1;
      seen.oldSeen += 1;
    }
    if (row[0] === ' ' || row[0] === '+') {
      out.push(row.slice(1));
      missingNewline = false;
      seen.newSeen += 1;
    }
    previous = row[0];
  }
  checkHunk();
  while (cursor < oldLines.length) {
    out.push(oldLines[cursor]);
    cursor += 1;
    missingNewline = !oldNewline && cursor === oldLines.length;
  }
  if (out.length === 0) return '';
  return missingNewline ? out.join('\n') : `${out.join('\n')}\n`;
}

const TEN = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n';
const TWELVE = 'a1\na2\na3\na4\na5\na6\na7\na8\na9\na10\na11\na12\n';

test('splitLines separates content from the trailing newline', () => {
  assert.deepEqual(splitLines(''), { lines: [], newlineAtEnd: true });
  assert.deepEqual(splitLines('\n'), { lines: [''], newlineAtEnd: true });
  assert.deepEqual(splitLines('a'), { lines: ['a'], newlineAtEnd: false });
  assert.deepEqual(splitLines('a\nb\n'), { lines: ['a', 'b'], newlineAtEnd: true });
  assert.deepEqual(splitLines('a\nb'), { lines: ['a', 'b'], newlineAtEnd: false });
  assert.deepEqual(splitLines('a\n\nb\n'), { lines: ['a', '', 'b'], newlineAtEnd: true });
  assert.throws(() => splitLines(null), { name: 'TypeError', message: 'text must be a string' });
});

test('diffLines puts a deletion before the insertion that replaces it', () => {
  assert.deepEqual(diffLines(['x'], ['y']), [
    { type: 'delete', line: 'x' },
    { type: 'insert', line: 'y' },
  ]);
  assert.deepEqual(diffLines([], []), []);
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'c']), [
    { type: 'equal', line: 'a' },
    { type: 'delete', line: 'b' },
    { type: 'equal', line: 'c' },
  ]);
  assert.deepEqual(diffLines(['a', 'c'], ['a', 'b', 'c']), [
    { type: 'equal', line: 'a' },
    { type: 'insert', line: 'b' },
    { type: 'equal', line: 'c' },
  ]);
  assert.deepEqual(diffLines(['a', 'b'], ['c', 'd']).map((op) => op.type), ['delete', 'delete', 'insert', 'insert']);
  assert.deepEqual(diffLines(['\u{1F600}'], ['\u{1F601}']).map((op) => op.line), ['\u{1F600}', '\u{1F601}']);
  assert.throws(() => diffLines('a', []), { name: 'TypeError', message: 'lines must be an array of strings' });
  assert.throws(() => diffLines([], [1]), { name: 'TypeError', message: 'lines must be an array of strings' });
});

test('diffStats counts each kind of line', () => {
  assert.deepEqual(diffStats('a\nb\nc\n', 'a\nc\n'), { added: 0, removed: 1, unchanged: 2 });
  assert.deepEqual(diffStats('', 'a\nb\n'), { added: 2, removed: 0, unchanged: 0 });
  assert.deepEqual(diffStats('a\nb\n', 'a\nb\n'), { added: 0, removed: 0, unchanged: 2 });
});

test('identical line content produces no diff at all', () => {
  assert.equal(unifiedDiff('', ''), '');
  assert.equal(unifiedDiff(TEN, TEN), '');
  assert.equal(unifiedDiff('only\n', 'only\n', { context: 0 }), '');
});

test('a hunk against an empty side starts at line zero', () => {
  assert.equal(unifiedDiff('', 'x\ny\n'), '--- a\n+++ b\n@@ -0,0 +1,2 @@\n+x\n+y\n');
  assert.equal(unifiedDiff('x\ny\n', ''), '--- a\n+++ b\n@@ -1,2 +0,0 @@\n-x\n-y\n');
  assert.equal(unifiedDiff('', 'x\n'), '--- a\n+++ b\n@@ -0,0 +1 @@\n+x\n');
});

test('context lines surround a change on both sides', () => {
  assert.equal(
    unifiedDiff(TEN, TEN.replace('l4', 'CHANGED')),
    '--- a\n+++ b\n@@ -1,7 +1,7 @@\n l1\n l2\n l3\n-l4\n+CHANGED\n l5\n l6\n l7\n',
  );
  assert.equal(
    unifiedDiff(TEN, TEN.replace('l4', 'CHANGED'), { context: 1 }),
    '--- a\n+++ b\n@@ -3,3 +3,3 @@\n l3\n-l4\n+CHANGED\n l5\n',
  );
  assert.equal(
    unifiedDiff(TEN, TEN.replace('l4', 'CHANGED'), { context: 0 }),
    '--- a\n+++ b\n@@ -4 +4 @@\n-l4\n+CHANGED\n',
  );
  assert.equal(
    unifiedDiff('a\nb\nc\n', 'a\nb\nc\nd\n', { context: 2 }),
    '--- a\n+++ b\n@@ -2,2 +2,3 @@\n b\n c\n+d\n',
  );
});

test('changes closer than twice the context share one hunk', () => {
  assert.equal(
    unifiedDiff(TWELVE, TWELVE.replace('a2\n', 'B2\n').replace('a9\n', 'B9\n')),
    '--- a\n+++ b\n@@ -1,12 +1,12 @@\n a1\n-a2\n+B2\n a3\n a4\n a5\n a6\n a7\n a8\n-a9\n+B9\n a10\n a11\n a12\n',
  );
  assert.equal(
    unifiedDiff(TWELVE, TWELVE.replace('a2\n', 'B2\n').replace('a10\n', 'B10\n')),
    '--- a\n+++ b\n@@ -1,5 +1,5 @@\n a1\n-a2\n+B2\n a3\n a4\n a5\n@@ -7,6 +7,6 @@\n a7\n a8\n a9\n-a10\n+B10\n a11\n a12\n',
  );
  assert.equal(
    unifiedDiff(TWELVE, TWELVE.replace('a2\n', 'B2\n').replace('a4\n', 'B4\n'), { context: 0 }),
    '--- a\n+++ b\n@@ -2 +2 @@\n-a2\n+B2\n@@ -4 +4 @@\n-a4\n+B4\n',
  );
});

test('a missing final newline is marked on the side that misses it', () => {
  assert.equal(
    unifiedDiff('one\ntwo\n', 'one\ntwo'),
    '--- a\n+++ b\n@@ -1,2 +1,2 @@\n one\n-two\n+two\n\\ No newline at end of file\n',
  );
  assert.equal(
    unifiedDiff('one\ntwo', 'one\ntwo\n'),
    '--- a\n+++ b\n@@ -1,2 +1,2 @@\n one\n-two\n\\ No newline at end of file\n+two\n',
  );
  assert.equal(
    unifiedDiff('one\ntwo', 'one\nTWO'),
    '--- a\n+++ b\n@@ -1,2 +1,2 @@\n one\n-two\n\\ No newline at end of file\n+TWO\n\\ No newline at end of file\n',
  );
  assert.equal(
    unifiedDiff('one\ntwo', 'zero\none\ntwo'),
    '--- a\n+++ b\n@@ -1,2 +1,3 @@\n+zero\n one\n two\n\\ No newline at end of file\n',
  );
});

test('names and malformed arguments are handled', () => {
  assert.equal(
    unifiedDiff('x\n', 'y\n', { oldName: 'old/file.txt', newName: 'new/file.txt' }),
    '--- old/file.txt\n+++ new/file.txt\n@@ -1 +1 @@\n-x\n+y\n',
  );
  const bad = [
    [() => unifiedDiff(1, ''), 'TypeError', 'text must be a string'],
    [() => unifiedDiff('', undefined), 'TypeError', 'text must be a string'],
    [() => unifiedDiff('', '', null), 'TypeError', 'options must be an object'],
    [() => unifiedDiff('', '', { oldName: 3 }), 'TypeError', 'name must be a string'],
    [() => unifiedDiff('', '', { context: -1 }), 'RangeError', 'context must be a non-negative integer'],
    [() => unifiedDiff('', '', { context: 1.5 }), 'RangeError', 'context must be a non-negative integer'],
    [() => applyUnified('a\n', '--- a\n+++ b\n@@ -1 +1 @@\n-zzz\n+y\n'), 'Error', 'patch does not apply at line 1'],
    [() => applyUnified('a\n', 'no headers here\n'), 'Error', 'patch is missing its file headers'],
    [() => applyUnified('a\n', '--- a\n+++ b\n@@ bogus @@\n'), 'Error', 'malformed hunk header: @@ bogus @@'],
  ];
  for (const [call, name, message] of bad) assert.throws(call, { name, message }, message);
});

test('round-trips random edits through the patch text', () => {
  const rnd = mulberry32(0xd1ff);
  const pool = ['alpha', 'beta', 'gamma', 'delta', '', '  spaced', '\u{1F600} emoji', 'tail'];
  const makeText = (count, newlineAtEnd) => {
    if (count === 0) return '';
    const lines = Array.from({ length: count }, () => pool[Math.floor(rnd() * pool.length)]);
    return lines.join('\n') + (newlineAtEnd ? '\n' : '');
  };
  for (let round = 0; round < 300; round += 1) {
    const oldText = makeText(Math.floor(rnd() * 14), rnd() < 0.75);
    const lines = oldText === '' ? [] : oldText.replace(/\n$/, '').split('\n');
    const edited = [];
    for (const line of lines) {
      const roll = rnd();
      if (roll < 0.15) continue;
      if (roll < 0.3) edited.push(pool[Math.floor(rnd() * pool.length)]);
      edited.push(line);
    }
    if (rnd() < 0.3) edited.push('appended');
    const newText = edited.length === 0 ? '' : edited.join('\n') + (rnd() < 0.75 ? '\n' : '');
    const context = Math.floor(rnd() * 4);
    const patch = unifiedDiff(oldText, newText, { context });
    const label = `round ${round} context ${context}`;
    assert.equal(rebuild(oldText, patch, label), newText, label);
    assert.equal(applyUnified(oldText, patch), newText, `${label} applyUnified`);
    if (patch !== '') {
      assert.ok(patch.endsWith('\n') && patch.startsWith('--- a\n+++ b\n@@ '), `${label} framing`);
    }
  }
});
