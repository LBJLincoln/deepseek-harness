# Governance

English | [中文](governance.zh.md)

Two records a client auditor reads from the session log itself. [dsh-signoff](../../packages/governance/signoff) (`ctx.signoffs`) records one attributed human decision per signed transition; [dsh-data-use](../../packages/governance/data-use) (`ctx.dataUse`) pins the contract terms one session's transcript is held under at creation. Both are log-first: nothing holds state a replay does not reproduce, nothing authenticates anything, and nothing reaches a model request. The [attributable-decisions Agent Note](../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md) owns the design rationale, and the [Village note](../../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md) owns why these two records gate the client district.

Source: [`packages/governance/signoff/src/index.ts`](../../packages/governance/signoff/src/index.ts), [`packages/governance/data-use/src/index.ts`](../../packages/governance/data-use/src/index.ts)

## Signed transitions

`SignoffTransition` is the closed set of transitions that never complete without a signature. Each is signed on the session that carries the transition, and the same session may sign several of them.

```ts type-equiv
/**
 * The five transitions that never complete without a signature: freezing a
 * spec, relaxing a security or compliance check, accepting a review, releasing
 * a deliverable, and releasing training data.
 */
type SignoffTransition =
  | 'spec-freeze'
  | 'relaxation'
  | 'review-acceptance'
  | 'release'
  | 'training-data-release'
```

`SignoffPrincipal` names the signer. Only a person signs a transition; a rule that decides is an [approval principal](approval.md#attribution), not a signature.

```ts type-equiv
/**
 * Who signed, as the deployment's identity provider names them. This package
 * records a principal and never authenticates one, so `id` is only as
 * attributable as the provider that supplied it.
 */
interface SignoffPrincipal {
  /** Only a person signs a transition; a rule that decides is not a signature. */
  readonly kind: 'human'
  /** Non-empty identity string from the deployment's identity provider. */
  readonly id: string
  /** Human-readable name for a reader of the log; non-empty when present. */
  readonly displayName?: string
}
```

`SignoffRecord` is both the `signoff/recorded` payload and what `record()` returns. `artefactSha256` addresses whatever was signed — a frozen spec, a certificate, a merged head, a dataset manifest — and `evidence` points at what the signer had in view, bounded by the plugin's configured limits.

```ts type-equiv
/** Payload of `signoff/recorded`. */
interface SignoffRecord {
  readonly transition: SignoffTransition
  readonly principal: SignoffPrincipal
  /** Lowercase 64-character SHA-256 hex of the artefact signed. */
  readonly artefactSha256: string
  /** What the signer had in view, bounded by the plugin's configured limits. */
  readonly evidence: readonly SignoffEvidence[]
}
```

```ts type-equiv
/** One pointer to something the signer had in view when they signed. */
interface SignoffEvidence {
  /** Non-empty kind of the referenced material, named by the recording caller. */
  readonly kind: string
  /** Non-empty reference the deployment can resolve: a path, a url, a session id, a digest. */
  readonly ref: string
}
```

Reading a signature is a fold: `latest(agent, transition)` over the agent's own log, or the pure `latestSignoff(events, transition)` over any log a consumer holds. [`dsh-program`](improvement.md) gates both its `requireSignoff` transitions that way, without injecting the service — `spec-freeze` before it opens a program, `release` before `program/end { outcome: released }`.

## Data-use terms

`DataUsePurpose` is what a transcript may serve. `DataUseTerms` is the `dataUse/terms` payload: the agreement the terms come from, the purposes it grants, and the residency, retention, and redaction profile an export must honour.

```ts type-equiv
/**
 * What a session's transcript may serve: `delivery` is the client work itself,
 * `training` admits it to a training corpus, `evaluation` admits it to
 * measurement. A session carries the subset its agreement grants.
 */
type DataUsePurpose = 'delivery' | 'training' | 'evaluation'
```

```ts type-equiv
/** Payload of `dataUse/terms`. */
interface DataUseTerms {
  /** The client the transcript belongs to; cards hash it rather than showing it. */
  readonly clientId: string
  /** The agreement these terms come from. */
  readonly agreementId: string
  /** Non-empty subset of {@link DataUsePurpose}, in the order the terms list them. */
  readonly purposes: readonly DataUsePurpose[]
  /** Region the transcript may live in. */
  readonly residency: string
  /** Positive number of days the transcript is kept. */
  readonly retentionDays: number
  /** Versioned redaction profile an export applies to this transcript. */
  readonly redactionProfile: string
}
```

The service appends the deployment's configured terms at `agent/session-start` to any session carrying none, so a session states its terms before its first turn and a resumed session keeps the terms it was created under. `pin(agent, terms)` records narrower terms; a pin admitting a purpose the standing terms do not is refused with `DATA_USE_TERMS_PINNED` and appends nothing, because widening after the fact turns a delivery transcript into training material. Every other field may be re-pinned in any direction. `termsOf(events)` is the fold consumers read.

## What the log can and cannot show

The [invariant companions](invariants.md) own the two relations the log carries: a session never signs one transition over two artefacts, and never widens the purposes it already carries. Every field is checked for a form a reader can act on — a known transition, a lowercase 64-hex digest, a person with a non-empty id, evidence pointers that name something, a non-empty set of known purposes each named once, a positive whole-day retention.

Nothing outside the log is checkable here, and neither companion claims it: that the principal is the person named, that the digest addresses a real artefact, that the evidence refs resolve, that the client and agreement exist, or that any export applied the redaction profile named. Making an identity binding is the deployment's identity provider's job. The complete event declarations are in the [persistence log event catalog](../persistence-catalog.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdatause--datauseservice"></a>

### `ctx.dataUse` — `DataUseService`

Data use (`ctx.dataUse`): the contract terms every session log states about itself.

```ts cordis-catalog
/**
 * Pin narrower terms to one session and return the record as it was appended.
 * @param agent - the agent whose session the terms hold.
 * @param terms - the terms to record; their purposes may not exceed the session's.
 * @returns the terms exactly as they were appended.
 * @throws {@link DataUseError} when a field is unusable, or when the pin would
 *   admit a purpose the session's standing terms do not.
 */
pin(agent: Agent, terms: DataUseTerms): DataUseTerms
```

Types: [Agent](core.md)

Source: [`packages/governance/data-use/src/index.ts:95`](../../packages/governance/data-use/src/index.ts)

<a id="ctxsignoffs--signoffservice"></a>

### `ctx.signoffs` — `SignoffService`

Signoffs (`ctx.signoffs`): attributed human decisions recorded in the session log.

```ts cordis-catalog
/**
 * Record one signature on the agent's session and return the detached record.
 * The record is validated before anything is appended, so a session log never
 * carries a signature this service refused.
 * @param agent - the agent whose session carries the transition being signed.
 * @param input - the transition, principal, artefact digest, and evidence the
 *   caller states; every field is validated before anything is appended.
 * @returns the record exactly as it was appended.
 * @throws {@link SignoffError} when a field cannot become a durable signature,
 *   or when the same session already signed this transition on another artefact.
 */
record(agent: Agent, input: SignoffRecord): SignoffRecord

/**
 * The newest signature of one transition on the agent's own session.
 * @param agent - the agent whose session log is folded.
 * @param transition - the transition whose newest signature is wanted.
 * @returns the last matching record, or `undefined` without one.
 */
latest(agent: Agent, transition: SignoffTransition): SignoffRecord | undefined
```

Types: [Agent](core.md)

Source: [`packages/governance/signoff/src/index.ts:86`](../../packages/governance/signoff/src/index.ts)
<!-- END GENERATED cordis-surface -->
