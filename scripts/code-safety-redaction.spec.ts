/**
 * The code-safety record redaction tool's behavior cases, run under plain Node
 * the way the tool itself runs: every private-key shape found in recorded
 * session logs is replaced, JSON stays parseable, and a second pass is a no-op.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const casesFile = fileURLToPath(new URL('../data/code-safety/tools/redact-record.cases.mjs', import.meta.url))

describe('code-safety record redaction', () => {
  it('replaces every private-key body shape on record and leaves the rest untouched', () => {
    const output = execFileSync(process.execPath, [casesFile], { encoding: 'utf8' })
    expect(output.trim()).toMatch(/^redact-record cases: \d+ passed$/)
  })
})
