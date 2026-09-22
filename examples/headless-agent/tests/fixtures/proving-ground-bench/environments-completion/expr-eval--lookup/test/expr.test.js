import test from 'node:test';
import assert from 'node:assert/strict';

import { ExprError, evaluate, parse, tokenize } from '../src/index.js';

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

test('tokenises numbers, names, operators and punctuation', () => {
  assert.deepStrictEqual(tokenize(''), []);
  assert.deepStrictEqual(tokenize('  \t\n '), []);
  assert.deepStrictEqual(tokenize('1 + x'), [
    { type: 'number', value: 1, index: 0 },
    { type: 'operator', value: '+', index: 2 },
    { type: 'name', value: 'x', index: 4 },
  ]);
  assert.deepStrictEqual(tokenize('f(2,-3)'), [
    { type: 'name', value: 'f', index: 0 },
    { type: 'lparen', value: '(', index: 1 },
    { type: 'number', value: 2, index: 2 },
    { type: 'comma', value: ',', index: 3 },
    { type: 'operator', value: '-', index: 4 },
    { type: 'number', value: 3, index: 5 },
    { type: 'rparen', value: ')', index: 6 },
  ]);
});

test('number literals accept decimals and exponents', () => {
  const cases = [
    ['0', 0],
    ['42', 42],
    ['3.5', 3.5],
    ['.5', 0.5],
    ['1e3', 1000],
    ['1E-3', 0.001],
    ['2.5e+2', 250],
    ['.5e1', 5],
  ];
  for (const [source, value] of cases) {
    assert.deepStrictEqual(tokenize(source), [{ type: 'number', value, index: 0 }], source);
  }
});

test('the tree keeps operator positions and drops parentheses', () => {
  assert.deepStrictEqual(parse('1+2'), {
    type: 'binary',
    op: '+',
    left: { type: 'number', value: 1, index: 0 },
    right: { type: 'number', value: 2, index: 2 },
    index: 1,
  });
  assert.deepStrictEqual(parse('(7)'), { type: 'number', value: 7, index: 1 });
  assert.deepStrictEqual(parse('-x'), {
    type: 'unary',
    op: '-',
    operand: { type: 'variable', name: 'x', index: 1 },
    index: 0,
  });
  assert.deepStrictEqual(parse('max(1)'), {
    type: 'call',
    name: 'max',
    args: [{ type: 'number', value: 1, index: 4 }],
    index: 0,
  });
});

test('precedence, associativity and unary signs', () => {
  const cases = [
    ['1+2*3', 7],
    ['(1+2)*3', 9],
    ['2*3+4*5', 26],
    ['100/10/2', 5],
    ['100-10-2', 88],
    ['2^3^2', 512],
    ['(2^3)^2', 64],
    ['-2^2', -4],
    ['(-2)^2', 4],
    ['2^-2', 0.25],
    ['-2*3', -6],
    ['2*-3', -6],
    ['5--3', 8],
    ['--3', 3],
    ['+-3', -3],
    ['-+-3', 3],
    ['10%3', 1],
    ['-7%3', -1],
    ['7%-3', 1],
    ['2+3%2', 3],
    ['1/4', 0.25],
    ['  1  +  2  ', 3],
    ['-(2+3)', -5],
  ];
  for (const [source, expected] of cases) assert.equal(evaluate(source), expected, source);
});

test('negative zero survives evaluation', () => {
  assert.ok(Object.is(evaluate('-0'), -0));
  assert.ok(Object.is(evaluate('0'), 0));
});

test('variables shadow the built-in constants', () => {
  assert.equal(evaluate('x*2', { x: 21 }), 42);
  assert.equal(evaluate('pi'), Math.PI);
  assert.equal(evaluate('e'), Math.E);
  assert.equal(evaluate('pi', { pi: 3 }), 3);
  assert.equal(evaluate('a+b*c', { a: 1, b: 2, c: 3 }), 7);
  assert.equal(evaluate('_x1', { _x1: 5 }), 5);
});

test('built-in functions and their arities', () => {
  const cases = [
    ['abs(-3)', 3],
    ['sqrt(16)', 4],
    ['floor(-1.5)', -2],
    ['ceil(-1.5)', -1],
    ['round(2.5)', 3],
    ['round(-2.5)', -2],
    ['sign(-4)', -1],
    ['pow(2,10)', 1024],
    ['min(3,1,2)', 1],
    ['max(3,1,2)', 3],
    ['min(5)', 5],
    ['max(1+1, 2*2, -8)', 4],
    ['abs(0-min(1,2))', 1],
  ];
  for (const [source, expected] of cases) assert.equal(evaluate(source), expected, source);
});

test('lexical failures report the offending position', () => {
  const cases = [
    ['1 + $', /unexpected character '\$' at 4/, 4],
    ['1 + \u{1f600}', /unexpected character '\u{1f600}' at 4/u, 4],
    ['1.2.3', /malformed number at 0/, 0],
    ['1e', /malformed number at 0/, 0],
    ['1e+', /malformed number at 0/, 0],
    ['2abc', /malformed number at 0/, 0],
    ['1 + 4.', /malformed number at 4/, 4],
  ];
  for (const [source, message, index] of cases) {
    const error = caught(() => tokenize(source));
    assert.ok(error instanceof ExprError, `expected ExprError for ${source}`);
    assert.match(error.message, message);
    assert.equal(error.index, index, `index for ${source}`);
  }
});

