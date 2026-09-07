import test from 'node:test';
import assert from 'node:assert/strict';

import { GlobError, compile, filter, isMatch } from '../src/glob.js';

/** Deterministic 32-bit PRNG so the generated cases are identical on every run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

const UNIVERSE = [
  'a.js',
  'b.ts',
  '.hidden.js',
  'src/a.js',
  'src/.rc',
  'src/deep/c.js',
  'src/deep/deeper/d.js',
  'src/.dot/e.js',
  'test/a.test.js',
  'x',
  'x/y',
  'x/y/z',
  'a b.js',
  'ünïcode.js',
  '\u{1f600}.js',
  'star*.js',
];

test('wildcards, globstars and the dot rule select the right paths', () => {
  const cases = [
    ['*.js', {}, ['a.js', 'a b.js', 'ünïcode.js', '\u{1f600}.js', 'star*.js']],
    ['*.js', { dot: true }, ['a.js', '.hidden.js', 'a b.js', 'ünïcode.js', '\u{1f600}.js', 'star*.js']],
    ['*', {}, ['a.js', 'b.ts', 'x', 'a b.js', 'ünïcode.js', '\u{1f600}.js', 'star*.js']],
    [
      '**/*.js',
      {},
      [
        'a.js',
        'src/a.js',
        'src/deep/c.js',
        'src/deep/deeper/d.js',
        'test/a.test.js',
        'a b.js',
        'ünïcode.js',
        '\u{1f600}.js',
        'star*.js',
      ],
    ],
    ['src/**', {}, ['src/a.js', 'src/deep/c.js', 'src/deep/deeper/d.js']],
    ['src/**/*.js', {}, ['src/a.js', 'src/deep/c.js', 'src/deep/deeper/d.js']],
    ['x/**', {}, ['x', 'x/y', 'x/y/z']],
    ['src/*', {}, ['src/a.js']],
    ['src/*', { dot: true }, ['src/a.js', 'src/.rc']],
    ['**/.*', {}, ['.hidden.js', 'src/.rc']],
    ['?', {}, ['x']],
    ['[a-c]*.js', {}, ['a.js', 'a b.js']],
    ['[!a-c]*', {}, ['x', 'ünïcode.js', '\u{1f600}.js', 'star*.js']],
    ['star\\*.js', {}, ['star*.js']],
    ['**/*/*.js', {}, ['src/a.js', 'src/deep/c.js', 'src/deep/deeper/d.js', 'test/a.test.js']],
    ['*/*/*', {}, ['src/deep/c.js', 'x/y/z']],
  ];
  for (const [pattern, options, expected] of cases) {
    assert.deepStrictEqual(filter(UNIVERSE, pattern, options), expected, `pattern ${pattern}`);
  }
});

test('a globstar matches zero or more whole segments', () => {
  const cases = [
    ['a/**/b', 'a/b', true],
    ['a/**/b', 'a/x/b', true],
    ['a/**/b', 'a/x/y/b', true],
    ['a/**/b', 'ab', false],
    ['a/**/b', 'a/b/c', false],
    ['**', 'a/b/c', true],
    ['**/a', 'a', true],
    ['**/a', 'x/y/a', true],
    ['a/**', 'a', true],
    ['a/**', 'a/b/c', true],
    ['a/**/**/b', 'a/x/b', true],
    ['**/**', 'a/b', true],
    ['a**b', 'axb', true],
    ['a**b', 'a/b', false],
  ];
  for (const [pattern, path, expected] of cases) assert.equal(isMatch(path, pattern), expected, `${pattern} vs ${path}`);
});

test('wildcards never cross a separator', () => {
  const cases = [
    ['*', 'a/b', false],
    ['*/*', 'a/b', true],
    ['?', 'ab', false],
    ['?', 'a', true],
    ['??', 'a/', false],
    ['a?c', 'a/c', false],
  ];
  for (const [pattern, path, expected] of cases) assert.equal(isMatch(path, pattern), expected, `${pattern} vs ${path}`);
});

test('character classes follow the POSIX bracket rules', () => {
  const cases = [
    ['[abc]', 'b', true],
    ['[abc]', 'd', false],
    ['[a-c]', 'c', true],
    ['[a-c]', 'd', false],
    ['[!a-c]', 'd', true],
    ['[!a-c]', 'a', false],
    ['[^a-c]', 'd', true],
    ['[]]', ']', true],
    ['[]]', 'a', false],
    ['[!]]', 'a', true],
    ['[!]]', ']', false],
    ['[\\]]', ']', true],
    ['[a-]', '-', true],
    ['[a-]', 'a', true],
    ['[-a]', '-', true],
    ['[*]', '*', true],
    ['[*]', 'a', false],
    ['[.]file', '.file', false],
    ['[abc]', '.', false],
    ['x[!a]', 'x.', true],
  ];
  for (const [pattern, path, expected] of cases) assert.equal(isMatch(path, pattern), expected, `${pattern} vs ${path}`);
});

