import test from 'node:test';
import assert from 'node:assert/strict';
import { TemplateError, compile, escapeHtml, parse, render } from '../src/index.js';

/** Deterministic 32-bit PRNG so generated values replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Undo escaping, innermost entity last, so double escaping is visible. */
function unescapeHtml(text) {
  return text
    .split('&#39;')
    .join("'")
    .split('&quot;')
    .join('"')
    .split('&gt;')
    .join('>')
    .split('&lt;')
    .join('<')
    .split('&amp;')
    .join('&');
}

test('escapeHtml escapes the ampersand before it escapes anything else', () => {
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('&<>'), '&amp;&lt;&gt;');
  assert.equal(escapeHtml('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('&amp;'), '&amp;amp;');
  assert.equal(escapeHtml('1 < 2 && 3 > 2'), '1 &lt; 2 &amp;&amp; 3 &gt; 2');
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml('plain text'), 'plain text');
  assert.throws(() => escapeHtml(5), { name: 'TemplateError', code: 'BAD_INPUT' });
});

test('parse builds the node list', () => {
  assert.deepEqual(parse('hello'), [{ type: 'text', value: 'hello' }]);
  assert.deepEqual(parse(''), []);
  assert.deepEqual(parse('{{name}}'), [{ type: 'variable', name: 'name', escaped: true }]);
  assert.deepEqual(parse('{{{name}}}'), [{ type: 'variable', name: 'name', escaped: false }]);
  assert.deepEqual(parse('{{& name }}'), [{ type: 'variable', name: 'name', escaped: false }]);
  assert.deepEqual(parse('{{ a.b }}'), [{ type: 'variable', name: 'a.b', escaped: true }]);
  assert.deepEqual(parse('{{.}}'), [{ type: 'variable', name: '.', escaped: true }]);
  assert.deepEqual(parse('a{{! note }}b'), [{ type: 'text', value: 'ab' }]);
  assert.deepEqual(parse('{{>bit}}'), [{ type: 'partial', name: 'bit' }]);
  assert.deepEqual(parse('{{#a}}x{{/a}}'), [
    { type: 'section', name: 'a', inverted: false, children: [{ type: 'text', value: 'x' }] },
  ]);
  assert.deepEqual(parse('{{^a}}x{{/a}}'), [
    { type: 'section', name: 'a', inverted: true, children: [{ type: 'text', value: 'x' }] },
  ]);
});

test('interpolation escapes by default and stringifies every value', () => {
  assert.equal(render('{{a}}', { a: '<b>' }), '&lt;b&gt;');
  assert.equal(render('{{{a}}}', { a: '<b>' }), '<b>');
  assert.equal(render('{{&a}}', { a: '<b>' }), '<b>');
  assert.equal(render('{{a}}', {}), '');
  assert.equal(render('{{a}}', { a: null }), '');
  assert.equal(render('{{a}}', { a: undefined }), '');
  assert.equal(render('{{a}}', { a: 0 }), '0', 'zero is a value, not an absence');
  assert.equal(render('{{a}}', { a: false }), 'false', 'false is a value, not an absence');
  assert.equal(render('{{a}}', { a: '' }), '');
  assert.equal(render('{{a}}', { a: 12.5 }), '12.5');
  assert.equal(render('x{{a}}y', { a: '-' }), 'x-y');
  assert.equal(render('{{a.b.c}}', { a: { b: { c: 'deep' } } }), 'deep');
  assert.equal(render('{{a.b}}', { a: {} }), '');
  assert.equal(render('{{a.b}}', { a: 'text' }), '');
});

