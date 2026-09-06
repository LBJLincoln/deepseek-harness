# Governance

English | [中文](governance.zh.md)

Two records a client auditor reads from the session log itself, and the export path that acts on them. [dsh-signoff](../../packages/governance/signoff) (`ctx.signoffs`) records one attributed human decision per signed transition; [dsh-data-use](../../packages/governance/data-use) (`ctx.dataUse`) pins the contract terms one session's transcript is held under at creation; [dsh-curator](../../packages/governance/curator) (`ctx.curator`) exports transcripts only under a redaction profile and only for a purpose their terms admit. The two records are log-first: nothing holds state a replay does not reproduce, nothing authenticates anything, and nothing reaches a model request. The [attributable-decisions Agent Note](../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md) and the [curator Agent Note](../../.agents/notes/proposed/architecture/2026-09-06-curator.md) own the design rationale, and the [Village note](../../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md) owns why they gate the client district.

Source: [`packages/governance/signoff/src/index.ts`](../../packages/governance/signoff/src/index.ts), [`packages/governance/data-use/src/index.ts`](../../packages/governance/data-use/src/index.ts), [`packages/governance/curator/src/index.ts`](../../packages/governance/curator/src/index.ts)

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

## Curated export

A curated export is the only path that redacts. `CuratedExportRequest` states which purpose the export serves, which profile it runs under, and where the lines and the manifest go; the exporter's own `rewardedOnly`, `includeHeldOut`, and `districts` filters pass through unchanged.

```ts type-equiv
/** What to export, under which terms, and where. */
interface CuratedExportRequest {
  /** Purpose the export serves; a session whose terms do not list it is withheld. */
  readonly purpose: DataUsePurpose
  /** Profile to apply; absent uses the configured `defaultProfile`, and an export with neither is refused. */
  readonly profile?: string
  /** Sessions to consider; absent considers every persisted session. */
  readonly sessions?: readonly SessionId[]
  /** Destination of the curated lines; closed exactly once by the wrapped exporter. */
  readonly sink: TrajectorySink
  /** Where the manifest is written; absent returns it in the report only. */
  readonly manifestPath?: string
  /** Write only trajectories whose reward outcome is `1`. */
  readonly rewardedOnly?: boolean
  /** Also write sessions whose environment is held out. */
  readonly includeHeldOut?: boolean
  /** Districts to export; absent applies the exporter's configured `withheldDistricts`. */
  readonly districts?: readonly string[]
}
```

A session is admitted only when its newest `dataUse/terms` lists the export's purpose, and a session carrying no terms at all is withheld by the same rule. Admitted sessions alone reach the exporter, so a withheld transcript is never folded, serialized, or written. An export that names no profile over a deployment with no `defaultProfile` is refused with `CURATOR_PROFILE_REQUIRED`; there is no configuration that exports unredacted.

Each written line is the `dsh-trajectory/1` record plus a `curation` block naming the profile that ran, the digest of its effective rules, the replacements this record received, and the residency its terms name. Every string in the record is redacted except the identifiers, the discriminants a reader switches on, and registered tool names; the [package README](../../packages/governance/curator/README.md) enumerates both sides.

```ts type-equiv
/** The block the curator adds to every record it exports. */
interface TrajectoryCuration {
  /** Always `true`: a record without a `curation` block was written by the unredacted exporter. */
  readonly redactionApplied: true
  /** The profile that ran and what it replaced in this record. */
  readonly redaction: TrajectoryRedaction
  /** Region the session's pinned terms name, so a sink can partition by it without reading the logs again. */
  readonly residency: string
}
```

The manifest is the export's durable artefact. An export spans many sessions and belongs to none, so it is a file rather than a session event.

```ts type-equiv
/** The durable record of one curated export, written beside its lines. */
interface ExportManifest {
  /** Manifest format tag. */
  readonly version: string
  /** Epoch milliseconds the export finished at. */
  readonly exportedAt: number
  /** Purpose the export serves, which every written session's terms admit. */
  readonly purpose: DataUsePurpose
  /** Profile id the export ran under. */
  readonly profile: string
  /** Lowercase SHA-256 hex over that profile's effective rules in order. */
  readonly profileSha256: string
  /** Lines written. */
  readonly records: number
  /** Sessions withheld, by reason. */
  readonly withheld: ExportWithheld
  /** Replacements over the whole export, per rule id; every rule of the profile is listed, including those that matched nothing. */
  readonly ruleHits: Readonly<Record<string, number>>
  /** Lowercase SHA-256 hex over the written lines in order, which is the digest of the sink's bytes. */
  readonly recordsSha256: string
  /** Record format of every written line. */
  readonly trajectoryFormat: TrajectoryFormat
}
```

```ts type-equiv
/** Sessions one export did not write, by the reason each was withheld. */
interface ExportWithheld {
  /** Withheld because their environment is held out. */
  readonly heldOut: number
  /** Withheld because their stamp's district is not one this export writes. */
  readonly districts: number
  /** Withheld because their pinned terms do not admit the export's purpose, or because they carry none. */
  readonly terms: number
}
```

## What the log can and cannot show

The [invariant companions](invariants.md) own the two relations the log carries: a session never signs one transition over two artefacts, and never widens the purposes it already carries. Every field is checked for a form a reader can act on — a known transition, a lowercase 64-hex digest, a person with a non-empty id, evidence pointers that name something, a non-empty set of known purposes each named once, a positive whole-day retention.

Nothing outside the log is checkable here, and neither companion claims it: that the principal is the person named, that the digest addresses a real artefact, that the evidence refs resolve, that the client and agreement exist, or that any export applied the redaction profile named. Making an identity binding is the deployment's identity provider's job. The complete event declarations are in the [persistence log event catalog](../persistence-catalog.md).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcurator--curatorservice"></a>

### `ctx.curator` — `CuratorService`

Curated export (`ctx.curator`): redacted, terms-gated trajectory export with a manifest.

```ts cordis-catalog
/**
 * Export the sessions whose pinned terms admit the purpose, redacted under
 * one profile, and write the manifest that accounts for every session the
 * request considered.
 * @param request - the purpose, the profile, the sessions, the sink, and the exporter's own filters.
 * @returns the manifest with the counts behind it, including the sessions withheld by terms and the ones that could not be read.
 * @throws {@link CuratorError} `CURATOR_PROFILE_REQUIRED` when neither the
 *   request nor the configuration names a profile, and `CURATOR_PROFILE_UNKNOWN`
 *   when the request names one this deployment did not configure. Nothing is
 *   written and the sink is not touched in either case.
 */
async export(request: CuratedExportRequest): Promise<CuratedExportReport>
```

Source: [`packages/governance/curator/src/index.ts:70`](../../packages/governance/curator/src/index.ts)

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
