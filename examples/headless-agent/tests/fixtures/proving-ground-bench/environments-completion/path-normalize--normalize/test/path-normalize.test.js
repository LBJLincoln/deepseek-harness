import test from 'node:test';
import assert from 'node:assert/strict';
import { PathError, isAbsolute, join, normalize, relative } from '../src/index.js';

/** Deterministic 32-bit PRNG so the generated paths replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('isAbsolute looks only at the leading slash', () => {
  assert.equal(isAbsolute('/'), true);
  assert.equal(isAbsolute('/a/b'), true);
  assert.equal(isAbsolute('//a'), true);
  assert.equal(isAbsolute('a/b'), false);
  assert.equal(isAbsolute('./a'), false);
  assert.equal(isAbsolute(''), false);
  assert.throws(() => isAbsolute(7), { name: 'PathError', code: 'NOT_A_STRING', message: 'path must be a string' });
});

test('normalize collapses separators, dots and trailing slashes', () => {
  const cases = [
    ['/a/b', '/a/b'],
    ['/a/b/', '/a/b'],
    ['/a//b', '/a/b'],
    ['//a//b//', '/a/b'],
    ['/', '/'],
    ['///', '/'],
    ['/a/./b', '/a/b'],
    ['/a/b/..', '/a'],
    ['/a/b/../..', '/'],
    ['/a/../b', '/b'],
    ['a/b/', 'a/b'],
    ['./a', 'a'],
    ['.', '.'],
    ['./', '.'],
    ['a/.', 'a'],
    ['x/..', '.'],
    ['/.hidden', '/.hidden'],
    ['/..a/b', '/..a/b'],
    ['/a/...', '/a/...'],
    ['/a b/c', '/a b/c'],
    ['/日本/x/../y', '/日本/y'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(normalize(input), expected, `normalize(${JSON.stringify(input)})`);
  }
});

test('normalize keeps leading parents on relative paths only', () => {
  assert.equal(normalize('..'), '..');
  assert.equal(normalize('../..'), '../..');
  assert.equal(normalize('../a/..'), '..');
  assert.equal(normalize('a/../..'), '..');
  assert.equal(normalize('a/../../b'), '../b');
  assert.equal(normalize('../a/../b'), '../b');
  assert.equal(normalize('a/b/../../c'), 'c');
});

test('normalize rejects malformed input and escapes from the root', () => {
  assert.throws(() => normalize(''), { code: 'EMPTY_PATH', message: 'path must not be empty' });
  assert.throws(() => normalize(null), { code: 'NOT_A_STRING', message: 'path must be a string' });
  assert.throws(() => normalize('a\u0000b'), { code: 'NUL_BYTE', message: 'path contains a NUL byte' });
  assert.throws(() => normalize('/..'), { code: 'ESCAPE', message: 'path escapes root: /..' });
  assert.throws(() => normalize('/../a'), { code: 'ESCAPE', message: 'path escapes root: /../a' });
  assert.throws(() => normalize('/a/../..'), { code: 'ESCAPE', message: 'path escapes root: /a/../..' });
  assert.throws(() => normalize('/a/b/../../../c'), { code: 'ESCAPE' });
  assert.equal(new PathError('X', 'y') instanceof Error, true);
});

test('join concatenates and then normalizes', () => {
  assert.equal(join('a', 'b'), 'a/b');
  assert.equal(join('/a', 'b'), '/a/b');
  assert.equal(join('/a/', 'b/'), '/a/b');
  assert.equal(join('a', '..', 'b'), 'b');
  assert.equal(join('a', '../..'), '..');
  assert.equal(join('/'), '/');
  assert.equal(join('/a', '.'), '/a');
  assert.equal(join('.', 'a'), 'a');
  assert.equal(join('a'), 'a');
  assert.equal(join('/a', 'b/../c'), '/a/c');
  assert.equal(join('日', '本'), '日/本');
  assert.equal(join('/', 'a', 'b'), '/a/b');
});

test('join rejects empty, absolute and non-string segments', () => {
  assert.throws(() => join(), { code: 'NO_SEGMENTS', message: 'join requires at least one segment' });
  assert.throws(() => join('a', ''), { code: 'EMPTY_SEGMENT', message: 'segment 1 must not be empty' });
  assert.throws(() => join('', 'a'), { code: 'EMPTY_SEGMENT', message: 'segment 0 must not be empty' });
  assert.throws(() => join('a', '/b'), { code: 'ABSOLUTE_SEGMENT', message: 'segment 1 must be relative' });
  assert.throws(() => join('a', 'b', '/c'), { code: 'ABSOLUTE_SEGMENT', message: 'segment 2 must be relative' });
  assert.throws(() => join('a', 3), { code: 'NOT_A_STRING' });
  assert.throws(() => join('/a', '..', '..'), { code: 'ESCAPE' });
});

test('relative walks up and back down', () => {
  const cases = [
    ['/a/b', '/a/b', ''],
    ['/a/b', '/a/b/c/d', 'c/d'],
    ['/a/b/c', '/a/d', '../../d'],
    ['/', '/a/b', 'a/b'],
    ['/a/b', '/', '../..'],
    ['/a/b/', '/a/c', '../c'],
    ['/a/./b', '/a/b/c', 'c'],
    ['/x', '/y', '../y'],
    ['/a/bb', '/a/b', '../b'],
    ['/日本/a', '/日本/b', '../b'],
  ];
  for (const [from, to, expected] of cases) {
    assert.equal(relative(from, to), expected, `relative(${from}, ${to})`);
  }
});

test('relative demands two absolute paths', () => {
  assert.throws(() => relative('a', '/b'), { code: 'NOT_ABSOLUTE', message: 'both paths must be absolute' });
  assert.throws(() => relative('/a', 'b'), { code: 'NOT_ABSOLUTE', message: 'both paths must be absolute' });
  assert.throws(() => relative('', '/b'), { code: 'NOT_ABSOLUTE' });
  assert.throws(() => relative('/..', '/a'), { code: 'ESCAPE' });
  assert.throws(() => relative('/a', undefined), { code: 'NOT_A_STRING' });
  assert.throws(() => relative('/a\u0000', '/b'), { code: 'NUL_BYTE' });
});

test('normalized paths are stable and well formed for generated input', () => {
  const pick = mulberry32(555);
  const parts = ['a', 'bb', '.', '..', 'c', '日', 'x.y', '..a'];
  for (let round = 0; round < 400; round += 1) {
    const rooted = pick() < 0.5;
    const count = 1 + Math.floor(pick() * 6);
    const chosen = Array.from({ length: count }, () => parts[Math.floor(pick() * parts.length)]);
    const raw = (rooted ? '/' : '') + chosen.join(pick() < 0.2 ? '//' : '/');
    let result;
    try {
      result = normalize(raw);
    } catch (error) {
      assert.equal(error.code, 'ESCAPE', `only rooted escapes may throw for ${raw}`);
      assert.equal(rooted, true, `relative paths never escape: ${raw}`);
      continue;
    }
    assert.equal(normalize(result), result, `idempotent for ${raw}`);
    assert.equal(result.includes('//'), false, `no doubled separator in ${result}`);
    assert.equal(result === '/' || result.endsWith('/'), result === '/', `no trailing slash in ${result}`);
    assert.equal(result.startsWith('/'), rooted, `rootedness preserved for ${raw}`);
    assert.notEqual(result, '', 'never empty');
  }
});

test('relative and join are inverses for generated absolute paths', () => {
  const pick = mulberry32(777);
  const parts = ['a', 'b', 'c', 'dd', '日'];
  const makePath = () => {
    const count = Math.floor(pick() * 5);
    return `/${Array.from({ length: count }, () => parts[Math.floor(pick() * parts.length)]).join('/')}`;
  };
  for (let round = 0; round < 300; round += 1) {
    const from = normalize(makePath());
    const to = normalize(makePath());
    const step = relative(from, to);
    assert.equal(isAbsolute(step), false, `${step} is relative`);
    assert.equal(join(from, step === '' ? '.' : step), to, `join(${from}, ${step}) returns ${to}`);
    assert.equal(relative(from, from), '', 'a path is empty relative to itself');
    if (step !== '') assert.equal(normalize(step), step, `${step} is already normalized`);
  }
});
