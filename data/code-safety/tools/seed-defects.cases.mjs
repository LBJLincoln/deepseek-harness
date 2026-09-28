#!/usr/bin/env node
// Behavior cases for seed-defects.mjs on a TypeScript target: a planted line
// parses as one statement of its own, an insertion a semicolon-free
// neighbour would absorb is refused, the seeded copy carries no `.git`
// directory, and the same seed plants the same set twice.
// `scripts/code-safety-seeding.spec.ts` runs this file under plain Node, as
// the tool itself runs.
//
// Usage: node seed-defects.cases.mjs
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkTypeScript, seedDefects } from './seed-defects.mjs'

// Line 3 is a credential site and line 15 a wire-read site, twelve lines
// apart, so the tool's ten-line separation rule admits both.
const WIRE = [
  "import { string } from './wire.ts'",
  '',
  'export const DEFAULT_GRACE_MS = 3_000',
  '',
  '/**',
  ' * The thread a notification names.',
  ' *',
  ' * The value crosses a process boundary, so it is read through the',
  ' * validating accessor rather than trusted.',
  ' *',
  " * @param params - the notification's parameters.",
  ' * @returns the thread id.',
  ' */',
  'export function threadOf(params: Record<string, unknown>): string {',
  "  const threadId = string(params.threadId, 'thread id')",
  '  return threadId',
  '}',
  '',
].join('\n')

/**
 * A target tree holding one TypeScript file and a `.git` directory, in a fresh temporary directory.
 * @returns {{ root: string, target: string }} the temporary root and the target inside it
 */
function makeTarget() {
  const root = mkdtempSync(join(tmpdir(), 'seed-defects-cases-'))
  const target = join(root, 'target')
  mkdirSync(join(target, 'src'), { recursive: true })
  mkdirSync(join(target, '.git'))
  writeFileSync(join(target, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  writeFileSync(join(target, 'src', 'thread.ts'), WIRE)
  return { root, target }
}

const cases = {
  'an inserted line that stands alone passes the TypeScript check': () => {
    const text = WIRE.replace("  return threadId", "  console.error(`subagent threadId: ${String(threadId)}`)\n  return threadId")
    assert.equal(checkTypeScript(text, 'thread.ts', [16]), true)
  },
  'an inserted line a following continuation would absorb is refused': () => {
    const text = [
      'export function detailOf(message: { subtype: string }): string {',
      "  const detail = message.subtype === 'success'",
      '  console.error(`subagent detail: ${String(detail)}`)',
      "    ? 'ok'",
      "    : 'failed'",
      '  return detail',
      '}',
    ].join('\n')
    assert.equal(checkTypeScript(text, 'detail.ts', [3]), false)
  },
  'a syntax error is refused': () => {
    assert.equal(checkTypeScript('export const x = {\n', 'broken.ts', [1]), false)
  },
  'a seeded TypeScript copy plants every site, leaves out .git, and repeats under the same seed': () => {
    const { root, target } = makeTarget()
    try {
      const plant = out => seedDefects({ targetDir: target, outDir: join(root, out), language: 'typescript', seed: 'a', n: 2, cataloguePath: new URL('./seed-catalogue.json', import.meta.url).pathname, avoidPaths: [], maxPerEntry: 1 })
      const first = plant('first')
      const second = plant('second')
      assert.equal(first.planted, 2)
      assert.throws(() => readFileSync(join(first.repoDir, '.git', 'HEAD')), /ENOENT/)
      assert.equal(readFileSync(join(first.repoDir, 'src', 'thread.ts'), 'utf8'), readFileSync(join(second.repoDir, 'src', 'thread.ts'), 'utf8'))
      const truth = JSON.parse(readFileSync(first.groundTruthPath, 'utf8'))
      const lines = readFileSync(join(first.repoDir, 'src', 'thread.ts'), 'utf8').split('\n')
      const original = WIRE.split('\n')
      for (const issue of truth.issues) {
        assert.equal(issue.file, 'src/thread.ts')
        assert.equal(checkTypeScript(lines.join('\n'), 'thread.ts', [issue.lines[0]]), true)
        assert.equal(original.includes(lines[issue.lines[0] - 1]), false, `line ${issue.lines[0]} is an original line, not the planted one`)
      }
      assert.equal(readFileSync(join(target, 'src', 'thread.ts'), 'utf8'), WIRE)
    } finally {
      rmSync(root, { recursive: true, force: true })
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
console.log(`seed-defects cases: ${passed} passed`)
