import test from 'node:test';
import assert from 'node:assert/strict';

import { escapeHtml, renderInline } from '../src/markdown-inline.js';

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

test('ordinary text is escaped for HTML', () => {
  const cases = [
    ['', ''],
    ['plain text', 'plain text'],
    ['a < b & c > d', 'a &lt; b &amp; c &gt; d'],
    ['say "hi"', 'say &quot;hi&quot;'],
    ['&amp;', '&amp;amp;'],
    ['caf\u00e9 \u{1f600}', 'caf\u00e9 \u{1f600}'],
  ];
  for (const [input, expected] of cases) assert.equal(renderInline(input), expected, JSON.stringify(input));
  assert.equal(escapeHtml('<&">'), '&lt;&amp;&quot;&gt;');
  assert.throws(() => renderInline(null), TypeError);
});

test('backslash escapes remove markup meaning', () => {
  const cases = [
    ['\\*not em\\*', '*not em*'],
    ['\\_a\\_', '_a_'],
    ['\\`a\\`', '`a`'],
    ['\\[a\\](b)', '[a](b)'],
    ['\\\\', '\\'],
    ['\\\\*a*', '\\<em>a</em>'],
    ['\\a', '\\a'],
    ['a\\', 'a\\'],
    ['\\<', '&lt;'],
    ['\\&', '&amp;'],
  ];
  for (const [input, expected] of cases) assert.equal(renderInline(input), expected, JSON.stringify(input));
});

test('code spans close on a run of the same length', () => {
  const cases = [
    ['`code`', '<code>code</code>'],
    ['``a`b``', '<code>a`b</code>'],
    ['`` ` ``', '<code>`</code>'],
    ['``a`', '``a`'],
    ['`foo', '`foo'],
    ['a ` b', 'a ` b'],
    ['`*a*`', '<code>*a*</code>'],
    ['`a<b>&"`', '<code>a&lt;b&gt;&amp;&quot;</code>'],
    ['`a` and `b`', '<code>a</code> and <code>b</code>'],
    ['``a``b``', '<code>a</code>b``'],
  ];
  for (const [input, expected] of cases) assert.equal(renderInline(input), expected, JSON.stringify(input));
});

test('a code span drops at most one space from each end', () => {
  const cases = [
    ['` a `', '<code>a</code>'],
    ['`  a  `', '<code> a </code>'],
    ['` a`', '<code> a</code>'],
    ['`a `', '<code>a </code>'],
    ['`  `', '<code>  </code>'],
    ['` `', '<code> </code>'],
    ['` a b `', '<code>a b</code>'],
    ['`  ab  `', '<code> ab </code>'],
  ];
  for (const [input, expected] of cases) assert.equal(renderInline(input), expected, JSON.stringify(input));
});

test('emphasis pairs delimiter runs', () => {
  const cases = [
    ['*a*', '<em>a</em>'],
    ['_a_', '<em>a</em>'],
    ['**a**', '<strong>a</strong>'],
    ['__a__', '<strong>a</strong>'],
    ['***a***', '<strong><em>a</em></strong>'],
    ['*a* and *b*', '<em>a</em> and <em>b</em>'],
    ['**a** b **c**', '<strong>a</strong> b <strong>c</strong>'],
    ['*a_b*', '<em>a_b</em>'],
    ['**a *b* c**', '<strong>a <em>b</em> c</strong>'],
    ['*a * b*', '<em>a * b</em>'],
    ['a * b *', 'a * b *'],
    ['**a', '**a'],
    ['a**', 'a**'],
    ['*a**', '<em>a*</em>'],
    ['**a*', '<em>*a</em>'],
    ['* a *', '* a *'],
    ['*`a`*', '<em><code>a</code></em>'],
  ];
  for (const [input, expected] of cases) assert.equal(renderInline(input), expected, JSON.stringify(input));
});

test('an underscore inside a word is not emphasis', () => {
  const cases = [
    ['foo_bar_baz', 'foo_bar_baz'],
    ['foo*bar*baz', 'foo<em>bar</em>baz'],
    ['_foo_bar', '_foo_bar'],
    ['snake_case_name and _real_', 'snake_case_name and <em>real</em>'],
    ['a_b_ c', 'a_b_ c'],
    ['5_000_000', '5_000_000'],
    ['__a__b', '__a__b'],
    ['**a**b', '<strong>a</strong>b'],
  ];
  for (const [input, expected] of cases) assert.equal(renderInline(input), expected, JSON.stringify(input));
});

test('inline links carry a destination and an optional title', () => {
  const cases = [
    ['[x](/y)', '<a href="/y">x</a>'],
    ['[x](/y "t")', '<a href="/y" title="t">x</a>'],
    ["[x](/y 't')", '<a href="/y" title="t">x</a>'],
    ['[x]()', '<a href="">x</a>'],
    ['[**b**](/y)', '<a href="/y"><strong>b</strong></a>'],
    ['[a [b] c](/y)', '<a href="/y">a [b] c</a>'],
    ['[x](<a b>)', '<a href="a%20b">x</a>'],
    ['[x](/a(b)c)', '<a href="/a(b)c">x</a>'],
    ['[x](/a&b)', '<a href="/a&amp;b">x</a>'],
    ['[x](/y "a\\"b")', '<a href="/y" title="a&quot;b">x</a>'],
    ['[a](b)[c](d)', '<a href="b">a</a><a href="d">c</a>'],
    ['[a [b](/c) d](/e)', '<a href="/e">a [b](/c) d</a>'],
    ['[unclosed](/y', '[unclosed](/y'],
    ['[x](/a b)', '[x](/a b)'],
    ['[x]', '[x]'],
    ['[<b>](/y)', '<a href="/y">&lt;b&gt;</a>'],
  ];
  for (const [input, expected] of cases) assert.equal(renderInline(input), expected, JSON.stringify(input));
});

