/** Pure replay fold and strict decoders for durable completion-standard changes. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { GoalId } from '@deepseek-ai/dsh-goal'
import { CheckId, isKebabCase, StandardId, VERIFICATION_CHANGE_VERSION } from './runtime.ts'
import type {
  CertificateIsolation,
  CheckResult,
  CheckStatus,
  CompletionStandardSnapshot,
  RelaxedCheck,
  RunExecutor,
  RunVerdict,
  StandardCheck,
  StandardRef,
  VerificationCertificate,
} from './types.ts'
import type {
  CertificateChangeMeta,
  DirectiveChangeMeta,
  FoldedVerification,
  RelaxationChangeMeta,
  StandardChangeMeta,
  StandardOperation,
  VerificationRunChangeMeta,
} from './domain.ts'

const OPERATIONS: ReadonlySet<StandardOperation> = new Set(['author', 'extend'])
const ISOLATIONS: ReadonlySet<CertificateIsolation> = new Set(['none', 'process', 'host'])
const EXECUTORS: ReadonlySet<RunExecutor> = new Set(['runner', 'agent-reported'])
const VERDICTS: ReadonlySet<RunVerdict> = new Set(['passed', 'failed', 'tampered'])
const CERTIFIED_STATUSES: ReadonlySet<CheckStatus> = new Set(['pass'])
const RUN_STATUSES: ReadonlySet<CheckStatus> = new Set(['pass', 'fail'])
const RUN_KEYS = ['attempt', 'executor', 'isolation', 'kind', 'recordedAt', 'results', 'standard', 'version']
const HEX_DIGEST = /^[0-9a-f]+$/

/** Mutable accumulator kept private to the pure fold. */
export interface VerificationFoldState {
  standard: CompletionStandardSnapshot | undefined
  certificate: VerificationCertificate | undefined
  directivesIssued: number
  runsRecorded: number
  lastRun: VerificationRunChangeMeta | undefined
  createdAt: number | undefined
  updatedAt: number | undefined
  lastRef: StandardRef | undefined
  seenStandardIds: Set<CompletionStandardSnapshot['id']>
}

/**
 * Attempt number the next run of one standard must carry. Authorship never
 * reuses a standard id, so the runs of one standard are contiguous in the log
 * and the last one carries their count.
 * @param state - fold accumulator covering every prior event.
 * @param id - standard the next run covers.
 * @returns one plus the runs already recorded for that standard id.
 */
export function nextRunAttempt(state: VerificationFoldState, id: CompletionStandardSnapshot['id']): number {
  const last = state.lastRun
  return (last !== undefined && last.standard.id === id ? last.attempt : 0) + 1
}

/**
 * Build an empty replay accumulator.
 * @returns mutable state with no current standard or prior ref.
 */
export function emptyVerificationFoldState(): VerificationFoldState {
  return {
    standard: undefined,
    certificate: undefined,
    directivesIssued: 0,
    runsRecorded: 0,
    lastRun: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    lastRef: undefined,
    seenStandardIds: new Set(),
  }
}

// Strict per-domain decoders keep their own guards (the goal fold is the template).
/* jscpd:ignore-start */
/** Whether a value is a JSON record rather than an array. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one positive safe integer. */
function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`verification change ${field} must be a positive safe integer`)
  }
  return value
}

/** Require one non-negative safe integer. */
function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`verification change ${field} must be a non-negative safe integer`)
  }
  return value
}
/* jscpd:ignore-end */

/** Require one lowercase hex digest. */
function hexDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HEX_DIGEST.test(value)) {
    throw new Error(`verification change ${field} must be a lowercase hex digest`)
  }
  return value
}

/** Require one non-empty trim-normalized string. */
function normalizedText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`verification change ${field} must be non-empty and normalized`)
  }
  return value
}

