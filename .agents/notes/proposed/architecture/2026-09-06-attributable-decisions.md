# Agent Note: Attributable decisions and pinned data-use terms

Status: proposed

English | [中文](2026-09-06-attributable-decisions.zh.md)

## Problem

Two of the Village's governance promises have no producer in the log. The [Village note](2026-09-05-daliesk-village.md) states that five transitions — spec freeze, relaxation of a security or compliance check, review acceptance, release, and training-data release — never complete without a `signoff/recorded` naming the principal and the artefact hash, and that every client-district session carries `dataUse/terms` from creation; the [four-goal note](2026-09-05-four-goal-workflows.md) names the same two records `SignoffRecord` and `DataUseTerms`, puts them in blocking rollout item 3 beside `decidedBy` with an argument digest on approvals, and hangs the "Attributed human signer" roster row on them. Nothing writes any of the three today. `dsh-program` gates `requireSignoff` on a caller-supplied `spec.signoff` field its own README calls an assertion rather than a proof, the [program-ledger note](2026-09-06-program-ledger.md) defers the real record to this rollout, and the approval seam's `approval/decided` records an outcome with no principal and no statement of what was decided on. A client auditor reading a session log can therefore see that a program released, but not who released it, on what artefact, with what in view; and no export can tell an evaluation-only transcript from one a training run may consume.

## Proposal

Two plugins in a new `packages/governance/` group, plus two fields on the approval seam's existing audit pair. All three are log-first: nothing holds state a replay of the session log does not reproduce, and nothing reaches a model request.

### `@deepseek-ai/dsh-signoff`

`ctx.signoffs.record(agent, { transition, principal, artefactSha256, evidence })` appends one `signoff/recorded` to the agent's session and returns the detached record. `transition` is the closed union `spec-freeze | relaxation | review-acceptance | release | training-data-release` — the five transitions of the Village note's Governance section. `principal` is `{ kind: 'human', id, displayName? }`, an identity string the deployment's identity provider supplies: the plugin records a principal, it never authenticates one. `artefactSha256` is a lowercase 64-hex digest of whatever the signer signed — a frozen spec, a certificate, a merged head, a dataset manifest. `evidence` is a bounded list of `{ kind, ref }` pointers to what the signer had in view, bounded by `Config.maxEvidence` and `Config.maxEvidenceRefChars` so one record cannot grow a session log without limit. `latest(agent, transition)` folds the session's own log for the newest record of one transition, and the pure `latestSignoff(events, transition)` folds any log a consumer already holds.

The invariant companion rejects a malformed principal, a digest that is not lowercase 64-hex, an unknown transition, an evidence entry with an empty `kind` or `ref`, and a record whose `artefactSha256` differs from the digest the same session already recorded for the same transition. What it cannot check is everything outside the log: that the principal is the person named, that the digest addresses a real artefact, that the evidence refs resolve, or that the signer saw them.

`dsh-program` switches both `requireSignoff` gates to that record. Opening a program reads `signoff/recorded { transition: 'spec-freeze' }` from the program session — recorded by the caller through `ctx.signoffs` before `start`, because the program session id is derived from the spec digest and is therefore addressable before the program exists — and releasing reads `signoff/recorded { transition: 'release' }` before `program/end { outcome: released }`. `spec.signoff` shrinks to `{ artefactSha256 }`: the frozen artefact digest each record must match, with the principal now coming from the record rather than from the caller.

### `decidedBy` and `argumentsSha256` on approvals

`ApprovalRequest` gains the decided call's `arguments`. The approval seam digests them once as a lowercase SHA-256 over their canonical JSON encoding and writes that digest to both `approval/asked` and `approval/decided`, so a decision states what it decided on rather than only which call id it belonged to. `approval/decided` also gains `decidedBy?: { kind: 'human' | 'policy', id }`. The `approval/request` waterfall's answer widens from an outcome to an outcome or `{ outcome, decidedBy }`, so an answerer that knows who decided attributes its own answer while every existing answerer keeps returning a bare outcome. The service attributes the one decision it makes itself: the deterministic `'never'` policy records `{ kind: 'policy', id: 'approval-policy:never' }`.

The invariant companion rejects an `approval/decided` whose `argumentsSha256` differs from the digest its paired `approval/asked` recorded, including one carrying a digest its ask did not, and a `decidedBy` with an unknown `kind` or an empty `id`.

### `@deepseek-ai/dsh-data-use`

