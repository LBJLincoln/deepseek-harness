/** The repository's own suite, covering what `mdlite` already does. */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url))
const root = fileURLToPath(new URL('../', import.meta.url))

function run(argv, stdin = '') {
  const result = spawnSync(process.execPath, [cli, ...argv], { cwd: root, encoding: 'utf8', input: stdin })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

test('a heading becomes the matching element', () => {
  assert.deepEqual(run(['html'], '# Title\n'), { code: 0, out: '<h1>Title</h1>\n', err: '' })
  assert.equal(run(['html'], '###### Deep\n').out, '<h6>Deep</h6>\n')
})

test('seven hashes are not a heading', () => {
  assert.equal(run(['html'], '####### Nope\n').out, '<p>####### Nope</p>\n')
})

test('consecutive lines form one paragraph, newlines kept', () => {
  assert.equal(run(['html'], 'one\ntwo\n\nthree\n').out, '<p>one\ntwo</p>\n<p>three</p>\n')
})

test('a flat bullet list becomes a ul', () => {
  assert.equal(run(['html'], '- one\n- two\n').out, '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n')
})

test('emphasis, strong, and code spans render inline', () => {
  assert.equal(run(['html'], '*a* **b** `c`\n').out, '<p><em>a</em> <strong>b</strong> <code>c</code></p>\n')
})

test('text is escaped for HTML', () => {
  assert.equal(run(['html'], 'a & b < c > d\n').out, '<p>a &amp; b &lt; c &gt; d</p>\n')
})

test('a code span escapes its content', () => {
  assert.equal(run(['html'], '`<b>`\n').out, '<p><code>&lt;b&gt;</code></p>\n')
})

test('a backslash escapes the punctuation the syntax uses', () => {
  assert.equal(run(['html'], '\\*not em\\* \\[not a link\\]\n').out, '<p>*not em* [not a link]</p>\n')
})

test('an inline link renders with an escaped href', () => {
  assert.equal(run(['html'], '[a](https://x.test/?a=1&b=2)\n').out, '<p><a href="https://x.test/?a=1&amp;b=2">a</a></p>\n')
})

test('an unmatched marker stays literal', () => {
  assert.equal(run(['html'], 'a * b ` c [d\n').out, '<p>a * b ` c [d</p>\n')
})

test('a fenced block becomes pre and code', () => {
  assert.equal(run(['html'], '```\nplain\n```\n').out, '<pre><code>plain\n</code></pre>\n')
})

test('an info string becomes a language class', () => {
  assert.equal(run(['html'], '```js\nlet a = 1\n```\n').out, '<pre><code class="language-js">let a = 1\n</code></pre>\n')
})

test('a fence may be closed by a longer run of backticks', () => {
  assert.equal(run(['html'], '```\na\n`````\n').out, '<pre><code>a\n</code></pre>\n')
})

test('an unterminated fence names its opening line', () => {
  assert.deepEqual(run(['html'], 'x\n\n```\na\n'), { code: 2, out: '', err: 'error: line 3: unterminated code fence\n' })
})

test('an empty document renders nothing', () => {
  assert.deepEqual(run(['html'], ''), { code: 0, out: '', err: '' })
})

test('outline lists the headings with their levels', () => {
  assert.equal(run(['outline'], '# A\ntext\n\n## B\n').out, '1 A\n2 B\n')
})

test('outline reads the raw heading text', () => {
  assert.equal(run(['outline'], '# *A* & B\n').out, '1 *A* & B\n')
})

test('a malformed argument list is refused with the usage line', () => {
  const failed = run(['render'], '')
  assert.equal(failed.code, 2)
  assert.equal(failed.out, '')
  assert.match(failed.err, /^error: usage: cli\.js /u)
})