/** Require an exact sorted key set. */
function requireKeys(value: Record<string, unknown>, expected: readonly string[], subject: string): void {
  const keys = Object.keys(value).sort().join(',')
  const wanted = [...expected].sort().join(',')
  if (keys !== wanted) {
    throw new Error(`verification change ${subject} must have exactly ${wanted} fields`)
  }
}

/** Decode and validate one check. */
function decodeCheck(value: unknown, subject: string): StandardCheck {
  if (!isRecord(value)) throw new Error(`verification change ${subject} must be a record`)
  requireKeys(value, ['id', 'outcome', 'run'], subject)
  const rawId = value['id']
  if (typeof rawId !== 'string' || !isKebabCase(rawId)) {
    throw new Error(`verification change ${subject}.id must be lower-kebab-case`)
  }
  return {
    id: CheckId(rawId),
    outcome: normalizedText(value['outcome'], `${subject}.outcome`),
    run: normalizedText(value['run'], `${subject}.run`),
  }
}

/** Decode and validate one relaxed entry. */
function decodeRelaxed(value: unknown, subject: string): RelaxedCheck {
  if (!isRecord(value)) throw new Error(`verification change ${subject} must be a record`)
  requireKeys(value, ['check', 'evidence'], subject)
  return {
    check: decodeCheck(value['check'], `${subject}.check`),
    evidence: normalizedText(value['evidence'], `${subject}.evidence`),
  }
}

/** Decode and validate one full standard snapshot. */
function decodeSnapshot(value: unknown): CompletionStandardSnapshot {
  if (!isRecord(value)) throw new Error('verification change standard must be a record')
  requireKeys(value, ['checks', 'goalId', 'id', 'relaxed', 'revision'], 'standard')
  if (typeof value['id'] !== 'string' || value['id'].length === 0) {
    throw new Error('verification change standard.id must be a non-empty string')
  }
  if (typeof value['goalId'] !== 'string' || value['goalId'].length === 0) {
    throw new Error('verification change standard.goalId must be a non-empty string')
  }
  if (!Array.isArray(value['checks'])) throw new Error('verification change standard.checks must be an array')
  if (!Array.isArray(value['relaxed'])) throw new Error('verification change standard.relaxed must be an array')
  const checks = value['checks'].map((check, index) => decodeCheck(check, `standard.checks[${index}]`))
  const relaxed = value['relaxed'].map((entry, index) => decodeRelaxed(entry, `standard.relaxed[${index}]`))
  const ids = new Set<string>()
  for (const check of checks) {
    if (ids.has(check.id)) throw new Error(`verification change standard.checks repeats id "${check.id}"`)
    ids.add(check.id)
  }
  for (const entry of relaxed) {
    if (ids.has(entry.check.id)) {
      throw new Error(`verification change standard.relaxed repeats id "${entry.check.id}"`)
    }
    ids.add(entry.check.id)
  }
  return {
    id: StandardId(value['id']),
    revision: positiveInteger(value['revision'], 'standard.revision'),
    goalId: GoalId(value['goalId']),
    checks,
    relaxed,
  }
}

/** Decode and validate one standard ref. */
function decodeRef(value: unknown, subject: string): StandardRef {
  if (!isRecord(value)) throw new Error(`verification change ${subject} must be a record`)
  requireKeys(value, ['id', 'revision'], subject)
  if (typeof value['id'] !== 'string' || value['id'].length === 0) {
    throw new Error(`verification change ${subject}.id must be a non-empty string`)
  }
  return { id: StandardId(value['id']), revision: positiveInteger(value['revision'], `${subject}.revision`) }
}

/** Decode one check result, admitting exactly the statuses its carrier allows. */
function decodeResult(
  value: unknown,
  subject: string,
  admitted: ReadonlySet<CheckStatus>,
  requirement: string,
): CheckResult {
  if (!isRecord(value)) throw new Error(`verification change ${subject} must be a record`)
  requireKeys(value, ['checkId', 'evidence', 'status'], subject)
  const rawCheckId = value['checkId']
  if (typeof rawCheckId !== 'string' || !isKebabCase(rawCheckId)) {
    throw new Error(`verification change ${subject}.checkId must be lower-kebab-case`)
  }
  const status = value['status'] as CheckStatus
  if (!admitted.has(status)) {
    throw new Error(`verification change ${subject}.status must be ${requirement}`)
  }
  return {
    checkId: CheckId(rawCheckId),
    status,
    evidence: normalizedText(value['evidence'], `${subject}.evidence`),
  }
}

