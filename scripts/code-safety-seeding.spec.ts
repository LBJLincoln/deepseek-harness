/**
 * The seeded-defect tool's TypeScript behavior cases, run under plain Node
 * the way the tool itself runs: a planted line stands as one statement, an
 * insertion a neighbouring line would absorb is refused, and the seeded copy
 * leaves out the target's `.git`.
 */

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const casesFile = fileURLToPath(new URL('../data/code-safety/tools/seed-defects.cases.mjs', import.meta.url))

describe('code-safety seeded defects', () => {
  it('plants TypeScript canaries that parse as their own statements and never copies .git', () => {
    const output = execFileSync(process.execPath, [casesFile], { encoding: 'utf8' })
    expect(output.trim()).toMatch(/^seed-defects cases: \d+ passed$/)
  })
})