test('syntactic failures report the offending position', () => {
  const cases = [
    ['', /unexpected end of input at 0/, 0],
    ['2 +', /unexpected end of input at 3/, 3],
    ['(1+2', /missing closing parenthesis at 4/, 4],
    ['(1 2)', /missing closing parenthesis at 3/, 3],
    ['1 + )', /unexpected token '\)' at 4/, 4],
    ['1 2', /unexpected token '2' at 2/, 2],
    ['max(1,)', /unexpected token '\)' at 6/, 6],
    ['max(1 2)', /unexpected token '2' at 6/, 6],
    ['*3', /unexpected token '\*' at 0/, 0],
    ['(1))', /unexpected token '\)' at 3/, 3],
  ];
  for (const [source, message, index] of cases) {
    const error = caught(() => parse(source));
    assert.ok(error instanceof ExprError, `expected ExprError for ${JSON.stringify(source)}`);
    assert.match(error.message, message);
    assert.equal(error.index, index, `index for ${JSON.stringify(source)}`);
  }
});

test('semantic failures report the offending position', () => {
  const cases = [
    ['1/0', {}, /division by zero at 1/, 1],
    ['1 % 0', {}, /division by zero at 2/, 2],
    ['1/(3-3)', {}, /division by zero at 1/, 1],
    ['sqrt(-1)', {}, /non-finite result at 0/, 0],
    ['1e308*10', {}, /non-finite result at 5/, 5],
    ['x', {}, /unknown variable: x at 0/, 0],
    ['1 + y*2', {}, /unknown variable: y at 4/, 4],
    ['x', { x: 'no' }, /variable x is not a finite number at 0/, 0],
    ['x', { x: Number.POSITIVE_INFINITY }, /variable x is not a finite number at 0/, 0],
    ['foo(1)', {}, /unknown function: foo at 0/, 0],
    ['abs(1,2)', {}, /function abs expects 1 argument, got 2 at 0/, 0],
    ['abs()', {}, /function abs expects 1 argument, got 0 at 0/, 0],
    ['pow(2)', {}, /function pow expects 2 arguments, got 1 at 0/, 0],
    ['max()', {}, /function max expects at least 1 argument, got 0 at 0/, 0],
    ['1 + max()', {}, /function max expects at least 1 argument, got 0 at 4/, 4],
  ];
  for (const [source, env, message, index] of cases) {
    const error = caught(() => evaluate(source, env));
    assert.ok(error instanceof ExprError, `expected ExprError for ${source}`);
    assert.match(error.message, message);
    assert.equal(error.index, index, `index for ${source}`);
  }
});

test('inherited properties are not variable bindings', () => {
  assert.throws(() => evaluate('toString'), /unknown variable: toString at 0/);
  assert.throws(() => evaluate('constructor', { x: 1 }), /unknown variable: constructor at 0/);
});

test('generated expressions agree with an independent rendering of the same tree', () => {
  const random = mulberry32(0x1234abc);
  const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '%': 2, '^': 4 };
  const OPERATORS = ['+', '-', '*', '/', '%', '^'];

  const precedenceOf = (node) => (node.kind === 'number' ? 100 : node.kind === 'negate' ? 3 : PRECEDENCE[node.op]);

  const render = (node) => {
    if (node.kind === 'number') return String(node.value);
    if (node.kind === 'negate') {
      const inner = render(node.operand);
      return precedenceOf(node.operand) < 3 ? `-(${inner})` : `-${inner}`;
    }
    const level = PRECEDENCE[node.op];
    const rightAssociative = node.op === '^';
    const leftPrecedence = precedenceOf(node.left);
    const rightPrecedence = precedenceOf(node.right);
    const left = (rightAssociative ? leftPrecedence <= level : leftPrecedence < level) ? `(${render(node.left)})` : render(node.left);
    const right = (rightAssociative ? rightPrecedence < level : rightPrecedence <= level) ? `(${render(node.right)})` : render(node.right);
    return `${left}${node.op}${right}`;
  };

  const renderFully = (node) => {
    if (node.kind === 'number') return String(node.value);
    if (node.kind === 'negate') return `(-${renderFully(node.operand)})`;
    return `(${renderFully(node.left)}${node.op}${renderFully(node.right)})`;
  };

  const compute = (node) => {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'negate') return -compute(node.operand);
    const left = compute(node.left);
    const right = compute(node.right);
    if ((node.op === '/' || node.op === '%') && right === 0) throw new Error('skip');
    const value =
      node.op === '+'
        ? left + right
        : node.op === '-'
          ? left - right
          : node.op === '*'
            ? left * right
            : node.op === '/'
              ? left / right
              : node.op === '%'
                ? left % right
                : left ** right;
    if (!Number.isFinite(value)) throw new Error('skip');
    return value;
  };

  const grow = (depth) => {
    if (depth === 0 || random() < 0.25) return { kind: 'number', value: 1 + Math.floor(random() * 9) };
    if (random() < 0.2) return { kind: 'negate', operand: grow(depth - 1) };
    const op = OPERATORS[Math.floor(random() * OPERATORS.length)];
    const right = op === '^' ? { kind: 'number', value: Math.floor(random() * 4) } : grow(depth - 1);
    return { kind: 'binary', op, left: grow(depth - 1), right };
  };

  let checked = 0;
  for (let iteration = 0; iteration < 400; iteration += 1) {
    const tree = grow(3);
    let expected;
    try {
      expected = compute(tree);
    } catch {
      continue;
    }
    const source = render(tree);
    assert.equal(evaluate(source), expected, `${source} should be ${expected}`);
    assert.equal(evaluate(renderFully(tree)), expected, `${renderFully(tree)} should be ${expected}`);
    checked += 1;
  }
  assert.ok(checked > 200, `expected many usable samples, got ${checked}`);
});