/** Decode one passing certificate result. */
function decodeCertificateResult(value: unknown, subject: string): CheckResult {
  return decodeResult(value, subject, CERTIFIED_STATUSES, '"pass" inside a certificate')
}

/** Decode one recorded run result, passing or failing. */
function decodeRunResult(value: unknown, subject: string): CheckResult {
  return decodeResult(value, subject, RUN_STATUSES, '"pass" or "fail"')
}

/**
 * The verdict one run payload carries, or the one its results decide. Absence
 * is not a gap: every verdict but `tampered` follows from the results, and a
 * payload that states nothing states no tamper.
 */
function decodeVerdict(value: unknown, results: readonly CheckResult[]): RunVerdict {
  if (value === undefined) return results.every(result => result.status === 'pass') ? 'passed' : 'failed'
  if (typeof value !== 'string' || !VERDICTS.has(value as RunVerdict)) {
    throw new Error('verification change run.verdict is invalid')
  }
  return value as RunVerdict
}

/** Shared timestamp validation for standard-shaped changes. */
function decodeTimestamps(value: Record<string, unknown>): { createdAt: number; updatedAt: number } {
  const createdAt = nonNegativeInteger(value['createdAt'], 'createdAt')
  const updatedAt = nonNegativeInteger(value['updatedAt'], 'updatedAt')
  if (updatedAt < createdAt) throw new Error('verification change updatedAt cannot precede createdAt')
  return { createdAt, updatedAt }
}

/** Require a self-declared payload version. */
function requireVersion(value: Record<string, unknown>): void {
  if (value['version'] !== VERIFICATION_CHANGE_VERSION) {
    throw new Error(`unsupported verification change version ${String(value['version'])}`)
  }
}

/**
 * Decode a value that declares itself as a standard change. Unrelated values
 * return `undefined`; malformed standard changes fail replay loudly.
 * @param value - candidate durable payload.
 * @returns validated standard change or `undefined` for another value kind.
 */
export function decodeStandardChange(value: unknown): StandardChangeMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'verification/standard') return undefined
  requireVersion(value)
  requireKeys(value, ['createdAt', 'kind', 'operation', 'standard', 'updatedAt', 'version'], 'standard change')
  if (typeof value['operation'] !== 'string' || !OPERATIONS.has(value['operation'] as StandardOperation)) {
    throw new Error('verification change operation is invalid')
  }
  return {
    kind: 'verification/standard',
    version: VERIFICATION_CHANGE_VERSION,
    operation: value['operation'] as StandardOperation,
    standard: decodeSnapshot(value['standard']),
    ...decodeTimestamps(value),
  }
}

/**
 * Decode a value that declares itself as a relaxation. Unrelated values
 * return `undefined`; malformed relaxations fail replay loudly.
 * @param value - candidate durable payload.
 * @returns validated relaxation or `undefined` for another value kind.
 */
export function decodeRelaxationChange(value: unknown): RelaxationChangeMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'verification/relaxation') return undefined
  requireVersion(value)
  requireKeys(value, ['checkId', 'createdAt', 'kind', 'standard', 'updatedAt', 'version'], 'relaxation')
  const rawCheckId = value['checkId']
  if (typeof rawCheckId !== 'string' || !isKebabCase(rawCheckId)) {
    throw new Error('verification change relaxation checkId must be lower-kebab-case')
  }
  const standard = decodeSnapshot(value['standard'])
  const last = standard.relaxed[standard.relaxed.length - 1]
  if (last === undefined || last.check.id !== rawCheckId) {
    throw new Error('verification change relaxation must end the snapshot relaxed list with its check')
  }
  return {
    kind: 'verification/relaxation',
    version: VERIFICATION_CHANGE_VERSION,
    checkId: CheckId(rawCheckId),
    standard,
    ...decodeTimestamps(value),
  }
}

