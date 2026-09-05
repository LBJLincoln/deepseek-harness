/**
 * The read barrier (`ctx.readBarrier`): the policy home for reads an
 * implementer session must not perform, in the role `dsh-sandbox-policy` plays
 * for sandbox mode and workspace root. It owns one validator-owned directory
 * tree, mints the per-run directory a validator writes its standard snapshot
 * and check scripts into, collects the directories other plugins register,
 * resolves one policy per session, decides containment through the filesystem
 * seam, and appends the durable refusal record. Enforcement itself belongs to
 * each path-opening capability: this service decides, the executors deny. The
 * [read-barrier Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-read-barrier.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-read-barrier
 */

import { mkdirSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ReadBarrierCapability, ReadBarrierDenial, ReadBarrierPolicy, ReadBarrierRole } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    readBarrier: ReadBarrierService
  }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One read the barrier refused: the role that was refused, the seam that
     * refused it, the model-facing path, and the barrier root in force.
     * Log-only — it never enters model history.
     */
    'read-barrier/denied': ReadBarrierDenial
  }
}

/** Self-declared payload version of the `read-barrier/denied` event. */
export const READ_BARRIER_DENIED_VERSION = 1

/** Directory holding one reservation per session, under the barrier root. */
export const RUNS_DIR = 'runs'

/** Permission bits that would let another operating-system account read the barrier's files. */
const GROUP_OTHER_BITS = 0o077

/**
 * Plugin config: which directories the barrier owns. The denied set for a role
 * is deliberately absent — which authorities an implementer may hold is a
 * security invariant, not a deployment choice.
 */
export interface Config {
  /**
   * Directory the barrier owns, absolute or `~`-prefixed (default:
   * `<harness home>/verification`). Created `0700`; an existing directory
   * readable beyond its owner is rejected at load.
   */
  root?: string
  /**
   * Further denied directories, absolute or `~`-prefixed, for directories no
   * plugin registers through {@link ReadBarrierService.protect} (default: none).
   */
  denyRoots?: string[]
}

/** Inputs that select the barrier policy for one capability call. */
export interface ReadBarrierRequest {
  /** Calling session; its reservation decides the role. Absent means an agentless call. */
  session?: Session
}

/**
 * Expand `~`, resolve, and require an absolute directory path.
 * @param path - the configured or caller-supplied directory.
 * @param field - the config field or method naming the path, used in the failure.
 * @returns the expanded absolute path.
 * @throws when the expanded path is not absolute.
 */
function absoluteDirectory(path: string, field: string): string {
  const expanded = expandHomePath(path)
  if (!isAbsolute(expanded)) {
    throw new Error(`read-barrier: ${field} ${JSON.stringify(path)} must be an absolute or "~"-prefixed directory`)
  }
  return resolvePath(expanded)
}

/**
 * Create the barrier root owner-only and refuse one another account can read.
 *
 * POSIX only: Windows has no mode to inspect, so the check is skipped rather
 * than faked and the directory's protection there is whatever `mkdir` expresses.
 * @param root - the absolute barrier root.
 * @throws when the directory exists with group or other permission bits set.
 */
function createOwnerOnlyRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  /* v8 ignore next -- POSIX coverage cannot take the Windows peer; native Windows coverage does. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- Windows has no POSIX mode enforcement; POSIX behavior tests enforce this peer. */
  const mode = statSync(root).mode
  if ((mode & GROUP_OTHER_BITS) === 0) return
  throw new Error(
    `read-barrier: ${root} is readable beyond its owner (mode ${(mode & 0o777).toString(8)});`
    + ` run "chmod 700 ${root}" before starting again`,
  )
  /* v8 ignore stop */
}

/**
 * The read-barrier service (`ctx.readBarrier`). It owns the validator root, the
 * per-session reservations that make a session an implementer, and the denied
 * set every enforcing capability resolves against.
 */
export class ReadBarrierService extends Service {
  static inject = ['fs']

  // Inline schema call: the config catalog walks `static Config` statically.
  static Config: z<Config> = z.object({
    // No schema default: the harness home is resolved in the constructor so the
    // stored root is always absolute regardless of how it was supplied.
    root: z.string(),
    denyRoots: z.array(z.string()).default([]),
  })

  /** The absolute directory the barrier owns; always the first denied directory. */
  readonly root: string

  /** Absolute directories denied alongside {@link root} by deployment config. */
  private readonly configuredDenyRoots: readonly string[]

  /** Registered denied directories, keyed per registration so two registrations of one path both hold. */
  private readonly protectedRoots = new Map<object, string>()

