# verification/ — executable completion standards

English | [中文](README.zh.md)

Durable completion standards for an agent session's goal, owned independently of the validator, orchestrator, and policy consumers that use them. A goal measured by a standard completes against a certificate from a fully passing run, not against a self-report; standard state is part of the owning session log. What the checks execute is the validator's own, and the barrier decides which directories an implementer session may not read; each path-opening capability enforces that decision where it opens paths.

| Package | Role | ctx key |
|---|---|---|
| [`verification/`](verification/README.md) | Completion-standard state, certificates, directives | `ctx.completionStandards` |
| [`read-barrier/`](read-barrier/README.md) | The validator-owned directory tree, per-run reservations, and the per-session deny decision | `ctx.readBarrier` |
| [`command-verification/`](command-verification/README.md) | Human-facing `/verification` evidence ledger | — |