/**
 * Decode a value that declares itself as a run. Unrelated values return
 * `undefined`; malformed runs fail replay loudly.
 * @param value - candidate durable payload.
 * @returns validated run or `undefined` for another value kind.
 */
export function decodeRunChange(value: unknown): VerificationRunChangeMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'verification/run') return undefined
  requireVersion(value)
  const treeHash = value['treeHash']
  const optional = [
    ...treeHash === undefined ? [] : ['treeHash'],
    ...value['verdict'] === undefined ? [] : ['verdict'],
  ]
  requireKeys(value, [...RUN_KEYS, ...optional], 'run')
  if (typeof value['isolation'] !== 'string' || !ISOLATIONS.has(value['isolation'] as CertificateIsolation)) {
    throw new Error('verification change run.isolation is invalid')
  }
  if (typeof value['executor'] !== 'string' || !EXECUTORS.has(value['executor'] as RunExecutor)) {
    throw new Error('verification change run.executor is invalid')
  }
  if (!Array.isArray(value['results']) || value['results'].length === 0) {
    throw new Error('verification change run.results must be a non-empty array')
  }
  const results = value['results'].map((result, index) => decodeRunResult(result, `run.results[${index}]`))
  return {
    kind: 'verification/run',
    version: VERIFICATION_CHANGE_VERSION,
    standard: decodeRef(value['standard'], 'run.standard'),
    attempt: positiveInteger(value['attempt'], 'run.attempt'),
    isolation: value['isolation'] as CertificateIsolation,
    executor: value['executor'] as RunExecutor,
    verdict: decodeVerdict(value['verdict'], results),
    results,
    ...treeHash === undefined ? {} : { treeHash: hexDigest(treeHash, 'run.treeHash') },
    recordedAt: nonNegativeInteger(value['recordedAt'], 'run.recordedAt'),
  }
}

/**
 * Decode a value that declares itself as a certificate. Unrelated values
 * return `undefined`; malformed certificates fail replay loudly.
 * @param value - candidate durable payload.
 * @returns validated certificate or `undefined` for another value kind.
 */
export function decodeCertificateChange(value: unknown): CertificateChangeMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'verification/certificate') return undefined
  requireVersion(value)
  requireKeys(value, ['certificate', 'kind', 'version'], 'certificate')
  const certificate = value['certificate']
  if (!isRecord(certificate)) throw new Error('verification change certificate must be a record')
  requireKeys(certificate, ['executor', 'goalId', 'isolation', 'recordedAt', 'results', 'standard'], 'certificate')
  if (typeof certificate['goalId'] !== 'string' || certificate['goalId'].length === 0) {
    throw new Error('verification change certificate.goalId must be a non-empty string')
  }
  if (typeof certificate['isolation'] !== 'string'
    || !ISOLATIONS.has(certificate['isolation'] as CertificateIsolation)) {
    throw new Error('verification change certificate.isolation is invalid')
  }
  if (typeof certificate['executor'] !== 'string' || !EXECUTORS.has(certificate['executor'] as RunExecutor)) {
    throw new Error('verification change certificate.executor is invalid')
  }
  if (!Array.isArray(certificate['results']) || certificate['results'].length === 0) {
    throw new Error('verification change certificate.results must be a non-empty array')
  }
  return {
    kind: 'verification/certificate',
    version: VERIFICATION_CHANGE_VERSION,
    certificate: {
      standard: decodeRef(certificate['standard'], 'certificate.standard'),
      goalId: GoalId(certificate['goalId']),
      isolation: certificate['isolation'] as CertificateIsolation,
      executor: certificate['executor'] as RunExecutor,
      results: certificate['results'].map((result, index) =>
        decodeCertificateResult(result, `certificate.results[${index}]`)),
      recordedAt: nonNegativeInteger(certificate['recordedAt'], 'certificate.recordedAt'),
    },
  }
}

