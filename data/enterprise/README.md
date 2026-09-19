# Enterprise roster

English | [中文](README.zh.md)

`roster.json` in this directory is a generated, 147-agent roster for the enterprise proof of concept: a composition of role x division x specialization built from sources this repository actually defines. [`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) generates it (`pnpm run roster`); [`scripts/harness-feed.ts`](../../scripts/harness-feed.ts) serves it with live status overlaid (`pnpm run feed`).

## The honesty rule

147 is the count of agents this repository **defines** — every entry's `source` field names a real, existing repository path (a package README, a `verify-*.ts` script, a CI gate name, an Agent Note, a skill directory, or a recorded bench scenario), checked against disk when the roster is generated. It is never the count of agents currently running. `counts.active` in the committed file is always `0`, and every agent's `status` is always `"defined"`.

Live status comes only from `GET /roster` on the running feed (`pnpm run feed`), which overlays the committed roster with what real session data on disk says right now: an agent is `active` while a discovered run has a session mapped to it and still running, `certified` once that session logs a certificate-shaped event, and `failed` if its run ended without one. An agent with no matching session keeps `"defined"`. A fresh checkout, with no `.proving-ground/`, `data/proving-ground/`, or `.code-safety/` runtime data yet, reports `active: 0` for all 147 — that is the correct, honest answer, not a bug.

## Divisions

| Division | Purpose |
|---|---|
| `harness-core` | Stewards the product API spine: session, prompt assembly, tools, agent, the agent loop, LLM routing, and subagent delegation. |
| `proving-ground` | Operates the harness against real bench scenarios recorded under `examples/headless-agent/tests`. |
| `verification` | Runs the `verify-*` scripts that gate changed source before it ships. |
| `judging` | Decides pass or fail at each named CI gate. |
| `curation-data` | Curates the Agent Note corpus and fixture datasets, and keeps score of usage for the observatory. |
| `program-departments` | Coordinates cross-cutting package groups as departments of one program. |
| `code-safety` | Reviews target repositories for secrets, injection, access, data, dependency, and platform risk, per language. |
| `knowledge` | Keeps the repository's reusable skills current and discoverable. |
| `governance` | Owns process standards: labels, stacking, dependencies, vendoring, licensing, and translation pairing. |
| `observatory` | Watches session telemetry, token spend, and query surfaces across runs. |

## Code-safety specializations name a target, not an implemented scanner

This repository is TypeScript/JavaScript and ships no Java, Go, PHP, or mobile static-analysis tooling. Every department x specialization reviewer seat — including the four languages this repository does not implement a scanner for — cites its department's real grounding package (credentials, shell, filesystem, storage, license verification, or sandbox policy); the specialization records what the seat is *for*, not a claim that a matching scanner already runs. Read [`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) for exactly which source grounds each department, and the [Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md) for the full rationale.

## Regenerating

```sh
pnpm run roster
```

The generator is idempotent: run against an unchanged tree, it reproduces `roster.json` byte for byte. A diff after a clean regeneration means a cited source moved; the generator's own error, thrown before it writes anything, names which one.