test('link destinations keep the escapes they already carry', () => {
  const cases = [
    ['[x](/a%20b)', '<a href="/a%20b">x</a>'],
    ['[x](/a%zzb)', '<a href="/a%zzb">x</a>'],
    ['[x](/100%25)', '<a href="/100%25">x</a>'],
    ['[x](/a"b)', '<a href="/a%22b">x</a>'],
    ['[x](/caf\u00e9)', '<a href="/caf\u00e9">x</a>'],
  ];
  for (const [input, expected] of cases) assert.equal(renderInline(input), expected, JSON.stringify(input));
});

test('autolinks cover absolute URIs and email addresses', () => {
  const cases = [
    ['<http://example.com/a>', '<a href="http://example.com/a">http://example.com/a</a>'],
    ['<http://x.com/?a=1&b=2>', '<a href="http://x.com/?a=1&amp;b=2">http://x.com/?a=1&amp;b=2</a>'],
    ['<mailto:x@y.com>', '<a href="mailto:x@y.com">mailto:x@y.com</a>'],
    ['<x@y.com>', '<a href="mailto:x@y.com">x@y.com</a>'],
    ['<a+b@example.com>', '<a href="mailto:a+b@example.com">a+b@example.com</a>'],
    ["<o'brien@x.co.uk>", '<a href="mailto:o\'brien@x.co.uk">o\'brien@x.co.uk</a>'],
    ['<first.last@sub.example.org>', '<a href="mailto:first.last@sub.example.org">first.last@sub.example.org</a>'],
    ['<not a link>', '&lt;not a link&gt;'],
    ['<div>', '&lt;div&gt;'],
    ['<@example.com>', '&lt;@example.com&gt;'],
    ['a < b', 'a &lt; b'],
    ['see <http://x.com> now', 'see <a href="http://x.com">http://x.com</a> now'],
  ];
  for (const [input, expected] of cases) assert.equal(renderInline(input), expected, JSON.stringify(input));
});

test('constructs combine without leaking markup', () => {
  assert.equal(renderInline('*[a](/b)*'), '<em><a href="/b">a</a></em>');
  assert.equal(renderInline('[`a`](/b)'), '<a href="/b"><code>a</code></a>');
  assert.equal(renderInline('`[a](/b)`'), '<code>[a](/b)</code>');
  assert.equal(renderInline('**a `b` c**'), '<strong>a <code>b</code> c</strong>');
  assert.equal(renderInline('[a *b* c](/d "t")'), '<a href="/d" title="t">a <em>b</em> c</a>');
  assert.equal(renderInline('a `*b*` *c*'), 'a <code>*b*</code> <em>c</em>');
  assert.equal(renderInline('\\*a* `b`'), '*a* <code>b</code>');
  assert.equal(renderInline('`<script>`'), '<code>&lt;script&gt;</code>');
  assert.equal(renderInline('[<script>](/x)'), '<a href="/x">&lt;script&gt;</a>');
  assert.equal(renderInline('*a* <b@c.com> `d`'), '<em>a</em> <a href="mailto:b@c.com">b@c.com</a> <code>d</code>');
});

test('a paragraph of mixed markup renders as a whole', () => {
  const source = 'See [the *docs*](http://x.com/a%20b "How & why") or mail <a+b@x.co>: `a_b` stays, a_b_c too.';
  const expected =
    'See <a href="http://x.com/a%20b" title="How &amp; why">the <em>docs</em></a> or mail ' +
    '<a href="mailto:a+b@x.co">a+b@x.co</a>: <code>a_b</code> stays, a_b_c too.';
  assert.equal(renderInline(source), expected);
  assert.ok(!renderInline('<not markup> & "quoted"').includes('<not'));
  assert.equal(renderInline('&lt;'), '&amp;lt;');
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml('no markup here'), 'no markup here');
  assert.equal(escapeHtml('a&b<c>d"e'), 'a&amp;b&lt;c&gt;d&quot;e');
  assert.equal(renderInline('a'.repeat(200)), 'a'.repeat(200));
  assert.equal(renderInline('*'.repeat(6)), '*'.repeat(6));
});

test('generated plain text renders as escaped text', () => {
  const random = mulberry32(0x8ac1d);
  const plain = ['a', 'B', '7', ' ', '&', '<', '>', '"', 'é', '\u{1f600}', '-', '/', ':', '!'];
  const codeSafe = ['a', 'B', '7', ' ', '&', '<', '>', '"', '*', '_', '[', ']', '(', ')', '\\', 'é'];

  for (let iteration = 0; iteration < 200; iteration += 1) {
    let text = '';
    const length = 1 + Math.floor(random() * 8);
    for (let i = 0; i < length; i += 1) text += plain[Math.floor(random() * plain.length)];
    assert.equal(renderInline(text), escapeHtml(text), `plain text ${JSON.stringify(text)}`);
  }

  for (let iteration = 0; iteration < 200; iteration += 1) {
    let content = 'x';
    const length = 1 + Math.floor(random() * 8);
    for (let i = 0; i < length; i += 1) content += codeSafe[Math.floor(random() * codeSafe.length)];
    content += 'y';
    assert.equal(renderInline(`\`${content}\``), `<code>${escapeHtml(content)}</code>`, `code span ${JSON.stringify(content)}`);
  }
});
