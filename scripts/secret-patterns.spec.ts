/**
 * The shared credential and personal-data patterns
 * (`data/transcripts/tools/secret-patterns.mjs`): each shape is masked as
 * `[REDACTED-<PATTERN>]` wherever the text sits (after a JSON-escaped newline,
 * inside a JSON string, across a PEM body), the masked JSON stays parseable,
 * nothing masked survives a re-scan, an accepted placeholder stays verbatim,
 * and ids, hashes and base64 are left alone. The keys and addresses here match
 * the shapes but are invented.
 */

import { describe, expect, it } from 'vitest'
import {
  CREDENTIAL_PATTERN_NAMES,
  PERSONAL_PATTERN_NAMES,
  SECRET_PATTERN_NAMES,
  redactText,
  scanSecrets,
  sha256,
} from '../data/transcripts/tools/secret-patterns.mjs'

const FAKE_OPENROUTER = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`
const FAKE_GITHUB_PAT = `github_pat_${'11ABCDEFG0'.repeat(3)}_${'x9'.repeat(29)}`
const FAKE_HF = `hf_${'Ab1'.repeat(12)}`
const FAKE_E2B = `e2b_${'0123456789abcdef'.repeat(2)}abcdef01`
const FAKE_AWS_ID = `AKIA${'Q'.repeat(16)}`
const FAKE_AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYFAKEKEY012'
const FAKE_BEARER = `abcdef${'0123456789'.repeat(3)}`
const EMAIL = 'jane.doe+build@mailhost.org'
const PEM_BODY = 'fedcba9876543210FEDCBA98'.repeat(3)

/**
 * Masks every pattern.
 * @param text - the text to mask.
 * @returns the masked text and the counts per pattern.
 */
function mask(text: string): { text: string; counts: Record<string, number> } {
  return redactText(text, SECRET_PATTERN_NAMES)
}

describe('shared secret and personal-data patterns', () => {
  it('splits the patterns into credential and personal kinds', () => {
    expect([...PERSONAL_PATTERN_NAMES]).toEqual(['email'])
    expect([...CREDENTIAL_PATTERN_NAMES]).toEqual(expect.arrayContaining(['github-token', 'huggingface-token', 'e2b-key', 'aws-secret-key', 'bearer-token']))
    expect(CREDENTIAL_PATTERN_NAMES.size + PERSONAL_PATTERN_NAMES.size).toBe(SECRET_PATTERN_NAMES.size)
  })

  it.each([
    ['github-token', `token ${FAKE_GITHUB_PAT} set`, FAKE_GITHUB_PAT],
    ['huggingface-token', `HF_TOKEN=${FAKE_HF}`, FAKE_HF],
    ['e2b-key', `E2B_API_KEY=${FAKE_E2B}`, FAKE_E2B],
    ['bearer-token', `curl -H "Authorization: Bearer ${FAKE_BEARER}"`, `Bearer ${FAKE_BEARER}`],
    ['bearer-token', `authorization: bearer ${FAKE_BEARER}`, `bearer ${FAKE_BEARER}`],
    ['aws-secret-key', `${FAKE_AWS_ID},${FAKE_AWS_SECRET}`, FAKE_AWS_SECRET],
    ['aws-secret-key', `aws_secret_access_key = ${FAKE_AWS_SECRET}`, FAKE_AWS_SECRET],
    ['aws-secret-key', `export AWS_SECRET_ACCESS_KEY="${FAKE_AWS_SECRET}"`, FAKE_AWS_SECRET],
    ['aws-secret-key', JSON.stringify({ SecretAccessKey: FAKE_AWS_SECRET }), FAKE_AWS_SECRET],
    ['email', `Author: Jane <${EMAIL}>`, EMAIL],
  ])('masks a %s', (pattern, text, secret) => {
    const masked = mask(text)
    expect(masked.text).not.toContain(secret)
    expect(masked.text).toContain(`[REDACTED-${pattern.toUpperCase()}]`)
    expect(masked.counts[pattern]).toBe(1)
    expect(scanSecrets('case', masked.text)).toEqual([])
  })

  it('masks a key and an address right after a JSON-escaped newline and keeps the JSONL line parseable', () => {
    const line = JSON.stringify({ text: `collections/free-models\n${FAKE_OPENROUTER}\n${FAKE_HF}\nmail\n${EMAIL}` })
    expect(line).toContain(String.raw`\n${FAKE_HF}`)
    const masked = mask(line)
    expect(masked.counts).toEqual({ 'openrouter-key': 1, 'huggingface-token': 1, email: 1 })
    expect(JSON.parse(masked.text)).toEqual({ text: 'collections/free-models\n[REDACTED-OPENROUTER-KEY]\n[REDACTED-HUGGINGFACE-TOKEN]\nmail\n[REDACTED-EMAIL]' })
  })

  it('masks an e-mail address inside a JSON string, a doubly encoded one, and one behind a \\u escape, leaving each escape whole', () => {
    const single = JSON.stringify({ commit: `Co-Authored-By: Jane <${EMAIL}>` })
    expect(JSON.parse(mask(single).text)).toEqual({ commit: 'Co-Authored-By: Jane <[REDACTED-EMAIL]>' })
    const double = JSON.stringify({ result: JSON.stringify({ log: `x\n${EMAIL}` }) })
    const outer = JSON.parse(mask(double).text) as { result: string }
    expect(JSON.parse(outer.result)).toEqual({ log: 'x\n[REDACTED-EMAIL]' })
    const escaped = String.raw`{"to":"<${EMAIL}>"}`
    expect(JSON.parse(mask(escaped).text)).toEqual({ to: '<[REDACTED-EMAIL]>' })
  })

  it('masks a PEM private key, body and all', () => {
    const line = JSON.stringify({ text: `read server.key\n-----BEGIN RSA PRIVATE KEY-----\n${PEM_BODY}\n${PEM_BODY}\n-----END RSA PRIVATE KEY-----\ndone` })
    const masked = mask(line)
    expect(masked.text).not.toContain(PEM_BODY)
    expect(masked.counts).toEqual({ 'private-key': 1 })
    expect(JSON.parse(masked.text)).toEqual({ text: 'read server.key\n[REDACTED-PRIVATE-KEY]\ndone' })
  })

  it('finds an AWS secret next to an access key id that an earlier redaction already masked', () => {
    const idMasked = redactText(`${FAKE_AWS_ID} ${FAKE_AWS_SECRET}`, new Set(['aws-access-key']))
    expect(idMasked.text).toContain(FAKE_AWS_SECRET)
    expect(scanSecrets('case', idMasked.text).map(hit => hit.pattern)).toEqual(['aws-secret-key'])
  })

  it('keeps a match whose digest is an accepted placeholder', () => {
    const placeholder = 'Bearer abcdefghijklmnopqrstuvwxyz012345'
    const masked = redactText(`fixture ${placeholder} and ${EMAIL}`, SECRET_PATTERN_NAMES, new Set([sha256(placeholder)]))
    expect(masked.text).toBe(`fixture ${placeholder} and [REDACTED-EMAIL]`)
  })

  it.each([
    ['a git SHA', 'commit 3f786850e387550fdab836ed7e6dc881de23001b (HEAD -> main)'],
    ['a 40-character SHA after an unrelated label', 'secret_sha: 3f786850e387550fdab836ed7e6dc881de23001b'],
    ['a UUID', 'session 123e4567-e89b-12d3-a456-426614174000 resumed'],
    ['a base64 image fragment', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='],
    ['package pins and hosts without a mail domain', 'pnpm add vitest@4.0.0-beta.1 react@19.1.0; ssh root@10.0.0.1; curl user@localhost'],
    ['identifiers that only contain a short prefix', `my_hf_${'a'.repeat(40)} e2b_sandbox_template ${'x'.repeat(20)}hf_${'b'.repeat(40)}`],
    ['a shell variable after Bearer', 'Authorization: Bearer $GITHUB_TOKEN'],
  ])('leaves %s alone', (_label, text) => {
    expect(mask(text)).toEqual({ text, counts: {} })
    expect(scanSecrets('case', text)).toEqual([])
  })
})
