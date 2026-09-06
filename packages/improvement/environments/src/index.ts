/**
 * Environment registry: the composition-time inventory of tasks with
 * verifiers. Each environment declares a task, its executable checks in the
 * completion-standard vocabulary, and whether it is held out for evaluation.
 * The registry executes nothing; the
 * [trajectory-export Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-trajectory-export-and-environment-registry.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-environments
 */

import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@deepseek-ai/dsh-llm'
// Type-only: the durable event vocabulary this package augments.
import type {} from '@deepseek-ai/dsh-session'
import { caseBodiesSha256 } from '@deepseek-ai/dsh-verification'
import type { AuthoredCheck } from '@deepseek-ai/dsh-verification/types'
import type {
  EnvironmentContentHashes,
  EnvironmentDefinition,
  EnvironmentFilter,
  EnvironmentId as EnvironmentIdType,
  EnvironmentRunStamp,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * Environment run stamp: the environment, its content hashes, the
     * repetition, group, and district, the model route, and the declared
     * isolation of one run, appended once before the run's first turn.
     */
    'environment/run': EnvironmentRunStamp
  }
}

/** Self-declared payload version of the `environment/run` event. */
export const ENVIRONMENT_RUN_VERSION = 1

const ISOLATIONS = new Set(['none', 'process', 'host'])
const HEX_64 = /^[0-9a-f]{64}$/
/** A Windows drive prefix, which no workspace-relative path may carry. */
const DRIVE_LETTER = /^[A-Za-z]:/

/** SHA-256 hex digest of one UTF-8 string. */
function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * Field-ordered tuple of one check, so the inventory digest does not depend on
 * the author's object key order. A check without cases digests exactly the
 * three fields every check has always carried.
 */
function checkTuple(check: AuthoredCheck): unknown[] {
  const head = [check.id, check.outcome, check.run]
  const { cases, caseBodies, treeScope } = check
  if (cases === undefined && caseBodies === undefined && treeScope === undefined) return head
  return [
    ...head,
    treeScope ?? null,
    cases === undefined ? null : [cases.count, cases.weightTotal, cases.sha256],
    caseBodies === undefined ? null : caseBodiesSha256(caseBodies),
  ]
}

/**
 * Content hashes of one environment: the prompt, the check inventory in
 * authored order (case bodies included), the caller-computed fixture digest,
 * and the combined key.
 * @param environment - the task and checks to hash.
 * @param fixtureSha256 - digest of the fixture files, absent for a task without a fixture.
 * @returns the four digests; identical inputs give identical digests.
 */
