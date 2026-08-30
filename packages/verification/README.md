# verification/ — executable completion standards

English | [中文](README.zh.md)

Durable completion standards for an agent session's goal, owned independently of the validator, orchestrator, and policy consumers that use them. A goal measured by a standard completes against a certificate from a fully passing run, not against a self-report; standard state is part of the owning session log.

| Package | Role | ctx key |
|---|---|---|
| [`verification/`](verification/README.md) | Completion-standard state, certificates, directives | `ctx.completionStandards` |
