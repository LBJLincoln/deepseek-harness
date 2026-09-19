/** The suite for the change this task asks for: the layers, the coercion, and the positions. */

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

const LOADED = [
  'log.file=/var/log/app.log',
  'log.level=error',
  'log.rotate=true',
  'retry.attempts=5',
  'retry.backoff=250',
  'server.host=example.test',
  'server.port=443',
  'server.timeout=120000',
  'server.tls=true',
  'tags=web,api',
  '',
].join('\n')

test('load stacks the site file over the base file and coerces every value', () => {
  assert.deepEqual(run(['load', 'data/base.ini', 'data/site.ini']), { code: 0, out: LOADED, err: '' })
})

test('the environment layer wins over both files', () => {
  const env = 'CONF_SERVER_PORT=8443\nCONF_LOG_LEVEL=debug\n'
  const out = run(['load', 'data/base.ini', 'data/site.ini'], env).out.split('\n')
  assert.equal(out[1], 'log.level=debug')
  assert.equal(out[6], 'server.port=8443')
})

test('origin names the highest layer that set each key', () => {
  const env = 'CONF_TAGS=one\n'
  assert.equal(run(['origin', 'data/base.ini', 'data/site.ini'], env).out, [
    'log.file base',
    'log.level site',
    'log.rotate default',
    'retry.attempts base',
    'retry.backoff default',
    'server.host base',
    'server.port site',
    'server.timeout base',
    'server.tls site',
    'tags env',
    '',
  ].join('\n'))
})

test('a duration renders as whole milliseconds', () => {
  const env = 'CONF_RETRY_BACKOFF=2h\nCONF_SERVER_TIMEOUT=1500ms\n'
  const out = run(['load', 'data/empty.ini', 'data/empty.ini'], env).out.split('\n')
  assert.equal(out[4], 'retry.backoff=7200000')
  assert.equal(out[7], 'server.timeout=1500')
})

test('a list drops repeats and keeps the order it was written in', () => {
  const out = run(['load', 'data/empty.ini', 'data/site.ini']).out.split('\n')
  assert.equal(out[9], 'tags=web,api')
})

test('a value that does not fit its type is reported at the position it was written', () => {
  assert.deepEqual(run(['load', 'data/base.ini', 'data/bad-type.ini']), {
    code: 2,
    out: '',
    err: 'error: data/bad-type.ini:3:12: server.port is not an integer: eighty\n',
  })
})

test('an enum names its members in the declared order', () => {
  const env = 'CONF_LOG_LEVEL=quiet\n'
  assert.equal(
    run(['load', 'data/empty.ini', 'data/empty.ini'], env).err,
    'error: <stdin>:1:16: log.level is not one of debug|info|warn|error: quiet\n',
  )
})

test('a boolean takes only the two lowercase words', () => {
  const env = 'CONF_SERVER_TLS=True\n'
  assert.equal(run(['load', 'data/empty.ini', 'data/empty.ini'], env).err, 'error: <stdin>:1:17: server.tls is not a boolean: True\n')
})

test('a duration without a unit is refused', () => {
  const env = 'CONF_SERVER_TIMEOUT=30\n'
  assert.equal(run(['load', 'data/empty.ini', 'data/empty.ini'], env).err, 'error: <stdin>:1:21: server.timeout is not a duration: 30\n')
})

test('an empty item in a list is refused with the whole text', () => {
  const env = 'CONF_TAGS=a,,b\n'
  assert.equal(run(['load', 'data/empty.ini', 'data/empty.ini'], env).err, 'error: <stdin>:1:11: tags has an empty item: a,,b\n')
})

test('load refuses a key the schema does not know, where dump ignores it', () => {
  assert.equal(
    run(['load', 'data/unknown.ini', 'data/empty.ini']).err,
    'error: data/unknown.ini:3:12: unknown setting server.colour\n',
  )
})

test('an empty value is positioned one past the last non-space character', () => {
  const env = 'CONF_SERVER_PORT=\n'
  assert.equal(run(['load', 'data/empty.ini', 'data/empty.ini'], env).err, 'error: <stdin>:1:18: server.port is not an integer: \n')
})

test('an environment line without an equals sign is refused at its first character', () => {
  assert.deepEqual(run(['load', 'data/empty.ini', 'data/empty.ini'], '  CONF_TAGS\n'), {
    code: 2,
    out: '',
    err: 'error: <stdin>:1:3: expected NAME=VALUE\n',
  })
})

test('an environment name outside the schema is refused', () => {
  assert.equal(run(['load', 'data/empty.ini', 'data/empty.ini'], 'HOME=/root\n').err, 'error: <stdin>:1:1: unknown environment variable HOME\n')
})

test('an environment name set twice names its second line', () => {
  const env = 'CONF_TAGS=a\n# again\nCONF_TAGS=b\n'
  assert.equal(run(['load', 'data/empty.ini', 'data/empty.ini'], env).err, 'error: <stdin>:3:1: CONF_TAGS is set twice\n')
})

test('the base file is read before the site file and the site file before the environment', () => {
  assert.equal(
    run(['load', 'data/bad-line.ini', 'data/unknown.ini'], 'HOME=/root\n').err,
    'error: data/bad-line.ini:2:3: expected a section header or key = value\n',
  )
})

test('the usage line names every form', () => {
  assert.deepEqual(run(['load', 'data/base.ini']), {
    code: 2,
    out: '',
    err: 'error: usage: cli.js dump <file>|get <file> <key>|load <base> <site>|origin <base> <site>\n',
  })
})
