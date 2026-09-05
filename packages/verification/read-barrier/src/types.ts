/**
 * Pure vocabulary of the read barrier: the session roles, the path-opening
 * capabilities that can refuse a read, the resolved per-session policy, and the
 * durable refusal record.
 *
 * @module @deepseek-ai/dsh-read-barrier/types
 */

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
