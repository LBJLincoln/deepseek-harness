# governance/ — attributable decisions and the terms a transcript is held under

English | [中文](README.zh.md)

The governance plugins put two facts a client auditor needs into the session log itself, where a replay reproduces them. A signoff records one attributed human decision — which transition it closes, who the deployment says signed it, the digest of the artefact signed, and the pointers to what the signer had in view — so the five transitions that need a signature (spec freeze, relaxation of a security or compliance check, review acceptance, release, training-data release) leave a record a consumer folds rather than a claim a caller makes. Data-use terms pin the contract one session's transcript is held under at creation — client, agreement, purposes, residency, retention, redaction profile — and may afterwards be narrowed but never widened, so a transcript recorded for delivery cannot become training material after the fact. Neither plugin authenticates anything and neither reaches a model request; both record, and the [attributable-decisions Agent Note](../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md) owns the design rationale.

| Package | Role | ctx key |
|---|---|---|
| [`signoff/`](signoff/README.md) | Signoffs: one `signoff/recorded` per signed transition, naming the principal, the artefact digest, and the evidence in view | `ctx.signoffs` |
| [`data-use/`](data-use/README.md) | Data-use terms: `dataUse/terms` pinned at session start from the deployment's default terms, narrowable and never widened | `ctx.dataUse` |