test('sections iterate, scope and skip', () => {
  assert.equal(render('{{#xs}}[{{.}}]{{/xs}}', { xs: [1, 2, 3] }), '[1][2][3]');
  assert.equal(render('{{#xs}}{{n}}{{/xs}}', { xs: [{ n: 1 }, { n: 2 }] }), '12');
  assert.equal(render('{{#o}}{{n}}{{/o}}', { o: { n: 'x' } }), 'x');
  assert.equal(render('{{#t}}yes{{/t}}', { t: true }), 'yes');
  assert.equal(render('{{#t}}{{t}}{{/t}}', { t: 'v' }), 'v');
  assert.equal(render('{{#xs}}x{{/xs}}', { xs: [] }), '');
  assert.equal(render('{{#xs}}x{{/xs}}', { xs: 0 }), '');
  assert.equal(render('{{#xs}}x{{/xs}}', {}), '');
  assert.equal(render('{{#a}}{{#b}}{{.}}{{/b}}{{/a}}', { a: { b: ['q'] } }), 'q');
});

test('inverted sections render exactly when a section would not', () => {
  const cases = [
    [[], 'none'],
    [[1], ''],
    [false, 'none'],
    [true, ''],
    [0, 'none'],
    ['', 'none'],
    [undefined, 'none'],
    [null, 'none'],
    ['x', ''],
    [{}, ''],
  ];
  for (const [value, expected] of cases) {
    assert.equal(render('{{^a}}none{{/a}}', { a: value }), expected, `inverted for ${JSON.stringify(value)}`);
  }
  assert.equal(render('{{^missing}}none{{/missing}}', {}), 'none');
});

test('the context stack is searched innermost first', () => {
  assert.equal(render('{{#xs}}{{name}}{{/xs}}', { name: 'outer', xs: [{ name: 'inner' }, {}] }), 'innerouter');
  assert.equal(render('{{#xs}}{{top}}{{/xs}}', { top: 'T', xs: [{}, {}] }), 'TT');
  assert.equal(render('{{#a}}{{b.c}}{{/a}}', { a: [{}], b: { c: 'parent' } }), 'parent');
  assert.equal(render('{{#a}}{{#b}}{{v}}{{/b}}{{/a}}', { v: 'root', a: { v: 'mid', b: { x: 1 } } }), 'mid');
  assert.equal(render('{{#a}}{{v}}{{/a}}{{v}}', { v: 'root', a: [{ v: 'own' }] }), 'ownroot');
});

test('partials render in the current context', () => {
  assert.equal(render('{{>p}}', { x: 'v' }, { partials: { p: '[{{x}}]' } }), '[v]');
  assert.equal(render('{{>p}}', {}, { partials: { p: '{{>q}}', q: 'deep' } }), 'deep');
  assert.equal(render('{{#xs}}{{>p}}{{/xs}}', { xs: [{ n: 1 }, { n: 2 }] }, { partials: { p: '{{n}}' } }), '12');
  assert.equal(
    render('{{>p}}{{>p}}{{>p}}{{>p}}{{>p}}', {}, { partials: { p: 'p' }, maxDepth: 3 }),
    'ppppp',
    'partials side by side do not nest',
  );
  assert.equal(render('{{>p}}', {}, { partials: { p: '{{>q}}{{>q}}', q: 'x' }, maxDepth: 2 }), 'xx');
  assert.throws(() => render('{{>self}}', {}, { partials: { self: 'x{{>self}}' } }), {
    code: 'PARTIAL_DEPTH',
  });
  assert.throws(() => render('{{>p}}', {}, { partials: { p: '{{>q}}', q: '{{>r}}', r: 'x' }, maxDepth: 2 }), {
    code: 'PARTIAL_DEPTH',
  });
  assert.throws(() => render('{{>missing}}', {}), { code: 'UNKNOWN_PARTIAL', message: 'unknown partial: missing' });
});

