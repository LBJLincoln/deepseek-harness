/**
 * Completion-standard domain: event-sourced executable standards per goal,
 * compare-and-set mutations, evidence-gated relaxation, and certificates
 * recorded only by fully passing runs. The [verification-seams Agent Note]
 * (../../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-verification
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
// Type-only: resolves ctx.goals for the optional admission child.
import type {} from '@deepseek-ai/dsh-goal'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only: resolves ctx.sessionProjections for the optional unit child.
import type {} from '@deepseek-ai/dsh-session-projection'
import {
  applyVerificationEvent,
  decodeCertificateChange,
  decodeDirectiveChange,
  decodeRelaxationChange,
  decodeRunChange,
  decodeStandardChange,
  emptyVerificationFoldState,
  nextRunAttempt,
} from './fold.ts'
import type { VerificationFoldState } from './fold.ts'
import { resolveAuthoredCases } from './cases.ts'
import { isolationProblem } from './isolation.ts'
import { isKebabCase, StandardId, VERIFICATION_CHANGE_VERSION, VerificationError } from './runtime.ts'
import type {
  AuthoredCheck,
  AuthorStandardRequest,
  CertificateIsolation,
  CheckId,
  CheckResult,
  CompletionStandardSnapshot,
  DirectiveCluster,
  DirectiveRequest,
  RunEvidence,
  RunOutcome,
  RunParity,
  RunVerdict,
  StandardCheck,
  StandardRef,
  StandardView,
  VerificationCertificate,
  VerificationProjection,
} from './types.ts'
import type {
  CertificateChangeMeta,
  DirectiveChangeMeta,
  RelaxationChangeMeta,
  StandardChangeMeta,
  VerificationErrorCode,
  VerificationRunChangeMeta,
} from './domain.ts'

export type * from './types.ts'
export type * from './domain.ts'
export { CheckCaseId, CheckId, isKebabCase, StandardId, VERIFICATION_CHANGE_VERSION, VerificationError } from './runtime.ts'
export {
  applyCaseNormalizer,
  caseBodiesSha256,
  caseChannelDigest,
  CHECK_CASE_CHANNELS,
  CHECK_CASE_NORMALIZERS,
  checkCasesRef,
  normalizeCaseBytes,
  resolveAuthoredCases,
} from './cases.ts'
export {
  applyVerificationEvent,
  decodeCertificateChange,
  decodeDirectiveChange,
  decodeRelaxationChange,
  decodeRunChange,
  decodeStandardChange,
  emptyVerificationFoldState,
  foldVerification,
} from './fold.ts'
export type { VerificationFoldState } from './fold.ts'
export { isolationProblem, recordedScope } from './isolation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    completionStandards: CompletionStandardService
  }
}

/** Wire payload of one check, whose case reference travels while the bodies stay in the reservation. */
const checkSchema = zod.object({
  id: zod.string().min(1),
  outcome: zod.string().min(1),
  run: zod.string().min(1),
  cases: zod.object({
    count: zod.number().int().positive(),
    weightTotal: zod.number().int().positive(),
    sha256: zod.string().min(1),
  }).optional(),
  treeScope: zod.string().min(1).optional(),
})

/** Wire payload of one executed check's result, carrying its case tally when the check has cases. */
const resultSchema = zod.object({
  checkId: zod.string().min(1),
  status: zod.union([zod.literal('pass'), zod.literal('fail')]),
  evidence: zod.string().min(1),
  cases: zod.object({
    passed: zod.number().int().nonnegative(),
    total: zod.number().int().positive(),
    weightPassed: zod.number().int().nonnegative(),
    weightTotal: zod.number().int().positive(),
    failed: zod.array(zod.object({
      id: zod.string().min(1),
      weight: zod.number().int().positive(),
      channels: zod.array(zod.union([
        zod.literal('exit'),
        zod.literal('stdout'),
        zod.literal('stderr'),
        zod.literal('tree'),
      ])).min(1),
      exitClass: zod.union([
        zod.literal('zero'),
        zod.literal('nonzero'),
        zod.literal('signal'),
        zod.literal('timeout'),
      ]),
    })),
  }).optional(),
})

