/**
 * The transcript collector's credential handling: a real credential shape is
 * refused by default, masked when its pattern is passed to `--redact`, and kept
 * verbatim only when its digest is passed to `--accept-hit`; the written tree is
 * re-scanned so no unaccepted secret can ship. The synthetic keys here match the
 * shapes but are not real credentials.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const collector = fileURLToPath(new URL('../data/transcripts/tools/collect-claude-code-session.mjs', import.meta.url))
const FAKE_OPENROUTER = `sk-or-v1-${'0123456789abcdef'.repeat(4)}`
const FAKE_ANTHROPIC = `sk-ant-${'A1b2C3d4E5'.repeat(4)}`

let root: string
let projectsDir: string
const session = 'testsession'

/**
 * Runs the collector, returning its exit status and streams instead of throwing.
 * @param args - CLI arguments after the script path.
 * @returns the exit code, stdout and stderr.
 */
function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [collector, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout, stderr: '' }
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string }
    return { code: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }
  }
}

/** Every file under a directory, read as text and concatenated. */
function readTree(dir: string): string {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => readFileSync(join(entry.parentPath ?? dir, entry.name), 'utf8'))
    .join('\n')
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'collect-redaction-'))
  projectsDir = join(root, 'projects')
  mkdirSync(projectsDir, { recursive: true })
  const line = (data: unknown) => `${JSON.stringify(data)}\n`
  writeFileSync(join(projectsDir, `${session}.jsonl`), [
    line({ role: 'user', text: `here is my key ${FAKE_OPENROUTER} use it` }),
    line({ role: 'assistant', text: `and the vendor key ${FAKE_ANTHROPIC}` }),
    line({ role: 'assistant', text: 'a plain line with no secret' }),
  ].join(''))
})

afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('transcript collector credential handling', () => {
  it('refuses to write when a credential shape is neither redacted nor accepted', () => {
    const out = join(root, 'refused')
    const result = run(['--out', out, '--session', session, '--projects-dir', projectsDir])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('refusing to write')
    expect(result.stderr).toContain('openrouter-key')
    expect(result.stderr).toContain('anthropic-key')
    expect(() => readdirSync(out)).toThrow()
  })

  it('masks a credential whose pattern is passed to --redact and records it', () => {
    const out = join(root, 'redacted')
    const result = run(['--out', out, '--session', session, '--projects-dir', projectsDir, '--redact', 'openrouter-key', '--redact', 'anthropic-key'])
    expect(result.code).toBe(0)
    const tree = readTree(out)
    expect(tree).not.toContain(FAKE_OPENROUTER)
    expect(tree).not.toContain(FAKE_ANTHROPIC)
    expect(tree).toContain('[REDACTED-OPENROUTER-KEY]')
    expect(tree).toContain('[REDACTED-ANTHROPIC-KEY]')
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as {
      redactions: { patterns: string[]; files: { count: number }[] }
    }
    expect(manifest.redactions.patterns).toEqual(['anthropic-key', 'openrouter-key'])
    expect(manifest.redactions.files.reduce((sum, entry) => sum + entry.count, 0)).toBe(2)
  })

  it('still refuses a second credential when only one pattern is redacted', () => {
    const out = join(root, 'partial')
    const result = run(['--out', out, '--session', session, '--projects-dir', projectsDir, '--redact', 'openrouter-key'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('anthropic-key')
    expect(result.stderr).not.toContain('openrouter-key')
  })

  it('keeps a reviewed placeholder verbatim when its digest is accepted', () => {
    const out = join(root, 'accepted')
    const openrouterDigest = createHash('sha256').update(FAKE_OPENROUTER).digest('hex')
    const result = run(['--out', out, '--session', session, '--projects-dir', projectsDir, '--accept-hit', openrouterDigest, '--redact', 'anthropic-key'])
    expect(result.code).toBe(0)
    const tree = readTree(out)
    expect(tree).toContain(FAKE_OPENROUTER)
    expect(tree).not.toContain(FAKE_ANTHROPIC)
  })

  it('rejects an unknown --redact pattern name', () => {
    const result = run(['--out', join(root, 'bad'), '--session', session, '--projects-dir', projectsDir, '--redact', 'not-a-pattern'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unknown pattern')
  })
})
