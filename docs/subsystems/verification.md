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
  /** One passing result per active check, in the standard's check order. */
  readonly results: readonly CheckResult[]
  /** Epoch milliseconds of the certificate commit. */
  readonly recordedAt: number
}
```

The five durable events (`verification/standard`, `verification/relaxation`, `verification/run`, `verification/certificate`, `verification/directive`) are catalogued in [persistence-catalog.md](../persistence-catalog.md#verificationstandard--log-only); every executed run is recorded, and a certificate covers only a run whose results all passed. The `verification` session projection serves the current standard with its covering certificate.

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
