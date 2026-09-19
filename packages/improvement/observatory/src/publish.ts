/**
 * The publication rules as pure functions: which rows a fold may withhold,
 * which experiment verdicts a fold may rank, when a publication goes stale, and
 * what one row may state once those rules have run.
 *
 * Every rule here is fixed rather than configured. A deployment states which
 * districts it withholds, how stale is stale, and how often it refolds; it does
 * not state whether a cost may be published without the digest that priced it,
 * whether `resolved` may stand in for `parity`, or whether a ranking may appear
 * without a verdict, because those are what the page means.
 *
 * @module @deepseek-ai/dsh-observatory/publish
 */

import type { ExperimentResult } from '@deepseek-ai/dsh-experiments/types'
import type { ScoreboardRow } from '@deepseek-ai/dsh-scorekeeper/types'
import { OBSERVATORY_DOCUMENT_VERSION } from './types.ts'
import type {
  ObservatoryDocument,
  ObservatoryPublishedRow,
  ObservatoryRanking,
  ObservatorySnapshot,
  ObservatoryTamper,
} from './types.ts'

/** The districts and held-out split one fold keeps out of its public rows. */
export interface WithholdRule {
  /** Districts whose rows never reach the public page. */
  readonly districts: readonly string[]
  /** Whether held-out rows are withheld as well. */
  readonly heldOut: boolean
}

/** One fold's rows split into what it publishes and what it withheld, with the counts. */
export interface WithholdSplit {
  readonly published: readonly ScoreboardRow[]
  readonly districtRows: number
  readonly districtSessions: number
  readonly heldOutRows: number
  readonly heldOutSessions: number
}

/** Sessions one row folded, the errored ones included. */
function sessionsOf(row: ScoreboardRow): number {
  return row.runs + row.errors
}

/**
 * Split scoreboard rows into the published ones and the withheld counts. A row
 * withheld for both reasons is counted under its district, which is checked
 * first; the row key carries both dimensions, so every session of a withheld
 * row is withheld and no withheld session can reach a published row.
 * @param rows - every row the scoreboard folded, in fold order.
 * @param rule - the districts and held-out split to withhold.
 * @returns the published rows in fold order, and the rows and sessions dropped per reason.
 */
export function withhold(rows: readonly ScoreboardRow[], rule: WithholdRule): WithholdSplit {
  const published: ScoreboardRow[] = []
  let districtRows = 0
  let districtSessions = 0
  let heldOutRows = 0
  let heldOutSessions = 0
  for (const row of rows) {
    if (row.district !== undefined && rule.districts.includes(row.district)) {
      districtRows += 1
      districtSessions += sessionsOf(row)
      continue
    }
    if (rule.heldOut && row.heldOut) {
      heldOutRows += 1
      heldOutSessions += sessionsOf(row)
      continue
    }
    published.push(row)
  }
  return { published, districtRows, districtSessions, heldOutRows, heldOutSessions }
}

/**
 * Sort key of one row: the same fields the scoreboard keys a row by,
 * serialized rather than concatenated so no field value can spell a separator.
 */
function sortKey(row: ScoreboardRow): string {
  return JSON.stringify([
    row.provider,
    row.model,
    row.ladder?.map(rung => [rung.provider, rung.model, rung.share ?? null]) ?? null,
    row.environmentId,
    row.isolation,
    row.implementer,
    row.preset ?? null,
    row.heldOut,
    row.district ?? null,
  ])
}

/**
 * Order rows by route, attempt ladder, environment, isolation, implementer, agent preset, held-out split, and district. A
 * scoreboard's own order is the order its session store listed the sessions in,
 * which no backend promises to keep, so an unordered page would reshuffle
 * between folds that measured the same thing.
 * @param rows - the published rows in fold order.
 * @returns the same rows in the page's stable order.
 */
export function orderRows(rows: readonly ScoreboardRow[]): readonly ScoreboardRow[] {
  return [...rows].sort((left, right) => (sortKey(left) < sortKey(right) ? -1 : 1))
}

/** The key one route is matched by: its provider and model, separated by a character no route name can hold. */
function routeKey(provider: string, model: string): string {
  return `${provider}\0${model}`
}

/**
 * Keep the experiment results whose two arm routes both appear in the published
 * rows. A verdict about a route the page withholds or never folded publishes no
 * ranking, so a ranking is never the only evidence of a session.
 * @param experiments - the results a caller holds from its own runs.
 * @param rows - the published rows, whose routes are the ones a ranking may name.
 * @returns the rankable results in caller order.
 */