test('malformed templates report a code and an offset', () => {
  const cases = [
    ['{{a', 'UNCLOSED_TAG', 0],
    ['x {{a', 'UNCLOSED_TAG', 2],
    ['{{{a}}', 'UNCLOSED_TAG', 0],
    ['{{#a}}x', 'UNCLOSED_SECTION', 0],
    ['a{{#b}}', 'UNCLOSED_SECTION', 1],
    ['{{#a}}x{{/b}}', 'MISMATCHED_SECTION', 7],
    ['{{/a}}', 'MISMATCHED_SECTION', 0],
    ['{{}}', 'EMPTY_NAME', 0],
    ['{{#}}', 'EMPTY_NAME', 0],
    ['{{ }}', 'EMPTY_NAME', 0],
    ['{{a b}}', 'BAD_NAME', 0],
    ['{{a..b}}', 'BAD_NAME', 0],
  ];
  for (const [template, code, index] of cases) {
    assert.throws(() => render(template, {}), { name: 'TemplateError', code, index }, `case ${template}`);
  }
  assert.throws(() => render(5, {}), { code: 'BAD_TEMPLATE' });
  assert.throws(() => render('{{a}}', {}, null), { code: 'BAD_INPUT' });
  assert.throws(() => render('{{a}}', {}, { maxDepth: 0 }), { code: 'BAD_INPUT' });
  assert.throws(() => render('{{a}}', {}, { partials: 'x' }), { code: 'BAD_INPUT' });
});

test('a whole page renders end to end', () => {
  const template =
    '<ul>{{#items}}<li>{{name}}: {{{html}}} ({{count}})</li>{{/items}}{{^items}}<li>empty</li>{{/items}}</ul>';
  assert.equal(
    render(template, {
      items: [
        { name: 'a<b', html: '<i>x</i>', count: 0 },
        { name: "o'k", html: '&', count: 2 },
      ],
    }),
    '<ul><li>a&lt;b: <i>x</i> (0)</li><li>o&#39;k: & (2)</li></ul>',
  );
  assert.equal(render(template, { items: [] }), '<ul><li>empty</li></ul>');
  assert.equal(render(template, {}), '<ul><li>empty</li></ul>');
});

test('a compiled template renders many times over fresh state', () => {
  const greet = compile('{{#xs}}[{{.}}]{{/xs}}');
  assert.equal(greet({ xs: [1, 2] }), '[1][2]');
  assert.equal(greet({ xs: [] }), '');
  assert.equal(greet({ xs: ['<'] }), '[&lt;]');
  const withPartial = compile('{{>p}}');
  const options = { partials: { p: 'x' }, maxDepth: 1 };
  assert.equal(withPartial({}, options), 'x');
  assert.equal(withPartial({}, options), 'x', 'a second render starts from depth zero again');
  assert.equal(render('{{>p}}', {}, options), 'x');
  assert.throws(() => compile('{{#a}}'), { code: 'UNCLOSED_SECTION' });
  assert.throws(() => compile('{{a}}')({}, null), { code: 'BAD_INPUT' });
});

test('escaping round-trips for generated values', () => {
  const pick = mulberry32(707070);
  const alphabet = ['a', '<', '>', '&', '"', "'", ' ', ';', '#', '日', '\n', 'amp'];
  for (let round = 0; round < 300; round += 1) {
    const length = Math.floor(pick() * 8);
    let value = '';
    for (let index = 0; index < length; index += 1) value += alphabet[Math.floor(pick() * alphabet.length)];
    const escaped = render('{{v}}', { v: value });
    assert.equal(unescapeHtml(escaped), value, `round ${round} for ${JSON.stringify(value)}`);
    assert.equal(render('{{{v}}}', { v: value }), value, 'a raw tag never rewrites its value');
    assert.equal(escaped, escapeHtml(value), 'interpolation escapes exactly like escapeHtml');
    assert.equal(escaped.includes('<'), false, 'escaped output has no raw angle bracket');
  }
});

test('a section and its inverse never both render', () => {
  const pick = mulberry32(808080);
  const values = [[], [1], [1, 2], false, true, 0, 1, '', 'x', null, undefined, {}, { a: 1 }];
  for (let round = 0; round < 200; round += 1) {
    const value = values[Math.floor(pick() * values.length)];
    const output = render('{{#a}}X{{/a}}{{^a}}Y{{/a}}', { a: value });
    const positive = output.includes('X');
    const negative = output.includes('Y');
    assert.notEqual(positive, negative, `exactly one branch renders for ${JSON.stringify(value)}`);
    if (Array.isArray(value)) {
      assert.equal(output, value.length === 0 ? 'Y' : 'X'.repeat(value.length), 'arrays repeat their body');
    }
  }
});
