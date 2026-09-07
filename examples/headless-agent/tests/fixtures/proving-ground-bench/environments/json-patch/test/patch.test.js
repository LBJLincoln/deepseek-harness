import test from 'node:test';
import assert from 'node:assert/strict';

import { PatchError, PointerError, applyPatch, formatPointer, parsePointer, resolve } from '../src/index.js';

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

const DOCUMENT = {
  name: 'root',
  nested: { list: [10, 20, 30], flag: false, deep: { value: null } },
  'a/b': 'slash',
  'a~b': 'tilde',
  '': 'empty key',
  '0': 'digit key',
};

test('pointers decode reference tokens', () => {
  const cases = [
    ['', []],
    ['/', ['']],
    ['//', ['', '']],
    ['/name', ['name']],
    ['/a~1b', ['a/b']],
    ['/a~0b', ['a~b']],
    ['/~01', ['~1']],
    ['/~10', ['/0']],
    ['/nested/list/0', ['nested', 'list', '0']],
    ['/ x ', [' x ']],
    ['/c%d', ['c%d']],
    ['/\u{1f600}', ['\u{1f600}']],
  ];
  for (const [pointer, tokens] of cases) assert.deepStrictEqual(parsePointer(pointer), tokens, pointer);
  for (const [pointer, tokens] of cases) assert.equal(formatPointer(tokens), pointer, `format ${pointer}`);
});

test('malformed pointers are rejected', () => {
  const cases = [
    ['name', /pointer must be empty or start with '\/'/],
    ['#/name', /pointer must be empty or start with '\/'/],
    ['/~2', /invalid escape in pointer token: ~2/],
    ['/~', /invalid escape in pointer token: ~/],
    ['/a~b', /invalid escape in pointer token: ~b/],
  ];
  for (const [pointer, message] of cases) {
    const error = caught(() => parsePointer(pointer));
    assert.ok(error instanceof PointerError, `expected PointerError for ${pointer}`);
    assert.match(error.message, message);
  }
  assert.throws(() => parsePointer(null), /pointer must be a string/);
  assert.throws(() => formatPointer('x'), /tokens must be an array/);
  assert.throws(() => formatPointer([1]), /reference token must be a string/);
});

test('resolution walks objects and arrays', () => {
  const cases = [
    ['/name', 'root'],
    ['/a~1b', 'slash'],
    ['/a~0b', 'tilde'],
    ['/', 'empty key'],
    ['/0', 'digit key'],
    ['/nested/list/0', 10],
    ['/nested/list/2', 30],
    ['/nested/flag', false],
    ['/nested/deep/value', null],
    ['/nested/list', [10, 20, 30]],
    ['/nested/deep', { value: null }],
  ];
  for (const [pointer, expected] of cases) assert.deepStrictEqual(resolve(DOCUMENT, pointer), expected, pointer);
  assert.strictEqual(resolve(DOCUMENT, ''), DOCUMENT);
});

test('resolution failures name the offending step', () => {
  const cases = [
    ['/missing', /missing property: missing at \/missing/],
    ['/nested/missing/x', /missing property: missing at \/nested\/missing/],
    ['/nested/list/3', /index out of range: 3 at \/nested\/list\/3/],
    ['/nested/list/-', /invalid array index: - at \/nested\/list\/-/],
    ['/nested/list/01', /invalid array index: 01 at \/nested\/list\/01/],
    ['/nested/list/ 1', /invalid array index:  1 at/],
    ['/name/0', /cannot index into string at \/name\/0/],
    ['/nested/flag/x', /cannot index into boolean at/],
    ['/nested/deep/value/x', /cannot index into null at/],
  ];
  for (const [pointer, message] of cases) {
    const error = caught(() => resolve(DOCUMENT, pointer));
    assert.ok(error instanceof PointerError, `expected PointerError for ${pointer}`);
    assert.match(error.message, message);
  }
});

test('add inserts into objects and arrays', () => {
  const cases = [
    [{ a: 1 }, { op: 'add', path: '/b', value: 2 }, { a: 1, b: 2 }],
    [{ a: 1 }, { op: 'add', path: '/a', value: 9 }, { a: 9 }],
    [[1, 2, 3], { op: 'add', path: '/0', value: 0 }, [0, 1, 2, 3]],
    [[1, 2, 3], { op: 'add', path: '/1', value: 9 }, [1, 9, 2, 3]],
    [[1, 2, 3], { op: 'add', path: '/3', value: 4 }, [1, 2, 3, 4]],
    [[1, 2, 3], { op: 'add', path: '/-', value: 4 }, [1, 2, 3, 4]],
    [{ a: {} }, { op: 'add', path: '/a/b', value: [1] }, { a: { b: [1] } }],
    [{ a: 1 }, { op: 'add', path: '', value: 'replaced' }, 'replaced'],
  ];
  for (const [document, operation, expected] of cases) {
    assert.deepStrictEqual(applyPatch(document, [operation]), expected, JSON.stringify(operation));
  }
});