/**
 * Decode a value that declares itself as a directive. Unrelated values
 * return `undefined`; malformed directives fail replay loudly.
 * @param value - candidate durable payload.
 * @returns validated directive or `undefined` for another value kind.
 */
export function decodeDirectiveChange(value: unknown): DirectiveChangeMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'verification/directive') return undefined
  requireVersion(value)
  requireKeys(value, ['detail', 'issuedAt', 'kind', 'rootCause', 'standard', 'version'], 'directive')
  return {
    kind: 'verification/directive',
    version: VERIFICATION_CHANGE_VERSION,
    standard: decodeRef(value['standard'], 'directive.standard'),
    rootCause: normalizedText(value['rootCause'], 'directive.rootCause'),
    detail: normalizedText(value['detail'], 'directive.detail'),
    issuedAt: nonNegativeInteger(value['issuedAt'], 'issuedAt'),
  }
}

/** Require two checks to be identical field-for-field. */
function requireSameCheck(previous: StandardCheck, next: StandardCheck, subject: string): void {
  if (previous.id !== next.id || previous.outcome !== next.outcome || previous.run !== next.run) {
    throw new Error(`verification change ${subject} must preserve the existing check "${previous.id}"`)
  }
}

/** Require the relaxed list to preserve an existing prefix exactly. */
function requireSameRelaxed(previous: readonly RelaxedCheck[], next: readonly RelaxedCheck[], subject: string): void {
  for (const [index, entry] of previous.entries()) {
    const candidate = next[index]
    if (candidate === undefined || candidate.evidence !== entry.evidence) {
      throw new Error(`verification change ${subject} must preserve the existing relaxation of "${entry.check.id}"`)
    }
    requireSameCheck(entry.check, candidate.check, subject)
  }
}

/** Require one exact next revision of the current standard for the same goal. */
function requireNextRevision(
  current: CompletionStandardSnapshot,
  next: CompletionStandardSnapshot,
  operation: string,
): void {
  if (next.id !== current.id || next.revision !== current.revision + 1 || next.goalId !== current.goalId) {
    throw new Error(`verification ${operation} must advance the current standard by one revision for its goal`)
  }
}

/** Require preserved creation time and monotone update time. */
function requireTimestampContinuity(
  state: VerificationFoldState,
  createdAt: number,
  updatedAt: number,
  operation: string,
): void {
  /* v8 ignore next -- a current standard established by this fold always has an updatedAt */
  if (state.updatedAt === undefined) throw new Error('current standard fold lacks updatedAt')
  if (createdAt !== state.createdAt || updatedAt < state.updatedAt) {
    throw new Error(`verification ${operation} does not preserve the current timestamps`)
  }
}

/** Validate and apply one standard change (author or extend). */
function applyStandardChange(state: VerificationFoldState, change: StandardChangeMeta): void {
  const next = change.standard
  if (change.operation === 'author') {
    if (next.revision !== 1 || next.relaxed.length !== 0 || next.checks.length === 0
      || state.seenStandardIds.has(next.id)
      || (state.standard !== undefined && state.standard.goalId === next.goalId)) {
      throw new Error('verification author requires a fresh revision-one standard for a new goal')
    }
    state.seenStandardIds.add(next.id)
  } else {
    const current = state.standard
    if (current === undefined) throw new Error('verification extend requires a current standard')
    requireNextRevision(current, next, change.operation)
    requireTimestampContinuity(state, change.createdAt, change.updatedAt, change.operation)
    if (next.checks.length <= current.checks.length) {
      throw new Error('verification extend must add at least one check')
    }
    for (const [index, check] of current.checks.entries()) {
      requireSameCheck(check, next.checks[index] as StandardCheck, change.operation)
    }
    if (next.relaxed.length !== current.relaxed.length) {
      throw new Error('verification extend cannot change relaxations')
    }
    requireSameRelaxed(current.relaxed, next.relaxed, change.operation)
  }
  state.standard = next
  state.certificate = undefined
  state.createdAt = change.createdAt
  state.updatedAt = change.updatedAt
  state.lastRef = { id: next.id, revision: next.revision }
}

