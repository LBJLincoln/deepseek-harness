# @deepseek-ai/dsh-data-use

English | [中文](README.zh.md)

The contract a session's transcript is held under, pinned to the session log at creation. Every session this plugin sees start carries one `dataUse/terms` naming its client, agreement, purposes, residency, retention, and redaction profile before its first turn, so an export, a curator, or a client auditor reads the terms from the log rather than from the deployment that produced it. A later pin may narrow the terms and may never widen their purposes. Nothing here reaches a model request. Decision record: [the attributable-decisions Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md).

## Config

```yaml
- id: data-use
  name: '@deepseek-ai/dsh-data-use'
  config:
    clientId: acme-industrial
    agreementId: msa-2026-11
    purposes:
      - delivery
      - evaluation
    residency: eu-west
    retentionDays: 90
    redactionProfile: client-v3
```

| Field | Meaning |
|---|---|
| `clientId` (required) | The client every session of this deployment belongs to. Cards hash it rather than showing it. |
| `agreementId` (required) | The agreement the terms come from. |
| `purposes` (required) | Non-empty subset of `delivery`, `training`, `evaluation`, each named once, in the order the agreement lists them. |
| `residency` (required) | Region the transcripts may live in. |
| `retentionDays` (required) | Positive whole number of days a transcript is kept. |
| `redactionProfile` (required) | Versioned redaction profile an export applies. |

Every field is required and validated when the plugin loads: a deployment that cannot state its terms cannot pin them, and terms that admit nothing (`purposes: []`) or name no client would be a record no consumer could act on. A rejection carries `DATA_USE_INVALID_CONFIG`.

## What a session start pins

The service listens on `agent/session-start` and appends `dataUse/terms` with the configured defaults to any session that carries none. A resumed session already carries the terms it was created under, so it keeps them — the record states creation-time terms, not the deployment's current configuration.

A composition without this plugin produces sessions with no terms at all; `termsOf(events)` answers `undefined` for them, and a consumer that requires terms decides for itself what to do with an unpinned session.

## Service contract

`pin(agent, terms)` validates the terms, refuses a widening, appends `dataUse/terms`, and returns the record as it was appended. `defaultTerms` is the deployment's configured terms, as every fresh session is pinned with. `termsOf(events)` is the exported fold consumers read; `widenedPurposes(standing, candidate)` names every purpose one candidate adds, and is what both the refusal and the invariant companion decide on.

A pin whose `purposes` admit anything the session's standing terms do not is refused with `DATA_USE_TERMS_PINNED` and appends nothing, because widening after the fact would turn a delivery-only transcript into training material. Every other field may be re-pinned freely — a shortened retention, a stricter profile, a corrected residency. An unusable field carries `DATA_USE_INVALID_TERMS`.

## The record

| Event | Written when | Payload |
|---|---|---|
| `dataUse/terms` | At `agent/session-start` on an unpinned session, and at every accepted `pin()` | `clientId`, `agreementId`, `purposes`, `residency`, `retentionDays`, `redactionProfile` |

The [persistence catalog](../../../docs/persistence-catalog.md) carries the payload's declaration. The newest record is the session's terms.

### Invariant companion

`@deepseek-ai/dsh-data-use/invariant` checks what the log can show: every record names a client, an agreement, a residency, and a redaction profile, keeps a positive whole-day retention, and lists a non-empty set of known purposes each named once; and no record widens the purposes the same session already carries.

It cannot check anything outside the log: that the client and agreement exist, that the residency is where the transcript actually lives, or that any export applied the redaction profile named.

## Model Experience

None, as the terms are a durable record for exports, curators, and auditors; `dataUse/terms` is not a surface event, no prompt section or tool schema mentions it, and no model request is made or changed when one is appended.

#### KV Cache effect

Independent: the request surface is neither extended nor rewritten, so an already-reusable prefix stays reusable.

## Known Limitations and Deferred Work

- **Terms are recorded, not enforced** — no exporter reads them yet, so a `training`-ineligible session is not withheld from a training export by anything in this repository; the pin is a durable claim until the exporter integration and the shipped redaction rules land beside it.
- **`purposes` is the only monotone field** — residency, retention, and the redaction profile may be re-pinned in any direction, because only widening purposes turns a transcript recorded under one agreement into material for another.
- **One set of terms per deployment** — the configured defaults are deployment-wide, so a process serving two clients pins both their sessions with the first client's terms unless every session is re-pinned by hand; per-agreement composition is the deployment's job.
- **No authority over who may pin** — as with `budget/caps`, any writer of a session's log can record terms; the companion bounds what a later record may say, it does not decide who may write one.
