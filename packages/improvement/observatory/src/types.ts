/**
 * Pure types of the observatory: the snapshot one fold over every persisted
 * session produces, the published row with the honest column set, the ranking
 * an experiment verdict earns, and the two faces of one rendered publication.
 *
 * @module @deepseek-ai/dsh-observatory/types
 */

import type { EnvironmentId, EnvironmentRunModel } from '@deepseek-ai/dsh-environments/types'
import type { ExperimentResult, ExperimentVerdict } from '@deepseek-ai/dsh-experiments/types'
import type { ScoreboardRow, ScorekeeperSkip } from '@deepseek-ai/dsh-scorekeeper/types'
import type { CertificateIsolation, RunExecutor } from '@deepseek-ai/dsh-verification/types'

/** Self-declared payload version of the JSON document this build renders. */
export const OBSERVATORY_DOCUMENT_VERSION = 1

/**
 * What a snapshot kept out of its public rows, counted rather than hidden: a
 * row that disappears without a count inflates every rate computed from the
 * rest. A row withheld for both reasons is counted under its district, which is
 * the reason checked first.
 */
export interface ObservatoryWithheld {
  /** Districts the deployment withholds, as configured. */
  readonly districts: readonly string[]
  /** Rows dropped because their district is withheld. */
  readonly districtRows: number
  /** Sessions in those rows, run and errored alike. */
  readonly districtSessions: number
  /** Rows dropped because their environment is held out. */
  readonly heldOutRows: number
  /** Sessions in those rows. */
  readonly heldOutSessions: number
}

/** What a caller hands one fold beside the persisted logs. */
export interface ObservatorySnapshotRequest {
  /**
   * Experiment results the caller holds from its own runs. No session event
   * carries an `ExperimentResult`, so a fold that is handed none publishes no
   * ranking; the snapshot keeps only the results whose two arm routes both
   * appear in its published rows.
   */
  readonly experiments?: readonly ExperimentResult[]
}

/** One fold over every persisted session, before rendering decides what it shows. */
export interface ObservatorySnapshot {
  /** Scoreboard rows that survived withholding, ordered by route, environment, isolation, held-out split, and district. */
  readonly rows: readonly ScoreboardRow[]
  /** What withholding removed from those rows. */
  readonly withheld: ObservatoryWithheld
  /** Experiment results whose two arm routes both appear in {@link rows}; empty publishes no ranking. */
  readonly experiments: readonly ExperimentResult[]
  /** Session headers the fold read. */
  readonly sessions: number
  /** Folded sessions whose log carries no `environment/run` stamp, so no row can name their cell. */
  readonly unstamped: number
  /** Sessions that could not be read or folded. */
  readonly skipped: readonly ScorekeeperSkip[]
  /** Epoch milliseconds at which the fold ran. */
  readonly foldedAt: number
  /** Newest `createdAt` among the session headers the fold read, absent when the store held none. */
  readonly newestSessionAt?: number
  /** Batch refresh interval the page names, milliseconds. */
  readonly refreshIntervalMs: number
}

/**
 * Tamper status of one published row. `not-instrumented` is a row whose
 * sessions recorded no run, so no verdict states whether the check-owned files
 * changed; `tampered` is a row at least one of whose runs found them changed.
 */
export type ObservatoryTamper = 'not-instrumented' | 'tampered' | 'none'

/**
 * One published row: the honest column set, with the publication rules already
 * applied. `resolved` and `parity` are two fields and stay two — neither is
 * ever computed from the other, and no field merges them.
 */
export interface ObservatoryPublishedRow {
  readonly provider: string
  readonly model: string
  readonly environmentId: EnvironmentId
  readonly environmentKind: string
  /** District the row's sessions were stamped with, absent for a row outside every district. */
  readonly district?: string
  readonly heldOut: boolean
  readonly isolation: CertificateIsolation
  /** Who did the work of the row's sessions: `route`, or the subagent provider name of a delegated cell. */
  readonly implementer: string
  /** Executors of the row's certificates; empty for a row that certified nothing. */
  readonly certificateExecutors: readonly RunExecutor[]
  /** Composition digest every session of the row states, absent when the page shows `pending`. */
  readonly compositionSha256?: string
  readonly tamper: ObservatoryTamper
  /** Sessions of the row whose last recorded run carried the `tampered` verdict. */
  readonly tampered: number
  /** Sessions that recorded at least one run. */
  readonly runs: number
  /** Sessions that ended without recording one. */
  readonly errors: number
  /** Sessions holding a certificate. */
  readonly certified: number
  /** `certified / runs`: the certificate rate under its own name, `0` without runs. */
  readonly resolved: number
  /** Mean weighted pass rate over the row's sessions that measured cases, absent when none did. */
  readonly parity?: number
  /** Mean cost of the row's certified sessions, absent unless {@link pricingDigest} names the one table that priced them. */
  readonly costEurPerCertified?: number
  /** The single pricing digest that priced the row, absent when the row carries none or more than one. */
  readonly pricingDigest?: string
}

/** One published ranking: an experiment's frozen plan, its two arms, and its verdict. */
export interface ObservatoryRanking {
  /** Content digest of the frozen plan; both arm groups carry it. */
  readonly digest: string
  /** Model route of the reference arm. */
  readonly baseline: EnvironmentRunModel
  /** Model route of the arm under test. */
  readonly candidate: EnvironmentRunModel
  /** Certificate-rate delta over every paired repetition. */
  readonly delta: number
  readonly verdict: ExperimentVerdict
}

/**
 * The JSON face of one publication. A stale document carries no row and no
 * ranking at all, so a consumer reading it cannot render a number the page
 * refused to show.
 */
export interface ObservatoryDocument {
  readonly version: typeof OBSERVATORY_DOCUMENT_VERSION
  /** Whether the newest folded session is older than the configured staleness threshold. */
  readonly stale: boolean
  /** Epoch milliseconds at which the fold ran. */
  readonly foldedAt: number
  /** Newest `createdAt` among the folded session headers, absent when the store held none. */
  readonly newestSessionAt?: number
  /** Batch refresh interval the page names, milliseconds. */
  readonly refreshIntervalMs: number
  /** Age of the newest folded session past which this document goes stale, milliseconds. */
  readonly staleAfterMs: number
  /** Published rows, empty for a stale document. */
  readonly rows: readonly ObservatoryPublishedRow[]
  /** What withholding removed; stated in both states, because a withheld row is a fact about the fold. */
  readonly withheld: ObservatoryWithheld
  /** Published rankings, empty for a stale document and for a fold carrying no experiment verdict. */
  readonly rankings: readonly ObservatoryRanking[]
}

/** Both faces of one publication, rendered from one snapshot at one instant. */
export interface ObservatoryPage {
  /** Self-contained HTML document; it references no external resource. */
  readonly html: string
  /** The same publication as data. */
  readonly json: ObservatoryDocument
}
