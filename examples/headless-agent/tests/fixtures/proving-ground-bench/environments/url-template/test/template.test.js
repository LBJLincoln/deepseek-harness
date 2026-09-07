import test from 'node:test';
import assert from 'node:assert/strict';

import { UriTemplateError, expand, parse } from '../src/index.js';

function caught(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

const VARS = {
  who: 'fred',
  half: '50%',
  empty: '',
  path: '/foo/bar',
  hello: 'Hello World!',
  x: 1024,
  y: 768,
  flag: true,
  zero: 0,
  dom: ['example', 'com'],
  one: ['alpha'],
  blanks: ['', ''],
  none: [],
  opts: { sort: 'asc', page: '2' },
  odd: { 'a b': 'c/d', plain: '' },
  nothing: {},
  uni: 'ü\u{1f600}',
  pct: 'a%20b',
  nil: null,
};

test('templates split into literal and expression parts', () => {
  assert.deepStrictEqual(parse(''), []);
  assert.deepStrictEqual(parse('http://x/y'), [{ type: 'literal', value: 'http://x/y' }]);
  assert.deepStrictEqual(parse('a{b}c{+d}'), [
    { type: 'literal', value: 'a' },
    { type: 'expression', operator: '', variables: [{ name: 'b', explode: false, maxLength: null }] },
    { type: 'literal', value: 'c' },
    { type: 'expression', operator: '+', variables: [{ name: 'd', explode: false, maxLength: null }] },
  ]);
  assert.deepStrictEqual(parse('{?a:3,b*}'), [
    {
      type: 'expression',
      operator: '?',
      variables: [
        { name: 'a', explode: false, maxLength: 3 },
        { name: 'b', explode: true, maxLength: null },
      ],
    },
  ]);
  assert.deepStrictEqual(parse('{a.b}')[0].variables[0].name, 'a.b');
  assert.deepStrictEqual(parse('{%41}')[0].variables[0].name, '%41');
});

test('malformed templates report the opening brace', () => {
  const cases = [
    ['x{a', /unterminated expression at 1/, 1],
    ['a}', /unexpected '}' at 1/, 1],
    ['{}', /empty expression at 0/, 0],
    ['a{+}', /empty variable specification at 1/, 1],
    ['{a,}', /empty variable specification at 0/, 0],
    ['{=a}', /reserved operator '=' at 0/, 0],
    ['{,a}', /reserved operator ',' at 0/, 0],
    ['{a-b}', /invalid variable name 'a-b' at 0/, 0],
    ['{ a}', /invalid variable name ' a' at 0/, 0],
    ['{a:0}', /invalid prefix modifier ':0' at 0/, 0],
    ['{a:10000}', /invalid prefix modifier ':10000' at 0/, 0],
    ['{a:}', /invalid prefix modifier ':' at 0/, 0],
    ['{a*:3}', /invalid variable name 'a\*' at 0/, 0],
    ['{a:3*}', /invalid variable name 'a:3' at 0/, 0],
  ];
  for (const [template, message, index] of cases) {
    const error = caught(() => parse(template));
    assert.ok(error instanceof UriTemplateError, `expected UriTemplateError for ${template}`);
    assert.match(error.message, message);
    assert.equal(error.index, index, `index for ${template}`);
  }
  assert.throws(() => parse(null), /template must be a string/);
});

test('simple and reserved expansion encode differently', () => {
  const cases = [
    ['{who}', 'fred'],
    ['{half}', '50%25'],
    ['{hello}', 'Hello%20World%21'],
    ['{path}', '%2Ffoo%2Fbar'],
    ['{x}', '1024'],
    ['{zero}', '0'],
    ['{flag}', 'true'],
    ['{empty}', ''],
    ['{missing}', ''],
    ['{nil}', ''],
    ['{uni}', '%C3%BC%F0%9F%98%80'],
    ['{pct}', 'a%2520b'],
    ['{+path}/here', '/foo/bar/here'],
    ['{+hello}', 'Hello%20World!'],
    ['{+half}', '50%25'],
    ['{+pct}', 'a%20b'],
    ['{+uni}', '%C3%BC%F0%9F%98%80'],
    ['{#path}', '#/foo/bar'],
    ['{#hello}', '#Hello%20World!'],
    ['{#empty}', '#'],
    ['{#missing}', ''],
    ['here{?who}', 'here?who=fred'],
  ];
  for (const [template, expected] of cases) assert.equal(expand(template, VARS), expected, template);
});

test('literal text is encoded but keeps reserved characters', () => {
  assert.equal(expand('a b{who}', VARS), 'a%20bfred');
  assert.equal(expand('http://e.org/~x?q=1#f', VARS), 'http://e.org/~x?q=1#f');
  assert.equal(expand('café/{who}', VARS), 'caf%C3%A9/fred');
  assert.equal(expand('{who}{who}', VARS), 'fredfred');
});

test('the operator table drives prefix, separator and naming', () => {
  const cases = [
    ['{x,y}', '1024,768'],
    ['{+x,hello,y}', '1024,Hello%20World!,768'],
    ['{#x,hello,y}', '#1024,Hello%20World!,768'],
    ['X{.who}', 'X.fred'],
    ['X{.x,y}', 'X.1024.768'],
    ['{/who}', '/fred'],
    ['{/who,x}/here', '/fred/1024/here'],
    ['{;x,y}', ';x=1024;y=768'],
    ['{;x,y,empty}', ';x=1024;y=768;empty'],
    ['{?x,y,empty}', '?x=1024&y=768&empty='],
    ['{&x}', '&x=1024'],
    ['{&x,empty}', '&x=1024&empty='],
    ['{?x,missing,y}', '?x=1024&y=768'],
    ['{?missing}', ''],
    ['{.missing}', ''],
    ['{/missing}', ''],
  ];
  for (const [template, expected] of cases) assert.equal(expand(template, VARS), expected, template);
});

test('prefix modifiers cut by characters, not code units', () => {
  const cases = [
    ['{who:3}', 'fre'],
    ['{who:10}', 'fred'],
    ['{path:6}', '%2Ffoo%2Fb'],
    ['{path:4}', '%2Ffoo'],
    ['{+path:6}', '/foo/b'],
    ['{#path:6}', '#/foo/b'],
    ['{uni:1}', '%C3%BC'],
    ['{uni:2}', '%C3%BC%F0%9F%98%80'],
    ['{;who:3}', ';who=fre'],
    ['{?who:3}', '?who=fre'],
    ['{half:2}', '50'],
  ];
  for (const [template, expected] of cases) assert.equal(expand(template, VARS), expected, template);
  const error = caught(() => expand('{dom:2}', VARS));
  assert.ok(error instanceof UriTemplateError);
  assert.match(error.message, /prefix modifier applied to a composite value: 'dom'/);
  assert.throws(() => expand('{opts:2}', VARS), /prefix modifier applied to a composite value: 'opts'/);
});

test('lists and maps expand with and without the explode modifier', () => {
  const cases = [
    ['{dom}', 'example,com'],
    ['{dom*}', 'example,com'],
    ['{+dom}', 'example,com'],
    ['{/dom}', '/example,com'],
    ['{/dom*}', '/example/com'],
    ['{.dom*}', '.example.com'],
    ['{?dom}', '?dom=example,com'],
    ['{?dom*}', '?dom=example&dom=com'],
    ['{&dom*}', '&dom=example&dom=com'],
    ['{;dom}', ';dom=example,com'],
    ['{;dom*}', ';dom=example;dom=com'],
    ['{one*}', 'alpha'],
    ['{?one*}', '?one=alpha'],
    ['{?blanks}', '?blanks=,'],
    ['{?blanks*}', '?blanks=&blanks='],
    ['{none}', ''],
    ['{?none}', ''],
    ['{;none*}', ''],
    ['{opts}', 'sort,asc,page,2'],
    ['{opts*}', 'sort=asc,page=2'],
    ['{+opts}', 'sort,asc,page,2'],
    ['{/opts*}', '/sort=asc/page=2'],
    ['{.opts*}', '.sort=asc.page=2'],
    ['{?opts}', '?opts=sort,asc,page,2'],
    ['{?opts*}', '?sort=asc&page=2'],
    ['{;opts*}', ';sort=asc;page=2'],
    ['{odd}', 'a%20b,c%2Fd,plain,'],
    ['{odd*}', 'a%20b=c%2Fd,plain='],
    ['{?odd*}', '?a%20b=c%2Fd&plain='],
    ['{+odd*}', 'a%20b=c/d,plain='],
    ['{nothing}', ''],
    ['{?nothing*}', ''],
    ['{?dom*,x}', '?dom=example&dom=com&x=1024'],
  ];
  for (const [template, expected] of cases) assert.equal(expand(template, VARS), expected, template);
});

test('only own properties are bound and unusable values are rejected', () => {
  assert.equal(expand('{toString}', VARS), '');
  assert.equal(expand('{who}', Object.create({ who: 'inherited' })), '');
  assert.throws(() => expand('{a}', { a: () => 1 }), /value for 'a' is not a string, number or boolean/);
  assert.throws(() => expand('{a}', { a: Number.NaN }), /value for 'a' is not a string, number or boolean/);
  assert.throws(() => expand('{a*}', { a: [1, {}] }), /value for 'a' is not a string, number or boolean/);
  assert.throws(() => expand('{a}', null), /variables must be an object/);
  assert.equal(expand('{a}', { a: [null, 'x', undefined] }), 'x');
  assert.equal(expand('{?a*}', { a: { k: null, j: 'v' } }), '?j=v');
});

test('every operator round-trips a value that needs no encoding', () => {
  const operators = ['', '+', '#', '.', '/', ';', '?', '&'];
  const firsts = { '': '', '+': '', '#': '#', '.': '.', '/': '/', ';': ';', '?': '?', '&': '&' };
  for (const operator of operators) {
    const expanded = expand(`{${operator}v}`, { v: 'plain' });
    const expected = `${firsts[operator]}${['?', '&', ';'].includes(operator) ? 'v=' : ''}plain`;
    assert.equal(expanded, expected, `operator ${operator || '(simple)'}`);
  }
});
