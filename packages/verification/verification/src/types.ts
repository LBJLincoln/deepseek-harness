/**
 * Pure types of the completion-standard domain: identities, checks, standard
 * snapshots, run results, and certificates, free of this package's host-side
 * imports. Host-coupled vocabulary (durable change payloads, fold shapes,
 * error codes) lives in ./domain.ts.
 *
 * @module @deepseek-ai/dsh-verification/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'

/** Identifies one completion standard across its durable revisions. */
export type StandardId = Branded<'StandardId'>

/** Identifies one check inside its owning standard. */
export type CheckId = Branded<'CheckId'>

/** Identifies one case inside its owning check. */
export type CheckCaseId = Branded<'CheckCaseId'>

/** Compare-and-set identity for one exact standard revision. */
export interface StandardRef {
  /** Stable standard identity. */
  readonly id: StandardId
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
}

/**
 * Channel one case compares. `exit` is the candidate's exit code, `stdout` and
 * `stderr` its captured bytes, and `tree` the work tree under the check's
 * `treeScope` as the case left it.
 */
export type CheckCaseChannel = 'exit' | 'stdout' | 'stderr' | 'tree'

/**
 * Pure byte function applied to a compared channel before it is digested, in
 * the comparator's order. The set is closed: every normalizer widens what
 * counts as equal, so a new one is a design decision rather than a
 * deployment choice.
 *
 * - `crlf` rewrites every `\r\n` to `\n`.
 * - `trailing-whitespace` drops spaces and tabs at the end of each line.
 * - `blank-lines` drops leading and trailing blank lines and collapses each
 *   interior run of them to one.
 * - `iso8601-timestamps` replaces each ISO-8601 timestamp with `<timestamp>`.
 * - `temp-paths` replaces each temporary-directory prefix with `<temp>`.
 * - `json-canonical` reserializes valid JSON with sorted keys and no
 *   insignificant whitespace, and leaves anything else unchanged.
 */
export type CheckCaseNormalizer =
  | 'crlf'
  | 'trailing-whitespace'
  | 'blank-lines'
  | 'iso8601-timestamps'
  | 'temp-paths'
  | 'json-canonical'

/** What one case feeds the candidate. */
export interface CheckCaseInput {
  /**
   * Command words appended to the check's run instruction. Each word must need
   * no shell quoting, because the composed shell's dialect is not known here.
   */
  readonly argv: readonly string[]
  /** Bytes written to the candidate's stdin, which is then closed; absent leaves stdin empty. */
  readonly stdin?: string
  /** UTF-8 files staged into the workspace before the case runs, keyed by normalized workspace-relative path. */
  readonly files?: Readonly<Record<string, string>>
}

/** Digests one case compares its configured channels against. */
export interface CheckCaseExpectation {
  /** Exit code the candidate must report, for a case comparing `exit`. */
  readonly exitCode?: number
  /** SHA-256 hex of the normalized stdout bytes, for a case comparing `stdout`. */
  readonly stdoutSha256?: string
  /** SHA-256 hex of the normalized stderr bytes, for a case comparing `stderr`. */
  readonly stderrSha256?: string
  /** SHA-256 hex of the normalized work tree under `treeScope`, for a case comparing `tree`. */
  readonly treeSha256?: string
}

/** How one case decides that a channel agrees. */
export interface CheckCaseComparator {
  /** Non-empty channel set, without repeats; the case passes only when every one of them matches. */
  readonly channels: readonly CheckCaseChannel[]
  /** Normalizers applied to each compared byte channel, in this order. */
  readonly normalizers: readonly CheckCaseNormalizer[]
}

/** One behavioural sample of a check: what the candidate is fed and what it must produce. */
export interface CheckCase {
  /** Lower-kebab-case identity unique inside the owning check. */
  readonly id: CheckCaseId
  /** Positive safe-integer share of the check's weight this case carries. */
  readonly weight: number
  /** What the case feeds the candidate. */
  readonly input: CheckCaseInput
  /** Digests the case's configured channels are compared against. */
  readonly expected: CheckCaseExpectation
  /** Channels compared and the normalizers applied before comparison. */
  readonly comparator: CheckCaseComparator
}

/**
 * The durable reference to one check's case bodies. The bodies live in the
 * validator's reservation, never in the session log; `sha256` binds the two.
 */
export interface CheckCasesRef {
  /** Number of cases the bodies hold. */
  readonly count: number
  /** Sum of every case weight. */
  readonly weightTotal: number
  /** SHA-256 hex of the canonical case bodies. */
  readonly sha256: string
}

