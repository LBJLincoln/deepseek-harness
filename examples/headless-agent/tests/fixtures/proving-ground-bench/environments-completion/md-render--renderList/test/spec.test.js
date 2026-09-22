/** The suite for the change this task asks for: nested lists, reference links, and a safe fence. */

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

test('an indented item nests inside the item above it', () => {
  assert.deepEqual(run(['html'], '- one\n  - inner\n    - deeper\n- two\n'), {
    code: 0,
    out: '<ul>\n<li>one\n<ul>\n<li>inner\n<ul>\n<li>deeper</li>\n</ul>\n</li>\n</ul>\n</li>\n<li>two</li>\n</ul>\n',
    err: '',
  })
})

test('an indentation that is not a whole number of levels rounds down', () => {
  assert.equal(run(['html'], '- one\n   - odd\n- two\n').out, '<ul>\n<li>one\n<ul>\n<li>odd</li>\n</ul>\n</li>\n<li>two</li>\n</ul>\n')
})

test('an item cannot jump more than one level deeper', () => {
  assert.equal(run(['html'], '- one\n      - jump\n').out, '<ul>\n<li>one\n<ul>\n<li>jump</li>\n</ul>\n</li>\n</ul>\n')
})

test('a reference link resolves against the definitions file', () => {
  assert.equal(
    run(['html', 'data/site.links'], 'see [Home][home] and [Docs][] and [x][nope]\n').out,
    '<p>see <a href="https://example.test/">Home</a> and <a href="https://example.test/docs">Docs</a> and [x][nope]</p>\n',
  )
})

test('a label matches with its case folded and its whitespace collapsed', () => {
  assert.equal(
    run(['html', 'data/site.links'], '[two   WORDS][]\n').out,
    '<p><a href="https://example.test/two?a=1&amp;b=2">two   WORDS</a></p>\n',
  )
})

test('a resolved url is escaped for the attribute it lands in', () => {
  assert.equal(run(['html', 'data/site.links'], '[q][quote]\n').out, '<p><a href="https://example.test/&quot;q&quot;">q</a></p>\n')
})

test('a document may define its own labels, and the definition line disappears', () => {
  assert.equal(run(['html'], '[Local]: /l\n\nsee [it][local]\n').out, '<p>see <a href="/l">it</a></p>\n')
})

test('a definition line ends the paragraph it stands in', () => {
  assert.equal(run(['html'], 'text\n[a]: /a\nmore\n').out, '<p>text</p>\n<p>more</p>\n')
})

test('fence content is escaped, so an ampersand survives once', () => {
  assert.equal(
    run(['html'], '```html\n<b>&amp;</b>\n```\n').out,
    '<pre><code class="language-html">&lt;b&gt;&amp;amp;&lt;/b&gt;\n</code></pre>\n',
  )
})

test('the language class is escaped too', () => {
  assert.equal(run(['html'], '```h<i>\na\n```\n').out, '<pre><code class="language-h&lt;i&gt;">a\n</code></pre>\n')
})

test('a reference link works inside a nested item', () => {
  assert.equal(
    run(['html', 'data/site.links'], '- [Home][home]\n  - [Docs][]\n').out,
    '<ul>\n<li><a href="https://example.test/">Home</a>\n<ul>\n<li><a href="https://example.test/docs">Docs</a></li>\n</ul>\n</li>\n</ul>\n',
  )
})

test('defs lists every definition in force with the layer it came from', () => {
  assert.deepEqual(run(['defs', 'data/site.links'], '[Local]: /l\n'), {
    code: 0,
    out: [
      'docs https://example.test/docs file',
      'home https://example.test/ file',
      'local /l document',
      'quote https://example.test/"q" file',
      'two words https://example.test/two?a=1&b=2 file',
      'total 5',
      '',
    ].join('\n'),
    err: '',
  })
})

test('defs counts nothing when no definition is in force', () => {
  assert.equal(run(['defs'], '').out, 'total 0\n')
})

test('a document may not redefine a label the file already defined', () => {
  assert.deepEqual(run(['defs', 'data/site.links'], '[home]: /x\n'), {
    code: 2,
    out: '',
    err: 'error: line 1: label home is defined twice\n',
  })
})

test('a definitions file takes definitions and nothing else', () => {
  assert.equal(run(['html', 'data/bad.links'], '').err, 'error: data/bad.links: line 2: expected [label]: <url>\n')
})

test('two definitions of one label in the file name the second line', () => {
  assert.equal(run(['html', 'data/twice.links'], '').err, 'error: data/twice.links: line 2: label home is defined twice\n')
})

test('a definitions file that is not there is refused by name', () => {
  assert.deepEqual(run(['html', 'data/nope.links'], ''), { code: 2, out: '', err: 'error: cannot read definitions data/nope.links\n' })
})

test('the usage line names every form', () => {
  assert.deepEqual(run(['render'], ''), { code: 2, out: '', err: 'error: usage: cli.js html|outline|defs [<definitions>]\n' })
})