`Config` states the deployment's default terms — `clientId`, `agreementId`, `purposes` (a non-empty subset of `delivery | training | evaluation`), `residency`, `retentionDays`, and `redactionProfile`, the `DataUseTerms` fields of the four-goal note. The plugin appends one `dataUse/terms` at every `agent/session-start` whose session does not already carry one, so a session created by any composition that mounts it is pinned from creation and a resumed session keeps the terms it was created under. `ctx.dataUse.pin(agent, terms)` records narrower terms for one session; a pin that widens `purposes` beyond what the session already carries is refused with `DATA_USE_TERMS_PINNED` rather than appended, because widening after the fact would let a delivery-only session become a training corpus. `termsOf(events)` is the exported fold consumers read. The invariant companion rejects a second `dataUse/terms` that widens `purposes`.

## Alternatives considered

**One governance plugin holding both records.** Rejected: the two have different lifetimes and different consumers — a signoff is one attributed transition read by the program ledger and the release path, while data-use terms are a per-session pin read by the exporter and the curator — and a composition that needs terms without signatures is the ordinary client district.

**Authenticating the principal.** Rejected as out of scope and out of place: the harness has no identity provider (`dsh-anonymous-user-id` is deliberately anonymous), and a plugin that verified a signature would need a key store, a revocation path, and a clock. The record states who the deployment says signed; making that binding is the identity provider's job and the deployment's.

**Keeping the caller-supplied `spec.signoff` as the program's proof.** Rejected: it is the assertion the program README already flags, it carries a principal nothing can attribute, and it is invisible to the invariant companions and to every reader of the session log.

**Putting the arguments themselves on `approval/asked`.** Rejected: the ask deliberately carries a `callId` rather than duplicating a tool call the log already holds, and a full argument copy would put secrets a redaction profile has not seen into a second place. A digest states what was decided on without restating it.

**Deriving `decidedBy` inside the service from the answerer's registration.** Rejected: the registering plugin is not the principal — a UI answerer forwards a person's click and a machine answerer forwards a rule — so only the answerer can say which of the two decided.

**Enforcing data-use terms rather than recording them.** Rejected for this slice: the exporter's refusal to emit a `training`-ineligible session is the enforcement, and it belongs with the exporter's redaction profile, which is not in this slice.

## Acceptance criteria

- A `signoff/recorded` names its transition, principal, artefact digest, and evidence, and `latest` folds the newest record of one transition from the log; the companion rejects a malformed principal, a non-hex digest, an unknown transition, and a second record of one transition under a different artefact digest, each with a failing fixture.
- `dsh-program` with `requireSignoff: true` refuses `start` without a `spec-freeze` record on the program session and refuses release without a `release` one, each with `PROGRAM_SIGNOFF_REQUIRED`, and refuses a record whose artefact digest is not the spec's.
- Every `approval/decided` carries the digest of the arguments its `approval/asked` recorded, the `'never'` policy attributes itself as `policy`, and the companion rejects a decision whose digest differs from its ask's.
- A session created under a composition holding `dsh-data-use` carries `dataUse/terms` before its first turn, a pin narrowing `purposes` is recorded, and a pin widening them is refused and appends nothing.
- A Loader-booted e2e over one `cordis.yml` composing both plugins, the approval seam, a mock route, persistence, and the checkpoint policy shows all four facts in the durable log.

## Rollout

1. This slice: `dsh-signoff`, `dsh-data-use`, `decidedBy` and `argumentsSha256` on the approval pair, the program gate switch, and the governance e2e.
2. The exporter integration: `dataUse/terms` decides which sessions a trajectory or facts export may emit, beside the held-out and district withholding it already applies, and the redaction profile the terms name becomes the export's own.
3. The remaining `SignoffRecord` fields of the four-goal note — `role`, `method`, and `scope` — once a stage vocabulary and an identity provider exist to fill them.
4. Attributing answerers: a UI or ACP answerer that carries the deciding person's identity records `kind: 'human'`.

## Risks

- **A record is only as good as its principal.** Nothing authenticates the id, so a deployment whose identity provider is a configuration string has an audit trail that names a role rather than a person; the companion cannot tell the difference and the README says so.
- **Terms pinned at creation, enforced nowhere yet.** Until the exporter reads them, `dataUse/terms` is a durable claim rather than a barrier, and a composition that omits `dsh-data-use` produces sessions with no terms at all.
- **`purposes` is the only monotone field.** Residency, retention, and the redaction profile can be re-pinned freely; only widening `purposes` is refused, because it is the field whose widening turns a delivery transcript into training data.
- **Two writers on one session.** As with `budget/caps`, nothing states which orchestrator owns a session's terms or signatures; the companions bound what a second writer can do, they do not decide who may write.
