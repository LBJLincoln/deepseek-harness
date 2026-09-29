/**
 * Every commit the enterprise shipped, with its Branch CI verdict
 * (`pnpm run enterprise:verdicts`): each distinct `shipped.commit` of the
 * ledger's ticket lines, the tickets it carries, and the answer the
 * [report](./enterprise-report.ts) gives it — the verdict of a run on that
 * exact commit, else of the first later completed run whose head contains it,
 * labelled `later` — over the whole ledger instead of one window.
 *
 * @module enterprise-verdicts
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { githubReader } from './enterprise-functions.ts'
import { LEDGER_PATH, readLedger } from './enterprise-ledger.ts'
import {
  describeCi,
  enterpriseReport,
  gitRepository,
  recordedSessionsIn,
  rosterGeneratorAt,
  type ReportSources,
  type ShippedCommitReport,
} from './enterprise-report.ts'

/**
 * The shipped commits and their Branch CI answers, from the ledger's first line to `now`.
 * @param sources - what the report reads.
 * @param now - the end of the window.
 * @returns one entry per shipped commit, as the report answers it.
 */
export async function shippedVerdicts(sources: ReportSources, now: Date): Promise<ShippedCommitReport[]> {
  const until = now.toISOString()
  const since = readLedger(join(sources.root, LEDGER_PATH)).lines.map(line => line.at).sort()[0] ?? until
  return (await enterpriseReport(sources, { since, until })).commits
}

/**
 * The run a verdict was read from.
 * @param entry - one shipped commit's answer.
 * @returns the run's page, or `undefined` when no run rendered the verdict.
 */
function verdictRun(entry: ShippedCommitReport): string | undefined {
  switch (entry.ci.basis) {
    case 'exact': return entry.ci.runs.find(run => run.conclusion === entry.verdict)?.url
    case 'later': return entry.ci.run.url
    case 'none':
    case 'unknown': return undefined
    default: return entry.ci satisfies never
  }
}

/**
 * The verdicts as a Markdown table, one row per shipped commit.
 * @param commits - the shipped commits' answers.
 * @returns the table.
 */
export function renderVerdicts(commits: readonly ShippedCommitReport[]): string {
  const rows = commits.map(entry => [
    `\`${entry.commit}\``,
    entry.tickets.join(', '),
    entry.verdict,
    entry.ci.basis,
    describeCi(entry.commit, entry.ci),
    verdictRun(entry) ?? '—',
  ])
  return `${[
    '| Commit | Tickets | Verdict | Basis | Which run | Run |',
    '|---|---|---|---|---|---|',
    ...rows.map(cells => `| ${cells.join(' | ')} |`),
  ].join('\n')}\n`
}

const isMain = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const sources: ReportSources = {
    root,
    repository: gitRepository(root),
    github: githubReader(),
    rosterAt: rosterGeneratorAt(root),
    sessions: recordedSessionsIn(root),
  }
  process.stdout.write(renderVerdicts(await shippedVerdicts(sources, new Date())))
}
