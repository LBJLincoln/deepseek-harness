# enterprise-intake: the coordinators propose the queue's next tickets

English | [中文](README.zh.md)

The [program](../../../../../packages/improvement/program/README.md) that `pnpm run enterprise:intake` runs when the [ticket queue](../../../../../data/enterprise/tickets/README.md) runs low: one department per Program Departments coordinator of the [roster](../../../../../data/enterprise/README.md), each reading its own package group and committing up to `--max-tickets` proposed tickets, and each measured by admission, the deterministic rules that decide which proposals enter the queue. [`scripts/enterprise-intake.ts`](../../../../../scripts/enterprise-intake.ts) is the command, [`scripts/enterprise-intake-admission.ts`](../../../../../scripts/enterprise-intake-admission.ts) holds the rules, and the [Agent Note](../../../../../.agents/notes/implemented/architecture/2026-09-28-coordinators-intake.md) records why the intake is built this way.

## What one intake does

1. It counts the open tickets: every ticket under `data/enterprise/tickets/` whose latest ticket line in `data/enterprise/ledger.jsonl` names neither a shipped commit nor a `reject` verdict; an absent ledger leaves every ticket open. At or above `--min-open` (default 8) it writes `result.json` with `outcome: "nothing-needed"` under its record directory and exits 0.
2. It selects the coordinators: the seats `--coordinators` names, or the `--count` (default 2) with the fewest open tickets, a coordinator counting every open ticket it owns or whose scope or source lies in its package group, and roster order breaking ties.
3. It clones the committed tip into a scratch directory, adds a second worktree of the same commit as the clean checkout the checks run in, and installs it (`--install`, default `pnpm install --offline --frozen-lockfile`). Both leave out `data/` apart from `data/enterprise/` (`--exclude`), and every worktree the program adds from the clone leaves out the same.
4. It runs the program through [`driver.ts`](driver.ts): one department per coordinator on the composition's route, each created with the objective [`coordinatorObjective`](../../../../../scripts/enterprise-intake.ts) writes and the composition's caps as its budget, and each certified by one check: `enterprise-intake.ts admit` over the file it committed at `.intake/<seat>.json`, which passes when admission admits at least one proposal. A department whose every proposal was refused is told why and gets one more round. The integration merges the proposal files and is gated on a clean tree.
5. It admits every department's committed proposals once more, in department order, so ids and duplicates are decided across departments, and writes each admitted ticket to the queue. A department that did not certify has none admitted.
6. It writes its record and appends one function line per coordinator whose department reached the route.

## Admission

A proposal is admitted only when every rule holds, in this order; a refused proposal takes no id, so the admitted ones continue the queue without a gap.

| Rule | Refusal code |
|---|---|
| It is one of the coordinator's first `--max-tickets` proposals. | `over-limit` |
| With the queue's next id assigned, [`validateTickets`](../../../../../scripts/enterprise-tickets.ts) accepts it beside every queued ticket. | `invalid` |
| Its `seat` owns its `scope`: among the roster seats whose `source` covers every scope entry, the ones whose covered prefix is longest. A `README.md` source covers its directory, a directory covers itself, a file covers only itself. | `owner` |
| No open or shipped ticket, and no ticket admitted earlier in the same intake, has the same `source.path` and `source.anchor`. | `duplicate` |
| It carries a check of its own: an acceptance command other than `pnpm run typecheck`, `pnpm run doc-sync` and a `--coverage` run, which pass before and after a change by the queue's rules. | `no-own-check` |
| Each check of its own, run with `bash -c` in the clean checkout, exits non-zero within `--check-timeout-ms` (default 120000). | `passes-before`, `timeout` |

A check runs in its own process group with every variable whose name carries `KEY`, `SECRET`, `TOKEN` or `PASSWORD` and the whole `GIT_CONFIG_*` set removed from its environment; a check that changed the clean checkout is recorded and the checkout is reset before the next one. Guard commands are not run at admission: the engine runs every acceptance command when it verifies the implemented ticket.

## The usage limit

[`route-wall.ts`](route-wall.ts) is composed beside the program. The first turn of any session that ends in the LLM seam's `QUOTA` failure — the classification the Claude Code route gives the product's usage-limit notice — walls the process: every later step is rejected before a request is assembled, and the session's goal is blocked under `route-limit`, which the program records as the department's blocking code. The department the refusal cut spends one more validation of what it committed; every department after it is blocked on its first step without a request reaching the route. The intake then admits what certified departments committed, records the refusal with the reset the notice states, and exits 3.

## The record and the ledger

Every intake writes `data/enterprise/intake/<UTC date>-<hhmmss>-<suffix>/`:

| File | What it holds |
|---|---|
| `result.json` | The target commit, the open count, the outcome (`nothing-needed`, `ran`, `route-limit`), the program's id and outcome, per coordinator its status, tokens, seconds, admitted ids and refusals, the route limit, and the session ids |
| `<seat>.json` | One coordinator's department, the proposals it committed, and every verdict with the checks of its own that ran, their exit codes and their output tails |
| `sessions/<session id>.jsonl` | Every session log of the program: the ledger, each department, the integration |

Credential-shaped strings are masked in every file before it is written, and `result.json` counts the masks per pattern. Each coordinator whose department reached the route gets one line in `data/enterprise/ledger.jsonl`: `{ "type": "function", "at", "shift", "seat", "division", "function": "intake", "target": { "commit" }, "outcome", "evidence": { "path" }, "seconds" }`, with `outcome` `pass` when a ticket of its was admitted, `error` when its department was cut before it finished (a usage limit, a spent budget), and `fail` otherwise, `at` the moment its department's session ended, `evidence.path` its `<seat>.json`, and `shift` the value of `--shift` or the intake's own id. A coordinator whose department the wall stopped before its first request gets no line.

## The two compositions

[`cordis.yml`](cordis.yml) is the keyless half: the departments run on the `cli-mock` route [`intake-llm.ts`](intake-llm.ts) registers, which reads a script naming, per coordinator seat, either a proposals file under [`scripted/`](scripted) to commit or the product's usage-limit notice to refuse with. [`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) is the real one: the scripted route disabled, the operator's Claude Code installation inserted with `sonnet` at medium effort, and each department's caps raised to 4,000,000 tokens over 1,500 s.

## Running it keyless

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/enterprise-intake.e2e.ts
```

The e2e is [`examples/headless-agent/tests/enterprise-intake.e2e.ts`](../../enterprise-intake.e2e.ts). It runs the command over repositories minted from [`seed/`](seed), a two-coordinator roster and a one-ticket queue: once at `--min-open 1`, which needs nothing; once with both coordinators, which admits one ticket of each and refuses a proposal whose check already passes and one that repeats the queued ticket's source; and once with the first coordinator refused under the usage-limit notice, which stops the run with no request from the second.

## Running it for real

From a checkout whose tip is committed, with the `claude` CLI installed and logged in:

```sh
pnpm run enterprise:intake -- --count 2 --max-tickets 3 --scratch "$SCRATCH"
```

It writes the admitted tickets, the record and the ledger lines into the checkout and removes its scratch directory unless `--keep` is given; committing them is the operator's act.