/** One executable check: the outcome it establishes and how a validator runs it. */
export interface StandardCheck {
  /** Lower-kebab-case identity unique inside the owning standard. */
  readonly id: CheckId
  /** Outcome the task must establish, stated without the implementation. */
  readonly outcome: string
  /** Validator-owned execution instruction (command line or procedure). */
  readonly run: string
  /** Reference to the check's case bodies; absent for a check whose verdict is its own exit code. */
  readonly cases?: CheckCasesRef
  /**
   * Normalized workspace-relative directory the `tree` channel digests, which
   * the runner empties before each case that compares it. Present exactly when
   * a case compares `tree`.
   */
  readonly treeScope?: string
}

/**
 * One check as its author hands it in. The case bodies travel with the check
 * only to authorship, which validates them against {@link StandardCheck.cases}
 * and stores the reference alone: the log carries no case body.
 */
export interface AuthoredCheck extends StandardCheck {
  /** Complete case bodies; required exactly when `cases` is present. */
  readonly caseBodies?: readonly CheckCase[]
}

/** A check removed from the active set together with its unsatisfiability evidence. */
export interface RelaxedCheck {
  /** The exact check that was removed. */
  readonly check: StandardCheck
  /** Recorded evidence that the stricter form is unsatisfiable. */
  readonly evidence: string
}

/** Full durable state written by every standard mutation. */
export interface CompletionStandardSnapshot extends StandardRef {
  /** Goal whose completion this standard measures. */
  readonly goalId: GoalId
  /** Active checks a certificate must cover, in authored order. */
  readonly checks: readonly StandardCheck[]
  /** Relaxations applied so far, in application order. */
  readonly relaxed: readonly RelaxedCheck[]
}

/** Verdict of one executed check. */
export type CheckStatus = 'pass' | 'fail'

/**
 * How the candidate ended one case, as the directive clusters it: `zero` and
 * `nonzero` are ordinary exits, `signal` a termination, `timeout` an overrun of
 * the case timeout.
 */
export type CaseExitClass = 'zero' | 'nonzero' | 'signal' | 'timeout'

/** One failed case as the run records it. */
export interface FailedCheckCase {
  /** The case that failed. */
  readonly id: CheckCaseId
  /** Weight the case carried. */
  readonly weight: number
  /** Channels whose digests disagreed, in the canonical `exit`, `stdout`, `stderr`, `tree` order. */
  readonly channels: readonly CheckCaseChannel[]
  /** How the candidate ended this case. */
  readonly exitClass: CaseExitClass
}

/** Case tally of one executed check, present exactly for a check that carries cases. */
export interface CheckCaseResults {
  /** Cases whose every configured channel matched. */
  readonly passed: number
  /** Cases executed; equal to the check's `cases.count`. */
  readonly total: number
  /** Summed weight of the passing cases. */
  readonly weightPassed: number
  /** Summed weight of every case; equal to the check's `cases.weightTotal`. */
  readonly weightTotal: number
  /** Failed cases, bounded by the executing runner; never longer than `total - passed`. */
  readonly failed: readonly FailedCheckCase[]
}

/** Result of running one check against the workspace. */
export interface CheckResult {
  /** Check this result answers. */
  readonly checkId: CheckId
  /** Verdict of the run; a cased result passes only when every case passed. */
  readonly status: CheckStatus
  /** Non-empty run evidence (command output summary, comparison, or location). */
  readonly evidence: string
  /** Case tally, present only for a check the run measured case by case. */
  readonly cases?: CheckCaseResults
}

/** Weighted pass rate of one run, summed over the checks that carry cases. */
export interface RunParity {
  /** Summed weight of every passing case of the run. */
  readonly weightPassed: number
  /** Summed weight of every case of the run. */
  readonly weightTotal: number
}

/**
 * Isolation the standard and its fixtures had from the implementer while the
 * certified run executed. Every level above `none` is refused unless the
 * session's own log carries the enforcement it asserts:
 *
 * - `none` asserts nothing; implementer and validator share a filesystem.
 * - `process` asserts that no executor of the implementer's session opened a
 *   denied path: a `read-barrier/scope` census recorded before the session's
 *   first request, with role `implementer`, no composed capability left
 *   `unenforced`, and no visible tool carrying an authority.
 * - `host` asserts everything `process` does plus a `read-barrier/attestation`
 *   the barrier verified from a file this account cannot write.
 */
export type CertificateIsolation = 'none' | 'process' | 'host'

