# Completion standards

English | [中文](verification.zh.md)

Types shared by the completion-standard service and its consumers. A standard is one executable check inventory per goal; a certificate is the durable record of one fully passing run under a stated isolation level, and goal completion of a measured goal is admitted only with a covering certificate. The [verification seams Agent Note](../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md) owns the design; this page records the exact fields from [`packages/verification/verification/src/types.ts`](../../packages/verification/verification/src/types.ts).

## Identity and checks

`StandardId` and `CheckId` are [branded ids](core.md#branded-ids). A caller mutates one exact standard revision through `StandardRef`; every durable mutation increments the revision.

```ts type-equiv
/** Compare-and-set identity for one exact standard revision. */
interface StandardRef {
  /** Stable standard identity. */
  readonly id: StandardId
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
}
```

A check states the outcome the task must establish and how a validator runs it; the implementer never reads it.

```ts type-equiv
/** One executable check: the outcome it establishes and how a validator runs it. */
interface StandardCheck {
  /** Lower-kebab-case identity unique inside the owning standard. */
  readonly id: CheckId
  /** Outcome the task must establish, stated without the implementation. */
  readonly outcome: string
  /** Validator-owned execution instruction (command line or procedure). */
  readonly run: string
}
```

## Certificates

A certificate covers exactly one standard revision and carries one passing result per active check, plus the isolation the run executed under: `none` (shared filesystem reach), `process` (in-process read policy only), or `host` (separate operating-system account or host).

```ts type-equiv
/** Durable record of one fully passing run of the current standard. */
interface VerificationCertificate {
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
```

The five durable events (`verification/standard`, `verification/relaxation`, `verification/run`, `verification/certificate`, `verification/directive`) are catalogued in [persistence-catalog.md](../persistence-catalog.md#verificationstandard--log-only); every executed run is recorded with the verdict its results and its caller's tamper report decide, and a certificate covers only a run whose verdict is `passed`. The `verification` session projection serves the current standard with its covering certificate.

## The read barrier

Types the read barrier decides from, declared by [`packages/verification/read-barrier`](../../packages/verification/read-barrier/README.md). A session's role decides what it may read; a reservation is what makes a session the implementer.

```ts type-equiv
/**
 * Authority a session holds against the barrier. `implementer` is denied every
 * directory the barrier owns; `validator` and `unrestricted` are denied
 * nothing, and `unrestricted` is what a session holds without a reservation.
 * Which directories a role may read is a security invariant, never a
 * deployment choice.
 */
type ReadBarrierRole = 'implementer' | 'validator' | 'unrestricted'
```

```ts type-equiv
/**
 * Capability seam that refused one read. Each member names a seam that opens
 * paths and can therefore decide a refusal in the operation that opens them.
 */
type ReadBarrierCapability = 'fs' | 'shell' | 'subprocess' | 'terminal'
```

```ts type-equiv
/** Inputs that select the barrier policy for one capability call. */
interface ReadBarrierRequest {
  /** Calling session; its reservation decides the role. Absent means an agentless call. */
  session?: Session
}
```

```ts type-equiv
/**
 * The barrier's complete decision inputs for one session, resolved once per
 * capability call. `denied` lists every directory the role may not read,
 * canonicalized only at the moment of the containment test.
 */
interface ReadBarrierPolicy {
  /** Authority the calling session holds. */
  readonly role: ReadBarrierRole
  /** The barrier's own validator-owned root, always the first denied directory. */
  readonly root: string
  /** Every denied directory: the root, the configured extras, and the registered ones. */
  readonly denied: readonly string[]
}
```

The barrier appends one `read-barrier/denied` event per refusal, catalogued in [persistence-catalog.md](../persistence-catalog.md#read-barrierdenied--log-only).

```ts type-equiv
/**
 * One refusal, as the `read-barrier/denied` session event carries it. The path
 * is already in the log inside the model's own `tool/call` arguments, so the
 * record adds evidence and no new disclosure.
 */
interface ReadBarrierDenial {
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
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcompletionstandards--completionstandardservice"></a>

### `ctx.completionStandards` — `CompletionStandardService`

Completion-standard service (`ctx.completionStandards`) backed exclusively by the owning session log.

```ts cordis-catalog
/**
 * Read the current standard for one exact live agent.
 * @param agent - owning live agent.
 * @returns a fresh view or `undefined` when no standard is current.
 * @throws {@link VerificationError} when the agent is not the registry's live instance.
 */
get(agent: Agent): StandardView | undefined

/**
 * Author the executable standard for one goal before implementation begins.
 * A current standard for a different goal is superseded; authoring twice
 * for the same goal is rejected — grow it with {@link extend} instead.
 * @param agent - owning live agent.
 * @param request - goal identity and the initial non-empty check inventory.
 * @returns the authored view at revision one.
 */
author(agent: Agent, request: AuthorStandardRequest): StandardView

/**
 * Add checks to the current standard. Existing checks and relaxations are
 * preserved exactly; the mutation invalidates any prior certificate.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param checks - one or more checks to append.
 * @returns the extended view.
 */
extend(agent: Agent, ref: StandardRef, checks: readonly StandardCheck[]): StandardView

/**
 * Remove one check with recorded evidence that its stricter form is
 * unsatisfiable. The mutation invalidates any prior certificate.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param checkId - active check to relax.
 * @param evidence - non-empty unsatisfiability evidence.
 * @returns the relaxed view.
 */
relax(agent: Agent, ref: StandardRef, checkId: CheckId, evidence: string): StandardView

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
recordRun( agent: Agent, ref: StandardRef, isolation: CertificateIsolation, results: readonly CheckResult[], evidence: RunEvidence, ): RunOutcome

/**
 * Record one root-cause failure aggregation for the implementer. The
 * directive is the durable channel across the read barrier: it names where
 * the candidate is weak without revealing individual checks.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param request - root cause and actionable detail.
 */
issueDirective(agent: Agent, ref: StandardRef, request: DirectiveRequest): void

/**
 * Read the certificate covering exactly the current standard revision.
 * @param agent - owning live agent.
 * @returns the valid certificate, or `undefined` when none covers the current revision.
 */
certified(agent: Agent): VerificationCertificate | undefined

/**
 * Require a valid certificate for one goal before admitting its completion.
 * The orchestrator policy calls this immediately before `ctx.goals.complete()`.
 * @param agent - owning live agent.
 * @param goalId - goal whose completion is being admitted.
 * @returns the covering certificate.
 * @throws {@link VerificationError} without a current standard for the goal or a covering certificate.
 */
assertCertified(agent: Agent, goalId: GoalId): VerificationCertificate
```

Types: [Agent](core.md)

Source: [`packages/verification/verification/src/index.ts:215`](../../packages/verification/verification/src/index.ts)

<a id="ctxreadbarrier--readbarrierservice"></a>

### `ctx.readBarrier` — `ReadBarrierService`

The read-barrier service (`ctx.readBarrier`). It owns the validator root, the per-session reservations that make a session an implementer, and the denied set every enforcing capability resolves against.

```ts cordis-catalog
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
reserve(agent: Agent): string

/**
 * Deny one more directory for as long as the registration lives, so a plugin
 * that owns a directory contributes it as an effect instead of a deployment
 * repeating it in configuration.
 * @param path - absolute or `~`-prefixed directory to deny.
 * @returns the registration's disposer.
 */
protect(path: string): () => void

/**
 * Record that one capability denies the barrier's directories in the
 * operation that opens paths, for as long as the registration lives. The
 * scope census reports a composed capability without one as `unenforced`, and
 * an isolation claim above `none` is refused while any such entry stands.
 * @param capability - the path-opening capability that enforces.
 * @returns the registration's disposer.
 */
enforce(capability: ReadBarrierEnforcedCapability): () => void

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
enforceByRefusal(capability: ReadBarrierEnforcedCapability): () => void

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
cannotEnforce(capability: ReadBarrierEnforcedCapability, reason: string): () => void

/**
 * Why one capability that cannot be confined in-process must not start for a
 * session, or `undefined` when it may. Every start of such a capability asks
 * here, so the refusal is decided in the operation that would open the paths.
 * @param capability - the capability about to start.
 * @param session - the session it would start for; absent for an agentless call.
 * @returns the exact refusal from {@link startRefusalMessage}, or undefined.
 */
startRefusal(capability: ReadBarrierEnforcedCapability, session: Session | undefined): string | undefined

/**
 * Record what a preset roster composed for one agent. A declared role
 * outranks a reservation, because only the composition knows what was
 * actually mounted; a preset that declares none leaves the reservation to
 * decide. The roster is the only caller: nothing a session itself runs may
 * raise its own role.
 * @param agent - the agent whose composition was resolved.
 * @param composition - the preset id and the role it declared, if any.
 */
declareComposition(agent: Agent, composition: ReadBarrierComposition): void

/**
 * Resolve the complete policy for one capability call. A session whose preset
 * declared a role holds that role; otherwise a session holding a reservation
 * is the implementer, and every other session and every agentless call is
 * unrestricted.
 * @param request - the calling session, when there is one.
 * @returns the role, the barrier root, and every denied directory.
 */
resolve(request: ReadBarrierRequest = {}): ReadBarrierPolicy

/**
 * One entry per path-opening capability: `denied-at-executor` when the
 * capability registered enforcement — through {@link enforce}, or through
 * {@link enforceByRefusal} under a `process` or `host` claim — `unenforced`
 * when it is composed without one, and `not-composed` when this composition
 * does not have it. An `unenforced` entry carries the reason whenever a
 * registration supplied one.
 * @returns the enforcement census in the fixed capability order.
 */
enforcementCensus(): ReadBarrierEnforcementEntry[]

/**
 * Decide whether the policy denies reading one resolved target. Each denied
 * directory is canonicalized through the filesystem seam immediately before
 * its containment test, so an ancestor symlink swapped since the target was
 * resolved is caught. A target whose containment cannot be decided is denied.
 * @param policy - the policy {@link resolve} returned for this call.
 * @param target - the already-resolved target the caller is about to read.
 * @returns true when the read must be refused.
 */
async denies(policy: ReadBarrierPolicy, target: FsTarget): Promise<boolean>

/**
 * Append the durable record of one refusal. The barrier owns the write so
 * every seam that refuses produces the same evidence.
 * @param session - the refused session, whose log receives the record.
 * @param policy - the policy that refused, supplying the role and root.
 * @param capability - the seam that refused the read.
 * @param target - the refused target, supplying the model-facing path.
 * @returns the payload exactly as it was appended.
 */
recordDenial( session: Session, policy: ReadBarrierPolicy, capability: ReadBarrierCapability, target: FsTarget, ): ReadBarrierDenial
```

Types: [Agent](core.md) · [FsTarget](filesystem.md) · [Session](session.md)

Source: [`packages/verification/read-barrier/src/index.ts:291`](../../packages/verification/read-barrier/src/index.ts)
<!-- END GENERATED cordis-surface -->