test('remove and replace require an existing target', () => {
  assert.deepStrictEqual(applyPatch({ a: 1, b: 2 }, [{ op: 'remove', path: '/a' }]), { b: 2 });
  assert.deepStrictEqual(applyPatch([1, 2, 3], [{ op: 'remove', path: '/1' }]), [1, 3]);
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: 2 }]), { a: 2 });
  assert.deepStrictEqual(applyPatch([1], [{ op: 'replace', path: '/0', value: 'x' }]), ['x']);
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'replace', path: '', value: 7 }]), 7);
  const cases = [
    [{ a: 1 }, { op: 'remove', path: '/b' }, /missing property: b/],
    [[1], { op: 'remove', path: '/1' }, /index out of range: 1/],
    [[1], { op: 'remove', path: '/-' }, /invalid array index: -/],
    [{ a: 1 }, { op: 'remove', path: '' }, /cannot remove the whole document/],
    [{ a: 1 }, { op: 'replace', path: '/b', value: 1 }, /missing property: b/],
    [[1], { op: 'replace', path: '/1', value: 1 }, /index out of range: 1/],
    [[1], { op: 'add', path: '/2', value: 1 }, /index out of range: 2/],
    [{ a: 'text' }, { op: 'add', path: '/a/0', value: 1 }, /cannot index into string/],
  ];
  for (const [document, operation, message] of cases) {
    const error = caught(() => applyPatch(document, [operation]));
    assert.match(error.message, message, JSON.stringify(operation));
  }
});

test('move and copy relocate values', () => {
  assert.deepStrictEqual(applyPatch({ a: { x: 1 } }, [{ op: 'move', from: '/a', path: '/b' }]), { b: { x: 1 } });
  assert.deepStrictEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/0', path: '/2' }]), [2, 3, 1]);
  assert.deepStrictEqual(applyPatch([1, 2, 3], [{ op: 'move', from: '/2', path: '/0' }]), [3, 1, 2]);
  assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/a' }]), { a: 1 });
  assert.deepStrictEqual(applyPatch({ a: { x: 1 } }, [{ op: 'copy', from: '/a', path: '/b' }]), { a: { x: 1 }, b: { x: 1 } });
  const copied = applyPatch({ a: { x: 1 } }, [{ op: 'copy', from: '/a', path: '/b' }]);
  assert.notStrictEqual(copied.a, copied.b);
  const moveInside = caught(() => applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '/a/c' }]));
  assert.match(moveInside.message, /cannot move a value into its own child/);
  const missingFrom = caught(() => applyPatch({ a: 1 }, [{ op: 'copy', from: '/z', path: '/b' }]));
  assert.ok(missingFrom.cause instanceof PointerError);
});

test('test compares JSON structure, not member order', () => {
  const document = { a: { x: 1, y: [1, 2] }, b: null };
  assert.deepStrictEqual(applyPatch(document, [{ op: 'test', path: '/a', value: { y: [1, 2], x: 1 } }]), document);
  assert.deepStrictEqual(applyPatch(document, [{ op: 'test', path: '/b', value: null }]), document);
  const cases = [
    [{ op: 'test', path: '/a/y', value: [2, 1] }, /test failed at \/a\/y/],
    [{ op: 'test', path: '/a/x', value: '1' }, /test failed at \/a\/x/],
    [{ op: 'test', path: '/b', value: false }, /test failed at \/b/],
    [{ op: 'test', path: '/a', value: { x: 1 } }, /test failed at \/a/],
  ];
  for (const [operation, message] of cases) {
    const error = caught(() => applyPatch(document, [operation]));
    assert.ok(error instanceof PatchError);
    assert.match(error.message, message, JSON.stringify(operation));
    assert.equal(error.index, 0);
  }
});

test('a patch applies whole or not at all', () => {
  const document = { a: [1, 2], b: { c: 3 } };
  const snapshot = JSON.stringify(document);
  const patch = [
    { op: 'add', path: '/a/-', value: 3 },
    { op: 'remove', path: '/b/c' },
    { op: 'test', path: '/a/0', value: 99 },
  ];
  const error = caught(() => applyPatch(document, patch));
  assert.equal(error.index, 2);
  assert.equal(JSON.stringify(document), snapshot);
  const applied = applyPatch(document, patch.slice(0, 2));
  assert.deepStrictEqual(applied, { a: [1, 2, 3], b: {} });
  assert.equal(JSON.stringify(document), snapshot);
});

