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
const PEM_BODY = 'fedcba9876543210FEDCBA98'.repeat(3)

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
    line({ role: 'tool', text: `read server.key\n-----BEGIN RSA PRIVATE KEY-----\n${PEM_BODY}\n${PEM_BODY}\n-----END RSA PRIVATE KEY-----\naws AKIAIOSFODNN7EXAMPLE` }),
    // A key right after a JSON-escaped newline: the `n` of `\n` is a word
    // character, so a leading `\b` on the pattern would miss it.
    line({ role: 'user', text: `collections/free-models\n\n${FAKE_OPENROUTER}` }),
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

  it('masks every credential whose pattern is passed to --redact, body and all, and records it', () => {
    const out = join(root, 'redacted')
    const result = run(['--out', out, '--session', session, '--projects-dir', projectsDir,
      '--redact', 'openrouter-key', '--redact', 'anthropic-key', '--redact', 'private-key', '--redact', 'aws-access-key'])
    expect(result.code).toBe(0)
    const tree = readTree(out)
    expect(tree).not.toContain(FAKE_OPENROUTER)
    expect(tree).not.toContain(FAKE_ANTHROPIC)
    expect(tree).not.toContain(PEM_BODY)
    expect(tree).not.toContain('-----BEGIN RSA PRIVATE KEY-----')
    expect(tree).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(tree).toContain('[REDACTED-OPENROUTER-KEY]')
    expect(tree).toContain('[REDACTED-PRIVATE-KEY]')
    expect(tree).toContain('[REDACTED-AWS-ACCESS-KEY]')
    // The line that carried the key block still parses as JSON.
    for (const raw of readFileSync(join(out, 'orchestrator-session.jsonl'), 'utf8').split('\n').filter(Boolean)) {
      expect(() => { JSON.parse(raw) }).not.toThrow()
    }
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as {
      redactions: { patterns: string[]; files: { count: number }[] }
    }
    expect(manifest.redactions.patterns).toEqual(['anthropic-key', 'aws-access-key', 'openrouter-key', 'private-key'])
  })

  it('still refuses a credential when its pattern is not redacted', () => {
    const out = join(root, 'partial')
    const result = run(['--out', out, '--session', session, '--projects-dir', projectsDir,
      '--redact', 'openrouter-key', '--redact', 'private-key', '--redact', 'aws-access-key'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('anthropic-key')
    expect(result.stderr).not.toContain('openrouter-key')
  })

  it('keeps a reviewed placeholder verbatim when its digest is accepted', () => {
    const out = join(root, 'accepted')
    const openrouterDigest = createHash('sha256').update(FAKE_OPENROUTER).digest('hex')
    const result = run(['--out', out, '--session', session, '--projects-dir', projectsDir,
      '--accept-hit', openrouterDigest, '--redact', 'anthropic-key', '--redact', 'private-key', '--redact', 'aws-access-key'])
    expect(result.code).toBe(0)
    const tree = readTree(out)
    expect(tree).toContain(FAKE_OPENROUTER)
    expect(tree).not.toContain(FAKE_ANTHROPIC)
    expect(tree).not.toContain(PEM_BODY)
  })

  it('rejects an unknown --redact pattern name', () => {
    const result = run(['--out', join(root, 'bad'), '--session', session, '--projects-dir', projectsDir, '--redact', 'not-a-pattern'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unknown pattern')
  })
})