/** Wire payload schema of the `verification` projection (whole current standard or pre-authorship null). */
const verificationProjectionSchema: ZodType<VerificationProjection | null> = zod.union([
  zod.object({
    standard: zod.object({
      id: zod.string().min(1),
      revision: zod.number().int().positive(),
      goalId: zod.string().min(1),
      checks: zod.array(checkSchema),
      relaxed: zod.array(zod.object({
        check: checkSchema,
        evidence: zod.string().min(1),
      })),
    }),
    certificate: zod.object({
      standard: zod.object({ id: zod.string().min(1), revision: zod.number().int().positive() }),
      goalId: zod.string().min(1),
      isolation: zod.union([zod.literal('none'), zod.literal('process'), zod.literal('host')]),
      executor: zod.union([zod.literal('runner'), zod.literal('agent-reported')]),
      results: zod.array(resultSchema),
      recordedAt: zod.number(),
    }).optional(),
    directivesIssued: zod.number().int().nonnegative(),
    runsRecorded: zod.number().int().nonnegative(),
    createdAt: zod.number(),
    updatedAt: zod.number(),
  }),
  zod.null(),
]) as ZodType<VerificationProjection | null>

/**
 * Light last-wins fold of the `verification` projection unit. Unlike the
 * strict replay fold (fold.ts: transition validation, fail-loud on malformed
 * changes), this transition is projection-grade: the state is plain JSON, any
 * non-verification or malformed event returns the same reference, and
 * correctness of the written change is the write side's job.
 * @param state - the projection covering all prior events.
 * @param event - the next committed session event.
 * @returns the next projection (same reference when the event is not a well-formed verification change).
 */
export function applyVerificationProjection(
  state: VerificationProjection | null,
  event: SessionEvent,
): VerificationProjection | null {
  try {
    switch (event.type) {
      case 'verification/standard': {
        const change = decodeStandardChange(event.data)
        if (change === undefined) return state
        return {
          standard: change.standard,
          directivesIssued: state?.directivesIssued ?? 0,
          runsRecorded: state?.runsRecorded ?? 0,
          createdAt: change.createdAt,
          updatedAt: change.updatedAt,
        }
      }
      case 'verification/relaxation': {
        const change = decodeRelaxationChange(event.data)
        if (change === undefined) return state
        return {
          standard: change.standard,
          directivesIssued: state?.directivesIssued ?? 0,
          runsRecorded: state?.runsRecorded ?? 0,
          createdAt: change.createdAt,
          updatedAt: change.updatedAt,
        }
      }
      case 'verification/run': {
        const change = decodeRunChange(event.data)
        if (change === undefined || state === null) return state
        return { ...state, runsRecorded: state.runsRecorded + 1 }
      }
      case 'verification/certificate': {
        const change = decodeCertificateChange(event.data)
        if (change === undefined || state === null) return state
        return { ...state, certificate: change.certificate }
      }
      case 'verification/directive': {
        const change = decodeDirectiveChange(event.data)
        if (change === undefined || state === null) return state
        return { ...state, directivesIssued: state.directivesIssued + 1 }
      }
      default:
        return state
    }
  } catch (_invalidPersistedVerificationChange) {
    return state
  }
}

/** Deployment bounds for authored standards and recorded text. */
export interface Config {
  /** Maximum active checks one standard may hold. */
  maxChecks?: number
  /** Maximum cases one standard's active checks may hold in total. */
  maxCases?: number
  /** Maximum characters of one outcome, run, evidence, root-cause, or detail text. */
  maxTextChars?: number
}

/** Resolved deployment bounds. */
export interface ResolvedConfig {
  /** Validated positive safe-integer check cap. */
  maxChecks: number
  /** Validated positive safe-integer case cap. */
  maxCases: number
  /** Validated positive safe-integer text cap. */
  maxTextChars: number
}

