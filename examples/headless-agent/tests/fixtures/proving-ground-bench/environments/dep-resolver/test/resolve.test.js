import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictError, ResolveError, resolve, satisfies } from '../src/index.js';

/** Deterministic 32-bit PRNG so generated registries replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const chain = {
  a: {
    '1.0.0': { deps: { b: '^1.0.0' } },
    '1.2.0': { deps: { b: '^1.0.0' } },
    '2.0.0': { deps: { b: '^2.0.0' } },
  },
  b: { '1.0.0': {}, '1.5.0': {}, '2.0.0': {} },
};

test('resolution takes the highest satisfying version of each package', () => {
  assert.deepEqual(resolve(chain, { a: '^1.0.0' }), {
    resolved: { a: '1.2.0', b: '1.5.0' },
    order: ['a', 'b'],
  });
  assert.deepEqual(resolve(chain, { a: '*' }), {
    resolved: { a: '2.0.0', b: '2.0.0' },
    order: ['a', 'b'],
  });
  assert.deepEqual(resolve(chain, {}), { resolved: {}, order: [] });
  assert.deepEqual(resolve({ p: { '1.0.0': {}, '1.10.0': {}, '1.9.0': {} } }, { p: '^1.0.0' }).resolved, {
    p: '1.10.0',
  });
});

test('constraints from several requirers narrow one choice', () => {
  const registry = {
    left: { '1.0.0': { deps: { shared: '<2.0.0' } } },
    right: { '1.0.0': { deps: { shared: '>=1.5.0' } } },
    shared: { '1.0.0': {}, '1.5.0': {}, '1.9.0': {}, '2.0.0': {} },
  };
  const result = resolve(registry, { left: '*', right: '*' });
  assert.deepEqual(result.resolved, { left: '1.0.0', right: '1.0.0', shared: '1.9.0' });
  assert.deepEqual(result.order, ['left', 'right', 'shared']);
});

test('packages are visited in a fixed order', () => {
  const registry = {
    apple: { '1.0.0': {} },
    zebra: { '1.0.0': { deps: { mango: '*' } } },
    mango: { '1.0.0': {} },
  };
  const result = resolve(registry, { zebra: '*', apple: '*' });
  assert.deepEqual(result.order, ['apple', 'zebra', 'mango']);
  assert.deepEqual(Object.keys(result.resolved), ['apple', 'mango', 'zebra']);
});

test('a cycle resolves once every package is chosen', () => {
  const registry = {
    ping: { '1.0.0': { deps: { pong: '^1.0.0' } } },
    pong: { '1.0.0': { deps: { ping: '^1.0.0' } } },
  };
  assert.deepEqual(resolve(registry, { ping: '*' }), {
    resolved: { ping: '1.0.0', pong: '1.0.0' },
    order: ['ping', 'pong'],
  });
});

test('an unsatisfiable root constraint names the root', () => {
  const registry = { solo: { '1.0.0': {}, '2.0.0': {} } };
  assert.throws(
    () => resolve(registry, { solo: '>=3.0.0' }),
    (error) => {
      assert.equal(error instanceof ConflictError, true);
      assert.equal(error instanceof ResolveError, true);
      assert.equal(error.name, 'ConflictError');
      assert.equal(error.code, 'CONFLICT');
      assert.equal(error.packageName, 'solo');
      assert.deepEqual(error.constraints, [{ range: '>=3.0.0', via: '<root>' }]);
      assert.deepEqual(error.available, ['1.0.0', '2.0.0']);
      assert.equal(error.message, 'cannot satisfy solo: >=3.0.0 (from <root>)');
      return true;
    },
  );
});

test('a conflict between two requirers lists both chains', () => {
  const registry = {
    alpha: { '1.0.0': { deps: { core: '<2.0.0' } } },
    zeta: { '1.0.0': { deps: { core: '>=2.0.0' } } },
    core: { '1.0.0': {}, '1.9.0': {}, '2.0.0': {} },
  };
  assert.throws(
    () => resolve(registry, { alpha: '*', zeta: '*' }),
    (error) => {
      assert.equal(error.packageName, 'core');
      assert.deepEqual(error.constraints, [
        { range: '<2.0.0', via: '<root> > alpha@1.0.0' },
        { range: '>=2.0.0', via: '<root> > zeta@1.0.0' },
      ]);
      assert.equal(
        error.message,
        'cannot satisfy core: <2.0.0 (from <root> > alpha@1.0.0), >=2.0.0 (from <root> > zeta@1.0.0)',
      );
      return true;
    },
  );
});

test('a deep conflict names the whole chain that asked for it', () => {
  const registry = {
    top: { '1.0.0': { deps: { mid: '^1.0.0' } } },
    mid: { '1.0.0': { deps: { leaf: '>=5.0.0' } } },
    leaf: { '1.0.0': {}, '2.0.0': {} },
  };
  assert.throws(
    () => resolve(registry, { top: '^1.0.0' }),
    (error) => {
      assert.equal(error.packageName, 'leaf');
      assert.deepEqual(error.constraints, [{ range: '>=5.0.0', via: '<root> > top@1.0.0 > mid@1.0.0' }]);
      assert.equal(error.message, 'cannot satisfy leaf: >=5.0.0 (from <root> > top@1.0.0 > mid@1.0.0)');
      return true;
    },
  );
});

test('missing packages are reported before anything else fails', () => {
  assert.throws(() => resolve({}, { ghost: '*' }), {
    name: 'ResolveError',
    code: 'UNKNOWN_PACKAGE',
    message: 'unknown package: ghost',
  });
  assert.throws(() => resolve({ a: { '1.0.0': { deps: { missing: '*' } } } }, { a: '*' }), {
    code: 'UNKNOWN_PACKAGE',
    message: 'unknown package: missing',
  });
  assert.throws(() => resolve({ empty: {} }, { empty: '*' }), { code: 'CONFLICT' });
});

test('the registry and the root dependencies are validated', () => {
  assert.throws(() => resolve(null, {}), { code: 'BAD_REGISTRY', message: 'registry must be an object' });
  assert.throws(() => resolve([], {}), { code: 'BAD_REGISTRY' });
  assert.throws(() => resolve({ a: 'nope' }, {}), {
    code: 'BAD_REGISTRY',
    message: 'registry entry must be an object: a',
  });
  assert.throws(() => resolve({ a: { '1.x': {} } }, {}), { code: 'BAD_VERSION' });
  assert.throws(() => resolve({ a: { '1.0.0': null } }, {}), {
    code: 'BAD_REGISTRY',
    message: 'metadata must be an object: a@1.0.0',
  });
  assert.throws(() => resolve({ a: { '1.0.0': { deps: 'x' } } }, {}), { code: 'BAD_DEPENDENCIES' });
  assert.throws(() => resolve({ a: { '1.0.0': { deps: { b: 'bad' } } } }, {}), { code: 'BAD_RANGE' });
  assert.throws(() => resolve({}, null), {
    code: 'BAD_DEPENDENCIES',
    message: 'root dependencies must be an object',
  });
  assert.throws(() => resolve({}, { a: '^' }), { code: 'BAD_RANGE' });
});

test('every successful resolution satisfies every constraint it collected', () => {
  const pick = mulberry32(606060);
  const names = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const versions = ['1.0.0', '1.1.0', '1.2.0', '1.4.0', '2.0.0'];
  const ranges = ['*', '^1.0.0', '>=1.2.0', '~1.1.0', '<1.4.0', '^2.0.0'];
  let successes = 0;
  let conflicts = 0;
  for (let round = 0; round < 200; round += 1) {
    const registry = {};
    names.forEach((name, index) => {
      registry[name] = {};
      for (const version of versions) {
        if (pick() < 0.35) continue;
        const deps = {};
        for (const other of names.slice(index + 1)) {
          if (pick() < 0.3) deps[other] = ranges[Math.floor(pick() * ranges.length)];
        }
        registry[name][version] = { deps };
      }
      if (Object.keys(registry[name]).length === 0) registry[name]['1.0.0'] = { deps: {} };
    });
    const rootDeps = {};
    for (const name of names) {
      if (pick() < 0.5) rootDeps[name] = ranges[Math.floor(pick() * ranges.length)];
    }

    let result;
    try {
      result = resolve(registry, rootDeps);
    } catch (error) {
      conflicts += 1;
      assert.equal(error.code, 'CONFLICT', `round ${round} failed for the expected reason`);
      assert.ok(error.constraints.length >= 1, 'a conflict always cites a constraint');
      assert.ok(error.message.startsWith(`cannot satisfy ${error.packageName}: `), 'the message names the package');
      continue;
    }
    successes += 1;
    assert.deepEqual(Object.keys(result.resolved), [...Object.keys(result.resolved)].sort(), 'keys are ordered');
    assert.deepEqual([...result.order].sort(), Object.keys(result.resolved), 'order lists exactly what was resolved');
    assert.equal(new Set(result.order).size, result.order.length, 'nothing is selected twice');
    for (const [name, range] of Object.entries(rootDeps)) {
      assert.ok(satisfies(result.resolved[name], range), `root ${name} ${range} is satisfied`);
    }
    for (const [name, version] of Object.entries(result.resolved)) {
      const deps = registry[name][version].deps ?? {};
      for (const [dep, range] of Object.entries(deps)) {
        assert.ok(result.resolved[dep] !== undefined, `${dep} required by ${name} was selected`);
        assert.ok(satisfies(result.resolved[dep], range), `${name}@${version} needs ${dep} ${range}`);
      }
    }
  }
  assert.ok(successes > 20, `enough registries resolved (${successes})`);
  assert.ok(conflicts > 5, `enough registries conflicted (${conflicts})`);
});
