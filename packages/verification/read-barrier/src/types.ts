/**
 * Pure vocabulary of the read barrier: the session roles, the path-opening
 * capabilities that can refuse a read, the resolved per-session policy, the
 * durable refusal record, the composition census one session was granted, and
 * the host attestation that puts the checks outside the harness account.
 *
 * @module @deepseek-ai/dsh-read-barrier/types
 */

import type { ToolAuthority } from '@deepseek-ai/dsh-tools/types'

/**
 * Authority a session holds against the barrier. `implementer` is denied every
 * directory the barrier owns; `validator` and `unrestricted` are denied
 * nothing, and `unrestricted` is what a session holds without a reservation.
 * Which directories a role may read is a security invariant, never a
 * deployment choice.
 */
export type ReadBarrierRole = 'implementer' | 'validator' | 'unrestricted'

/**
 * Capability seam that refused one read. Each member names a seam that opens
 * paths and can therefore decide a refusal in the operation that opens them.
 */
export type ReadBarrierCapability = 'fs' | 'shell' | 'subprocess' | 'terminal'

/**
 * The barrier's complete decision inputs for one session, resolved once per
 * capability call. `denied` lists every directory the role may not read,
 * canonicalized only at the moment of the containment test.
 */
export interface ReadBarrierPolicy {
  /** Authority the calling session holds. */
  readonly role: ReadBarrierRole
  /** The barrier's own validator-owned root, always the first denied directory. */
  readonly root: string
  /** Every denied directory: the root, the configured extras, and the registered ones. */
  readonly denied: readonly string[]
}

/**
 * One refusal, as the `read-barrier/denied` session event carries it. The path
 * is already in the log inside the model's own `tool/call` arguments, so the
 * record adds evidence and no new disclosure.
 */
export interface ReadBarrierDenial {
  /** Self-declared payload version. */
  readonly version: 1
  /** Role the refused session held. */
  readonly role: ReadBarrierRole
  /** Seam that refused the read. */
  readonly capability: ReadBarrierCapability
  /** Model-facing path of the refused target, exactly as the refusal reported it. */
  readonly displayPath: string
  /** The barrier root in force when the read was refused. */
  readonly root: string
}

/**
 * What a preset roster declares about one agent's composition. The roster is
 * the only authority that can raise or lower a session's role, because only
 * the composition knows which preset was actually mounted.
 */
export interface ReadBarrierComposition {
  /** Preset the agent joined, recorded verbatim in the scope census. */
  readonly presetId: string
  /**
   * Role the preset declared, absent when it declared none. A preset that
   * declares no role leaves the reservation to decide, so a validator can
   * still make an unmarked composition the implementer.
   */
  readonly role?: ReadBarrierRole
}

/**
 * Path-opening capability the scope census reports enforcement for. It extends
 * {@link ReadBarrierCapability} with the two executors the harness cannot fence
 * in-process and must therefore refuse to start instead of denying a read.
 */
export type ReadBarrierEnforcedCapability = ReadBarrierCapability | 'subagent' | 'workflow'

/**
 * What one path-opening capability does about the barrier in this composition:
 * it denies at the operation that opens paths, it is composed and denies
 * nothing, or the composition does not have it at all.
 */
export type ReadBarrierEnforcementState = 'denied-at-executor' | 'unenforced' | 'not-composed'

/** One capability's enforcement decision, as the scope census records it. */
export interface ReadBarrierEnforcementEntry {
  /** The path-opening capability. */
  readonly capability: ReadBarrierEnforcedCapability
  /** What that capability does about the barrier. */
  readonly state: ReadBarrierEnforcementState
}

/** One visible tool and the authorities its definition declares. */
export interface ReadBarrierCensusEntry {
  /** Tool name as the session's registry view resolves it. */
  readonly name: string
  /** Authorities the definition declared, empty for an ordinary tool. */
  readonly authority: readonly ToolAuthority[]
}

/**
 * The composition one session was granted, as the `read-barrier/scope` event
 * carries it. Appended before the session's first `request/header`, so the
 * census is the durable answer to what the model could reach, and a tool that
 * appears in a later header without appearing here was added after the census.
 */
export interface ReadBarrierScope {
  /** Self-declared payload version. */
  readonly version: 1
  /** Role the session holds for the whole run. */
  readonly role: ReadBarrierRole
  /** Preset the session composed, absent when the deployment mounts no roster. */
  readonly presetId?: string
  /** The barrier root in force. */
  readonly root: string
  /** Every denied directory at census time. */
  readonly denied: readonly string[]
  /** One entry per tool visible to the agent, in registry order. */
  readonly census: readonly ReadBarrierCensusEntry[]
  /** One entry per path-opening capability, in a fixed capability order. */
  readonly enforcement: readonly ReadBarrierEnforcementEntry[]
}

/**
 * One verified host attestation, as the `read-barrier/attestation` event
 * carries it. The barrier writes it only after a file at the configured path
 * proved to be owned by another account and unwritable by this one, which is
 * the property an in-process component cannot produce for itself.
 */
export interface ReadBarrierAttestation {
  /** Self-declared payload version. */
  readonly version: 1
  /** Absolute path of the verified file. */
  readonly path: string
  /** Numeric owner of the file, always different from this process's effective uid. */
  readonly owner: number
  /** SHA-256 hex digest of the verified file's bytes. */
  readonly sha256: string
}