export function environmentContentHashes(
  environment: Pick<EnvironmentDefinition, 'task' | 'checks'>,
  fixtureSha256?: string,
): EnvironmentContentHashes {
  const promptSha256 = sha256(environment.task.prompt)
  const checksSha256 = sha256(JSON.stringify(environment.checks.map(checkTuple)))
  const contentSha256 = sha256([promptSha256, fixtureSha256 ?? '', checksSha256].join('\n'))
  return { promptSha256, checksSha256, ...fixtureSha256 === undefined ? {} : { fixtureSha256 }, contentSha256 }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Require one non-empty string field of a durable stamp. */
function stampText(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string' || field === '') throw new Error(`environment/run ${key} must be a non-empty string`)
  return field
}

/** Require one SHA-256 hex field of a durable stamp. */
function stampHex(value: Record<string, unknown>, key: string): string {
  const field = stampText(value, key)
  if (!HEX_64.test(field)) throw new Error(`environment/run ${key} must be a SHA-256 hex digest`)
  return field
}

/** Require a durable stamp's sampling seed to be a value a provider could have been asked for. */
function stampSeed(value: unknown): number {
  if (!isSeed(value)) throw new Error('environment/run seed must be a non-negative integer')
  return value
}

/**
 * Whether a value is a usable sampling seed: a safe non-negative integer, the
 * only form every provider that accepts a seed can carry on its wire.
 * @param value - candidate seed.
 * @returns whether the value can be sent as a seed and written into a stamp.
 */
export function isSeed(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Decode a value that declares itself as an environment run stamp. Unrelated
 * values return `undefined`; a malformed stamp fails replay loudly, as every
 * durable payload does at the log boundary.
 * @param value - candidate durable payload.
 * @returns the validated stamp, or `undefined` for another value kind.
 */
export function decodeEnvironmentRun(value: unknown): EnvironmentRunStamp | undefined {
  if (!isRecord(value) || value['kind'] !== 'environment/run') return undefined
  if (value['version'] !== ENVIRONMENT_RUN_VERSION) {
    throw new Error(`unsupported environment/run version ${String(value['version'])}`)
  }
  const heldOut = value['heldOut']
  if (typeof heldOut !== 'boolean') throw new Error('environment/run heldOut must be a boolean')
  const repetition = value['repetition']
  if (typeof repetition !== 'number' || !Number.isSafeInteger(repetition) || repetition < 0) {
    throw new Error('environment/run repetition must be a non-negative integer')
  }
  const model = value['model']
  if (!isRecord(model)) throw new Error('environment/run model must be a record')
  const isolation = value['isolation']
  if (typeof isolation !== 'string' || !ISOLATIONS.has(isolation)) {
    throw new Error('environment/run isolation must be none, process, or host')
  }
  const fixture = value['fixtureSha256'] === undefined ? {} : { fixtureSha256: stampHex(value, 'fixtureSha256') }
  const group = value['group'] === undefined ? {} : { group: stampText(value, 'group') }
  const district = value['district'] === undefined ? {} : { district: stampText(value, 'district') }
  const policyVersion = value['policyVersion'] === undefined ? {} : { policyVersion: stampText(value, 'policyVersion') }
  const seed = value['seed'] === undefined ? {} : { seed: stampSeed(value['seed']) }
  return {
    kind: 'environment/run',
    version: ENVIRONMENT_RUN_VERSION,
    environmentId: EnvironmentId(stampText(value, 'environmentId')),
    environmentKind: stampText(value, 'environmentKind'),
    heldOut,
    promptSha256: stampHex(value, 'promptSha256'),
    checksSha256: stampHex(value, 'checksSha256'),
    ...fixture,
    contentSha256: stampHex(value, 'contentSha256'),
    repetition,
    ...group,
    ...district,
    ...policyVersion,
    ...seed,
    model: { provider: stampText(model, 'provider'), model: stampText(model, 'model') },
    isolation: isolation as EnvironmentRunStamp['isolation'],
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    environments: EnvironmentRegistry
  }
}

/** Near-duplicate admission across the held-out split. */
export interface NearDuplicateConfig {
  /**
   * Jaccard similarity of word 5-gram shingles, between 0 and 1, at which a
   * registration is refused against the opposite side of the held-out split.
   */
  threshold: number
}

/** Deployment choices of the registry, validated from `cordis.yml`. */
export interface Config {
  /** Near-duplicate admission; absent registers whatever a producer declares. */
  nearDuplicate?: NearDuplicateConfig
}

/** One registered environment and how close its prompt is to a candidate one. */
export interface NearestEnvironment {
  /** The registered environment that scored highest. */
  readonly environment: EnvironmentIdType
  /** Jaccard similarity of word 5-gram shingles, between 0 and 1. */
  readonly similarity: number
}

/** Stable error codes for rejected environment registrations. */
export type EnvironmentErrorCode =
  | 'ENVIRONMENT_DUPLICATE_ID'
  | 'ENVIRONMENT_NO_CHECKS'
  | 'ENVIRONMENT_DUPLICATE_CHECK'
  | 'ENVIRONMENT_INVALID_IMMUTABLE'
  | 'ENVIRONMENT_INVALID_REFERENCE'
  | 'ENVIRONMENT_NEAR_DUPLICATE'

/** Error returned by the environment registry boundary. */
export class EnvironmentError extends HarnessError {
  /**
   * @param message - human-readable rejection reason.
   * @param code - stable machine-routable classification.
   */
  // Keep the constructor to narrow HarnessError's string code at this boundary.
  // oxlint-disable-next-line typescript/no-useless-constructor -- type-only narrowing
  constructor(message: string, code: EnvironmentErrorCode) {
    super(message, code)
  }
}

/**
 * Brand a string as an environment id.
 * @param id - raw environment identifier.
 * @returns the same string with the compile-time brand.
 */
export function EnvironmentId(id: string): EnvironmentIdType {
  return id as EnvironmentIdType
}

/** Words one prompt is shingled into: each run of non-alphanumeric characters is one separator. */
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u

/** Words per shingle. Five is long enough that ordinary task phrasing does not collide by itself. */
const SHINGLE_SIZE = 5

/**
 * Word shingles of one prompt, normalized as the admission rule normalizes:
 * lower-cased, punctuation replaced by separators, and the resulting whitespace
 * collapsed away. A prompt shorter than one shingle contributes its whole word
 * list as a single shingle, so two identical short prompts still score 1.
 */
function promptShingles(prompt: string): ReadonlySet<string> {
  const words = prompt.toLowerCase().split(WORD_SEPARATOR).filter(word => word !== '')
  if (words.length === 0) return new Set()
  if (words.length < SHINGLE_SIZE) return new Set([words.join(' ')])
  const shingles = new Set<string>()
  for (let start = 0; start + SHINGLE_SIZE <= words.length; start += 1) {
    shingles.add(words.slice(start, start + SHINGLE_SIZE).join(' '))
  }
  return shingles
}

/**
 * Jaccard similarity of two shingle sets: shared shingles over all shingles.
 * Two empty sets are identical rather than undefined, which keeps an empty
 * prompt from silently admitting beside another empty one.
 */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let shared = 0
  for (const shingle of a) if (b.has(shingle)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** Copy a definition so callers never share the registry's stored check list, case bodies, or immutable set. */
function detach(definition: EnvironmentDefinition): EnvironmentDefinition {
  const immutable = definition.task.immutable
  return {
    ...definition,
    task: { ...definition.task, ...immutable === undefined ? {} : { immutable: [...immutable] } },
    checks: definition.checks.map(check => ({
      ...check,
      ...check.caseBodies === undefined ? {} : { caseBodies: [...check.caseBodies] },
    })),
  }
}

/**
 * Reject a declared immutable path the runner could not digest as one workspace
 * file or tree: an absolute path, a Windows-style path, a `.` or `..` segment,
 * an empty segment, or a repeat. The check-owned set is a security invariant of
 * the run, so a path the registry cannot resolve fails registration rather than
 * the run that would have measured it.
 */
function assertImmutable(definition: EnvironmentDefinition): void {
  const reject = (path: string, reason: string): never => {
    throw new EnvironmentError(
      `environment "${definition.id}" declares immutable path "${path}" ${reason}`,
      'ENVIRONMENT_INVALID_IMMUTABLE',
    )
  }
  const seen = new Set<string>()
  for (const path of definition.task.immutable ?? []) {
    if (path === '') reject(path, 'that is empty')
    if (path.startsWith('/') || DRIVE_LETTER.test(path)) reject(path, 'that is not workspace-relative')
    if (path.includes('\\')) reject(path, 'that uses a backslash; workspace-relative paths separate segments with "/"')
    for (const segment of path.split('/')) {
      if (segment === '') reject(path, 'that is not normalized: it holds an empty segment')
      if (segment === '.' || segment === '..') reject(path, `that is not normalized: it holds a "${segment}" segment`)
    }
    if (seen.has(path)) reject(path, 'twice')
    seen.add(path)
  }
}

/**
 * The kind whose completion standard a validator derives from the reference
 * program under `task.reference` rather than from checks written by hand. The
 * registry holds the literal because it enforces the kind's registration rule;
 * the kind itself is declared by the package that produces such environments.
 */
export const RECREATION_KIND = 'recreation'

/**
 * Reject a reference the runner could not stage beneath the barrier root: a
 * `recreation` environment without one, a reference on a task with no fixture,
 * a path that is not a normalized fixture-relative one, or a path that is not
 * an existing directory inside the fixture. Failing here rather than at the run
 * keeps a task whose reference cannot be hidden from ever being scheduled.
 */
function assertReference(definition: EnvironmentDefinition): void {
  const { fixture, reference } = definition.task
  const reject = (reason: string): never => {
    throw new EnvironmentError(`environment "${definition.id}" ${reason}`, 'ENVIRONMENT_INVALID_REFERENCE')
  }
  if (reference === undefined) {
    if (definition.kind === RECREATION_KIND) reject(`is a "${RECREATION_KIND}" environment without a task reference`)
    return
  }
  if (fixture === undefined) reject(`declares reference "${reference}" without a fixture to resolve it against`)
  if (reference === '') reject('declares an empty task reference')
  if (reference.startsWith('/') || DRIVE_LETTER.test(reference)) reject(`declares reference "${reference}" that is not fixture-relative`)
  if (reference.includes('\\')) reject(`declares reference "${reference}" that uses a backslash; fixture-relative paths separate segments with "/"`)
  for (const segment of reference.split('/')) {
    if (segment === '') reject(`declares reference "${reference}" that is not normalized: it holds an empty segment`)
    if (segment === '.' || segment === '..') reject(`declares reference "${reference}" that is not normalized: it holds a "${segment}" segment`)
  }
  if (!isDirectory(join(fixture as string, reference))) {
    reject(`declares reference "${reference}", which is not a directory inside its fixture`)
  }
}

/** Directory test that treats a missing or unreadable path as no directory. */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // statSync throws for a missing or unreadable path; both mean the
    // registration named no directory the runner could copy.
    return false
  }
}

/** Reject a definition whose verifiers cannot author a completion standard. */
function assertChecks(definition: EnvironmentDefinition): void {
  if (definition.checks.length === 0) {
    throw new EnvironmentError(`environment "${definition.id}" declares no checks`, 'ENVIRONMENT_NO_CHECKS')
  }
  const seen = new Set<string>()
  for (const check of definition.checks) {
    if (seen.has(check.id)) {
      throw new EnvironmentError(`environment "${definition.id}" declares check "${check.id}" twice`, 'ENVIRONMENT_DUPLICATE_CHECK')
    }
    seen.add(check.id)
  }
}

/** Environment registry (`ctx.environments`): tasks with verifiers, held at composition time. */
export class EnvironmentRegistry extends Service {
  static Config: z<Config> = z.object({
    // Prevent Schemastery from materializing an omitted nearDuplicate as `{}`,
    // whose missing threshold would reject every deployment that admits freely.
    nearDuplicate: z.object({
      threshold: z.number().min(0).max(1).required(),
    }).default(undefined as unknown as NearDuplicateConfig),
  })

  private readonly environments = new Map<EnvironmentIdType, EnvironmentDefinition>()

  private readonly nearDuplicate: NearDuplicateConfig | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'environments')
    this.nearDuplicate = config.nearDuplicate
  }

  /**
   * Register one environment. Registrations are effects: the producer keeps
   * the returned disposer under its own fiber so disposal removes the entry.
   * @param definition - complete environment definition.
   * @returns the exact disposer that removes this registration and no later one under the same id.
   * @throws {@link EnvironmentError} when the id is already registered, the
   *   definition declares no checks, two checks share an id, an immutable
   *   path is not a normalized workspace-relative path, the task reference is
   *   missing on a `recreation` environment or is not a directory inside the
   *   fixture, or a configured near-duplicate threshold refuses the prompt
   *   against the opposite split.
   */
  register(definition: EnvironmentDefinition): () => void {
    if (this.environments.has(definition.id)) {
      throw new EnvironmentError(`environment "${definition.id}" is already registered`, 'ENVIRONMENT_DUPLICATE_ID')
    }
    assertChecks(definition)
    assertImmutable(definition)
    assertReference(definition)
    this.assertNotNearDuplicate(definition)
    const stored = detach(definition)
    this.environments.set(stored.id, stored)
    return () => {
      if (this.environments.get(stored.id) === stored) this.environments.delete(stored.id)
    }
  }

  /**
   * Refuse an environment whose prompt near-duplicates one on the opposite
   * side of the held-out split. Training on a task the held-out suite also
   * measures is the contamination the split exists to prevent, and it is
   * equally contaminating whichever side is registered second.
   */
  private assertNotNearDuplicate(definition: EnvironmentDefinition): void {
    const threshold = this.nearDuplicate?.threshold
    if (threshold === undefined) return
    const nearest = this.nearest(definition.task.prompt, !definition.heldOut)
    if (nearest === undefined || nearest.similarity < threshold) return
    const opposite = definition.heldOut ? 'training-eligible' : 'held-out'
    throw new EnvironmentError(
      `environment "${definition.id}" near-duplicates ${opposite} environment "${nearest.environment}": word ${SHINGLE_SIZE}-gram Jaccard similarity ${nearest.similarity} reaches the ${threshold} admission threshold`,
      'ENVIRONMENT_NEAR_DUPLICATE',
    )
  }

  /**
   * The registered held-out environment whose task prompt is closest to one
   * candidate prompt, so a curator can score a proposal before paying for a
   * run. It reads the same normalization and similarity the admission rule
   * applies, and answers whether or not a threshold is configured.
   * @param prompt - candidate task statement.
   * @returns the nearest held-out environment and its similarity, or `undefined` when none is registered.
   */
  nearestHeldOut(prompt: string): NearestEnvironment | undefined {
    return this.nearest(prompt, true)
  }

  /** The most similar registered environment on one side of the held-out split. */
  private nearest(prompt: string, heldOut: boolean): NearestEnvironment | undefined {
    const candidate = promptShingles(prompt)
    let nearest: NearestEnvironment | undefined
    for (const environment of this.environments.values()) {
      if (environment.heldOut !== heldOut) continue
      const similarity = jaccard(candidate, promptShingles(environment.task.prompt))
      if (nearest === undefined || similarity > nearest.similarity) nearest = { environment: environment.id, similarity }
    }
    return nearest
  }

  /**
   * Read one environment.
   * @param id - environment identity.
   * @returns a detached definition, or `undefined` when nothing is registered under the id.
   */
  get(id: EnvironmentIdType): EnvironmentDefinition | undefined {
    const stored = this.environments.get(id)
    return stored === undefined ? undefined : detach(stored)
  }

  /**
   * List environments in registration order.
   * @param filter - kind and held-out selection; absent fields match everything.
   * @returns detached definitions.
   */
  list(filter: EnvironmentFilter = {}): EnvironmentDefinition[] {
    return [...this.environments.values()]
      .filter(environment => filter.kind === undefined || environment.kind === filter.kind)
      .filter(environment => filter.heldOut === undefined || environment.heldOut === filter.heldOut)
      .map(detach)
  }
}

export default EnvironmentRegistry
