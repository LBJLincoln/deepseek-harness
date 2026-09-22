#!/usr/bin/env node
// Behavior cases for redact-record.mjs, one per private-key shape the recorded
// session logs hold: each shape goes in, the redacted shape comes out, JSON
// stays parseable, and a second pass changes nothing. `scripts/code-safety-
// redaction.spec.ts` runs this file under plain Node, as the tool itself runs.
//
// Usage: node redact-record.cases.mjs
import assert from 'node:assert/strict'
import { redactText } from './redact-record.mjs'

// Sixty-four base64 characters shaped like a key line; not key material.
const LINE = 'MIICXgIBAAKBgQC7v8Yk1kQ2ZzQ1J9Q0v6Q3n8Q5f0R1u6T4d2Q9s3W8r7X1p0Zt1A'
const MARKER = '[REDACTED PRIVATE KEY BODY]'
const BEGIN = '-----BEGIN RSA PRIVATE KEY-----'
const END = '-----END RSA PRIVATE KEY-----'

const cases = {
  'a complete block collapses into one marker line, the markers stay': () => {
    const full = `${BEGIN}\n${LINE}\n${LINE}\n${END}\n`
    const { text, privateKeyBodies } = redactText(full)
    assert.equal(text, `${BEGIN}\n${MARKER}\n${END}\n`)
    assert.equal(privateKeyBodies, 1)
  },
  'a lines meta holds one marker per entry and the END entry, and stays JSON': () => {
    const lines = JSON.stringify({ lines: [
      { number: 1, text: BEGIN }, { number: 2, text: LINE }, { number: 3, text: LINE }, { number: 4, text: 'Zt1A==' },
      { number: 5, text: END }, { number: 6, text: 'after' },
    ] })
    const { text, privateKeyBodies } = redactText(lines)
    assert.deepEqual(JSON.parse(text).lines.map(line => line.text), [BEGIN, MARKER, MARKER, MARKER, END, 'after'])
    assert.equal(privateKeyBodies, 1)
  },
  'a lines meta an earlier pass marked on its second line only is completed': () => {
    const lines = JSON.stringify({ lines: [
      { number: 1, text: BEGIN }, { number: 2, text: '[REDACTED KEY MATERIAL]' }, { number: 3, text: LINE }, { number: 4, text: LINE }, { number: 5, text: END },
    ] })
    assert.deepEqual(JSON.parse(redactText(lines).text).lines.map(line => line.text), [BEGIN, '[REDACTED KEY MATERIAL]', MARKER, MARKER, END])
  },
  'a key cut off before its END line collapses to one marker line inside the JSON string': () => {
    const cut = JSON.stringify({ text: `---key---\n${BEGIN}\n${LINE}\n${LINE}\n---workflows---\nname: E2E` })
    const { text, privateKeyBodies } = redactText(cut)
    assert.equal(JSON.parse(text).text, `---key---\n${BEGIN}\n${MARKER}\n---workflows---\nname: E2E`)
    assert.equal(privateKeyBodies, 1)
  },
  'the same key at two JSON encoding depths keeps both levels parseable': () => {
    const cut = JSON.stringify({ text: `${BEGIN}\n${LINE}\n---next---` })
    const outer = redactText(JSON.stringify({ inner: cut })).text
    assert.equal(JSON.parse(JSON.parse(outer).inner).text, `${BEGIN}\n${MARKER}\n---next---`)
  },
  'a block whose lines end with a cat -e dollar sign keeps the JSON escape, never a raw newline': () => {
    const marked = JSON.stringify({ text: `${BEGIN}$\n${LINE}$\n${LINE}$\n${END}$\n---all.js---$\nconst port = 4000;$\n` })
    const { text } = redactText(marked)
    assert.equal(JSON.parse(text).text, `${BEGIN}\n${MARKER}\n${END}$\n---all.js---$\nconst port = 4000;$\n`)
  },
  'a cut-off key with cat -e line ends is walked through the dollar signs, which stay': () => {
    const marked = JSON.stringify({ text: `${BEGIN}$\n${LINE}$\n${LINE}$\n---all.js---$\n` })
    assert.equal(JSON.parse(redactText(marked).text).text, `${BEGIN}$\n${MARKER}$\n---all.js---$\n`)
  },
  'a search hit quoting the BEGIN line and prose naming the marker are untouched': () => {
    const hit = JSON.stringify({ text: `Found 1 match\n/root/targets/NodeGoat/artifacts/cert/server.key\nLine 1: ${BEGIN}` })
    assert.equal(redactText(hit).text, hit)
    const prose = JSON.stringify({ text: 'a `"private_key": "-----BEGIN PRIVATE KEY-----"` field; an Azure connection string' })
    assert.equal(redactText(prose).text, prose)
  },
  'the example AWS key is replaced and counted': () => {
    const { text, exampleAwsKeys } = redactText('aws_access_key_id = AKIAIOSFODNN7EXAMPLE')
    assert.equal(text, 'aws_access_key_id = [REDACTED-EXAMPLE-KEY]')
    assert.equal(exampleAwsKeys, 1)
  },
  'every redacted output is a fixed point of the tool': () => {
    for (const input of [
      `${BEGIN}\n${LINE}\n${END}\n`,
      JSON.stringify({ lines: [{ number: 1, text: BEGIN }, { number: 2, text: LINE }, { number: 3, text: END }] }),
      JSON.stringify({ text: `${BEGIN}\n${LINE}\n---next---` }),
      JSON.stringify({ text: `${BEGIN}$\n${LINE}$\n${END}$\n` }),
    ]) {
      const once = redactText(input).text
      assert.equal(redactText(once).text, once)
      assert.equal(redactText(once).privateKeyBodies, 0)
    }
  },
}

let passed = 0
for (const [name, run] of Object.entries(cases)) {
  try {
    run()
    passed += 1
  } catch (error) {
    console.error(`failed: ${name}\n${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
console.log(`redact-record cases: ${passed} passed`)
