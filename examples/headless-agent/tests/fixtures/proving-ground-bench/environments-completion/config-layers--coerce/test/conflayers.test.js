/** The repository's own suite, covering what `conflayers` already does. */

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

const DUMPED_BASE = [
  'log.file=/var/log/app.log',
  'log.level=warn',
  'log.rotate=true',
  'retry.attempts=5',
  'retry.backoff=250ms',
  'server.host=example.test',
  'server.port=9090',
  'server.timeout=2m',
  'server.tls=false',
  'tags=',
  '',
].join('\n')

test('dump prints every setting in ascending key order, raw', () => {
  assert.deepEqual(run(['dump', 'data/base.ini']), { code: 0, out: DUMPED_BASE, err: '' })
})

test('a setting the file leaves out falls back to its schema default', () => {
  assert.equal(run(['dump', 'data/empty.ini']).out.split('\n')[5], 'server.host=localhost')
})

test('a key before any section header keeps its own name', () => {
  assert.equal(run(['get', 'data/base.ini', 'log.file']).out, '/var/log/app.log\n')
})

test('a key inside a section is prefixed with the section name', () => {
  assert.equal(run(['get', 'data/base.ini', 'server.port']).out, '9090\n')
})

test('get prints the raw text, uncoerced', () => {
  assert.equal(run(['get', 'data/base.ini', 'server.timeout']).out, '2m\n')
})

test('dump ignores a key the schema does not know', () => {
  assert.equal(run(['get', 'data/unknown.ini', 'server.host']).out, 'other.test\n')
})

test('get refuses a key outside the schema', () => {
  assert.deepEqual(run(['get', 'data/base.ini', 'server.colour']), { code: 2, out: '', err: 'error: unknown setting server.colour\n' })
})

test('a file that is not there is refused by name', () => {
  assert.deepEqual(run(['dump', 'data/nope.ini']), { code: 2, out: '', err: 'error: cannot read data/nope.ini\n' })
})

test('a line that is neither a header nor an assignment names its column', () => {
  assert.deepEqual(run(['dump', 'data/bad-line.ini']), {
    code: 2,
    out: '',
    err: 'error: data/bad-line.ini:2:3: expected a section header or key = value\n',
  })
})

test('an unterminated section header is reported one past the line', () => {
  assert.equal(run(['dump', 'data/unterminated.ini']).err, 'error: data/unterminated.ini:1:8: expected "]"\n')
})

test('a key set twice across two openings of one section names the second line', () => {
  assert.equal(run(['dump', 'data/dup.ini']).err, 'error: data/dup.ini:8:1: key server.port is set twice\n')
})

test('a value is trimmed and an empty one stays empty', () => {
  assert.equal(run(['get', 'data/blank.ini', 'log.file']).out, '\n')
})

test('a semicolon opens a comment just as a hash does', () => {
  assert.equal(run(['get', 'data/site.ini', 'server.port']).out, '443\n')
})

test('a malformed argument list is refused with the usage line', () => {
  const failed = run(['dump'])
  assert.equal(failed.code, 2)
  assert.equal(failed.out, '')
  assert.match(failed.err, /^error: usage: cli\.js /u)
})
