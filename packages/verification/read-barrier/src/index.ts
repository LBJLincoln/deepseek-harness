/**
 * The read barrier (`ctx.readBarrier`): the policy home for reads an
 * `implementer` or `judge` session must not perform, in the role
 * `dsh-sandbox-policy` plays
 * for sandbox mode and workspace root. It owns one validator-owned directory
 * tree, mints the per-run directory a validator writes its standard snapshot
 * and check scripts into, collects the directories other plugins register,
 * resolves one policy per session, decides containment through the filesystem
 * seam, and appends the durable refusal record. Enforcement itself belongs to
 * each path-opening capability: this service decides, the executors deny. A
 * capability that opens paths in this process registers what it enforces; one
 * that opens them outside it — a worker thread, an out-of-process agent —
 * registers that it enforces by refusing to start. The
 * [read-barrier Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-read-barrier.md)
 * owns the design rationale.
 * @module @deepseek-ai/dsh-read-barrier
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve as resolvePath } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolAuthority, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {
  ReadBarrierAttestation,
  ReadBarrierCapability,
  ReadBarrierCensusEntry,
  ReadBarrierComposition,
  ReadBarrierDenial,
  ReadBarrierEnforcedCapability,
  ReadBarrierEnforcementEntry,
  ReadBarrierIsolationClaim,
  ReadBarrierPolicy,
  ReadBarrierRole,
  ReadBarrierScope,
} from './types.ts'

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
    /**
     * The composition one session was granted, appended before its first
     * `request/header`: the role, the preset that declared it, the denied
     * directories, one census entry per visible tool with the authorities its
     * definition declares, and one enforcement entry per path-opening
     * capability. Log-only — it never enters model history.
     */
    'read-barrier/scope': ReadBarrierScope
    /**
     * One host attestation the barrier verified: a file at the configured
     * `hostAttestation` path that is owned by another operating-system account
     * and unwritable by this one. Log-only — it never enters model history.
     */
    'read-barrier/attestation': ReadBarrierAttestation
  }
}

/** Self-declared payload version of the `read-barrier/denied` event. */
export const READ_BARRIER_DENIED_VERSION = 1

/** Self-declared payload version of the `read-barrier/scope` event. */
export const READ_BARRIER_SCOPE_VERSION = 1

/** Self-declared payload version of the `read-barrier/attestation` event. */
export const READ_BARRIER_ATTESTATION_VERSION = 1

/** Directory holding one reservation per session, under the barrier root. */
export const RUNS_DIR = 'runs'

/** Permission bits that would let another operating-system account read the barrier's files. */
const GROUP_OTHER_BITS = 0o077

/** Permission bits that would let this harness account write a file another account owns. */
const FOREIGN_WRITABLE_BITS = 0o022

/**
 * Every path-opening capability the scope census reports, mapped to the service
 * name that provides it. Iteration order fixes the census order, so two runs of
 * one composition record the same enforcement list.
 */
export const ENFORCED_CAPABILITY_SERVICES: Readonly<Record<ReadBarrierEnforcedCapability, string>> = {
  fs: 'fs',
  shell: 'shell',
  subprocess: 'subprocess',
  terminal: 'terminals',
  subagent: 'subagents',
  workflow: 'workflowEngine',
}

/**
 * The roles the barrier denies, in the order the vocabulary declares them. A
 * role outside this set holds every directory and every authority it was given.
 */
export const DENIED_ROLES: readonly ReadBarrierRole[] = ['implementer', 'judge']

/** The article each role takes in the refusals that name it. */
const ROLE_ARTICLE: Readonly<Record<ReadBarrierRole, string>> = {
  implementer: 'an',
  judge: 'a',
  validator: 'a',
  unrestricted: 'an',
}

/**
 * The first authority `role` may not hold, or `undefined` when it may hold
 * every one it was given. Every declared authority is denied to a role in
 * {@link DENIED_ROLES} and none to any other: which authorities a role may hold
 * is a security invariant rather than a deployment choice, and an authority
 * merged into `ToolAuthorityMap` later is denied by this same rule instead of
 * by being added to a list somewhere.
 * @param role - the calling session's role.
 * @param authority - authorities the tool definition declared, absent for an ordinary tool.
 * @returns the denied authority to report, or undefined when nothing is denied.
 */
export function deniedAuthority(
  role: ReadBarrierRole,
  authority: readonly ToolAuthority[] | undefined,
): ToolAuthority | undefined {
  if (!DENIED_ROLES.includes(role)) return undefined
  return authority?.[0]
}

