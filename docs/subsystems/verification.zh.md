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
  /** One passing result per active check, in the standard's check order. */
  readonly results: readonly CheckResult[]
  /** Epoch milliseconds of the certificate commit. */
  readonly recordedAt: number
}
```

五个持久事件（`verification/standard`、`verification/relaxation`、`verification/run`、`verification/certificate`、`verification/directive`）编目于 [persistence-catalog.md](../persistence-catalog.md#verificationstandard--log-only)；每次执行的运行都会被记录，而证书只覆盖结果全部通过的运行。`verification` 会话投影提供当前标准及其覆盖证书。

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
 * durable `verification/run` event carrying all of its results; a fully
 * passing run then commits a certificate, while any failure returns the
 * failing subset the validator aggregates into a {@link issueDirective}
 * directive.
 * @param agent - owning live agent.
 * @param ref - expected current revision.
 * @param isolation - isolation level the run executed under.
 * @param results - exactly one result per active check, any order.
 * @param evidence - executor of the checks and the workspace digest it covered.
 * @returns the certificate, or the failing results.
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

Source: [`packages/verification/verification/src/index.ts:211`](../../packages/verification/verification/src/index.ts)
<!-- END GENERATED cordis-surface -->