/** Process-local incremental fold over one session log. */
interface VerificationCache {
  readonly state: VerificationFoldState
  observedSeq: number
}

/**
 * The run's weighted pass rate, summed over the results that carry cases.
 * @param results - the run's results in check order.
 * @returns the parity, or `undefined` when no result carries cases.
 */
function runParity(results: readonly CheckResult[]): RunParity | undefined {
  const cased = results.flatMap(result => result.cases === undefined ? [] : [result.cases])
  if (cased.length === 0) return undefined
  return {
    weightPassed: cased.reduce((sum, cases) => sum + cases.weightPassed, 0),
    weightTotal: cased.reduce((sum, cases) => sum + cases.weightTotal, 0),
  }
}

/** Validate one caller-visible positive safe-integer bound. */
function resolveBound(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new VerificationError(`${field} must be a positive safe integer`, 'VERIFICATION_INVALID_CHECK')
  }
  return value
}

/** Completion-standard service (`ctx.completionStandards`) backed exclusively by the owning session log. */
export class CompletionStandardService extends Service {
  static inject = ['agents']

  static Config: z<Config> = z.object({
    maxChecks: z.number().default(256),
    maxCases: z.number().default(1024),
    maxTextChars: z.number().default(16384),
  })

  private readonly resolved: ResolvedConfig
  private readonly caches = new WeakMap<Session, VerificationCache>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'completionStandards')
    this.resolved = {
      maxChecks: resolveBound(config.maxChecks ?? 256, 'maxChecks'),
      maxCases: resolveBound(config.maxCases ?? 1024, 'maxCases'),
      maxTextChars: resolveBound(config.maxTextChars ?? 16384, 'maxTextChars'),
    }
    // Certificate admission activates only when a goal service is composed
    // (assemblies without goals keep the service verbs alone).
    ctx.inject(['goals'], (goalsCtx) => {
      goalsCtx.effect(() => goalsCtx.goals.completionGuard((agent, goal) => {
        this.guardCompletion(agent, goal.id)
      }))
    })
    // The `verification` projection unit: last-wins fold of the five
    // verification events (see applyVerificationProjection). The unit child
    // activates only when a projection registry is composed.
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      projectionCtx.sessionProjections.register<'verification', VerificationProjection | null>({
        key: 'verification',
        schema: verificationProjectionSchema,
        init: () => null,
        apply: applyVerificationProjection,
        view: state => state,
        stateVersion: 2,
      })
    })
  }

  /**
   * Read the current standard for one exact live agent.
   * @param agent - owning live agent.
   * @returns a fresh view or `undefined` when no standard is current.
   * @throws {@link VerificationError} when the agent is not the registry's live instance.
   */
  get(agent: Agent): StandardView | undefined {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    return this.view(cache)
  }

  /**
   * Author the executable standard for one goal before implementation begins.
   * A current standard for a different goal is superseded; authoring twice
   * for the same goal is rejected — grow it with {@link extend} instead.
   * @param agent - owning live agent.
   * @param request - goal identity and the initial non-empty check inventory.
   * @returns the authored view at revision one.
   */
  author(agent: Agent, request: AuthorStandardRequest): StandardView {
    const checks = this.resolveChecks(request.checks, new Set())
    if (checks.length === 0) {
      throw new VerificationError('standard requires at least one check', 'VERIFICATION_INVALID_CHECK')
    }
    this.assertCaseBudget(checks)
    const cache = this.prepareMutation(agent)
    const current = cache.state.standard
    if (current !== undefined && current.goalId === request.goalId) {
      throw new VerificationError(
        `standard "${current.id}" already measures goal "${current.goalId}"`,
        'VERIFICATION_STANDARD_EXISTS',
      )
    }
    const now = Date.now()
    const standard: CompletionStandardSnapshot = {
      id: StandardId(`standard-${randomUUID()}`),
      revision: 1,
      goalId: request.goalId,
      checks,
      relaxed: [],
    }
    return this.commitStandard(agent, cache, 'author', standard, now, now)
  }

  /**
   * Add checks to the current standard. Existing checks and relaxations are
   * preserved exactly; the mutation invalidates any prior certificate.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @param checks - one or more checks to append.
   * @returns the extended view.
   */
  extend(agent: Agent, ref: StandardRef, checks: readonly AuthoredCheck[]): StandardView {
    const cache = this.prepareMutation(agent)
    const current = this.expectCurrent(cache, ref)
    const taken = new Set<string>([
      ...current.checks.map(check => check.id),
      ...current.relaxed.map(entry => entry.check.id),
    ])
    const added = this.resolveChecks(checks, taken)
    if (added.length === 0) {
      throw new VerificationError('extend requires at least one added check', 'VERIFICATION_INVALID_CHECK')
    }
    const standard: CompletionStandardSnapshot = {
      ...current,
      revision: current.revision + 1,
      checks: [...current.checks, ...added],
    }
    if (standard.checks.length > this.resolved.maxChecks) {
      throw new VerificationError(
        `standard cannot exceed ${this.resolved.maxChecks} active checks`,
        'VERIFICATION_INVALID_CHECK',
      )
    }
    this.assertCaseBudget(standard.checks)
    return this.commitStandard(agent, cache, 'extend', standard, this.currentCreatedAt(cache), this.nextMutationTime(cache))
  }

  /**
   * Remove one check with recorded evidence that its stricter form is
   * unsatisfiable. The mutation invalidates any prior certificate.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @param checkId - active check to relax.
   * @param evidence - non-empty unsatisfiability evidence.
   * @returns the relaxed view.
   */
  relax(agent: Agent, ref: StandardRef, checkId: CheckId, evidence: string): StandardView {
    const recorded = this.text(evidence, 'evidence', 'VERIFICATION_INVALID_RELAXATION')
    const cache = this.prepareMutation(agent)
    const current = this.expectCurrent(cache, ref)
    const removed = current.checks.find(check => check.id === checkId)
    if (removed === undefined) {
      throw new VerificationError(
        `standard "${current.id}" has no active check "${checkId}"`,
        'VERIFICATION_INVALID_RELAXATION',
      )
    }
    const standard: CompletionStandardSnapshot = {
      ...current,
      revision: current.revision + 1,
      checks: current.checks.filter(check => check.id !== checkId),
      relaxed: [...current.relaxed, { check: removed, evidence: recorded }],
    }
    const change: RelaxationChangeMeta = {
      kind: 'verification/relaxation',
      version: VERIFICATION_CHANGE_VERSION,
      checkId,
      standard,
      createdAt: this.currentCreatedAt(cache),
      updatedAt: this.nextMutationTime(cache),
    }
    this.commit(agent, cache, 'verification/relaxation', change)
    return this.currentView(cache)
  }

  /**
   * Record one complete run of the current standard. Every run appends a
   * durable `verification/run` event carrying all of its results and the
   * verdict they and `evidence.tampered` decide; only a `passed` verdict
   * commits a certificate, while any other returns the failing subset the
   * validator aggregates into a {@link issueDirective} directive.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @param isolation - isolation level the run executed under.
   * @param results - exactly one result per active check, any order.
   * @param evidence - executor of the checks, the workspace digest it covered, and whether the check-owned files were tampered with.
   * @returns the certificate, or the failing results.
   * @throws {@link VerificationError} with `VERIFICATION_ISOLATION_UNPROVEN`
   *   when the session's durable record does not support the claimed isolation.
   */
  recordRun(
    agent: Agent,
    ref: StandardRef,
    isolation: CertificateIsolation,
    results: readonly CheckResult[],
    evidence: RunEvidence,
  ): RunOutcome {
    const cache = this.prepareMutation(agent)
    const current = this.expectCurrent(cache, ref)
    // Before anything is committed: the run event carries the claim too, so an
    // unproven level must not reach the log at all.
    const unproven = isolationProblem(agent.session.events, isolation, evidence.executor)
    if (unproven !== undefined) {
      throw new VerificationError(
        `run cannot claim "${isolation}" isolation: ${unproven}`,
        'VERIFICATION_ISOLATION_UNPROVEN',
      )
    }
    const byCheck = new Map<string, CheckResult>()
    for (const result of results) {
      if (byCheck.has(result.checkId)) {
        throw new VerificationError(`duplicate result for check "${result.checkId}"`, 'VERIFICATION_INVALID_RESULTS')
      }
      byCheck.set(result.checkId, {
        checkId: result.checkId,
        status: result.status,
        evidence: this.text(result.evidence, `result for "${result.checkId}"`, 'VERIFICATION_INVALID_RESULTS'),
        ...result.cases === undefined ? {} : { cases: result.cases },
      })
    }
    const ordered: CheckResult[] = []
    for (const check of current.checks) {
      const result = byCheck.get(check.id)
      if (result === undefined) {
        throw new VerificationError(`run is missing a result for check "${check.id}"`, 'VERIFICATION_INVALID_RESULTS')
      }
      byCheck.delete(check.id)
      ordered.push(this.resolveCaseTally(check, result))
    }
    const extra = [...byCheck.keys()]
    if (extra.length > 0) {
      throw new VerificationError(
        `run answers unknown check(s) ${extra.map(id => `"${id}"`).join(', ')}`,
        'VERIFICATION_INVALID_RESULTS',
      )
    }
    const standard: StandardRef = { id: current.id, revision: current.revision }
    const failures = ordered.filter(result => result.status === 'fail')
    const verdict: RunVerdict = evidence.tampered === true
      ? 'tampered'
      : failures.length > 0 ? 'failed' : 'passed'
    const parity = runParity(ordered)
    const run: VerificationRunChangeMeta = {
      kind: 'verification/run',
      version: VERIFICATION_CHANGE_VERSION,
      standard,
      attempt: nextRunAttempt(cache.state, current.id),
      isolation,
      executor: evidence.executor,
      verdict,
      results: ordered,
      ...parity === undefined ? {} : { parity },
      ...evidence.treeHash === undefined ? {} : { treeHash: evidence.treeHash },
      recordedAt: this.nextMutationTime(cache),
    }
    this.commit(agent, cache, 'verification/run', run)
    // A tampered run measured a workspace the validator no longer owns, so its
    // results certify nothing however they came out.
    if (verdict !== 'passed') return { certified: false, failures }
    const certificate: VerificationCertificate = {
      standard,
      goalId: current.goalId,
      isolation,
      executor: evidence.executor,
      results: ordered,
      recordedAt: this.nextMutationTime(cache),
    }
    const change: CertificateChangeMeta = {
      kind: 'verification/certificate',
      version: VERIFICATION_CHANGE_VERSION,
      certificate,
    }
    this.commit(agent, cache, 'verification/certificate', change)
    return { certified: true, certificate }
  }

  /**
   * Record one root-cause failure aggregation for the implementer. The
   * directive is the durable channel across the read barrier: it names where
   * the candidate is weak without revealing individual checks.
   * @param agent - owning live agent.
   * @param ref - expected current revision.
   * @param request - root cause, actionable detail, and the failure clusters the detail was built from.
   */
  issueDirective(agent: Agent, ref: StandardRef, request: DirectiveRequest): void {
    const rootCause = this.text(request.rootCause, 'rootCause', 'VERIFICATION_INVALID_DIRECTIVE')
    const detail = this.text(request.detail, 'detail', 'VERIFICATION_INVALID_DIRECTIVE')
    const cache = this.prepareMutation(agent)
    const current = this.expectCurrent(cache, ref)
    const clusters = this.resolveClusters(current, request.clusters)
    const change: DirectiveChangeMeta = {
      kind: 'verification/directive',
      version: VERIFICATION_CHANGE_VERSION,
      standard: { id: current.id, revision: current.revision },
      rootCause,
      detail,
      ...clusters === undefined ? {} : { clusters },
      issuedAt: this.nextMutationTime(cache),
    }
    this.commit(agent, cache, 'verification/directive', change)
  }

  /** Check every cluster against the standard's own cased checks before it enters the log. */
  private resolveClusters(
    current: CompletionStandardSnapshot,
    clusters: readonly DirectiveCluster[] | undefined,
  ): DirectiveCluster[] | undefined {
    if (clusters === undefined) return undefined
    if (clusters.length === 0) {
      throw new VerificationError('clusters must be a non-empty list when present', 'VERIFICATION_INVALID_DIRECTIVE')
    }
    return clusters.map((cluster) => {
      const check = current.checks.find(candidate => candidate.id === cluster.checkId)
      if (check?.cases === undefined) {
        throw new VerificationError(
          `cluster names unknown or caseless check "${cluster.checkId}"`,
          'VERIFICATION_INVALID_DIRECTIVE',
        )
      }
      if (cluster.count > check.cases.count || cluster.weight > check.cases.weightTotal) {
        throw new VerificationError(
          `cluster of check "${cluster.checkId}" exceeds its cases reference`,
          'VERIFICATION_INVALID_DIRECTIVE',
        )
      }
      return { checkId: cluster.checkId, channels: [...cluster.channels], count: cluster.count, weight: cluster.weight }
    })
  }

  /**
   * Read the certificate covering exactly the current standard revision.
   * @param agent - owning live agent.
   * @returns the valid certificate, or `undefined` when none covers the current revision.
   */
  certified(agent: Agent): VerificationCertificate | undefined {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    return cache.state.certificate
  }

  /**
   * Require a valid certificate for one goal before admitting its completion.
   * The orchestrator policy calls this immediately before `ctx.goals.complete()`.
   * @param agent - owning live agent.
   * @param goalId - goal whose completion is being admitted.
   * @returns the covering certificate.
   * @throws {@link VerificationError} without a current standard for the goal or a covering certificate.
   */
  assertCertified(agent: Agent, goalId: GoalId): VerificationCertificate {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    const current = cache.state.standard
    if (current === undefined || current.goalId !== goalId) {
      throw new VerificationError(`no completion standard measures goal "${goalId}"`, 'VERIFICATION_STANDARD_NOT_FOUND')
    }
    const certificate = cache.state.certificate
    if (certificate === undefined) {
      throw new VerificationError(
        `standard "${current.id}" revision ${current.revision} has no covering certificate`,
        'VERIFICATION_NOT_CERTIFIED',
      )
    }
    return certificate
  }

  /**
   * Completion admission for one goal: pass when no current standard
   * measures it, reject when the measured goal lacks a covering certificate.
   * The goal service asserts agent liveness before its guards run.
   */
  private guardCompletion(agent: Agent, goalId: GoalId): void {
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    const current = cache.state.standard
    if (current === undefined || current.goalId !== goalId) return
    if (cache.state.certificate === undefined) {
      throw new VerificationError(
        `goal "${goalId}" cannot complete: standard "${current.id}" revision ${current.revision} has no covering certificate`,
        'VERIFICATION_NOT_CERTIFIED',
      )
    }
  }

  /**
   * Check one result's case tally against the check's own case reference and
   * derive the verdict from it: a cased check passes only when every one of its
   * cases passed, whatever status the caller reported. A caseless result of a
   * cased check keeps its reported status, which is how a tampered attempt
   * records checks it never executed.
   */
  private resolveCaseTally(check: StandardCheck, result: CheckResult): CheckResult {
    const cases = result.cases
    if (cases === undefined) return result
    const reject = (reason: string): never => {
      throw new VerificationError(`result for check "${check.id}" ${reason}`, 'VERIFICATION_INVALID_RESULTS')
    }
    const reference = check.cases
    if (reference === undefined) {
      return reject('reports cases for a check that references none')
    }
    if (cases.total !== reference.count || cases.weightTotal !== reference.weightTotal) {
      reject(`reports ${cases.total} cases of weight ${cases.weightTotal} against a reference of ${reference.count} of weight ${reference.weightTotal}`)
    }
    if (!Number.isSafeInteger(cases.passed) || cases.passed < 0 || cases.passed > cases.total) {
      reject(`reports ${cases.passed} of ${cases.total} cases passing`)
    }
    if (!Number.isSafeInteger(cases.weightPassed) || cases.weightPassed < 0 || cases.weightPassed > cases.weightTotal) {
      reject(`reports passing weight ${cases.weightPassed} of ${cases.weightTotal}`)
    }
    if (cases.failed.length > cases.total - cases.passed) {
      reject(`lists ${cases.failed.length} failed cases while ${cases.total - cases.passed} failed`)
    }
    return { ...result, status: cases.passed === cases.total ? 'pass' : 'fail' }
  }

  /** Validate, trim, and cap one recorded text. */
  private text(value: string, field: string, code: VerificationErrorCode): string {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      throw new VerificationError(`${field} must be a non-empty string`, code)
    }
    if (trimmed.length > this.resolved.maxTextChars) {
      throw new VerificationError(`${field} exceeds ${this.resolved.maxTextChars} characters`, code)
    }
    return trimmed
  }

  /**
   * Validate one added check inventory against ids already taken, and each
   * cased check's bodies against the reference it hands in. The stored check
   * keeps the reference alone: the bodies live in the validator's reservation,
   * never in the log.
   */
  private resolveChecks(checks: readonly AuthoredCheck[], taken: Set<string>): StandardCheck[] {
    if (checks.length > this.resolved.maxChecks) {
      throw new VerificationError(
        `standard cannot exceed ${this.resolved.maxChecks} active checks`,
        'VERIFICATION_INVALID_CHECK',
      )
    }
    const resolved: StandardCheck[] = []
    const seen = new Set<string>(taken)
    for (const check of checks) {
      if (!isKebabCase(check.id)) {
        throw new VerificationError(`check id "${check.id}" must be lower-kebab-case`, 'VERIFICATION_INVALID_CHECK')
      }
      if (seen.has(check.id)) {
        throw new VerificationError(`check id "${check.id}" is already taken`, 'VERIFICATION_INVALID_CHECK')
      }
      seen.add(check.id)
      resolveAuthoredCases(check)
      resolved.push({
        id: check.id,
        outcome: this.text(check.outcome, `check "${check.id}" outcome`, 'VERIFICATION_INVALID_CHECK'),
        run: this.text(check.run, `check "${check.id}" run`, 'VERIFICATION_INVALID_CHECK'),
        ...check.cases === undefined ? {} : { cases: { ...check.cases } },
        ...check.treeScope === undefined ? {} : { treeScope: check.treeScope },
      })
    }
    return resolved
  }

  /** Reject a standard whose active checks hold more cases than the deployment allows. */
  private assertCaseBudget(checks: readonly StandardCheck[]): void {
    const cases = checks.reduce((sum, check) => sum + (check.cases?.count ?? 0), 0)
    if (cases > this.resolved.maxCases) {
      throw new VerificationError(
        `standard cannot exceed ${this.resolved.maxCases} cases`,
        'VERIFICATION_INVALID_CASE',
      )
    }
  }

  /** Resolve and validate the cache used by a mutation. */
  private prepareMutation(agent: Agent): VerificationCache {
    this.assertLive(agent)
    const cache = this.cache(agent.session)
    this.sync(agent.session, cache)
    return cache
  }

  /** Reject stale or missing current-state refs. */
  private expectCurrent(cache: VerificationCache, ref: StandardRef): CompletionStandardSnapshot {
    const current = cache.state.standard
    if (current === undefined) {
      throw new VerificationError('no current completion standard', 'VERIFICATION_STANDARD_NOT_FOUND')
    }
    if (ref.id !== current.id || ref.revision !== current.revision) {
      throw new VerificationError(
        `stale standard ref "${ref.id}" revision ${ref.revision}; current is "${current.id}" revision ${current.revision}`,
        'VERIFICATION_STALE_REVISION',
      )
    }
    return current
  }

  /** Enforce exact live-agent identity rather than trusting a matching id. */
  private assertLive(agent: Agent): void {
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new VerificationError(`agent "${agent.id}" is not live in this registry`, 'VERIFICATION_AGENT_NOT_LIVE')
    }
  }

  /** Return the per-session cache, folding a seed once. */
  private cache(session: Session): VerificationCache {
    let cache = this.caches.get(session)
    if (cache !== undefined) return cache
    const state = emptyVerificationFoldState()
    for (const event of session.events) applyVerificationEvent(state, event)
    cache = { state, observedSeq: session.seq }
    this.caches.set(session, cache)
    return cache
  }

  /** Incrementally observe durable events. */
  private sync(session: Session, cache: VerificationCache): void {
    for (const event of session.events.slice(cache.observedSeq)) {
      applyVerificationEvent(cache.state, event)
      cache.observedSeq += 1
    }
  }

  /** Creation time of the current standard. */
  private currentCreatedAt(cache: VerificationCache): number {
    const createdAt = cache.state.createdAt
    /* v8 ignore next -- strict replay and every standard commit set createdAt whenever a current standard exists */
    if (createdAt === undefined) throw new Error('current standard cache lacks createdAt')
    return createdAt
  }

  /** Clamp the next timestamp across backward wall-clock movement. */
  private nextMutationTime(cache: VerificationCache): number {
    const updatedAt = cache.state.updatedAt
    /* v8 ignore next -- strict replay and every standard commit set updatedAt whenever a current standard exists */
    if (updatedAt === undefined) throw new Error('current standard cache lacks updatedAt')
    return Math.max(Date.now(), updatedAt)
  }

  /** Build and commit one standard snapshot mutation. */
  private commitStandard(
    agent: Agent,
    cache: VerificationCache,
    operation: StandardChangeMeta['operation'],
    standard: CompletionStandardSnapshot,
    createdAt: number,
    updatedAt: number,
  ): StandardView {
    const change: StandardChangeMeta = {
      kind: 'verification/standard',
      version: VERIFICATION_CHANGE_VERSION,
      operation,
      standard,
      createdAt,
      updatedAt,
    }
    this.commit(agent, cache, 'verification/standard', change)
    return this.currentView(cache)
  }

  /** Commit one mutation into the session log and the cache. */
  private commit(
    agent: Agent,
    cache: VerificationCache,
    type: 'verification/standard' | 'verification/relaxation' | 'verification/run' | 'verification/certificate'
      | 'verification/directive',
    change: StandardChangeMeta | RelaxationChangeMeta | VerificationRunChangeMeta | CertificateChangeMeta
      | DirectiveChangeMeta,
  ): void {
    agent.session.append(type, change)
    this.sync(agent.session, cache)
  }

  /** Build a detached current view, requiring a current standard. */
  private currentView(cache: VerificationCache): StandardView {
    const view = this.view(cache)
    /* v8 ignore next -- every commit path installs the standard before this read */
    if (view === undefined) throw new Error('standard commit cleared the standard unexpectedly')
    return view
  }

  /** Build a detached current view. */
  private view(cache: VerificationCache): StandardView | undefined {
    const standard = cache.state.standard
    const createdAt = cache.state.createdAt
    const updatedAt = cache.state.updatedAt
    if (standard === undefined) return undefined
    /* v8 ignore next 3 -- strict replay and standard commits establish both timestamps with every current standard */
    if (createdAt === undefined || updatedAt === undefined) {
      throw new Error(`standard "${standard.id}" cache lacks timestamps`)
    }
    return {
      ...standard,
      createdAt,
      updatedAt,
      ...cache.state.certificate === undefined ? {} : { certificate: cache.state.certificate },
      directivesIssued: cache.state.directivesIssued,
      runsRecorded: cache.state.runsRecorded,
    }
  }
}

export default CompletionStandardService
