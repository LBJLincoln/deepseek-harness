# enterprise-intake: the coordinators answer the owner's requests and propose the queue's next tickets

English | [中文](README.zh.md)

The [program](../../../../../packages/improvement/program/README.md) that `pnpm run enterprise:intake` runs when the owner has committed a [request](../../../../../data/enterprise/requests/README.md) no ticket answers yet, or when the [ticket queue](../../../../../data/enterprise/tickets/README.md) runs low: one department per request, which turns it into exactly one ticket, and one department per refilling Program Departments coordinator of the [roster](../../../../../data/enterprise/README.md), which reads its own package group and commits up to `--max-tickets` proposed tickets; every department is staffed by a coordinator and measured by admission, the deterministic rules that decide which proposals enter the queue. [`scripts/enterprise-intake.ts`](../../../../../scripts/enterprise-intake.ts) is the command, [`scripts/enterprise-intake-admission.ts`](../../../../../scripts/enterprise-intake-admission.ts) holds the rules, and the Agent Notes on [the coordinators' intake](../../../../../.agents/notes/implemented/architecture/2026-09-28-coordinators-intake.md) and [the owner's requests](../../../../../.agents/notes/implemented/architecture/2026-09-28-owner-requests.md) record why the intake is built this way.

## What one intake does

1. It reads the owner's requests: every Markdown file under `data/enterprise/requests/` but the README pair, in file-name order, keeping those no ticket answers yet, a ticket answering a request when its `source.path` is the request's file. A request whose first non-blank line is not `# <title>` is refused at once with that reason and gets no department.
2. It counts the open tickets: every ticket under `data/enterprise/tickets/` whose latest ticket line in `data/enterprise/ledger.jsonl` names neither a shipped commit nor a `reject` verdict; an absent ledger leaves every ticket open. At or above `--min-open` (default 8) the queue needs no refill, and when no titled request waits either, it writes `result.json` with `outcome: "nothing-needed"` under its record directory and exits 0.
3. It selects the departments, independently of each other: one per waiting request, up to `--max-requests` (default 2) in file-name order, staffed by the coordinators in turn from the one with the fewest open tickets; and, below `--min-open`, one per refilling coordinator, the seats `--coordinators` names or the `--count` (default 2) with the fewest open tickets. A coordinator counts every open ticket it owns or whose scope or source lies in its package group, and roster order breaks ties.
4. It clones the committed tip into a scratch directory, adds a second worktree of the same commit as the clean checkout the checks run in, and installs it (`--install`, default `pnpm install --offline --frozen-lockfile`). Both leave out `data/` apart from `data/enterprise/` (`--exclude`), and every worktree the program adds from the clone leaves out the same.
5. It runs the program through [`driver.ts`](driver.ts), the requests' departments first, each on the composition's route with the composition's caps as its budget. A request's department is keyed `request-<file name>`, is created with the objective [`requestObjective`](../../../../../scripts/enterprise-intake.ts) writes, which carries the request verbatim, and commits one ticket at `.intake/<key>.json` whose seat is the one whose code or document the request is about, whose source is the request's file and title line, and whose priority is `0`. A coordinator's department is created with the objective [`coordinatorObjective`](../../../../../scripts/enterprise-intake.ts) writes and commits its proposals at `.intake/<seat>.json`. Each department is certified by one check: `enterprise-intake.ts admit` over the file it committed, with `--request` naming the request for a request's department, which passes when admission admits at least one proposal. A department whose every proposal was refused is told why and gets one more round. The integration merges the proposal files and is gated on a clean tree.
6. It admits every department's committed proposals once more, the requests' departments first and then the coordinators' in seat order, so ids and duplicates are decided across departments, and writes each admitted ticket to the queue. A department that did not certify has none admitted.
7. It writes its record, with what became of every request it took up, and appends one function line per department that reached the route.

## Admission

