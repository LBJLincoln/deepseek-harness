# Enterprise roster

English | [中文](README.zh.md)

`roster.json` in this directory is a generated roster of 147 seat definitions for the enterprise proof of concept, a composition of role x division x specialization built from sources this repository actually defines, and each seat carries the evidence the committed session records give it. [`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) generates it (`pnpm run roster`); [`scripts/harness-feed.ts`](../../scripts/harness-feed.ts) serves it with live status and evidence recomputed (`pnpm run feed`). The roster is not the organisation of record: that is the ledger of program runs the feed serves on `GET /programs`, one entry per recorded program run with its departments, their certificates, the integration's verdict and the sign-offs.

## The honesty rule

147 is the count of seats this repository **defines** — every entry's `source` field names a real, existing repository path (a package README, a `verify-*.ts` script, a CI gate name, an Agent Note, a skill directory, a Proving Ground bench task environment, or a code-safety review knowledge pack), checked against disk when the roster is generated. Each division's count is a fixed quota (summing to 147); a division built from a variable pool takes exactly its quota from the pool, sorted, and the generator throws naming the division and the shortfall if the tree ever defines fewer sources than that. A definition is neither a running agent nor evidence that one ever ran: every seat composes from one of the two test-fixture presets (`coding`, `reviewing`) and names the route it is defined for, whether or not a session ever ran there.

## Evidence

Each seat carries `evidence: { sessions, lastSeen?, routesSeen }`, computed from the committed records under `data/proving-ground/*/sessions` and `data/code-safety/*/sessions` by the attribution rules in [`scripts/roster-evidence.ts`](../../scripts/roster-evidence.ts), the module the feed also uses, so the file and the feed agree over the same records:

- a program session in a code-safety review occupies the code-safety seat its id names: a department's session its department's integrator seat, the program's own session and its integration session the program lead;
- a session whose `environment/run` names a bench environment occupies the Proving Ground bench operator seat specialized in that environment;
- a delegated session occupies what its delegating session occupies.

A route a session shares with a seat is not evidence. `counts.occupied` counts the seats at least one session occupies. `routesSeen` names the provider routes a seat's sessions ran on beside the `route` it is defined for, so a seat defined for `deepseek-official` whose sessions all ran on `claude-code` says exactly that. The top-level `evidence` names the records read (`records`), their session count (`sessions`), and the sessions per route across every session, attributed or not (`routes`). `unattributed` counts the sessions no rule places on a seat, by reason: `environment-not-seated`, `program-not-code-safety`, `program-member-not-seated`, `parent-not-recorded`, `no-seat-evidence`. No session is placed on a seat by default.

The committed file's evidence covers exactly the records `evidence.records` names, so it still reproduces from those records after more are committed; `pnpm run roster` extends it to every committed record. The file's `status` is always `"defined"` and `counts.active` is always `0`. The [roster-evidence Agent Note](../../.agents/notes/proposed/architecture/2026-09-22-roster-evidence-and-org-of-record.md) records the decision and the audit behind it.

## Live status

`GET /roster` on the running feed (`pnpm run feed`) recomputes every seat's evidence, the counts, `evidence` and `unattributed` over every run the feed discovers, live runs included, and sets each seat's `status`: `active` while a session attributed to it belongs to a run still running, `certified` once one of its sessions logged a certificate event, and `failed` when its sessions ended without one. A seat no session occupies keeps `"defined"`. A fresh checkout with no runtime data reports the committed records' evidence and `active: 0`, which is the correct answer.

## Divisions

| Division | Purpose |
|---|---|
| `harness-core` | Stewards the product API spine: session, prompt assembly, tools, agent, the agent loop, LLM routing, and subagent delegation. |
| `proving-ground` | Operates the harness against real task environments in the Proving Ground bench fixture. |
| `verification` | Runs the `verify-*` scripts that gate changed source before it ships. |
| `judging` | Decides pass or fail at each named CI gate. |
| `curation-data` | Curates the Agent Note corpus and fixture datasets, and keeps score of usage for the observatory. |
| `program-departments` | Coordinates cross-cutting package groups as departments of one program. |
| `code-safety` | Reviews target repositories for secrets, injection, access, data, dependency, and platform risk, per language. |
| `knowledge` | Keeps the repository's reusable skills current and discoverable. |
| `governance` | Owns process standards: labels, stacking, dependencies, vendoring, licensing, and translation pairing. |
| `observatory` | Watches session telemetry, token spend, and query surfaces across runs. |

## Code-safety specializations name a target, not an implemented scanner

This repository is TypeScript/JavaScript and ships no Java, Go, PHP, or mobile static-analysis tooling. Every department x specialization reviewer seat — including the four languages this repository does not implement a scanner for — cites its department's real review knowledge pack at `data/knowledge/code-safety/<department>/SKILL.md`; the specialization records what the seat is *for*, not a claim that a matching scanner already runs. Every reviewer, integrator, and the program lead also draws on that pack (and, for the lead, the cross-cutting review-method and severity-and-evidence packs) as a `code-safety/<id>` skill. Reviewers route to `openrouter`, cycling through the free-tier model ids this repository's own Proving Ground bench composes (`examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-openrouter.cordis.yml`), extracted by the generator rather than hardcoded. Read [`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) for exactly which source grounds each department, and the [Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md) for the full rationale.

## Regenerating

```sh
pnpm run roster
```

The generator is idempotent: run against an unchanged tree and unchanged records, it reproduces `roster.json` byte for byte. A diff after a clean regeneration means a cited source moved or a record was committed; a moved source fails the generator, whose error names it, before anything is written.
