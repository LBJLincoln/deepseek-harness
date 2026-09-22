import test from 'node:test';
import assert from 'node:assert/strict';

import { SemverError, compare, maxSatisfying, parse, parseRange, satisfies } from '../src/index.js';

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

test('versions parse into their parts', () => {
  assert.deepStrictEqual(parse('1.2.3'), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: [],
    build: [],
    version: '1.2.3',
  });
  assert.deepStrictEqual(parse('  v0.0.0-alpha.1.x+build.5  '), {
    major: 0,
    minor: 0,
    patch: 0,
    prerelease: ['alpha', 1, 'x'],
    build: ['build', '5'],
    version: '0.0.0-alpha.1.x+build.5',
  });
  assert.deepStrictEqual(parse('10.20.30').major, 10);
  assert.deepStrictEqual(parse('1.0.0-0').prerelease, [0]);
  assert.deepStrictEqual(parse('1.0.0--x').prerelease, ['-x']);
});

test('malformed versions are rejected', () => {
  const cases = ['1.2', '1', '1.2.3.4', '01.2.3', '1.02.3', '1.2.3-01', '1.2.3-', '1.2.3+', 'a.b.c', '', 'x.2.3', '1.2.3-be$ta'];
  for (const text of cases) assert.throws(() => parse(text), SemverError, text);
  assert.throws(() => parse(null), /version must be a string/);
});