export function rankable(
  experiments: readonly ExperimentResult[],
  rows: readonly ScoreboardRow[],
): readonly ExperimentResult[] {
  const routes = new Set(rows.map(row => routeKey(row.provider, row.model)))
  return experiments.filter((experiment) => {
    const { baseline, candidate } = experiment.arms
    return routes.has(routeKey(baseline.model.provider, baseline.model.model))
      && routes.has(routeKey(candidate.model.provider, candidate.model.model))
  })
}

/** The tamper status of one row: no verdict at all, at least one tamper, or none. */
function tamperOf(row: ScoreboardRow): ObservatoryTamper {
  if (row.runs === 0) return 'not-instrumented'
  return row.tampered > 0 ? 'tampered' : 'none'
}

/**
 * The cost fields one row may publish. Cost travels with the digest that priced
 * it and only when exactly one table priced the row: a row priced under two
 * tables states a sum across pricing tables, which is not a price.
 */
function costOf(row: ScoreboardRow): Pick<ObservatoryPublishedRow, 'costEurPerCertified' | 'pricingDigest'> {
  const [digest, ...rest] = row.pricingDigests
  if (digest === undefined || rest.length > 0 || row.costEurPerCertified === undefined) return {}
  return { costEurPerCertified: row.costEurPerCertified, pricingDigest: digest }
}

/**
 * Apply the row-level publication rules to one scoreboard row.
 * @param row - one published scoreboard row.
 * @returns the honest column set, with the cost and tamper rules already applied.
 */
export function publishRow(row: ScoreboardRow): ObservatoryPublishedRow {
  return {
    provider: row.provider,
    model: row.model,
    ...row.ladder === undefined ? {} : { ladder: row.ladder },
    environmentId: row.environmentId,
    environmentKind: row.environmentKind,
    ...row.district === undefined ? {} : { district: row.district },
    heldOut: row.heldOut,
    isolation: row.isolation,
    implementer: row.implementer,
    ...row.preset === undefined ? {} : { preset: row.preset },
    certificateExecutors: row.certificateExecutors,
    ...row.compositionSha256 === undefined ? {} : { compositionSha256: row.compositionSha256 },
    tamper: tamperOf(row),
    tampered: row.tampered,
    escapesDenied: row.escapesDenied,
    runs: row.runs,
    errors: row.errors,
    certified: row.certified,
    resolved: row.certificateRate,
    ...row.parity === undefined ? {} : { parity: row.parity },
    ...costOf(row),
  }
}

/** One ranking from one experiment result. */
function publishRanking(experiment: ExperimentResult): ObservatoryRanking {
  return {
    digest: experiment.digest,
    baseline: experiment.arms.baseline.model,
    candidate: experiment.arms.candidate.model,
    delta: experiment.delta,
    verdict: experiment.verdict,
  }
}

/**
 * Whether a snapshot is too old to show numbers. A fold that read no session is
 * stale by the same rule: it has nothing whose age could be current.
 * @param snapshot - the fold to age.
 * @param now - epoch milliseconds the publication is rendered at.
 * @param staleAfterMs - age of the newest folded session past which the page shows the notice instead.
 * @returns `true` when the newest folded session is older than the threshold, or when none was folded.
 */
export function isStale(snapshot: ObservatorySnapshot, now: number, staleAfterMs: number): boolean {
  const newest = snapshot.newestSessionAt
  return newest === undefined || now - newest > staleAfterMs
}

/**
 * Build the JSON face of one publication.
 * @param snapshot - the fold to publish.
 * @param now - epoch milliseconds the publication is rendered at.
 * @param staleAfterMs - the staleness threshold this deployment configured.
 * @returns the document; a stale one carries no row and no ranking, and keeps the withheld counts.
 */
export function publishDocument(
  snapshot: ObservatorySnapshot,
  now: number,
  staleAfterMs: number,
): ObservatoryDocument {
  const stale = isStale(snapshot, now, staleAfterMs)
  return {
    version: OBSERVATORY_DOCUMENT_VERSION,
    stale,
    foldedAt: snapshot.foldedAt,
    ...snapshot.newestSessionAt === undefined ? {} : { newestSessionAt: snapshot.newestSessionAt },
    refreshIntervalMs: snapshot.refreshIntervalMs,
    staleAfterMs,
    rows: stale ? [] : snapshot.rows.map(publishRow),
    withheld: snapshot.withheld,
    rankings: stale ? [] : snapshot.experiments.map(publishRanking),
  }
}
