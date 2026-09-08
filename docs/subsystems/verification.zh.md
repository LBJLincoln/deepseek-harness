# 完成标准

[English](verification.md) | 中文

完成标准服务及其消费方共享的类型。一个标准是每个 goal 一份可执行的检查清单；一张证书是在声明的隔离级别下一次完全通过运行的持久记录，被度量的 goal 只有在存在覆盖证书时才被准许完成。[验证 seam Agent Note](../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md) 承载设计；本页记录 [`packages/verification/verification/src/types.ts`](../../packages/verification/verification/src/types.ts) 中的精确字段。

## 标识与检查

`StandardId` 与 `CheckId` 是[带品牌的 id](core.md#branded-ids)。调用方通过 `StandardRef` 改动一个精确的标准修订；每次持久改动都会递增修订号。

```ts type-equiv
/** Compare-and-set identity for one exact standard revision. */
interface StandardRef {
  /** Stable standard identity. */
  readonly id: StandardId
  /** Positive revision; every durable mutation increments it. */
  readonly revision: number
}
```

一个检查陈述任务必须建立的结果以及验证者如何运行它；实现者从不读取它。

```ts type-equiv
/** One executable check: the outcome it establishes and how a validator runs it. */
interface StandardCheck {
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
```

## 加权用例

一个检查可以逐用例采样候选程序的行为，而不是归结为一个退出码。持久日志携带引用；用例正文存放在验证者的预留目录中，`sha256` 把两者绑定。

```ts type-equiv
/**
 * The durable reference to one check's case bodies. The bodies live in the
 * validator's reservation, never in the session log; `sha256` binds the two.
 */
interface CheckCasesRef {
  /** Number of cases the bodies hold. */
  readonly count: number
  /** Sum of every case weight. */
  readonly weightTotal: number
  /** SHA-256 hex of the canonical case bodies. */
  readonly sha256: string
}
```

```ts type-equiv
/** One behavioural sample of a check: what the candidate is fed and what it must produce. */
interface CheckCase {
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
```

```ts type-equiv
/**
 * Channel one case compares. `exit` is the candidate's exit code, `stdout` and
 * `stderr` its captured bytes, and `tree` the work tree under the check's
 * `treeScope` as the case left it.
 */
type CheckCaseChannel = 'exit' | 'stdout' | 'stderr' | 'tree'
```

规范化器集合是封闭的：每一项都会放宽“相等”的判定，因此扩展它是一次设计决定，而不是部署选择。每一项都是对通道字节的纯粹幂等函数，按比较器给定的顺序应用；[`packages/verification/verification`](../../packages/verification/verification/README.md#weighted-cases) 陈述每一项的作用。

```ts type-equiv
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
type CheckCaseNormalizer =
  | 'crlf'
  | 'trailing-whitespace'
  | 'blank-lines'
  | 'iso8601-timestamps'
  | 'temp-paths'
  | 'json-canonical'
```

带用例的检查，其结果携带裁定所依据的用例统计；一次运行把这些统计汇总为一个加权通过率。

```ts type-equiv
/** Case tally of one executed check, present exactly for a check that carries cases. */
interface CheckCaseResults {
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
```

```ts type-equiv
/** Weighted pass rate of one run, summed over the checks that carry cases. */
interface RunParity {
  /** Summed weight of every passing case of the run. */
  readonly weightPassed: number
  /** Summed weight of every case of the run. */
  readonly weightTotal: number
}
```

`parity` 随 `verification/run` 事件一起记录，且不构成任何认证：一张证书仍要求每个活动检查的每个用例都通过。跨越到实现者的指令只携带聚类，绝不携带用例正文、期望摘要或捕获输出。

```ts type-equiv
/**
 * One failure cluster of a directive: the failed cases of one check that
 * disagreed on the same channels and ended the same way. It carries counts and
 * weights only, never a case body, an expected digest, or captured output.
 */
interface DirectiveCluster {
  /** Check whose cases the cluster groups. */
  readonly checkId: CheckId
  /** Channels that disagreed, in the canonical `exit`, `stdout`, `stderr`, `tree` order. */
  readonly channels: readonly CheckCaseChannel[]
  /** Cases in the cluster. */
  readonly count: number
  /** Summed weight of the cluster's cases. */
  readonly weight: number
}
```

## 证书

一张证书恰好覆盖一个标准修订，为每个活动检查携带一条通过结果，并记录运行所处的隔离级别：`none`（共享文件系统可达）、`process`（仅进程内读取策略）或 `host`（独立的操作系统账户或主机）。

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

五个持久事件（`verification/standard`、`verification/relaxation`、`verification/run`、`verification/certificate`、`verification/directive`）编目于 [persistence-catalog.md](../persistence-catalog.md#verificationstandard--log-only)；每次执行的运行都会被记录，并带上由其结果与调用方的篡改报告决定的裁定，而证书只覆盖裁定为 `passed` 的运行。`verification` 会话投影提供当前标准及其覆盖证书。

## 读取屏障

读取屏障据以判定的类型，由 [`packages/verification/read-barrier`](../../packages/verification/read-barrier/README.md) 声明。会话的角色决定它可以读取什么；预留是使会话成为实现者的原因。策略在被拒集合旁携带会话自己的工作区，二者之间有先后：作为该工作区严格祖先的被拒目录，拒绝该祖先子树的其余部分并完整保留该工作区——正是这一点让 runner 可以对一个 cell 拒绝其自身目录之上的一切。

```ts type-equiv
/**
 * Authority a session holds against the barrier. `implementer` and `judge` are
 * denied every directory the barrier owns and every declared tool authority —
 * the implementer so it cannot read the standard it is measured against, the
 * judge so it cannot reach the audited session's log or the check instructions
 * behind the evidence it was handed. `validator` and `unrestricted` are denied
 * nothing, and `unrestricted` is what a session holds without a reservation.
 * Which directories and authorities a role may hold is a security invariant,
 * never a deployment choice.
 */
type ReadBarrierRole = 'implementer' | 'judge' | 'validator' | 'unrestricted'
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
  /** Every denied directory: the root, the configured extras, the registered ones, and those registered for this session. */
  readonly denied: readonly string[]
  /**
   * The session's own workspace, granted whole. A denied directory that is a
   * STRICT ancestor of it denies the rest of that ancestor's subtree and leaves
   * this directory readable; a denied directory that IS this one, or that lies
   * inside it, denies as it would without the grant. Absent for a session
   * created without a cwd and for every agentless call, which grant nothing.
   */
  readonly granted?: string
}
```

屏障为每次拒绝追加一条 `read-barrier/denied` 事件，编目于 [persistence-catalog.md](../persistence-catalog.md#read-barrierdenied--log-only)。

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

## 盲审判官

监督 seam 的评判消费方所记录的类型，由 [`packages/verification/judge`](../../packages/verification/judge/README.md) 声明。判官会话以全新 id、没有 `parentSessionId`、也没有种子的方式创建，因此下面两条记录就是它评审了什么、判定了什么的全部持久说明；这两个事件编目于 [persistence-catalog.md](../persistence-catalog.md#judgesession--log-only)。 `ctx.judge.audit()` 接受一个 `JudgeRequest`——被审会话与尝试、该次尝试的工作区与摘要、任务提示词、结果，以及可能存在的证书——并回答一个 `JudgeAudit`，即下面的裁决记录加上产生它的判官会话与工作区。

```ts type-equiv
/**
 * What one audit decided about the attempt it read.
 *
 * `upheld` means the evidence supports the outcome the attempt recorded,
 * `overturned` that it contradicts it, and `inconclusive` that the evidence
 * cannot decide — which is also what a reply naming no verdict records, because
 * a judge that did not answer decided nothing.
 */
type JudgeVerdict = 'upheld' | 'overturned' | 'inconclusive'
```

```ts type-equiv
/**
 * One judge session's lineage assertion, as the `judge/session` event carries
 * it. It is written into the judge's own log, which is where the invariant
 * companion reads it: a verdict from a session with no such record, or from one
 * whose header carries a parent or a seed, is refused.
 */
interface JudgeSessionRecord {
  /** The judge session this record was appended to. */
  readonly judgeSessionId: SessionId
  /** Session whose attempt this judge audits. */
  readonly auditedSessionId: SessionId
  /** One-based attempt number under audit. */
  readonly attempt: number
  /** Workspace digest the judge's copy reproduced before the session was created. */
  readonly treeHash: string
}
```

```ts type-equiv
/** One reached verdict, as the `judge/verdict` event carries it. */
interface JudgeVerdictRecord {
  /** Session whose attempt was audited. */
  readonly auditedSessionId: SessionId
  /** One-based attempt number that was audited. */
  readonly attempt: number
  /** What the judge decided. */
  readonly verdict: JudgeVerdict
  /** The judge's own reason, bounded by the deployment's `rationaleMaxChars`. */
  readonly rationale: string
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
extend(agent: Agent, ref: StandardRef, checks: readonly AuthoredCheck[]): StandardView

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
 * @param request - root cause, actionable detail, and the failure clusters the detail was built from.
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

Source: [`packages/verification/verification/src/index.ts:278`](../../packages/verification/verification/src/index.ts)

<a id="ctxjudge--judgeservice"></a>

### `ctx.judge` — `JudgeService`

The blind judge (`ctx.judge`): one lineage-free judge session per audited attempt.

```ts cordis-catalog
/**
 * Audit one recorded attempt and record the verdict.
 *
 * The copy is made and checked BEFORE the session exists, so a judge is never
 * created over a tree that is not the one the attempt was measured on. The
 * session that follows has a fresh id, no parent, and no seed; its history is
 * the standing instruction, the task, and the evidence, in that order; and
 * its log carries the `judge/session` lineage assertion before the first turn
 * and the `judge/verdict` after it settles.
 * @param request - the audited session and attempt, its workspace and digest, the task, the results, and any certificate.
 * @returns the verdict, its rationale, and the judge session and workspace that produced them.
 * @throws {@link JudgeError} with `JUDGE_TREE_HASH_MISMATCH` when the copy does not reproduce the attempt's digest.
 */
async audit(request: JudgeRequest): Promise<JudgeAudit>
```

Source: [`packages/verification/judge/src/index.ts:268`](../../packages/verification/judge/src/index.ts)

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
 * The run directory one session already holds, without minting one. Every
 * consumer that reads a reservation asks here rather than through
 * {@link reserve}: reserving is what makes an unmarked session the
 * implementer, so a reader that reserved to find out would demote the very
 * session it was reading for.
 * @param agent - the agent whose session the reservation would belong to.
 * @returns the reserved directory, or `undefined` when the session holds none.
 */
reservation(agent: Agent): string | undefined

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

Source: [`packages/verification/read-barrier/src/index.ts:308`](../../packages/verification/read-barrier/src/index.ts)
<!-- END GENERATED cordis-surface -->
