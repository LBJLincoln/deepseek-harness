/**
 * Pure types of the environment domain: identities, the merge-extensible kind
 * map, and the task-with-verifiers definition, free of host-side imports.
 *
 * @module @deepseek-ai/dsh-environments/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { AuthoredCheck, CertificateIsolation } from '@deepseek-ai/dsh-verification/types'

/** Identifies one environment across compositions; derived from its producer's stable name, never from mount order. */
export type EnvironmentId = Branded<'EnvironmentId'>

/**
 * Merge-extensible map from environment kind to that kind's detail type. Each
 * producer package declares its kind by declaration merging; the registry
 * itself ships no kind.
 */
export interface EnvironmentKindMap {}

/** Every declared environment kind; `string` while no producer has merged a kind into the program. */
export type EnvironmentKind = [keyof EnvironmentKindMap] extends [never] ? string : Extract<keyof EnvironmentKindMap, string>

/** Kind-specific detail declared by the kind's producer; `unknown` for kinds outside this program. */
export type EnvironmentDetail<K extends string> = K extends keyof EnvironmentKindMap ? EnvironmentKindMap[K] : unknown

/** Whether people curated an environment or an agent synthesized it. */
export type EnvironmentProvenance = 'curated' | 'synthesized'

/** The work an environment asks of an agent. */
export interface EnvironmentTask {
  /** Complete task statement handed to the agent as its first user message. */
  readonly prompt: string
  /** Workspace fixture the runner mounts before the task starts, absent for a task that needs no files. */
  readonly fixture?: string
  /**
   * Workspace-relative paths the fixture supplies and the implementer must not
   * author — the tests, the reference outputs, and any overlaid check script.
   * Each is a `/`-separated relative path without `.` or `..` segments, naming
   * a file or a directory tree; the runner digests them beside the validator's
   * own directory and records a run that changed them as tampered.
   */
  readonly immutable?: readonly string[]
  /**
   * Fixture-relative directory holding the reference program a validator may
   * execute and an implementer may never read. It is a `/`-separated relative
   * path without `.` or `..` segments, naming a directory inside `fixture`;
   * the runner copies it beneath the barrier root at reservation time and
   * removes it from every workspace overlay, so the reference reaches the
   * validator's reservation and never the implementer's tree. A `recreation`
   * environment must declare one; every other kind may.
   */
  readonly reference?: string
}

/** One task with its verifiers, as the registry stores it. */
export interface EnvironmentDefinition<K extends EnvironmentKind = EnvironmentKind> {
  /** Stable identity across compositions. */
  readonly id: EnvironmentId
  /** Declared kind. */
  readonly kind: K
  /** Human-readable name. */
  readonly name: string
  /** What the task establishes, stated for people and models. */
  readonly description: string
  /** The task statement and its fixture. */
  readonly task: EnvironmentTask
  /**
   * Executable checks in the completion-standard vocabulary, each cased check
   * carrying the bodies its `cases` reference digests. A validator authors the
   * task's completion standard from exactly these checks, so evaluation and
   * production measure the same outcomes; authorship validates the bodies and
   * keeps only the reference in the log.
   */
  readonly checks: readonly AuthoredCheck[]
  /** Reserved for evaluation: never exported as training data and never shown to an implementer outside a run. */
  readonly heldOut: boolean
  /** Package that produced the registration. */
  readonly owner: string
  /** Curated by people or synthesized by an agent. */
  readonly provenance: EnvironmentProvenance
  /** Environment this one derived from, absent for roots. */
  readonly lineage?: EnvironmentId
  /** Kind-specific detail. */
  readonly detail: EnvironmentDetail<K>
}

/** Selection over the registry's inventory; absent fields match everything. */
export interface EnvironmentFilter {
  /** Only environments of this kind. */
  readonly kind?: EnvironmentKind
  /** Only held-out (`true`) or only training-eligible (`false`) environments. */
  readonly heldOut?: boolean
}

/** Model route one environment run used. */
export interface EnvironmentRunModel {
  /** Registered provider route. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** Content hashes of one environment as it was run; `fixtureSha256` is absent for a task without a fixture. */
export interface EnvironmentContentHashes {
  /** SHA-256 hex of the task prompt. */
  readonly promptSha256: string
  /**
   * SHA-256 hex of the check inventory in authored order: ids, outcomes, run
   * instructions, tree scopes, case references, and the case bodies themselves,
   * so changing one case changes the decontamination key.
   */
  readonly checksSha256: string
  /**
   * SHA-256 hex over every fixture file (relative path and bytes, sorted),
   * the reference tree under `task.reference` included, so changing the
   * reference program changes the decontamination key.
   */
  readonly fixtureSha256?: string
  /** SHA-256 hex over the three hashes above; the decontamination key. */
  readonly contentSha256: string
}

/**
 * Durable link from a session to the environment it ran, written by the
 * runner as the `environment/run` event before the run's first turn. Every
 * fold that groups, decontaminates, or ranks sessions by environment reads it
 * from the log instead of from an in-memory report.
 */
export interface EnvironmentRunStamp extends EnvironmentContentHashes {
  readonly kind: 'environment/run'
  readonly version: 1
  /** Environment that was run. */
  readonly environmentId: EnvironmentId
  /** Declared kind of the environment. */
  readonly environmentKind: string
  /** Whether the environment is reserved for evaluation; exports drop held-out sessions unless asked to keep them. */
  readonly heldOut: boolean
  /** Zero-based repetition of this environment inside its batch; paired designs match repetitions across variants. */
  readonly repetition: number
  /** Batch or sampling group the run belongs to, absent for a single run. */
  readonly group?: string
  /** District the run belongs to; exports withhold the districts a deployment configures by it, absent for a run outside every district. */
  readonly district?: string
  /**
   * Checkpoint or policy the implementer route served, as the deployment names
   * it. Free-form: the harness never resolves it, and a fold that keys measured
   * difficulty by policy version compares the strings it finds. Absent for a
   * route the deployment did not version.
   */
  readonly policyVersion?: string
  /**
   * Sampling seed every request of the run asked for, absent for a run that
   * pinned none. It states what was asked for, not what a replay reproduces:
   * providers may ignore a seed and none of them promise identical tokens
   * across model or infrastructure versions.
   */
  readonly seed?: number
  /** Model route the implementer ran on. */
  readonly model: EnvironmentRunModel
  /** Isolation the deployment declared for the run's checks. */
  readonly isolation: CertificateIsolation
  /**
   * Who did the work: `route` for the session's own model route, or the
   * subagent provider name for a run delegated to an out-of-band coding agent.
   * A scoreboard row is keyed by it, so two implementers on one environment
   * stay two rows. Absent in a payload that states none, which is the route.
   */
  readonly implementer?: string
}