A proposal is admitted only when every rule holds, in this order; a refused proposal takes no id, so the admitted ones continue the queue without a gap.

| Rule | Refusal code |
|---|---|
| It is one of its department's first `--max-tickets` proposals, or the first one for a request's department. | `over-limit` |
| It answers a request exactly when its department is that request's: a request's department files a ticket whose `source` is the request's file and title line and whose `priority` is `0`, and no other department takes a request as its source. | `request` |
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
| `result.json` | The target commit, the open count, the outcome (`nothing-needed`, `ran`, `route-limit`), the program's id and outcome, the `decisions` no person made (the spec freeze and the release, each naming the machine principal `daliesk-enterprise-intake` and `decidedBy: "the enterprise intake, run <id>"`, over the plan's SHA-256), per request taken up its department and its result, per refilling coordinator its status, tokens, seconds, admitted ids and refusals, the route limit, and the session ids |
| `<key>.json` | One department, `request-<name>.json` for a request's and `<seat>.json` for a refilling coordinator's: the proposals it committed, and every verdict with the checks of its own that ran, their exit codes and their output tails |
| `sessions/<session id>.jsonl` | Every session log of the program: the ledger, each department, the integration |

A request's `result` is `admitted` with the `ticket` that answers it; `refused` with the `reason`, which is every reason admission gave, or that the department ended without committing a ticket, or that the first line is not `# <title>`; or `unanswered` when its department was cut before it finished and nothing it committed was refused for a reason of its own. A refused or unanswered request is taken up again by the next intake, so an owner who edits a refused request gets a new attempt; `pnpm run enterprise:requests` reads these results back.

Credential-shaped strings are masked in every file before it is written, and `result.json` counts the masks per pattern. Each department that reached the route gets one line in `data/enterprise/ledger.jsonl`, naming the coordinator who staffed it: `{ "type": "function", "at", "shift", "seat", "division", "function": "intake", "target": { "commit" }, "outcome", "evidence": { "path" }, "seconds" }`, with `outcome` `pass` when a ticket of its was admitted, `error` when the department was cut before it finished (a usage limit, a spent budget), and `fail` otherwise, `at` the moment its session ended, `evidence.path` its `<key>.json`, and `shift` the value of `--shift` or the intake's own id. A department the wall stopped before its first request gets no line.

## The two compositions

[`cordis.yml`](cordis.yml) is the keyless half: the departments run on the `cli-mock` route [`intake-llm.ts`](intake-llm.ts) registers, which reads a script naming, per department key, either a proposals file under [`scripted/`](scripted) to commit or the product's usage-limit notice to refuse with. [`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) is the real one: the scripted route disabled, the operator's Claude Code installation inserted with `sonnet` at medium effort, and each department's caps raised to 4,000,000 tokens over 1,500 s.

## Running it keyless

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/enterprise-intake.e2e.ts
```

The e2e is [`examples/headless-agent/tests/enterprise-intake.e2e.ts`](../../enterprise-intake.e2e.ts). It runs the command over repositories minted from [`seed/`](seed), a two-coordinator roster and a one-ticket queue: once at `--min-open 1`, which needs nothing; once with both coordinators, which admits one ticket of each and refuses a proposal whose check already passes and one that repeats the queued ticket's source; once at `--min-open 1` with four requests, which needs no refill but answers the first two titled requests, admitting one at priority `0` and refusing the other for its priority, refuses the one without a title line, leaves the fourth for a later intake, and reads the four states back through `pnpm run enterprise:requests`; and once with the first coordinator refused under the usage-limit notice, which stops the run with no request from the second.

## Running it for real

From a checkout whose tip is committed, with the `claude` CLI installed and logged in:

```sh
pnpm run enterprise:intake -- --count 2 --max-tickets 3 --scratch "$SCRATCH"
```

It writes the admitted tickets, the record and the ledger lines into the checkout and removes its scratch directory unless `--keep` is given; committing them is the operator's act.
