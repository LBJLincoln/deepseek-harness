import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { GitHubReader } from './enterprise-functions.ts'
import { LEDGER_PATH, readLedger } from './enterprise-ledger.ts'
import type { CiRunRef, ReportSources, ShippedCommitReport } from './enterprise-report.ts'
import { buildRoster } from './enterprise-roster.ts'
import { renderVerdicts, shippedVerdicts } from './enterprise-verdicts.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const OLD = '1'.repeat(40)
const RECENT = '2'.repeat(40)
const HEAD = '3'.repeat(40)
const NOW = new Date('2026-09-29T08:00:00.000Z')

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function shippedLine(ticket: string, at: string, commit: string): string {
  return JSON.stringify({
    type: 'ticket', at, shift: 's', ticket, seat: 'harness-core-session-steward', division: 'harness-core',
    checks: [], review: { verdict: 'approve' }, integration: { outcome: 'merged' }, shipped: { commit }, tokens: 1, seconds: 1,
  })
}

function runRef(id: number, conclusion: string | null, status = 'completed'): CiRunRef {
  return { id, headSha: HEAD, status, conclusion, url: `https://github.com/LBJLincoln/deepseek-harness/actions/runs/${id}`, createdAt: '2026-09-28T00:00:00Z' }
}

describe('shippedVerdicts', () => {
  it('answers every commit the ledger shipped, however long ago, from the ledger\'s first line to now', async () => {
    const root = mkdtempSync(join(tmpdir(), 'enterprise-verdicts-'))
    dirs.push(root)
    mkdirSync(dirname(join(root, LEDGER_PATH)), { recursive: true })
    writeFileSync(join(root, LEDGER_PATH), `${[shippedLine('T-0001', '2026-09-20T10:00:00.000Z', OLD), shippedLine('T-0002', '2026-09-29T07:00:00.000Z', RECENT)].join('\n')}\n`)
    const asked: string[] = []
    const github: GitHubReader = {
      json: async (path) => {
        asked.push(path)
        const head = path.includes(`head_sha=${OLD}`) ? OLD : path.includes(`head_sha=${RECENT}`) ? RECENT : undefined
        if (head === undefined) return { workflow_runs: [] }
        return { workflow_runs: [{ id: head === OLD ? 1 : 2, head_sha: head, status: 'completed', conclusion: 'success', html_url: `https://github.com/x/actions/runs/${head === OLD ? 1 : 2}`, created_at: '2026-09-29T07:30:00Z' }] }
      },
      text: async () => '',
    }
    const sources: ReportSources = {
      root,
      repository: { head: () => HEAD, cycleCommits: () => [], commitTime: () => undefined, contains: () => undefined },
      github,
      rosterAt: until => buildRoster(repoRoot, { generatedAt: until, recorded: [], ledger: readLedger(join(root, LEDGER_PATH)).lines }),
    }
    const commits = await shippedVerdicts(sources, NOW)
    expect(commits.map(entry => [entry.commit, entry.tickets, entry.verdict])).toEqual([[OLD, ['T-0001'], 'success'], [RECENT, ['T-0002'], 'success']])
    expect(asked.filter(path => path.includes('head_sha=')).length).toBe(2)
  })
})

describe('renderVerdicts', () => {
  it('writes one row per commit with its verdict, the basis, which run, and the run the verdict was read from', () => {
    const entries: ShippedCommitReport[] = [
      { commit: OLD, tickets: ['T-0001', 'T-0003'], divisions: ['harness-core'], ci: { basis: 'exact', runs: [runRef(12, null, 'in_progress'), runRef(11, 'success')] }, verdict: 'success' },
      { commit: RECENT, tickets: ['T-0002'], divisions: ['harness-core'], ci: { basis: 'later', run: runRef(22, 'failure'), superseded: [runRef(21, 'cancelled')] }, verdict: 'failure' },
      { commit: HEAD, tickets: ['T-0004'], divisions: ['harness-core'], ci: { basis: 'none', superseded: [] }, verdict: 'no run' },
    ]
    expect(renderVerdicts(entries).split('\n')).toEqual([
      '| Commit | Tickets | Verdict | Basis | Which run | Run |',
      '|---|---|---|---|---|---|',
      `| \`${OLD}\` | T-0001, T-0003 | success | exact | runs 12 (in_progress), 11 (success) on this exact commit | https://github.com/LBJLincoln/deepseek-harness/actions/runs/11 |`,
      `| \`${RECENT}\` | T-0002 | failure | later | run 21 (cancelled) on this exact commit rendered no verdict; the first later completed run whose head contains it is 22 on ${HEAD.slice(0, 10)} | https://github.com/LBJLincoln/deepseek-harness/actions/runs/22 |`,
      `| \`${HEAD}\` | T-0004 | no run | none | no run on ${HEAD.slice(0, 10)} and no later completed run whose head contains it | — |`,
      '',
    ])
  })
})
