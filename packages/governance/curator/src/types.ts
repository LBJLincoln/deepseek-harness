/**
 * Pure types of the curated export: the redaction rule a deployment configures,
 * the `curation` block every exported record carries, the export manifest left
 * beside the lines, and the request and report of one curated export.
 *
 * @module @deepseek-ai/dsh-curator/types
 */

import type { DataUsePurpose } from '@deepseek-ai/dsh-data-use'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  Trajectory,
  TrajectoryExportSkip,
  TrajectoryFormat,
  TrajectorySink,
} from '@deepseek-ai/dsh-trajectories/types'

/** One configured redaction rule, as `cordis.yml` states it. */
export interface RedactionRule {
  /** Non-empty identity, unique inside its profile; the key hit counts are reported under. */
  id: string
  /** JavaScript regular expression source, compiled at load. */
  pattern: string
  /** Regular expression flags; the global flag is added whether or not it is listed, and the sticky flag is refused. */
  flags?: string
  /** Literal text every match becomes; `$`-sequences are written verbatim, never expanded. */
  replacement: string
}

/** One configured profile: the rules an export applies, in the order they run. */
export interface RedactionProfileConfig {
  /** Whether the rule set this package ships runs ahead of `rules`. */
  shipped: boolean
  /** Deployment-owned rules, applied after the shipped ones. */
  rules?: RedactionRule[]
}

/** What the curator recorded about one exported record. */
export interface TrajectoryRedaction {
  /** Profile id the export ran under. */
  readonly profile: string
  /** Lowercase SHA-256 hex over the profile's effective rules in order. */
  readonly profileSha256: string
  /** Replacements this record received, per rule id; a rule that matched nothing is absent. */
  readonly hits: Readonly<Record<string, number>>
}

/** The block the curator adds to every record it exports. */
export interface TrajectoryCuration {
  /** Always `true`: a record without a `curation` block was written by the unredacted exporter. */
  readonly redactionApplied: true
  /** The profile that ran and what it replaced in this record. */
  readonly redaction: TrajectoryRedaction
  /** Region the session's pinned terms name, so a sink can partition by it without reading the logs again. */
  readonly residency: string
}

/** One exported line: the trajectory record plus the curator's own block. */
export type CuratedTrajectory = Trajectory & {
  readonly curation: TrajectoryCuration
}

/** Sessions one export did not write, by the reason each was withheld. */
export interface ExportWithheld {
  /** Withheld because their environment is held out. */
  readonly heldOut: number
  /** Withheld because their stamp's district is not one this export writes. */
  readonly districts: number
  /** Withheld because their pinned terms do not admit the export's purpose, or because they carry none. */
  readonly terms: number
}

/** The durable record of one curated export, written beside its lines. */
export interface ExportManifest {
  /** Manifest format tag. */
  readonly version: string
  /** Epoch milliseconds the export finished at. */
  readonly exportedAt: number
  /** Purpose the export serves, which every written session's terms admit. */
  readonly purpose: DataUsePurpose
  /** Profile id the export ran under. */
  readonly profile: string
  /** Lowercase SHA-256 hex over that profile's effective rules in order. */
  readonly profileSha256: string
  /** Lines written. */
  readonly records: number
  /** Sessions withheld, by reason. */
  readonly withheld: ExportWithheld
  /** Replacements over the whole export, per rule id; every rule of the profile is listed, including those that matched nothing. */
  readonly ruleHits: Readonly<Record<string, number>>
  /** Lowercase SHA-256 hex over the written lines in order, which is the digest of the sink's bytes. */
  readonly recordsSha256: string
  /** Record format of every written line. */
  readonly trajectoryFormat: TrajectoryFormat
}

/** What to export, under which terms, and where. */
export interface CuratedExportRequest {
  /** Purpose the export serves; a session whose terms do not list it is withheld. */
  readonly purpose: DataUsePurpose
  /** Profile to apply; absent uses the configured `defaultProfile`, and an export with neither is refused. */
  readonly profile?: string
  /** Sessions to consider; absent considers every persisted session. */
  readonly sessions?: readonly SessionId[]
  /** Destination of the curated lines; closed exactly once by the wrapped exporter. */
  readonly sink: TrajectorySink
  /** Where the manifest is written; absent returns it in the report only. */
  readonly manifestPath?: string
  /** Write only trajectories whose reward outcome is `1`. */
  readonly rewardedOnly?: boolean
  /** Also write sessions whose environment is held out. */
  readonly includeHeldOut?: boolean
  /** Districts to export; absent applies the exporter's configured `withheldDistricts`. */
  readonly districts?: readonly string[]
}

/** Counts of one curated export, beside the manifest it wrote. */
export interface CuratedExportReport {
  /** The manifest, whether or not `manifestPath` asked for it on disk. */
  readonly manifest: ExportManifest
  /** Sessions the request named or the store listed. */
  readonly sessions: number
  /** Lines written. */
  readonly exported: number
  /** Written lines whose reward outcome is `1`. */
  readonly rewarded: number
  /** Admitted sessions withheld by `rewardedOnly`. */
  readonly filtered: number
  /** Admitted sessions withheld because their environment is held out. */
  readonly heldOut: number
  /** Admitted sessions withheld because their stamp's district is not one this export writes. */
  readonly withheldByDistrict: number
  /** Sessions withheld because their pinned terms do not admit the purpose, or because they carry none. */
  readonly withheldByTerms: number
  /** Sessions that could not be read, either while reading their terms or while folding them. */
  readonly skipped: readonly TrajectoryExportSkip[]
}