test('a leading dot is only matched by an explicit dot', () => {
  const cases = [
    ['*', '.x', false],
    ['?x', '.x', false],
    ['[.]x', '.x', false],
    ['.*', '.x', true],
    ['\\.*', '.x', true],
    ['**', '.x', false],
    ['**/y', '.x/y', false],
    ['a/*', 'a/.b', false],
  ];
  for (const [pattern, path, expected] of cases) assert.equal(isMatch(path, pattern), expected, `${pattern} vs ${path}`);
  assert.equal(isMatch('.x', '*', { dot: true }), true);
  assert.equal(isMatch('.x/y', '**/y', { dot: true }), true);
  assert.equal(isMatch('a/.b', 'a/*', { dot: true }), true);
});

test('backslash escapes strip a metacharacter of its meaning', () => {
  const cases = [
    ['\\*', '*', true],
    ['\\*', 'a', false],
    ['\\?', '?', true],
    ['\\[a]', '[a]', true],
    ['a\\\\b', 'a\\b', true],
    ['\\a', 'a', true],
    ['q\\?.js', 'q?.js', true],
    ['q\\?.js', 'qx.js', false],
  ];
  for (const [pattern, path, expected] of cases) assert.equal(isMatch(path, pattern), expected, `${pattern} vs ${path}`);
});

test('case folding is opt-in', () => {
  assert.equal(isMatch('A.JS', '*.js'), false);
  assert.equal(isMatch('A.JS', '*.js', { nocase: true }), true);
  assert.equal(isMatch('SRC/A.JS', 'src/**/[a-z].js', { nocase: true }), true);
});

test('invalid patterns report the reason and the position', () => {
  const cases = [
    ['a[bc', /unterminated character class/, 1],
    ['x/[a-', /unterminated character class/, 2],
    ['a\\', /trailing backslash/, 1],
    ['[a\\', /trailing backslash/, 2],
    ['[a/b]', /path separator in character class/, 2],
  ];
  for (const [pattern, message, index] of cases) {
    const error = caught(() => compile(pattern));
    assert.ok(error instanceof GlobError, `expected GlobError for ${pattern}`);
    assert.match(error.message, message);
    assert.equal(error.index, index, `index for ${pattern}`);
  }
  assert.throws(() => compile(''), /pattern must not be empty/);
  assert.throws(() => compile(null), /pattern must be a string/);
  assert.throws(() => isMatch(7, '*'), /path must be a string/);
  assert.throws(() => filter('a', '*'), /paths must be an array/);
});

test('filter keeps duplicates and the original order', () => {
  assert.deepStrictEqual(filter(['b.js', 'a.js', 'b.js', 'c.ts'], '*.js'), ['b.js', 'a.js', 'b.js']);
  assert.deepStrictEqual(filter([], '*'), []);
  const matcher = compile('*.js');
  assert.equal(matcher('a.js'), true);
  assert.equal(matcher('a.ts'), false);
});

test('generated paths satisfy the matching invariants', () => {
  const random = mulberry32(0x91acbd);
  const alphabet = ['a', 'B', '7', '-', '_', 'ü', '*', '?', '[', ']', '\\', ' ', '+', '(', '$'];
  const escapeGlob = (text) => text.replace(/[\\*?[\]]/g, (match) => `\\${match}`);

  for (let iteration = 0; iteration < 250; iteration += 1) {
    const segments = [];
    const count = 1 + Math.floor(random() * 3);
    for (let s = 0; s < count; s += 1) {
      let segment = '';
      const length = 1 + Math.floor(random() * 4);
      for (let c = 0; c < length; c += 1) segment += alphabet[Math.floor(random() * alphabet.length)];
      segments.push(segment);
    }
    const path = segments.join('/');
    const escaped = segments.map(escapeGlob);

    assert.equal(isMatch(path, escaped.join('/')), true, `literal pattern for ${JSON.stringify(path)}`);
    assert.equal(isMatch(path, `**/${escaped.join('/')}`), true, `leading globstar for ${JSON.stringify(path)}`);
    assert.equal(isMatch(path, `${escaped.join('/')}/**`), true, `trailing globstar for ${JSON.stringify(path)}`);

    const index = Math.floor(random() * segments.length);
    const starred = escaped.slice();
    starred[index] = '*';
    assert.equal(isMatch(path, starred.join('/')), true, `starred segment ${index} of ${JSON.stringify(path)}`);

    const questioned = escaped.slice();
    questioned[index] = `?${escapeGlob(segments[index].slice(1))}`;
    assert.equal(isMatch(path, questioned.join('/')), true, `questioned segment ${index} of ${JSON.stringify(path)}`);

    const widened = escaped.slice();
    widened.splice(index, 0, '**');
    assert.equal(isMatch(path, widened.join('/')), true, `inserted globstar at ${index} of ${JSON.stringify(path)}`);

    const shifted = segments.slice();
    shifted[index] = `${segments[index]}z`;
    assert.equal(isMatch(shifted.join('/'), escaped.join('/')), false, `literal pattern must not match a longer segment`);
  }
});
