# Enterprise roster

English | [中文](README.zh.md)

`roster.json` in this directory is a generated roster of 147 seat definitions for the enterprise proof of concept, a composition of role x division x specialization built from sources this repository actually defines, and each seat carries the evidence the committed session records and the ledger give it. [`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) generates it (`pnpm run roster`); [`scripts/harness-feed.ts`](../../scripts/harness-feed.ts) serves it with live session status recomputed (`pnpm run feed`). The roster is not the organisation of record: that is [the ledger](#the-ledger), `ledger.jsonl` beside it, one line per deliverable, and the program runs the feed serves on `GET /programs`. The work queue the stewards draw from is [tickets/](tickets/README.md), which [shifts](#shifts) work; the divisions that need no ticket perform their [functions](#functions) on a schedule.

## The honesty rule

147 is the count of seats this repository **defines** — every entry's `source` field names a real, existing repository path (a package README, a `verify-*.ts` script, a CI gate name, an Agent Note, a skill directory, a Proving Ground bench task environment, or a code-safety review knowledge pack), checked against disk when the roster is generated. Each division's count is a fixed quota (summing to 147); a division built from a variable pool takes exactly its quota from the pool, sorted, and the generator throws naming the division and the shortfall if the tree ever defines fewer sources than that. A definition is neither a running agent nor evidence that one ever ran: every seat composes from one of the two test-fixture presets (`coding`, `reviewing`) and names the route it is defined for, whether or not a session ever ran there.

## Evidence

Each seat carries `evidence: { sessions, lastSeen?, routesSeen }`, computed from the committed records under `data/proving-ground/*/sessions` and `data/code-safety/*/sessions` by the attribution rules in [`scripts/roster-evidence.ts`](../../scripts/roster-evidence.ts), the module the feed also uses, so the file and the feed agree over the same records:

- a program session in a code-safety review occupies the code-safety seat its id names: a department's session its department's integrator seat, the program's own session and its integration session the program lead;
- a session whose `environment/run` names a bench environment occupies the Proving Ground bench operator seat specialized in that environment;
- a delegated session occupies what its delegating session occupies.

A route a session shares with a seat is not evidence. `routesSeen` names the provider routes a seat's sessions ran on beside the `route` it is defined for, so a seat defined for `deepseek-official` whose sessions all ran on `claude-code` says exactly that. The top-level `evidence` names the records read (`records`), their session count (`sessions`), and the sessions per route across every session, attributed or not (`routes`). `unattributed` counts the sessions no rule places on a seat, by reason: `environment-not-seated`, `program-not-code-safety`, `program-member-not-seated`, `parent-not-recorded`, `no-seat-evidence`. No session is placed on a seat by default.

Each seat also carries `ledger: { lines, lastAt? }`: the ticket and function lines of `ledger.jsonl` naming its id, counted exactly by seat id and nothing looser. The top-level `ledger` names the file, the lines read, and the lines naming no roster seat (`unseated`). The committed file covers exactly the records `evidence.records` names and the first `ledger.lines` lines of the ledger, so it still reproduces from those inputs after more records are committed or more lines appended; `pnpm run roster` extends it to everything committed. The [roster-evidence Agent Note](../../.agents/notes/proposed/architecture/2026-09-22-roster-evidence-and-org-of-record.md) records the attribution decision and the audit behind it.

## Occupancy

A seat is occupied only by a recorded deliverable — a shipped or reviewed ticket, a gate run on a commit, a CI verdict, a published snapshot, a recorded session attributed to it — and nothing else counts: not its definition, its route, its skills, an edge, or a mention in a task. [`scripts/enterprise-ledger.ts`](../../scripts/enterprise-ledger.ts) is the one implementation of the rule, read by the roster generator, the functions runner and the deck's published data:

- `counts.occupied` counts the seats with at least one attributed session or one ledger line;
- `counts.active` counts the seats whose newest deliverable — a ledger line by its `at`, or an attributed session by the newest time its record logged — falls inside `activeWindow`, the 24 hours ending at `generatedAt`, both ends inclusive;
- a seat's `status` is `"active"` for exactly those seats and `"defined"` for every other one; live session status is the feed's, never written here.

The window is measured at `generatedAt` rather than at the moment of reading, so the file is a snapshot with a stated time: regenerated over unchanged inputs it is byte-identical, and every new ledger line or record changes the content, which restamps it and measures the window afresh. The [enterprise operating model Agent Note](../../.agents/notes/implemented/architecture/2026-09-28-enterprise-functions-and-occupancy.md) records why the rule counts deliverables and nothing else.

## The ledger

`ledger.jsonl` is appended and never rewritten, one JSON object per line. Two line types share it; a line without `type` is read as a ticket line, and a line that lacks a field its readers rely on (`at`, `seat`, `division`, and the type's own required fields) is skipped and reported by line number rather than guessed at.

- A **ticket line** is one ticket worked in one shift, appended by the [engine](#shifts) (`pnpm run enterprise -- shift`): `{ "type": "ticket", "at", "shift", "ticket", "seat", "division", "programId", "implementer", "model", "department": { "outcome", "sessionId" }, "checks": [{ "id", "ok" }], "review": { "verdict", "sessionId" }, "integration": { "outcome" }, "shipped": { "commit" } | null, "reason", "tokens", "seconds" }`. `department.outcome` is `certified`, `failed`, `blocked`, `abandoned`, `pending` or `halted`; `review.verdict` is `approve`, `reject` or `none`; `integration.outcome` is `merged`, `skipped`, `conflict`, `checks-failed`, `digest-mismatch` or `not-shipped`; `shipped.commit` is the commit on the branch that carries the ticket's change. A ticket's status is its latest line's: `shipped` when `shipped` names a commit, `rejected` when the review verdict is `reject`, and `halted` otherwise — a department that failed its acceptance, a change the integration could not assemble, or a shift the route's usage limit stopped (`halted: limit (resets at <instant>)` as the reason) — and a ticket with no line is `queued`. A ticket is closed once it is `shipped` or `rejected`; a `halted` ticket stays open, and a later shift works it again.
- A **function line** is one seat performing its function on one commit, appended by `pnpm run enterprise:functions`: `{ "type": "function", "at", "shift", "seat", "division", "function", "target": { "commit", "requested"? }, "outcome": "pass" | "fail" | "error", "evidence": { "path" } | { "url" }, "seconds" }`. `at` is the deliverable's own time — when the gate finished, or when the CI verdict was rendered — `outcome` is the gate's or the verdict's, `error` meaning no verdict could be obtained, and `evidence` is the output the seat wrote or the page it read the verdict from.

## Shifts

A shift is one run of the [enterprise-shift engine](../../examples/headless-agent/tests/fixtures/enterprise-shift/README.md) (`pnpm run enterprise -- shift --next <n> --push`): it clones the development branch tip, works the selected open tickets through the program workflow in their own worktrees, has an independent reviewer decide on each certified change, assembles the approved ones as one commit per ticket, recertifies them, and pushes them fast-forward to the branch together with the shift's own commit. That commit carries the shift's ledger lines and its record, so the branch is the only place a shift reports to.

`shifts/<UTC date>-<shift id>/` is the shift's record: `result.json` (the shift, the program report, every ticket's line with the reviewer's rationale, the halt), `manifest.json` (the base revision, the branch, the composition, every file's SHA-256) and `sessions/<session id>.jsonl` for every session the shift ran — the program ledger, each department, each review, the integration — with credential-shaped strings cut and counted. The record is written by the shift that ran it and never rewritten.

## Functions

`pnpm run enterprise:functions -- [--commit <sha>] [--shift <id>] [--branch <name>] [--only <divisions>] [--gate-timeout-ms <ms>] [--lock <file>]` ([`scripts/enterprise-functions.ts`](../../scripts/enterprise-functions.ts)) runs the functions of the divisions that need no ticket on the checked-out commit and appends one function line per seat whose function really ran. `--commit` must name the checkout, because the gates run on it; the shift defaults to the minute the run started (`2026-09-28T17-20Z`); `--only` narrows the run to some of `verification`, `judging`, `observatory`, `curation-data`; `--lock` names the file every heavy command on a shared machine takes through util-linux `flock`, and each gate then waits for it, holds it while it runs and releases it before the next gate, so a run on such a machine is started unwrapped with `--lock` rather than under an outer `flock`, which the gates could never acquire.

| Division | What runs | Evidence |
|---|---|---|
| Verification | Each of the 14 verifier seats runs the root package script its `source` names (`scripts/verify-md-links.ts` runs `pnpm run verify-md-links`), one after another; a gate that judges nothing without a build runs the script that builds and then verifies, as CI's static lane does (`verify-doc-site-fragments` runs `pnpm run docs:build:mpa`), and a script the root `package.json` lacks fails the run before anything is recorded. `pass` is exit 0, `fail` any other exit, `error` a spawn failure or the timeout (15 minutes unless `--gate-timeout-ms` says otherwise). | `functions/<shift>/<seat>.log`: the command, the commit, the outcome, and the last 12 KB of the gate's output with terminal styling and trailing whitespace removed. |
| Judging | The Branch CI run of the commit (`LBJLincoln/deepseek-harness`, `branch-ci.yml`, read from GitHub's REST API without credentials, through the proxy `HTTPS_PROXY` names when the environment names one — Node's `fetch` honours it only under `NODE_USE_ENV_PROXY=1`, which the package script sets, and a read that bypasses the proxy leaves the judges vacant with that hint; Node prints one `UNDICI-EHPA` experimental warning per process started under that variable, and the gates run without it): the newest completed run whose lanes rendered a verdict, so a run cancelled by a later push is passed over; when the commit has none, the branch's newest such run, whose commit then stands in `target.commit` with the asked-for commit in `target.requested`. Each job maps to the seat of the gate mode its log opens with (`run-gates: ci-static running …`); a job's `success` is `pass`, `failure` is `fail`, anything else `error`. A gate group a job's log shows by name maps to that group's seat: `ci-lint-contracts-ready` from the `lint and duplication` gate, `ci-snapshot` from `build` and `test:snapshot`, `ci-artifacts` from `build`, `publint`, `node-next types`, `built package invariants` and `built-bin smoke`, each `pass` when every gate passed, `fail` when one failed, `error` when one was skipped after a failed dependency, and no line when the log does not show them all. A verdict already in the ledger for the same seat and job is not appended again, so the command repeats safely. | The job's page on GitHub, as `evidence.url`; `at` is the job's completion time. |
| Observatory | The session-stats observer folds its package's real `sessionStats` projection unit (`@deepseek-ai/dsh-session-stats`) over every session of the committed records and any shift records under `shifts/`, and publishes [`telemetry.json`](#telemetry-and-scoreboard). | `telemetry.json`. |
| Curation & Data | The scorekeeper folds `foldSessionFacts` and `foldScoreboard` from `@deepseek-ai/dsh-scorekeeper` over the same sessions and refreshes [`scoreboard.json`](#telemetry-and-scoreboard). | `scoreboard.json`. |

If the API cannot be read, every judge stays vacant with the failure as its reason and the other divisions still run; the command exits non-zero only for a misconfiguration it cannot record — a missing roster, a commit that is not the checkout, an unknown flag.

The seats of these divisions that get no line are vacant, and the run names each with its reason:

| Seat | Why vacant |
|---|---|
| `judging-ci-primary`, `judging-ci-linux-primary` | Those lanes run on runner pools this fork does not have; Branch CI runs the static, coverage and consumers lanes only. |
| `judging-ci-windows-blocking`, `judging-ci-windows-complete`, `judging-ci-windows-observational` | No Windows runner runs on this fork. |
| `observatory-session-telemetry-observer` | The telemetry coordinator hands live session records to a backend sink; no backend runs over committed records. |
| `observatory-session-telemetry-otel-observer` | The OpenTelemetry backend exports to an OTLP collector; none is configured here. |
| `observatory-session-projection-observer` | The projection registry drives units over live sessions; the session-stats unit is folded directly instead. |
| `observatory-session-query-observer` | The session-query provider indexes a running session store; no store runs over committed records. |
| `observatory-otel-bench-fixture-observer` | A fixture the snapshot suite composes, not a function that runs on a commit. |
| The seven `curation-data-*-curator` seats | Note and fixture curation are ticketed work, not functions of this runner. |

## Telemetry and scoreboard

`telemetry.json` is the enterprise's own telemetry snapshot: `publishedAt`, the `shift` and `commit`, the `window` (the 24 hours before publication), the `records` read, `inWindow` and `total` figures — sessions, tokens (`input`, `output`, `cacheRead`, `cacheWrite`, `reasoning`, summed from the scorekeeper's efficiency facts) and the session-stats unit's `turns`, `steps`, `llmMs`, `toolMs` — `sessionsByTree`, `seats` (occupied and active in all and per division, by the occupancy rule over the ledger as it stands at publication, this run's earlier lines included), and `skipped`, the sessions the scorekeeper fold could not read. A session is in the window when its newest event is. `scoreboard.json` is the scorekeeper's fold over the same sessions: `computedAt`, `rows` (one per model route, attempt ladder, environment, isolation, implementer, preset, held-out split and district, with pass@1), `excluded`, `unstamped` (sessions no `environment/run` stamp names a cell for) and `skipped`. Both files are rewritten whole on every run.

## Live status

`GET /roster` on the running feed (`pnpm run feed`) recomputes every seat's session evidence, `counts.occupied`, `evidence` and `unattributed` over every run the feed discovers, live runs included, and sets each seat's `status` from those sessions alone: `active` while a session attributed to it belongs to a run still running, `certified` once one of its sessions logged a certificate event, and `failed` when its sessions ended without one. A seat no discovered session occupies reads `"defined"` on the feed whatever the file says, and the feed's `counts.active` counts running sessions, not the ledger's day; the file and the deck's published data are where the ledger counts. A fresh checkout with no runtime data reports the committed records' evidence and `active: 0` on the feed, which is the correct answer.

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

## Intake

When the [ticket queue](tickets/README.md) holds fewer open tickets than its minimum, the Program Departments coordinators refill it: `pnpm run enterprise:intake` runs one program whose departments are coordinators, each proposing tickets for its own package group, and files only the proposals its deterministic admission accepts. Every run writes a record under `intake/` and appends one function line per coordinator whose department ran to `ledger.jsonl`. The [enterprise-intake fixture](../../examples/headless-agent/tests/fixtures/enterprise-intake/README.md) documents the command, admission, and the record; the [Agent Note](../../.agents/notes/implemented/architecture/2026-09-28-coordinators-intake.md) records the decision.

## Code-safety specializations name a target, not an implemented scanner

This repository is TypeScript/JavaScript and ships no Java, Go, PHP, or mobile static-analysis tooling. Every department x specialization reviewer seat — including the four languages this repository does not implement a scanner for — cites its department's real review knowledge pack at `data/knowledge/code-safety/<department>/SKILL.md`; the specialization records what the seat is *for*, not a claim that a matching scanner already runs. Every reviewer, integrator, and the program lead also draws on that pack (and, for the lead, the cross-cutting review-method and severity-and-evidence packs) as a `code-safety/<id>` skill. Reviewers route to `openrouter`, cycling through the free-tier model ids this repository's own Proving Ground bench composes (`examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-openrouter.cordis.yml`), extracted by the generator rather than hardcoded. Read [`scripts/enterprise-roster.ts`](../../scripts/enterprise-roster.ts) for exactly which source grounds each department, and the [Agent Note](../../.agents/notes/implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md) for the full rationale.

## Publishing the deck

`pnpm run enterprise:publish` ([`scripts/enterprise-publish.ts`](../../scripts/enterprise-publish.ts)) regenerates the Command Deck's static enterprise data from the roster, the ledger and the ticket queue: `apps/command-deck/public/fixtures/roster.json`, a byte copy of `roster.json`, and `apps/command-deck/public/fixtures/enterprise.json`, the deck's Ledger tab — `asOf` (the newer of the roster's stamp and the last ledger line), the window, seats occupied and active per division, the day's tickets by status (queued from the queue, the rest from each ticket's newest line inside the window), the day's function runs newest first, and the ten latest shipped commits with the CI verdicts recorded on them, matched by commit prefix. Both files are a pure function of their inputs and are rewritten only when their bytes change, and [`deck-pages.yml`](../../.github/workflows/deck-pages.yml) republishes <https://lbjlincoln.github.io/deepseek-harness/> on every push of the deck's branch that touches `apps/command-deck/**`, which a changed fixture does.

## Regenerating

```sh
pnpm run enterprise:functions   # the functions of the ticketless divisions, appended to the ledger
pnpm run roster                 # the roster over every record and every ledger line
pnpm run enterprise:publish     # the deck's fixtures from the roster and the ledger
```

Each command is idempotent and safe on any later commit: the functions runner appends and never rewrites, records a CI verdict once, and leaves the judges vacant rather than failing when the API cannot be read; the generator reproduces `roster.json` byte for byte over unchanged inputs and restamps it only when a record, a source or a ledger line changed, a moved source failing it with its name before anything is written; the publisher rewrites a fixture only when its bytes change. The engine runs the three in this order after every shift.

## The cycle

[`scripts/enterprise-cycle.sh`](../../scripts/enterprise-cycle.sh) runs the enterprise once, in order: the coordinators' [intake](#intake) when fewer than `ENTERPRISE_MIN_OPEN` tickets (default 8) are open, committed and pushed first so the shift's clone sees the new tickets; one [shift](#shifts) over the `ENTERPRISE_TICKETS` (default 2) highest-priority open tickets with `--push`; the ticketless [functions](#functions) on the new tip, each heavy gate taking `ENTERPRISE_HEAVY_LOCK` (default `/tmp/dsh-heavy.lock`) only while it runs; `pnpm run roster` and `pnpm run enterprise:publish`; and one commit of the functions' lines and evidence, the roster and the deck data, pushed. Every step runs whatever an earlier step's outcome was, except that an intake the usage limit stopped (exit 3) skips the shift. The cycle exits 4 when another cycle holds its lock, 5 when the checkout has uncommitted changes to tracked files, and otherwise with the first failing step's code; its own commits carry `ENTERPRISE_COMMIT_TRAILERS` when set. The enterprise runs it every two hours from a dedicated checkout of the development branch, so no operator's working tree is written to.