/** Durable record of one fully passing run of the current standard. */
export interface VerificationCertificate {
  /** Exact standard revision the run covered. */
  readonly standard: StandardRef
  /** Goal the certified standard measures. */
  readonly goalId: GoalId
  /** Isolation level the certified run executed under. */
  readonly isolation: CertificateIsolation
  /**
   * Executor of the certified run, copied from the `verification/run` this
   * certificate cites. An `agent-reported` run is the implementer's own account
   * of its checks, so it may certify only at `isolation: 'none'`.
   */
  readonly executor: RunExecutor
  /** One passing result per active check, in the standard's check order. */
  readonly results: readonly CheckResult[]
  /** Epoch milliseconds of the certificate commit. */
  readonly recordedAt: number
}

/** Executor of one recorded run's checks. */
export type RunExecutor = 'runner' | 'agent-reported'

/**
 * What one recorded run means. `passed` and `failed` follow from the results;
 * `tampered` says the check-owned files changed under the validator, so the
 * results measure a workspace that no longer describes the task. Only a
 * `passed` run may certify.
 */
export type RunVerdict = 'passed' | 'failed' | 'tampered'

/** How one recorded run was produced, beside its results. */
export interface RunEvidence {
  /** Executor of the checks: an automated validator, or the agent's own report. */
  readonly executor: RunExecutor
  /** Hex digest of the workspace tree the run covered, absent when the caller has none. */
  readonly treeHash?: string
  /**
   * Whether the check-owned files changed between the validator writing them
   * and this run reading them. Only the caller that digested them knows it, so
   * it is stated here; every other verdict follows from the results.
   */
  readonly tampered?: boolean
}

/**
 * One failure cluster of a directive: the failed cases of one check that
 * disagreed on the same channels and ended the same way. It carries counts and
 * weights only, never a case body, an expected digest, or captured output.
 */
export interface DirectiveCluster {
  /** Check whose cases the cluster groups. */
  readonly checkId: CheckId
  /** Channels that disagreed, in the canonical `exit`, `stdout`, `stderr`, `tree` order. */
  readonly channels: readonly CheckCaseChannel[]
  /** Cases in the cluster. */
  readonly count: number
  /** Summed weight of the cluster's cases. */
  readonly weight: number
}

/** Root-cause failure aggregation a validator hands the orchestrator. */
export interface DirectiveRequest {
  /** Failure cluster's root cause, stated for the implementer. */
  readonly rootCause: string
  /** Actionable detail that does not reveal individual check contents. */
  readonly detail: string
  /** Clusters the detail was built from, for the observatory; absent when no cased check failed. */
  readonly clusters?: readonly DirectiveCluster[]
}

/** Outcome of recording one run: a certificate, or the failing subset. */
export type RunOutcome =
  | { readonly certified: true; readonly certificate: VerificationCertificate }
  | { readonly certified: false; readonly failures: readonly CheckResult[] }

/** Current standard projection, including values derived from the session log. */
export interface StandardView extends CompletionStandardSnapshot {
  /** Epoch milliseconds of the author mutation. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest mutation. */
  readonly updatedAt: number
  /** Certificate covering exactly this revision, absent until a fully passing run. */
  readonly certificate?: VerificationCertificate
  /** Count of directives issued against this standard's goal so far. */
  readonly directivesIssued: number
  /** Count of runs recorded across the session, passing or failing. */
  readonly runsRecorded: number
}

/** Fields required to author a standard for one goal. */
export interface AuthorStandardRequest {
  /** Goal whose completion the standard will measure. */
  readonly goalId: GoalId
  /** Initial non-empty check inventory, each cased check carrying its bodies. */
  readonly checks: readonly AuthoredCheck[]
}

/**
 * The `verification` projection value: the current standard exactly as the
 * latest verification events carried it, with its covering certificate and
 * the session's cumulative directive and run counts.
 */
export interface VerificationProjection {
  /** Current standard snapshot. */
  readonly standard: CompletionStandardSnapshot
  /** Certificate covering exactly the current revision, absent otherwise. */
  readonly certificate?: VerificationCertificate
  /** Count of directives issued across the session. */
  readonly directivesIssued: number
  /** Count of runs recorded across the session, passing or failing. */
  readonly runsRecorded: number
  /** Epoch milliseconds of the author mutation. */
  readonly createdAt: number
  /** Epoch milliseconds of the latest standard mutation. */
  readonly updatedAt: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * The session's current completion standard (last-wins over the five
     * verification events), or `null` before the first authorship.
     */
    verification: VerificationProjection | null
  }
}