test('precedence follows the prerelease rules', () => {
  const cases = [
    ['1.0.0', '2.0.0', -1],
    ['2.0.0', '1.0.0', 1],
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.1', -1],
    ['1.1.0', '1.0.9', 1],
    ['1.0.0-alpha', '1.0.0', -1],
    ['1.0.0', '1.0.0-alpha', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha.beta', -1],
    ['1.0.0-alpha.beta', '1.0.0-beta', -1],
    ['1.0.0-beta', '1.0.0-beta.2', -1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-beta.11', '1.0.0-rc.1', -1],
    ['1.0.0-rc.1', '1.0.0', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['1.0.0-2', '1.0.0-11', -1],
    ['1.0.0-Alpha', '1.0.0-alpha', -1],
    ['1.0.0+build', '1.0.0', 0],
    ['1.0.0+a', '1.0.0+b', 0],
    ['1.0.0-alpha+1', '1.0.0-alpha+2', 0],
    ['v1.0.0', '1.0.0', 0],
  ];
  for (const [a, b, expected] of cases) assert.equal(compare(a, b), expected, `${a} vs ${b}`);
});

test('sorting by precedence orders a whole release history', () => {
  const ordered = [
    '0.9.9',
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
    '1.0.1',
    '1.1.0',
    '2.0.0',
  ];
  const random = mulberry32(0xa11ce);
  const shuffled = ordered.slice();
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  assert.notDeepStrictEqual(shuffled, ordered);
  assert.deepStrictEqual(shuffled.sort(compare), ordered);
});

test('ranges expand into comparator sets', () => {
  const cases = [
    ['1.2.3', [['=1.2.3']]],
    ['=1.2.3', [['=1.2.3']]],
    ['v1.2.3', [['=1.2.3']]],
    ['*', [['>=0.0.0']]],
    ['', [['>=0.0.0']]],
    ['x', [['>=0.0.0']]],
    ['1', [['>=1.0.0', '<2.0.0']]],
    ['1.2', [['>=1.2.0', '<1.3.0']]],
    ['1.X', [['>=1.0.0', '<2.0.0']]],
    ['1.2.x', [['>=1.2.0', '<1.3.0']]],
    ['^1.2.3', [['>=1.2.3', '<2.0.0']]],
    ['^0.2.3', [['>=0.2.3', '<0.3.0']]],
    ['^0.0.3', [['>=0.0.3', '<0.0.4']]],
    ['^1.2', [['>=1.2.0', '<2.0.0']]],
    ['^0.2', [['>=0.2.0', '<0.3.0']]],
    ['^0.0', [['>=0.0.0', '<0.1.0']]],
    ['^1', [['>=1.0.0', '<2.0.0']]],
    ['^0', [['>=0.0.0', '<1.0.0']]],
    ['^1.2.3-beta.2', [['>=1.2.3-beta.2', '<2.0.0']]],
    ['~1.2.3', [['>=1.2.3', '<1.3.0']]],
    ['~1.2', [['>=1.2.0', '<1.3.0']]],
    ['~1', [['>=1.0.0', '<2.0.0']]],
    ['~0.2.3', [['>=0.2.3', '<0.3.0']]],
    ['~0', [['>=0.0.0', '<1.0.0']]],
    ['>1.2.3', [['>1.2.3']]],
    ['>1.2', [['>=1.3.0']]],
    ['>1', [['>=2.0.0']]],
    ['>=1.2', [['>=1.2.0']]],
    ['<1.2', [['<1.2.0']]],
    ['<=1.2', [['<1.3.0']]],
    ['<= 1.2.3', [['<=1.2.3']]],
    ['>=  1.2.3', [['>=1.2.3']]],
    ['1.2.3 - 2.3.4', [['>=1.2.3', '<=2.3.4']]],
    ['1.2 - 2.3.4', [['>=1.2.0', '<=2.3.4']]],
    ['1.2.3 - 2.3', [['>=1.2.3', '<2.4.0']]],
    ['1.2.3 - 2', [['>=1.2.3', '<3.0.0']]],
    ['1.2.3-beta - x', [['>=1.2.3-beta']]],
    ['x - 2.3.4', [['<=2.3.4']]],
    ['>=1.2.3 <2.0.0', [['>=1.2.3', '<2.0.0']]],
    ['^1 || ^2', [['>=1.0.0', '<2.0.0'], ['>=2.0.0', '<3.0.0']]],
    ['1.2.7 || >=1.2.9 <2.0.0', [['=1.2.7'], ['>=1.2.9', '<2.0.0']]],
  ];
  for (const [range, expected] of cases) assert.deepStrictEqual(parseRange(range), expected, range);
});

test('malformed ranges are rejected', () => {
  const cases = ['>x', '<=*', '^x', '1.x.2', '1.2.3.4', '- 1.2.3', '1.2.3 -', '>=abc', '^1.2-beta'];
  for (const range of cases) assert.throws(() => parseRange(range), SemverError, range);
  assert.throws(() => parseRange(null), /range must be a string/);
});

test('satisfies applies the whole comparator set', () => {
  const cases = [
    ['1.2.3', '^1.2.3', true],
    ['1.9.9', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
    ['1.2.2', '^1.2.3', false],
    ['0.2.4', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.2.3', '1.2.x', true],
    ['1.3.0', '1.2.x', false],
    ['1.0.0', '*', true],
    ['1.2.3', '>1.2', false],
    ['1.3.0', '>1.2', true],
    ['1.2.3', '<=1.2', true],
    ['1.3.0', '<=1.2', false],
    ['1.2.3', '1.2.3 - 2.3.4', true],
    ['2.3.4', '1.2.3 - 2.3.4', true],
    ['2.3.5', '1.2.3 - 2.3.4', false],
    ['2.3.9', '1.2.3 - 2.3', true],
    ['2.4.0', '1.2.3 - 2.3', false],
    ['1.5.0', '^1 || ^3', true],
    ['2.5.0', '^1 || ^3', false],
    ['3.5.0', '^1 || ^3', true],
    ['1.2.3', '>=1.2.3 <2.0.0', true],
    ['2.0.0', '>=1.2.3 <2.0.0', false],
    ['1.0.0+build', '1.0.0', true],
    ['1.0.0', '1.0.0+other', true],
    ['1.2.3', '', true],
  ];
  for (const [version, range, expected] of cases) assert.equal(satisfies(version, range), expected, `${version} in ${range}`);
});

test('prereleases only match ranges that mention one', () => {
  const cases = [
    ['1.0.0-beta', '*', false],
    ['1.0.0-beta', '>=0.0.0', false],
    ['1.2.3-beta', '^1.2.3', false],
    ['1.2.4-beta', '^1.2.3', false],
    ['1.2.3-beta', '>=1.2.3-alpha <2.0.0', true],
    ['1.2.4-beta', '>=1.2.3-alpha <2.0.0', false],
    ['1.2.3-beta', '^1.2.3-alpha', true],
    ['1.2.3-alpha', '^1.2.3-beta', false],
    ['1.2.3', '^1.2.3-alpha', true],
    ['1.2.3-beta', '1.2.3-beta', true],
  ];
  for (const [version, range, expected] of cases) assert.equal(satisfies(version, range), expected, `${version} in ${range}`);
  const included = [
    ['1.0.0-beta', '*', true],
    ['1.2.4-beta', '^1.2.3', true],
    ['1.2.3-beta', '^1.2.3', false],
    ['2.0.0-beta', '^1.2.3', true],
    ['2.0.0', '^1.2.3', false],
  ];
  for (const [version, range, expected] of included) {
    assert.equal(satisfies(version, range, { includePrerelease: true }), expected, `${version} in ${range} with prereleases`);
  }
});

test('maxSatisfying picks the highest match as it was written', () => {
  assert.equal(maxSatisfying(['1.0.0', '1.1.0', '2.0.0'], '^1.0.0'), '1.1.0');
  assert.equal(maxSatisfying(['2.0.0'], '^1.0.0'), null);
  assert.equal(maxSatisfying([], '*'), null);
  assert.equal(maxSatisfying(['v1.2.0', '1.1.0'], '^1'), 'v1.2.0');
  assert.equal(maxSatisfying(['1.0.0+a', '1.0.0+b'], '1.0.0'), '1.0.0+a');
  assert.equal(maxSatisfying(['1.0.0-beta', '1.0.0'], '*'), '1.0.0');
  assert.equal(maxSatisfying(['1.0.0-beta'], '*'), null);
  assert.equal(maxSatisfying(['1.0.0-beta', '1.0.0-alpha'], '*', { includePrerelease: true }), '1.0.0-beta');
  assert.equal(maxSatisfying(['1.2.7', '1.2.9', '2.0.0'], '1.2.7 || >=1.2.9 <2.0.0'), '1.2.9');
  assert.throws(() => maxSatisfying('1.0.0', '*'), /versions must be an array/);
  assert.throws(() => maxSatisfying(['nope'], '*'), SemverError);
});

test('generated versions agree with the comparator algebra', () => {
  const random = mulberry32(0x5e17e2);
  const tags = [[], ['alpha'], ['beta', 1], ['rc', 10], [0], ['x', 'y']];
  const build = ['', '+001', '+meta.7'];

  const make = () => {
    const major = Math.floor(random() * 3);
    const minor = Math.floor(random() * 3);
    const patch = Math.floor(random() * 3);
    const tag = tags[Math.floor(random() * tags.length)];
    const suffix = tag.length > 0 ? `-${tag.join('.')}` : '';
    return `${major}.${minor}.${patch}${suffix}${build[Math.floor(random() * build.length)]}`;
  };

  const options = { includePrerelease: true };
  const pool = [];
  for (let i = 0; i < 40; i += 1) pool.push(make());

  for (let iteration = 0; iteration < 300; iteration += 1) {
    const a = pool[Math.floor(random() * pool.length)];
    const b = pool[Math.floor(random() * pool.length)];
    const order = compare(a, b);
    assert.equal(satisfies(a, `<${b}`, options), order < 0, `${a} < ${b}`);
    assert.equal(satisfies(a, `>=${b}`, options), order >= 0, `${a} >= ${b}`);
    assert.equal(satisfies(a, `${b}`, options), order === 0, `${a} = ${b}`);
    assert.equal(satisfies(a, `>${b} || <${b} || ${b}`, options), true, `${a} against a total range`);
    assert.equal(compare(b, a), order === 0 ? 0 : -order, `${b} vs ${a} must be the mirror`);
  }

  const best = maxSatisfying(pool, '*', options);
  for (const candidate of pool) assert.ok(compare(best, candidate) >= 0, `${best} must be at least ${candidate}`);
});