test('the result never shares structure with the inputs', () => {
  const document = { a: { b: [1] } };
  const empty = applyPatch(document, []);
  assert.deepStrictEqual(empty, document);
  assert.notStrictEqual(empty, document);
  assert.notStrictEqual(empty.a, document.a);
  const value = { shared: true };
  const result = applyPatch(document, [{ op: 'add', path: '/c', value }]);
  assert.notStrictEqual(result.c, value);
  value.shared = false;
  assert.deepStrictEqual(result.c, { shared: true });
});

test('operations are validated before they run', () => {
  const cases = [
    [{ op: 'frob', path: '/a' }, /unknown operation: frob/],
    [{ path: '/a' }, /unknown operation: undefined/],
    [{ op: 'add', value: 1 }, /add requires a path/],
    [{ op: 'add', path: '/a' }, /add requires a value/],
    [{ op: 'test', path: '/a' }, /test requires a value/],
    [{ op: 'move', path: '/a' }, /move requires a from/],
    [{ op: 'copy', path: '/a' }, /copy requires a from/],
    [{ op: 'add', path: 'a', value: 1 }, /pointer must be empty or start with/],
    ['nonsense', /operation must be an object/],
  ];
  for (const [operation, message] of cases) {
    const error = caught(() => applyPatch({ a: 1 }, [operation]));
    assert.ok(error instanceof PatchError, `expected PatchError for ${JSON.stringify(operation)}`);
    assert.match(error.message, message, JSON.stringify(operation));
  }
  assert.throws(() => applyPatch({}, 'nope'), /patch must be an array/);
  assert.throws(() => applyPatch({ a: () => 1 }, []), /document is not JSON data/);
  assert.throws(() => applyPatch({}, [{ op: 'add', path: '/a', value: undefined }]), /value is not JSON data/);
});

test('prototype-shadowing keys stay own properties', () => {
  const result = applyPatch({}, [{ op: 'add', path: '/__proto__', value: { polluted: true } }]);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepStrictEqual(Object.keys(result), ['__proto__']);
  assert.equal({}.polluted, undefined);
  assert.deepStrictEqual(resolve(result, '/__proto__'), { polluted: true });
  assert.throws(() => resolve({}, '/toString'), /missing property: toString/);
});

test('generated documents satisfy the pointer and patch invariants', () => {
  const random = mulberry32(0x7f0e21);
  const keys = ['a', 'b', 'x/y', 't~z', '', '0', 'ü'];
  const encode = (token) => token.split('~').join('~0').split('/').join('~1');

  const grow = (depth) => {
    const roll = random();
    if (depth === 0 || roll < 0.35) {
      const leaves = [0, 1, -2, 3.5, 'text', '', true, false, null];
      return leaves[Math.floor(random() * leaves.length)];
    }
    if (roll < 0.65) {
      const items = [];
      const length = Math.floor(random() * 4);
      for (let i = 0; i < length; i += 1) items.push(grow(depth - 1));
      return items;
    }
    const object = {};
    const size = Math.floor(random() * 4);
    for (let i = 0; i < size; i += 1) object[keys[Math.floor(random() * keys.length)]] = grow(depth - 1);
    return object;
  };

  const collect = (value, pointer, out) => {
    out.push([pointer, value]);
    if (Array.isArray(value)) value.forEach((item, i) => collect(item, `${pointer}/${i}`, out));
    else if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value)) collect(value[key], `${pointer}/${encode(key)}`, out);
    }
  };

  let checked = 0;
  for (let iteration = 0; iteration < 120; iteration += 1) {
    const document = grow(3);
    const snapshot = JSON.stringify(document);
    const entries = [];
    collect(document, '', entries);

    for (const [pointer, value] of entries) {
      assert.strictEqual(resolve(document, pointer), value, `resolve ${pointer} of ${snapshot}`);
      assert.deepStrictEqual(applyPatch(document, [{ op: 'test', path: pointer, value }]), document, `test ${pointer}`);
      const replaced = applyPatch(document, [{ op: 'replace', path: pointer, value: 'SENTINEL' }]);
      assert.equal(resolve(replaced, pointer), 'SENTINEL', `replace ${pointer} of ${snapshot}`);
      if (pointer !== '') {
        const cycled = applyPatch(document, [
          { op: 'remove', path: pointer },
          { op: 'add', path: pointer, value },
        ]);
        assert.deepStrictEqual(cycled, document, `remove then add ${pointer} of ${snapshot}`);
        assert.deepStrictEqual(applyPatch(document, [{ op: 'move', from: pointer, path: pointer }]), document, `move ${pointer}`);
      }
      checked += 1;
    }
    assert.equal(JSON.stringify(document), snapshot, 'the document must never be modified');
  }
  assert.ok(checked > 300, `expected many pointers, got ${checked}`);
});