  /** Reserved run directory per session; holding one is what makes a session the implementer. */
  private readonly reservations = new Map<SessionId, string>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'readBarrier')
    this.root = absoluteDirectory(config.root ?? dshHomePath('verification'), 'root')
    // schemastery (static Config) already filled `denyRoots`; the cast records
    // that runtime fact. `root` has NO schema default, so its fallback to the
    // harness home is real branching, resolved absolute either way.
    this.configuredDenyRoots = (config.denyRoots as string[]).map(entry => absoluteDirectory(entry, 'denyRoots entry'))
    createOwnerOnlyRoot(this.root)
    ctx.on('agent/disposed', ({ agent }) => {
      // The role belongs to the live session: a disposed agent can no longer
      // read, and keeping its reservation would grow the map for a process
      // running many environments.
      this.reservations.delete(agent.id)
    })
  }

  /**
   * Mint the run directory for one agent's session and record that session as
   * the implementer. The validator writes its standard snapshot, one script per
   * check, and any held-out fixture there, so the command line the implementer
   * can observe in a process listing names a file whose content it cannot read.
   * Reserving the same session twice returns the same directory.
   *
   * Synchronous so the role is in force the moment the caller returns: an
   * awaited reservation would leave a window in which the session's own reads
   * are still unrestricted.
   * @param agent - the implementer agent whose session the run belongs to.
   * @returns the absolute run directory, created owner-only.
   */
  reserve(agent: Agent): string {
    const existing = this.reservations.get(agent.id)
    if (existing !== undefined) return existing
    const directory = join(this.root, RUNS_DIR, agent.id)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    this.reservations.set(agent.id, directory)
    return directory
  }

  /**
   * Deny one more directory for as long as the registration lives, so a plugin
   * that owns a directory contributes it as an effect instead of a deployment
   * repeating it in configuration.
   * @param path - absolute or `~`-prefixed directory to deny.
   * @returns the registration's disposer.
   */
  protect(path: string): () => void {
    const directory = absoluteDirectory(path, 'protect path')
    const registration = {}
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return this.ctx.effect(() => {
      this.protectedRoots.set(registration, directory)
      return () => { this.protectedRoots.delete(registration) }
    }, `read-barrier protected root ${directory}`)
  }

  /**
   * Resolve the complete policy for one capability call. A session holding a
   * reservation is the implementer; every other session and every agentless
   * call is unrestricted.
   * @param request - the calling session, when there is one.
   * @returns the role, the barrier root, and every denied directory.
   */
  resolve(request: ReadBarrierRequest = {}): ReadBarrierPolicy {
    const role: ReadBarrierRole = request.session !== undefined && this.reservations.has(request.session.id)
      ? 'implementer'
      : 'unrestricted'
    return {
      role,
      root: this.root,
      denied: [...new Set([this.root, ...this.configuredDenyRoots, ...this.protectedRoots.values()])],
    }
  }

  /**
   * Decide whether the policy denies reading one resolved target. Each denied
   * directory is canonicalized through the filesystem seam immediately before
   * its containment test, so an ancestor symlink swapped since the target was
   * resolved is caught. A target whose containment cannot be decided is denied.
   * @param policy - the policy {@link resolve} returned for this call.
   * @param target - the already-resolved target the caller is about to read.
   * @returns true when the read must be refused.
   */
  async denies(policy: ReadBarrierPolicy, target: FsTarget): Promise<boolean> {
    if (policy.role !== 'implementer') return false
    for (const denied of policy.denied) {
      let directory: FsTarget
      try {
        directory = await this.ctx.fs.resolve(denied)
      } catch {
        // A denied directory the backend cannot resolve leaves containment
        // undecidable, and an undecidable read fails closed.
        return true
      }
      if (this.ctx.fs.contains(directory, target)) return true
    }
    return false
  }

  /**
   * Append the durable record of one refusal. The barrier owns the write so
   * every seam that refuses produces the same evidence.
   * @param session - the refused session, whose log receives the record.
   * @param policy - the policy that refused, supplying the role and root.
   * @param capability - the seam that refused the read.
   * @param target - the refused target, supplying the model-facing path.
   * @returns the payload exactly as it was appended.
   */
  recordDenial(
    session: Session,
    policy: ReadBarrierPolicy,
    capability: ReadBarrierCapability,
    target: FsTarget,
  ): ReadBarrierDenial {
    const denial: ReadBarrierDenial = {
      version: READ_BARRIER_DENIED_VERSION,
      role: policy.role,
      capability,
      displayPath: target.displayPath,
      root: policy.root,
    }
    session.append('read-barrier/denied', denial)
    return denial
  }
}

export default ReadBarrierService