/**
 * The complete account of one execution the barrier refused for its authority.
 * No recovery instruction follows it: the tool is not callable in this session
 * at all.
 * @param tool - the tool name the call named.
 * @param authority - the denied authority its definition declares.
 * @param role - the denied role the calling session holds.
 * @returns the exact guard-denial reason.
 */
export function authorityDenialMessage(tool: string, authority: ToolAuthority, role: ReadBarrierRole): string {
  return `"${tool}" carries the "${authority}" authority and is not callable in ${ROLE_ARTICLE[role]} ${role} session`
}

/**
 * The complete account of one capability the barrier refused to start. A worker
 * thread or an out-of-process agent runs outside every fence this process can
 * install, so the only denial available to it is not running at all.
 * @param capability - the path-opening capability that must not start.
 * @param claim - the isolation the deployment intends its certificates to claim.
 * @returns the exact start-refusal reason.
 */
export function startRefusalMessage(
  capability: ReadBarrierEnforcedCapability,
  claim: ReadBarrierIsolationClaim,
): string {
  return `"${capability}" opens paths this process cannot confine and does not start in an implementer session under the "${claim}" isolation claim`
}

/**
 * Why a capability that enforces by refusing to start records no enforcement,
 * used as the census reason under a claim that asks nothing of it.
 * @param claim - the deployment's isolation claim.
 * @returns the reason recorded on the `unenforced` census entry.
 */
function unclaimedRefusalReason(claim: ReadBarrierIsolationClaim): string {
  return `it runs outside this process and the deployment claims "${claim}" isolation, which asserts nothing about what an executor opens`
}

/**
 * The directories a resolved policy actually denies its holder: every denied
 * directory for a role in {@link DENIED_ROLES}, none for any other. One place
 * decides which roles the denied set binds, so a process runner filling its own
 * denial and the in-process {@link ReadBarrierService.denies} test cannot
 * disagree.
 * @param policy - the policy {@link ReadBarrierService.resolve} returned.
 * @returns the denied directories in force for that policy's role.
 */
export function deniedReadRoots(policy: ReadBarrierPolicy): readonly string[] {
  return DENIED_ROLES.includes(policy.role) ? policy.denied : []
}

/** The attestation file's decision inputs, read once per verification. */
export interface AttestationFile {
  /** Numeric owner reported by `stat`. */
  readonly uid: number
  /** Permission bits reported by `stat`. */
  readonly mode: number
  /** Whether the path resolves to a regular file. */
  readonly isFile: boolean
  /** SHA-256 hex digest of the file's bytes. */
  readonly sha256: string
}

/**
 * Why `file` does not prove another operating-system account wrote the
 * attestation, or `undefined` when it does. The property the `host` level
 * asserts is exactly this: an in-process component cannot produce such a file
 * without already holding another account's privileges.
 * @param file - the attestation file's owner, mode, kind, and digest.
 * @param effectiveUid - this process's effective uid; absent on a platform without one.
 * @returns the human-readable problem, or undefined when the file verifies.
 */
