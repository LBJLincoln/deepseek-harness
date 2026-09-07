import test from 'node:test';
import assert from 'node:assert/strict';
import { ResolveError, compareVersions, maxSatisfying, parseRange, parseVersion, satisfies } from '../src/index.js';

test('parseVersion accepts three numeric parts and nothing else', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseVersion('0.0.0'), { major: 0, minor: 0, patch: 0 });
  assert.deepEqual(parseVersion('10.20.30'), { major: 10, minor: 20, patch: 30 });
  for (const bad of ['1.2', '1.2.3.4', 'v1.2.3', '01.2.3', '1.02.3', '1.2.3-beta', '', ' 1.2.3', '1.2.x', 5, null]) {
    assert.throws(() => parseVersion(bad), { name: 'ResolveError', code: 'BAD_VERSION' }, `parseVersion(${bad})`);
  }
  assert.equal(new ResolveError('X', 'y') instanceof Error, true);
});

test('compareVersions orders numerically, not lexically', () => {
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.equal(compareVersions('2.0.0', '10.0.0'), -1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
  assert.equal(compareVersions('0.0.1', '0.1.0'), -1);
  assert.deepEqual(['1.10.0', '1.2.0', '1.9.0'].sort(compareVersions), ['1.2.0', '1.9.0', '1.10.0']);
});

test('parseRange expands carets and tildes into comparators', () => {
  assert.deepEqual(parseRange('*'), []);
  assert.deepEqual(parseRange('1.2.3'), [{ operator: '=', version: '1.2.3' }]);
  assert.deepEqual(parseRange('=1.2.3'), [{ operator: '=', version: '1.2.3' }]);
  assert.deepEqual(parseRange('^1.2.3'), [
    { operator: '>=', version: '1.2.3' },
    { operator: '<', version: '2.0.0' },
  ]);
  assert.deepEqual(parseRange('^0.2.3'), [
    { operator: '>=', version: '0.2.3' },
    { operator: '<', version: '0.3.0' },
  ]);
  assert.deepEqual(parseRange('^0.0.3'), [
    { operator: '>=', version: '0.0.3' },
    { operator: '<', version: '0.0.4' },
  ]);
  assert.deepEqual(parseRange('~1.2.3'), [
    { operator: '>=', version: '1.2.3' },
    { operator: '<', version: '1.3.0' },
  ]);
  assert.deepEqual(parseRange('>=1.0.0 <2.0.0'), [
    { operator: '>=', version: '1.0.0' },
    { operator: '<', version: '2.0.0' },
  ]);
  assert.deepEqual(parseRange('  >1.0.0   <=2.0.0  '), [
    { operator: '>', version: '1.0.0' },
    { operator: '<=', version: '2.0.0' },
  ]);
});

test('parseRange rejects malformed ranges', () => {
  for (const bad of ['', '   ', '^1.2', '1.2.3.4', '>=', '>= 1.0.0', 'x', '* 1.0.0', '1.0.0 *', '^', '~', 'v1.0.0', 7]) {
    assert.throws(() => parseRange(bad), { name: 'ResolveError', code: 'BAD_RANGE' }, `parseRange(${bad})`);
  }
});

test('satisfies honours every boundary', () => {
  const cases = [
    ['1.2.3', '*', true],
    ['0.0.0', '*', true],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.2.3', '^1.2.3', true],
    ['1.9.9', '^1.2.3', true],
    ['1.2.2', '^1.2.3', false],
    ['2.0.0', '^1.2.3', false],
    ['1.0.0', '^1.0.0', true],
    ['0.2.3', '^0.2.3', true],
    ['0.2.9', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.2.2', '^0.2.3', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.2.3', '~1.2.3', true],
    ['1.2.99', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.2.2', '~1.2.3', false],
    ['1.5.0', '>=1.0.0 <2.0.0', true],
    ['2.0.0', '>=1.0.0 <2.0.0', false],
    ['1.0.0', '>=1.0.0 <2.0.0', true],
    ['1.0.0', '>1.0.0', false],
    ['1.0.1', '>1.0.0', true],
    ['2.0.0', '<=2.0.0', true],
    ['2.0.1', '<=2.0.0', false],
    ['1.10.0', '<1.9.0', false],
    ['1.9.0', '<1.10.0', true],
  ];
  for (const [version, range, expected] of cases) {
    assert.equal(satisfies(version, range), expected, `${version} vs ${range}`);
  }
  assert.throws(() => satisfies('1.2', '*'), { code: 'BAD_VERSION' });
  assert.throws(() => satisfies('1.2.3', 'nope'), { code: 'BAD_RANGE' });
});

test('maxSatisfying picks the highest match', () => {
  const versions = ['1.0.0', '1.10.0', '1.9.0', '2.0.0', '0.9.0'];
  assert.equal(maxSatisfying(versions, '*'), '2.0.0');
  assert.equal(maxSatisfying(versions, '^1.0.0'), '1.10.0');
  assert.equal(maxSatisfying(versions, '~1.9.0'), '1.9.0');
  assert.equal(maxSatisfying(versions, '<1.0.0'), '0.9.0');
  assert.equal(maxSatisfying(versions, '>=3.0.0'), null);
  assert.equal(maxSatisfying([], '*'), null);
  assert.equal(maxSatisfying(['1.2.3'], '1.2.3'), '1.2.3');
  assert.throws(() => maxSatisfying('1.0.0', '*'), { code: 'BAD_VERSION' });
});