/** Validate and apply one relaxation. */
function applyRelaxationChange(state: VerificationFoldState, change: RelaxationChangeMeta): void {
  const current = state.standard
  if (current === undefined) throw new Error('verification relaxation requires a current standard')
  const next = change.standard
  requireNextRevision(current, next, 'relaxation')
  requireTimestampContinuity(state, change.createdAt, change.updatedAt, 'relaxation')
  const removed = current.checks.find(check => check.id === change.checkId)
  if (removed === undefined) {
    throw new Error(`verification relaxation names unknown check "${change.checkId}"`)
  }
  const remaining = current.checks.filter(check => check.id !== change.checkId)
  if (next.checks.length !== remaining.length) {
    throw new Error('verification relaxation must remove exactly its named check')
  }
  for (const [index, check] of remaining.entries()) {
    requireSameCheck(check, next.checks[index] as StandardCheck, 'relaxation')
  }
  if (next.relaxed.length !== current.relaxed.length + 1) {
    throw new Error('verification relaxation must append exactly one relaxed entry')
  }
  requireSameRelaxed(current.relaxed, next.relaxed, 'relaxation')
  const appended = next.relaxed[next.relaxed.length - 1] as RelaxedCheck
  requireSameCheck(removed, appended.check, 'relaxation')
  state.standard = next
  state.certificate = undefined
  state.createdAt = change.createdAt
  state.updatedAt = change.updatedAt
  state.lastRef = { id: next.id, revision: next.revision }
}

/** Require one result per active check, in the standard's check order. */
function requireResultsCover(
  current: CompletionStandardSnapshot,
  results: readonly CheckResult[],
  subject: string,
): void {
  if (results.length !== current.checks.length) {
    throw new Error(`verification ${subject} must carry one result per active check`)
  }
  for (const [index, check] of current.checks.entries()) {
    if (results[index]?.checkId !== check.id) {
      throw new Error(`verification ${subject} result ${index} must answer check "${check.id}"`)
    }
  }
}

/** Validate and apply one executed run. */
function applyRunChange(state: VerificationFoldState, change: VerificationRunChangeMeta): void {
  const current = state.standard
  if (current === undefined) throw new Error('verification run requires a current standard')
  if (change.standard.id !== current.id || change.standard.revision !== current.revision) {
    throw new Error('verification run must cover the exact current standard revision')
  }
  requireResultsCover(current, change.results, 'run')
  const allPassed = change.results.every(result => result.status === 'pass')
  if (change.verdict === 'passed' && !allPassed) {
    throw new Error('verification run cannot record verdict "passed" with a failing result')
  }
  if (change.verdict === 'failed' && allPassed) {
    throw new Error('verification run cannot record verdict "failed" with every result passing')
  }
  /* v8 ignore next -- a current standard established by this fold always has an updatedAt */
  if (state.updatedAt === undefined) throw new Error('current standard fold lacks updatedAt')
  if (change.recordedAt < state.updatedAt) {
    throw new Error('verification run cannot precede the current standard update')
  }
  const expected = nextRunAttempt(state, current.id)
  if (change.attempt !== expected) {
    throw new Error(`verification run must number attempt ${expected} for standard "${current.id}"`)
  }
  state.runsRecorded += 1
  state.lastRun = change
}