export function attestationProblem(file: AttestationFile, effectiveUid: number | undefined): string | undefined {
  if (!file.isFile) return 'is not a regular file'
  if (effectiveUid === undefined) return 'cannot be attributed to an operating-system owner on this platform'
  if (file.uid === effectiveUid) return `is owned by this harness account (uid ${String(effectiveUid)})`
  if ((file.mode & FOREIGN_WRITABLE_BITS) !== 0) {
    return `is writable outside its owner (mode ${(file.mode & 0o777).toString(8)})`
  }
  return undefined
}

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
  /**
   * Absolute or `~`-prefixed file an external account writes (default: none).
   * The barrier records a `read-barrier/attestation` only after the file proves
   * to be owned by another operating-system account and unwritable by this one;
   * without that record no certificate may claim `host` isolation.
   */
  hostAttestation?: string
  /**
   * Isolation this deployment intends its certificates to claim (default:
   * `none`). It decides only what a capability the harness cannot fence
   * in-process — a workflow worker, an out-of-process subagent — does for an
   * implementer session: refuse to start under `process` or `host`, run
   * unenforced under `none`. It grants nothing: what a certificate may actually
   * claim is decided by `@deepseek-ai/dsh-verification` over the census this
   * barrier appends, so a deployment that raises this field without composing
   * the enforcement still gets its claim refused.
   */
  isolationClaim?: ReadBarrierIsolationClaim
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
    hostAttestation: z.string(),
    isolationClaim: z.union(['none', 'process', 'host'] as const).default('none'),
  })

  /** The absolute directory the barrier owns; always the first denied directory. */
  readonly root: string

  /** The isolation this deployment intends to claim, as {@link Config.isolationClaim} set it. */
  readonly isolationClaim: ReadBarrierIsolationClaim

  /** Absolute directories denied alongside {@link root} by deployment config. */
  private readonly configuredDenyRoots: readonly string[]

  /** Absolute path of the file an external account writes, absent when none is configured. */
  private readonly hostAttestation: string | undefined

  /** Registered denied directories, keyed per registration so two registrations of one path both hold. */
  private readonly protectedRoots = new Map<object, string>()

  /** Reserved run directory per session; holding one is what makes a session the implementer. */
  private readonly reservations = new Map<SessionId, string>()

  /** Composition a preset roster declared per session; a declared role outranks a reservation. */
  private readonly compositions = new Map<SessionId, ReadBarrierComposition>()

  /** Capabilities that registered enforcement, keyed per registration so two registrations both hold. */
  private readonly enforcing = new Map<object, ReadBarrierEnforcedCapability>()

  /**
   * Capabilities that enforce by refusing to start, keyed per registration. A
   * membership here decides the census entry from {@link isolationClaim} rather
   * than from an enforcing listener, because there is no listener to hold.
   */
  private readonly refusing = new Map<object, ReadBarrierEnforcedCapability>()

  /** Why one composed capability enforces nothing, keyed per registration. */
  private readonly unenforceable = new Map<object, { capability: ReadBarrierEnforcedCapability; reason: string }>()

  /** Sessions whose scope census is already durable, so the census is appended exactly once. */
  private readonly censused = new Set<SessionId>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'readBarrier')
    this.root = absoluteDirectory(config.root ?? dshHomePath('verification'), 'root')
    // schemastery (static Config) already filled `denyRoots`; the cast records
    // that runtime fact. `root` has NO schema default, so its fallback to the
    // harness home is real branching, resolved absolute either way.
    this.configuredDenyRoots = (config.denyRoots as string[]).map(entry => absoluteDirectory(entry, 'denyRoots entry'))
    this.hostAttestation = config.hostAttestation === undefined
      ? undefined
      : absoluteDirectory(config.hostAttestation, 'hostAttestation')
    // schemastery (static Config) already filled `isolationClaim`; the cast records that runtime fact.
    this.isolationClaim = config.isolationClaim as ReadBarrierIsolationClaim
    createOwnerOnlyRoot(this.root)
    ctx.on('agent/created', ({ agent }) => { this.installGuard(agent) })
    // The census is taken here rather than at creation because a validator
    // reserves AFTER the agent exists: the role is settled by the time the
    // first request is composed, and this waterfall runs before the loop
    // appends that request's `request/header`.
    ctx.on('agent/request', async ({ agent }, next) => {
      this.recordScope(agent)
      return await next()
    })
    ctx.on('agent/disposed', ({ agent }) => {
      // The role belongs to the live session: a disposed agent can no longer
      // read, and keeping its reservation would grow the map for a process
      // running many environments.
      this.reservations.delete(agent.id)
      this.compositions.delete(agent.id)
      this.censused.delete(agent.id)
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
   * Record that one capability denies the barrier's directories in the
   * operation that opens paths, for as long as the registration lives. The
   * scope census reports a composed capability without one as `unenforced`, and
   * an isolation claim above `none` is refused while any such entry stands.
   * @param capability - the path-opening capability that enforces.
   * @returns the registration's disposer.
   */
  enforce(capability: ReadBarrierEnforcedCapability): () => void {
    const registration = {}
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return this.ctx.effect(() => {
      this.enforcing.set(registration, capability)
      return () => { this.enforcing.delete(registration) }
    }, `read-barrier enforcement ${capability}`)
  }

  /**
   * Record that one capability enforces the barrier by REFUSING TO START, for
   * as long as the registration lives. It is the sibling of {@link enforce} for
   * the executors this process cannot fence: a worker thread recovers the host
   * process's privileges and an out-of-process agent brings its own tool stack,
   * so neither can deny a read in the operation that opens paths. The census
   * follows {@link isolationClaim}: `denied-at-executor` under `process` or
   * `host` (where {@link startRefusal} refuses every implementer start) and
   * `unenforced` under `none` (where it starts and denies nothing).
   * @param capability - the path-opening capability that enforces by refusing.
   * @returns the registration's disposer.
   */
  enforceByRefusal(capability: ReadBarrierEnforcedCapability): () => void {
    const registration = {}
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return this.ctx.effect(() => {
      this.refusing.set(registration, capability)
      return () => { this.refusing.delete(registration) }
    }, `read-barrier refusal ${capability}`)
  }

  /**
   * Record that one composed capability CANNOT enforce the barrier on this
   * host, with the reason, for as long as the registration lives. A capability
   * whose confinement backend cannot express a read denial registers here
   * instead of {@link enforce}, so the census carries why the certificate that
   * cites it will be refused rather than only which capability was silent.
   * @param capability - the path-opening capability that enforces nothing.
   * @param reason - why it cannot, named from the capability's own vocabulary.
   * @returns the registration's disposer.
   */
  cannotEnforce(capability: ReadBarrierEnforcedCapability, reason: string): () => void {
    const registration = {}
    // oxlint-disable-next-line typescript/no-misused-promises -- synchronous cleanup; direct return preserves disposer identity
    return this.ctx.effect(() => {
      this.unenforceable.set(registration, { capability, reason })
      return () => { this.unenforceable.delete(registration) }
    }, `read-barrier unenforceable ${capability}`)
  }

  /**
   * Why one capability that cannot be confined in-process must not start for a
   * session, or `undefined` when it may. Every start of such a capability asks
   * here, so the refusal is decided in the operation that would open the paths.
   * @param capability - the capability about to start.
   * @param session - the session it would start for; absent for an agentless call.
   * @returns the exact refusal from {@link startRefusalMessage}, or undefined.
   */
  startRefusal(capability: ReadBarrierEnforcedCapability, session: Session | undefined): string | undefined {
    if (this.isolationClaim === 'none') return undefined
    if (this.roleOf(session) !== 'implementer') return undefined
    return startRefusalMessage(capability, this.isolationClaim)
  }

  /**
   * Record what a preset roster composed for one agent. A declared role
   * outranks a reservation, because only the composition knows what was
   * actually mounted; a preset that declares none leaves the reservation to
   * decide. The roster is the only caller: nothing a session itself runs may
   * raise its own role.
   * @param agent - the agent whose composition was resolved.
   * @param composition - the preset id and the role it declared, if any.
   */
  declareComposition(agent: Agent, composition: ReadBarrierComposition): void {
    this.compositions.set(agent.id, composition)
  }

  /**
   * Resolve the complete policy for one capability call. A session whose preset
   * declared a role holds that role; otherwise a session holding a reservation
   * is the implementer, and every other session and every agentless call is
   * unrestricted.
   * @param request - the calling session, when there is one.
   * @returns the role, the barrier root, and every denied directory.
   */
  resolve(request: ReadBarrierRequest = {}): ReadBarrierPolicy {
    return {
      role: this.roleOf(request.session),
      root: this.root,
      denied: [...new Set([this.root, ...this.configuredDenyRoots, ...this.protectedRoots.values()])],
    }
  }

  /** The role one session holds: the preset's declaration first, then the reservation. */
  private roleOf(session: Session | undefined): ReadBarrierRole {
    if (session === undefined) return 'unrestricted'
    const declared = this.compositions.get(session.id)?.role
    if (declared !== undefined) return declared
    return this.reservations.has(session.id) ? 'implementer' : 'unrestricted'
  }

  /**
   * One entry per path-opening capability: `denied-at-executor` when the
   * capability registered enforcement — through {@link enforce}, or through
   * {@link enforceByRefusal} under a `process` or `host` claim — `unenforced`
   * when it is composed without one, and `not-composed` when this composition
   * does not have it. An `unenforced` entry carries the reason whenever a
   * registration supplied one.
   * @returns the enforcement census in the fixed capability order.
   */
  enforcementCensus(): ReadBarrierEnforcementEntry[] {
    const enforced = new Set(this.enforcing.values())
    const refusing = new Set(this.refusing.values())
    const reasons = new Map([...this.unenforceable.values()].map(entry => [entry.capability, entry.reason]))
    return Object.entries(ENFORCED_CAPABILITY_SERVICES).map(([name, service]) => {
      const capability = name as ReadBarrierEnforcedCapability
      if (enforced.has(capability)) return { capability, state: 'denied-at-executor' as const }
      if (refusing.has(capability)) {
        return this.isolationClaim === 'none'
          ? { capability, state: 'unenforced' as const, reason: unclaimedRefusalReason(this.isolationClaim) }
          : { capability, state: 'denied-at-executor' as const }
      }
      // A recorded reason proves the capability is composed: only the
      // capability itself registers one, so it outranks the service lookup.
      const reason = reasons.get(capability)
      if (reason !== undefined) return { capability, state: 'unenforced' as const, reason }
      if (this.ctx.get(service) === undefined) return { capability, state: 'not-composed' as const }
      return { capability, state: 'unenforced' as const }
    })
  }

  /**
   * One census entry per tool the agent's registry view resolves, with the
   * authorities each declares, sorted by tool name: the registry answers in
   * mount order, which follows concurrent Loader mounts and would make two runs
   * of one composition record different censuses.
   */
  private toolCensus(agent: Agent): ReadBarrierCensusEntry[] {
    const tools = agent.ctx.get('tools')
    if (tools === undefined) return []
    return tools.schemas(agent)
      .map(schema => ({
        name: schema.name,
        authority: [...tools.get(schema.name, agent)?.authority ?? []],
      }))
      // Two entries never share a name: the registry keys tools by it.
      .sort((left, right) => (left.name < right.name ? -1 : 1))
  }

  /**
   * Append this session's composition census, and its host attestation when one
   * verifies, exactly once. Called before the loop composes the session's first
   * `request/header`, so the census is durable before any tool schema reaches a
   * model.
   */
  private recordScope(agent: Agent): void {
    if (this.censused.has(agent.id)) return
    this.censused.add(agent.id)
    const composition = this.compositions.get(agent.id)
    const scope: ReadBarrierScope = {
      version: READ_BARRIER_SCOPE_VERSION,
      role: this.roleOf(agent.session),
      ...composition === undefined ? {} : { presetId: composition.presetId },
      root: this.root,
      denied: this.resolve({ session: agent.session }).denied,
      census: this.toolCensus(agent),
      enforcement: this.enforcementCensus(),
    }
    agent.session.append('read-barrier/scope', scope)
    const attestation = this.verifiedAttestation()
    /* v8 ignore start -- only a file owned by another operating-system account reaches this append,
       which an unprivileged test process cannot create; `attestationProblem` covers every decision
       the record depends on. */
    if (attestation !== undefined) agent.session.append('read-barrier/attestation', attestation)
    /* v8 ignore stop */
  }

  /**
   * Verify the configured host attestation file.
   * @returns the record to append, or undefined when no file is configured, it
   * cannot be read, or it does not prove another account owns it.
   */
  private verifiedAttestation(): ReadBarrierAttestation | undefined {
    const path = this.hostAttestation
    if (path === undefined) return undefined
    let file: AttestationFile
    try {
      const stats = statSync(path)
      file = {
        uid: stats.uid,
        mode: stats.mode,
        isFile: stats.isFile(),
        sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      }
    } catch {
      // An absent or unreadable attestation file is simply no attestation: the
      // claim it would have supported is refused instead of the run failing.
      this.ctx.logger.warn(`read-barrier: host attestation ${path} cannot be read; no certificate may claim host isolation`)
      return undefined
    }
    const problem = attestationProblem(file, process.geteuid?.())
    /* v8 ignore start -- the verifying arm needs a file owned by another operating-system account,
       which an unprivileged test process cannot create; `attestationProblem` covers every decision
       this arm depends on. */
    if (problem === undefined) {
      return { version: READ_BARRIER_ATTESTATION_VERSION, path, owner: file.uid, sha256: file.sha256 }
    }
    /* v8 ignore stop */
    this.ctx.logger.warn(`read-barrier: host attestation ${path} ${problem}; no certificate may claim host isolation`)
    return undefined
  }

  /**
   * Register this agent's authority guard on its own scope, so a tool
   * registered into the agent's layer after its preset mounted is refused at
   * execution even though no composition audit saw it.
   */
  private installGuard(agent: Agent): void {
    // Registered through the AGENT's context: `tools.guard()` scopes the effect
    // to the caller's context, so the guard covers exactly this agent and
    // unwinds with it.
    agent.ctx.get('tools')?.guard(execution => this.guardExecution(agent, execution))
  }

  /** Deny one execution whose definition carries an authority this session's role forbids. */
  private guardExecution(agent: Agent, execution: Readonly<ToolExecution>): string | undefined {
    const definition = agent.ctx.get('tools')?.get(execution.name, agent)
    const role = this.roleOf(agent.session)
    const denied = deniedAuthority(role, definition?.authority)
    return denied === undefined ? undefined : authorityDenialMessage(execution.name, denied, role)
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
    for (const denied of deniedReadRoots(policy)) {
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
