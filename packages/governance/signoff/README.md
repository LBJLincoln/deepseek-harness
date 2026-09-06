# @deepseek-ai/dsh-signoff

English | [中文](README.zh.md)

The attributable human gate as a session event. `ctx.signoffs.record(agent, …)` appends one `signoff/recorded` naming which of five transitions it closes, who the deployment says signed it, the digest of the artefact signed, and the pointers to what the signer had in view; folding the log is how any consumer learns whether a transition was signed. The plugin records a principal and never authenticates one, and nothing it writes reaches a model request. Decision record: [the attributable-decisions Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md).

## Config

```yaml
- id: signoff
  name: '@deepseek-ai/dsh-signoff'
  config:
    maxEvidence: 8           # evidence pointers one record may carry
    maxEvidenceRefChars: 512 # length of one pointer's kind or ref
```

| Field | Meaning |
|---|---|
| `maxEvidence` (required) | Positive maximum number of `{ kind, ref }` pointers one record may carry. A record above it is refused, so one signature cannot grow a session log without limit. |
| `maxEvidenceRefChars` (required) | Positive maximum length in characters of one pointer's `kind` or `ref`. |

Both are deployment choices: what a client's audit trail is expected to cite differs per engagement, and a record that cannot be bounded is a log-growth path.

## Service contract

`record(agent, { transition, principal, artefactSha256, evidence })` validates every field, appends `signoff/recorded` to the agent's session, and returns the detached record. `latest(agent, transition)` folds the agent's own log for the newest record of one transition; the exported pure `latestSignoff(events, transition)` folds any log a consumer already holds — `@deepseek-ai/dsh-program` reads a program session that way, without an injection.

`transition` is the closed union `spec-freeze | relaxation | review-acceptance | release | training-data-release`, the five transitions the [Village note](../../../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md) states never complete without a signature. `principal` is `{ kind: 'human', id, displayName? }`, an identity string the deployment's identity provider supplies. `artefactSha256` is the lowercase 64-hex digest of whatever was signed — a frozen spec, a certificate, a merged head, a dataset manifest — and `ARTEFACT_SHA256` is the exported pattern it must match. `evidence` is the bounded list of `{ kind, ref }` pointers to what the signer saw.

Every refusal carries `SIGNOFF_INVALID_RECORD` and names the field at fault: an unknown transition, a digest that is not lowercase 64-hex, a principal that is not a person or names nobody, an empty display name, an evidence pointer that names nothing or exceeds the configured length, a list above `maxEvidence`, and a second signature of one transition over an artefact the session already signed another one for.

## The record

| Event | Written when | Payload |
|---|---|---|
| `signoff/recorded` | Once per signature, at `record()` | `transition`, `principal`, `artefactSha256`, `evidence` |

The [persistence catalog](../../../docs/persistence-catalog.md) carries the payload's declaration. A transition may be signed again — a re-signature after new evidence — and the newest record is the one `latest` answers with; a second record naming another artefact is refused, because the two would disagree about what the transition covered.

### Invariant companion

`@deepseek-ai/dsh-signoff/invariant` checks what the log can show: the transition is one of the five, the digest is lowercase 64-hex, the principal is a person with a non-empty id and no empty display name, every evidence pointer names a kind and a ref, and no session signs one transition over two artefacts.

It cannot check anything outside the log: that the principal is the person named, that the digest addresses a real artefact, that the evidence refs resolve, or that the signer saw them. Making the id binding is the deployment's identity provider's job; this package states who the deployment said signed.

## Reading a signature from another package

`@deepseek-ai/dsh-program` gates both of its `requireSignoff` transitions on records in the program session: `spec-freeze` before it opens a program, `release` before `program/end { outcome: released }`. The program id is derived from the spec digest, so a caller addresses the program session — and signs into it — before the program exists. Neither gate injects this service; both fold the persisted log through `latestSignoff`.

## Model Experience

None, as a signature is a durable record for humans and supervising processes; `signoff/recorded` is not a surface event, no prompt section or tool schema mentions it, and no model request is made or changed when one is appended.

#### KV Cache effect

Independent: the request surface is neither extended nor rewritten, so an already-reusable prefix stays reusable.

## Known Limitations and Deferred Work

- **The principal is recorded, never authenticated** — nothing verifies that the id names the person who signed, so a deployment whose identity provider is a configuration string has an audit trail naming a role rather than a person. A signed-message or IdP method belongs with an identity provider this repository does not have.
- **The note's `role`, `method`, and `scope` fields are absent** — the [four-goal note](../../../.agents/notes/proposed/architecture/2026-09-05-four-goal-workflows.md) names a signer role vocabulary, a signing method, and a stage scope on `SignoffRecord`; they wait for a stage vocabulary and an identity provider to fill them, so a consumer needing the signer's role reads it from the transition and its own context.
- **No authority over who may sign** — as with `budget/caps`, any writer of a session's log can record a signature; the companion bounds what a second record may say, it does not decide who may write one.
- **Only `dsh-program` reads a signature** — the relaxation, review-acceptance, and training-data-release transitions have no in-repository consumer yet, so recording one is durable evidence that nothing currently gates on.
