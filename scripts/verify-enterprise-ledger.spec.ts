import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { LEDGER_PATH, type FunctionLine, type TicketLine } from './enterprise-ledger.ts'
import {
  appendFailure,
  ledgerRows,
  parseGateArguments,
  repositoryGit,
  subsequenceIndexes,
  unparsedRows,
  verifyLedgerHistory,
  type LedgerViolationKind,
} from './verify-enterprise-ledger.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Run git in `cwd` with no hooks or signing from the host's configuration. */
function git(cwd: string, ...args: string[]): string {
  const config = ['core.hooksPath=/dev/null', 'commit.gpgsign=false', 'user.name=Claude', 'user.email=noreply@anthropic.com']
  return execFileSync('git', [...config.flatMap(entry => ['-c', entry]), ...args], { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

/** A repository whose `main` holds one commit with the union merge driver on the ledger. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), 'verify-ledger-'))
  roots.push(root)
  git(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, '.gitattributes'), `${LEDGER_PATH} merge=union\n`)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', 'root')
  return root
}

/** Commit the ledger as exactly `rows`. @returns the new commit. */
function commitLedger(root: string, rows: readonly string[], message = 'ledger'): string {
  mkdirSync(join(root, 'data/enterprise'), { recursive: true })
  writeFileSync(join(root, LEDGER_PATH), rows.map(row => `${row}\n`).join(''))
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', message)
  return git(root, 'rev-parse', 'HEAD')
}

/** Commit an unrelated file. @returns the new commit. */
function commitOther(root: string, name: string): string {
  writeFileSync(join(root, name), `${name}\n`)
  git(root, 'add', '-A')
  git(root, 'commit', '-q', '-m', name)
  return git(root, 'rev-parse', 'HEAD')
}

function ticket(id: string, commit: string | null): string {
  const line: TicketLine = {
    type: 'ticket',
    at: '2026-09-29T02:00:00.000Z',
    shift: 'shift-1',
    ticket: id,
    seat: 'harness-core-llm-steward',
    division: 'harness-core',
    checks: [],
    shipped: commit === null ? null : { commit },
  }
  return JSON.stringify(line)
}

function gate(commit: string, extra: Partial<FunctionLine['target']> = {}): string {
  const line: FunctionLine = {
    type: 'function',
    at: '2026-09-29T02:10:00.000Z',
    shift: 'cycle-1',
    seat: 'verification-verify-md-links',
    division: 'verification',
    function: 'verify-md-links',
    target: { commit, ...extra },
    outcome: 'pass',
    evidence: { path: 'data/enterprise/functions/cycle-1/verify-md-links.log' },
    seconds: 1,
  }
  return JSON.stringify(line)
}

/** A violation without its commit, which each fixture's commits make unstable to spell out. */
interface Found {
  kind: LedgerViolationKind
  line: number | undefined
  detail: string
}

function verify(root: string, base: string, head = 'HEAD'): { violations: Found[]; commits: number; added: number } {
  const result = verifyLedgerHistory(repositoryGit(root), base, head)
  const violations = result.violations.map(({ kind, line, detail }) => ({ kind, line, detail }))
  return { violations, commits: result.commits.length, added: result.added }
}

describe('the line helpers', () => {
  it('splits a ledger into lines, the final newline ending the last', () => {
    expect(ledgerRows(undefined)).toEqual([])
    expect(ledgerRows('')).toEqual([])
    expect(ledgerRows('a\nb\n')).toEqual(['a', 'b'])
    expect(ledgerRows('a\nb')).toEqual(['a', 'b'])
  })

  it('matches a subsequence in order, or answers undefined', () => {
    expect(subsequenceIndexes(['a', 'c'], ['a', 'b', 'c'])).toEqual([0, 2])
    expect(subsequenceIndexes(['c', 'a'], ['a', 'b', 'c'])).toBeUndefined()
  })

  it('names an insert, a deletion and a change at the first line not kept in place', () => {
    expect(appendFailure(['a', 'b'], ['a', 'b', 'c'])).toBeUndefined()
    expect(appendFailure(['a', 'b'], ['a', 'x', 'b'])).toEqual({ line: 2, detail: '1 line(s) inserted before the end; the parent\'s line 2 is not kept in place' })
    expect(appendFailure(['a', 'b'], ['b'])).toEqual({ line: 1, detail: '1 line(s) deleted; the parent\'s line 1 is not kept in place' })
    expect(appendFailure(['a', 'b'], ['a', 'c'])).toEqual({ line: 2, detail: 'a line changed; the parent\'s line 2 is not kept in place' })
  })

  it('reports every line of a ledger text that does not parse', () => {
    expect(unparsedRows(`${ticket('T-0001', null)}\nnot json\n{"type":"note"}\n`)).toEqual([
      { line: 2, detail: 'not JSON: not json' },
      { line: 3, detail: 'unknown line type "note"' },
    ])
  })
})

describe('verifyLedgerHistory', () => {
  it('accepts pure appends whose references are on the ancestry of the commit that added them', () => {
    const root = repository()
    const base = commitLedger(root, [ticket('T-0001', null)])
    const shipped = commitOther(root, 'change')
    commitLedger(root, [ticket('T-0001', null), ticket('T-0002', shipped)])
    commitOther(root, 'unrelated')
    commitLedger(root, [ticket('T-0001', null), ticket('T-0002', shipped), gate(shipped, { requested: base, via: shipped })])
    expect(verify(root, base)).toEqual({ violations: [], commits: 2, added: 2 })
  })

  it('checks the first ledger a range creates as all added lines', () => {
    const root = repository()
    const base = git(root, 'rev-parse', 'HEAD')
    commitLedger(root, [gate(base)])
    expect(verify(root, base)).toEqual({ violations: [], commits: 1, added: 1 })
  })

  it('rejects a line inserted before the end', () => {
    const root = repository()
    const base = commitLedger(root, [ticket('T-0001', null), ticket('T-0002', null)])
    commitLedger(root, [ticket('T-0001', null), ticket('T-0003', null), ticket('T-0002', null)])
    expect(verify(root, base)).toEqual({
      violations: [{ kind: 'not-append', line: 2, detail: '1 line(s) inserted before the end; the parent\'s line 2 is not kept in place' }],
      commits: 1,
      added: 1,
    })
  })

  it('rejects a deleted line', () => {
    const root = repository()
    const base = commitLedger(root, [ticket('T-0001', null), ticket('T-0002', null)])
    commitLedger(root, [ticket('T-0002', null)])
    expect(verify(root, base).violations).toEqual([{ kind: 'not-append', line: 1, detail: '1 line(s) deleted; the parent\'s line 1 is not kept in place' }])
  })

  it('rejects a changed line, and still checks what the changed line names', () => {
    const root = repository()
    const base = commitLedger(root, [ticket('T-0001', null)])
    commitLedger(root, [ticket('T-0001', 'f'.repeat(40))])
    expect(verify(root, base).violations).toEqual([
      { kind: 'not-append', line: 1, detail: 'a line changed; the parent\'s line 1 is not kept in place' },
      { kind: 'reference-missing', line: 1, detail: `shipped.commit ${'f'.repeat(40)} is not a commit in this repository` },
    ])
  })

  it('rejects a reference to a commit the branch does not carry, one that does not exist, and an abbreviated one', () => {
    const root = repository()
    const base = commitLedger(root, [ticket('T-0001', null)])
    git(root, 'switch', '-q', '-c', 'clone')
    const replaced = commitOther(root, 'pre-rebase')
    git(root, 'switch', '-q', 'main')
    commitLedger(root, [ticket('T-0001', null), ticket('T-0002', replaced), gate(base, { requested: '0'.repeat(40) }), gate(base.slice(0, 9))])
    expect(verify(root, base).violations).toEqual([
      { kind: 'reference-not-ancestor', line: 2, detail: `shipped.commit ${replaced} is not an ancestor of the commit that added the line` },
      { kind: 'reference-missing', line: 3, detail: `target.requested ${'0'.repeat(40)} is not a commit in this repository` },
      { kind: 'reference-malformed', line: 4, detail: `target.commit ${base.slice(0, 9)} is not a full 40-hex commit id` },
    ])
  })

  it('rejects an added line that does not parse under the ledger schema', () => {
    const root = repository()
    const base = commitLedger(root, [ticket('T-0001', null)])
    commitLedger(root, [ticket('T-0001', null), 'not json', JSON.stringify({ ...JSON.parse(ticket('T-0002', null)) as object, recordedBy: 'someone' })])
    expect(verify(root, base).violations).toEqual([
      { kind: 'unparsed', line: 2, detail: 'not JSON: not json' },
      { kind: 'unparsed', line: 3, detail: expect.stringContaining('"recordedBy" is not one of supervisor') as string },
    ])
  })

  it('accepts a union merge of two branches that each appended', () => {
    const root = repository()
    const base = commitLedger(root, [ticket('T-0001', null)])
    git(root, 'switch', '-q', '-c', 'side')
    const sideWork = commitOther(root, 'side-work')
    commitLedger(root, [ticket('T-0001', null), ticket('T-0002', sideWork)])
    git(root, 'switch', '-q', 'main')
    commitLedger(root, [ticket('T-0001', null), gate(base)])
    git(root, 'merge', '-q', '--no-edit', 'side')
    const merged = ledgerRows(git(root, 'show', `HEAD:${LEDGER_PATH}`))
    expect(merged).toEqual([ticket('T-0001', null), gate(base), ticket('T-0002', sideWork)])
    expect(verify(root, base)).toEqual({ violations: [], commits: 3, added: 2 })
  })

  it('rejects a merge that drops a parent\'s line, and names that parent', () => {
    const root = repository()
    const base = commitLedger(root, [ticket('T-0001', null)])
    git(root, 'switch', '-q', '-c', 'side')
    const side = commitLedger(root, [ticket('T-0001', null), ticket('T-0002', null)])
    git(root, 'switch', '-q', 'main')
    commitLedger(root, [ticket('T-0001', null), gate(base)])
    git(root, 'merge', '-q', '--no-edit', '-s', 'ours', 'side')
    expect(verify(root, base).violations).toEqual([
      { kind: 'merge-dropped', line: undefined, detail: `the merge does not keep every line of its parent ${side} in order` },
    ])
  })

  it('rejects a head whose history no longer contains the base', () => {
    const root = repository()
    const base = commitLedger(root, [ticket('T-0001', null)])
    git(root, 'reset', '-q', '--hard', 'HEAD~1')
    commitLedger(root, [ticket('T-0009', null)])
    const result = verifyLedgerHistory(repositoryGit(root), base, 'HEAD')
    expect(result.violations).toEqual([
      { kind: 'base-not-ancestor', commit: result.head, detail: `the base ${base} is not an ancestor of the head: the branch was rewritten` },
    ])
  })

  it('refuses a base or head that names no commit', () => {
    const root = repository()
    expect(() => verifyLedgerHistory(repositoryGit(root), 'no-such-rev', 'HEAD')).toThrow(/the base "no-such-rev" is not a commit/)
    expect(() => verifyLedgerHistory(repositoryGit(root), 'HEAD', 'no-such-rev')).toThrow(/the head "no-such-rev" is not a commit/)
  })
})

describe('parseGateArguments', () => {
  it('takes the base from --base, else from DSH_LEDGER_BASE_REF, and the head from --head, else HEAD', () => {
    expect(parseGateArguments(['--', '--base', 'abc', '--head', 'def'], {})).toEqual({ base: 'abc', head: 'def' })
    expect(parseGateArguments([], { DSH_LEDGER_BASE_REF: 'abc' })).toEqual({ base: 'abc', head: 'HEAD' })
    expect(parseGateArguments([], { DSH_LEDGER_BASE_REF: '' })).toEqual({ base: undefined, head: 'HEAD' })
  })

  it('refuses an unknown flag and a flag without its revision', () => {
    expect(() => parseGateArguments(['--since', 'abc'], {})).toThrow(/unknown argument "--since"/)
    expect(() => parseGateArguments(['--base'], {})).toThrow(/--base needs a revision/)
    expect(() => parseGateArguments(['--base', '--head', 'x'], {})).toThrow(/--base needs a revision/)
  })
})