/** Validate and apply one certificate. */
function applyCertificateChange(state: VerificationFoldState, change: CertificateChangeMeta): void {
  const current = state.standard
  if (current === undefined) throw new Error('verification certificate requires a current standard')
  const certificate = change.certificate
  if (certificate.standard.id !== current.id || certificate.standard.revision !== current.revision
    || certificate.goalId !== current.goalId) {
    throw new Error('verification certificate must cover the exact current standard revision')
  }
  requireResultsCover(current, certificate.results, 'certificate')
  /* v8 ignore next -- a current standard established by this fold always has an updatedAt */
  if (state.updatedAt === undefined) throw new Error('current standard fold lacks updatedAt')
  if (certificate.recordedAt < state.updatedAt) {
    throw new Error('verification certificate cannot precede the current standard update')
  }
  state.certificate = certificate
}

/** Validate and apply one directive record. */
function applyDirectiveChange(state: VerificationFoldState, change: DirectiveChangeMeta): void {
  const current = state.standard
  if (current === undefined) throw new Error('verification directive requires a current standard')
  if (change.standard.id !== current.id || change.standard.revision !== current.revision) {
    throw new Error('verification directive must reference the exact current standard revision')
  }
  /* v8 ignore next -- a current standard established by this fold always has a createdAt */
  if (state.createdAt === undefined) throw new Error('current standard fold lacks createdAt')
  if (change.issuedAt < state.createdAt) {
    throw new Error('verification directive cannot precede the current standard creation')
  }
  state.directivesIssued += 1
}

/**
 * Apply one session event to the strict durable completion-standard fold.
 * @param state - mutable fold accumulator.
 * @param event - next event in sequence order.
 */
export function applyVerificationEvent(state: VerificationFoldState, event: SessionEvent): void {
  switch (event.type) {
    case 'verification/standard': {
      const change = decodeStandardChange(event.data)
      /* v8 ignore next -- the event's declared payload always identifies itself as a standard change */
      if (change === undefined) throw new Error(`verification change at session event ${event.seq} has an invalid kind`)
      applyStandardChange(state, change)
      return
    }
    case 'verification/relaxation': {
      const change = decodeRelaxationChange(event.data)
      /* v8 ignore next -- the event's declared payload always identifies itself as a relaxation */
      if (change === undefined) throw new Error(`verification change at session event ${event.seq} has an invalid kind`)
      applyRelaxationChange(state, change)
      return
    }
    case 'verification/run': {
      const change = decodeRunChange(event.data)
      /* v8 ignore next -- the event's declared payload always identifies itself as a run */
      if (change === undefined) throw new Error(`verification change at session event ${event.seq} has an invalid kind`)
      applyRunChange(state, change)
      return
    }
    case 'verification/certificate': {
      const change = decodeCertificateChange(event.data)
      /* v8 ignore next -- the event's declared payload always identifies itself as a certificate */
      if (change === undefined) throw new Error(`verification change at session event ${event.seq} has an invalid kind`)
      applyCertificateChange(state, change)
      return
    }
    case 'verification/directive': {
      const change = decodeDirectiveChange(event.data)
      /* v8 ignore next -- the event's declared payload always identifies itself as a directive */
      if (change === undefined) throw new Error(`verification change at session event ${event.seq} has an invalid kind`)
      applyDirectiveChange(state, change)
      return
    }
    default:
      // Non-verification events do not affect the completion-standard fold.
  }
}

/**
 * Fold current completion-standard state from a contiguous session event log.
 * @param events - session events in sequence order.
 * @returns a fresh durable projection.
 */
export function foldVerification(events: readonly SessionEvent[]): FoldedVerification {
  const state = emptyVerificationFoldState()
  for (const event of events) applyVerificationEvent(state, event)
  return {
    ...state.standard === undefined ? {} : { standard: state.standard },
    ...state.certificate === undefined ? {} : { certificate: state.certificate },
    directivesIssued: state.directivesIssued,
    runsRecorded: state.runsRecorded,
    ...state.lastRun === undefined ? {} : { lastRun: state.lastRun },
    ...state.createdAt === undefined ? {} : { createdAt: state.createdAt },
    ...state.updatedAt === undefined ? {} : { updatedAt: state.updatedAt },
    ...state.lastRef === undefined ? {} : { lastRef: { ...state.lastRef } },
  }
}
