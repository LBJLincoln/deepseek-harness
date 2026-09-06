# Agent Note: The observatory, the page that publishes only what the logs prove

Status: proposed

English | [中文](2026-09-06-observatory.zh.md)

## Problem

The [Village note](2026-09-05-daliesk-village.md) fixes what a public leaderboard may say — rows before rankings, `% resolved` and `parity` under their own names, a tamper column, an executor, a composition digest or `pending`, cost only beside its pricing digest, Workshop and held-out sessions withheld — and the [competitive-baselines note](2026-09-06-competitive-baselines.md) adds the one property that makes an always-on claim falsifiable: a page that is current or visibly stale. Nothing renders any of it. The scorekeeper folds `ScoreboardRow` out of the persisted logs, but two of the honest columns have no field to read: the last run's verdict, which decides the tamper column, and the composition digest of the preset that ran, which decides whether a row may be attributed at all. A consumer that wanted a page today would recompute both from raw events beside the scoreboard, which is exactly the second producer of one number the publication rules exist to prevent.

## Proposal

Two changes. The scorekeeper gains the two facts the honest columns need and the row aggregates over them. A new package, `@deepseek-ai/dsh-observatory` (`ctx.observatory`), folds a snapshot over every persisted session, withholds what a deployment configures, and renders one self-contained HTML page and one JSON document from it.

### The two missing facts

`SessionFactsOutcome.tamper` is the last recorded run's verdict — `passed`, `failed`, or `tampered` — and `not-instrumented` when the log records no run at all, which is the same set of sessions the scoreboard already counts as `errors`. The verdict is a run payload field; every verdict but `tampered` follows from the results, so a fold that derived one from the results alone would silently publish a tampered run as failed.

`SessionFactsIdentity.compositionSha256` is the `compositionSha256` of the last `composition/manifest` in the session, absent when the log carries none. It is provenance, not outcome: it names the component set the agent had in play, which is what makes a row attributable to a harness variant rather than to the pair of a route and whatever the harness was that week.

`ScoreboardRow` aggregates both, plus the executor the page must show:

- `tampered` — sessions of the row whose last recorded run carried the `tampered` verdict. The page needs no second count: a row's `errors` is exactly its not-instrumented sessions, because a session with no run has no verdict.
- `compositionSha256` — present only when every session of the row states the same digest, absent when any session states none or two disagree. A digest that covered only part of a row would be worse than none.
- `certificateExecutors` — the distinct executors of the row's certified sessions, in first-appearance order, the same aggregate `pricingDigests` already is. Empty means the row certified nothing, one entry is the row's executor, and two mean the row's certificates disagree and no single executor may be printed beside its rate.

### The snapshot

`ctx.observatory.snapshot()` lists every persisted session header, folds the scoreboard through `ctx.scorekeeper.leaderboard()` over exactly those sessions, and partitions the rows. Withholding is a row operation because it is already a session operation: the scoreboard key carries `district` and `heldOut`, so every session of a withheld row is withheld and no withheld session can reach a published row. The snapshot counts what it dropped — rows and sessions, per reason, districts before the held-out split — rather than hiding it, because a missing row inflates every rate computed from the rest.

`foldedAt` is when the fold ran. `newestSessionAt` is the newest `createdAt` among the session headers the fold read, absent when the store held none; it is what the staleness rule reads and what the page prints. `refreshIntervalMs` travels in the snapshot so the rendered page names the cadence it was produced under rather than the cadence of whatever process happens to render it.

### The rendering

`render(snapshot, now)` is pure and returns both faces of one publication. When `now - newestSessionAt > staleAfterMs`, or when no session was folded at all, the page carries the staleness notice in place of every number and the JSON carries `stale: true` with no rows and no rankings. Otherwise the page is a table with one row per published scoreboard row: route, environment, district, isolation, certificate executor, composition digest or `pending`, held-out flag, tamper status, `resolved`, `parity`, and cost per certified session. `resolved` is the certificate rate under its own name and `parity` the weighted pass rate under its own name, in two columns that are never combined, never ranked across, and never rendered one as the other.

Cost is published only beside the digest that priced it and only when the row carries exactly one digest. This is fixed, not configurable: a row priced under two tables states a sum across pricing tables, and a deployment that could switch the rule off would publish that sum as a price. The page names its refresh interval and its fold time in both states.

The rankings section renders one entry per experiment result the snapshot carries: the plan digest, the two arm routes, the verdict, and the paired delta. A snapshot carrying none renders the sentence that no ranking is published without a paired experiment, which is the state of every deployment on this branch, because no session event carries an `ExperimentResult` — the experiment service writes its result to a sink and stamps its arms into the run `group`. A caller that ran an experiment hands its results to `snapshot({ experiments })`, and the snapshot keeps only those whose two arm routes both appear in the published rows, so a verdict about routes the page withholds or never folded publishes no ranking.

### Why not a projection

`ProjectionDefinition` is keyed by one session and driven by that session's committed events; `SessionProjectionCache` stores one checkpoint record per session. The observatory folds across every persisted session and has no session to attach to, so neither seam fits and the cached fold is a service that returns a snapshot. Village rollout item 7 has two halves: this page, which states its batch refresh interval, and the live projection, which stays proposed until a fold across sessions has a home — a store-level watermark and a durable snapshot record, not a per-session unit.

## Alternatives considered

**Fold the observatory's own rows from `SessionFacts` records.** The observatory would read each session through `ctx.scorekeeper.facts()`, withhold at the record, and call the exported `foldScoreboard`. Rejected: `foldScoreboard` takes the pass@k draws, which are the scorekeeper's configured tunable, so the observatory would either duplicate that config or fix a value the deployment already stated once. Row-level withholding gives the same partition because the row key already carries both withheld dimensions.

**Put the tamper verdict on the row as four counts.** One count per verdict reads well until `passed` and `failed` turn out to be `certified` and its complement, and `not-instrumented` to be `errors`. Rejected as three restatements of columns the row already carries; `tampered` is the only count the row cannot derive.

**Publish a row's cost across two pricing digests with both digests named.** Rejected: naming both digests does not make the sum meaningful, and a reader comparing two rows priced under different tables is comparing the tables. A row that cannot state one price states none.

**Let a deployment configure the cost rule.** Rejected under the no-hardcoded-tunables rule's own exception: this is a publication invariant, not a deployment-varying choice, and the only deployment that would switch it off is one that wants the number more than it wants the number to mean something.

**Derive the tamper column from the results of the last run.** Rejected: `passed` and `failed` follow from the results but `tampered` does not, so a derived column would report a tampered run as failed and the tamper gate would publish as if it had run.

**Match an experiment result to the logs by its arm groups.** Stronger than matching by route, and rejected only because `ScoreboardRow` carries no group: `EnvironmentStats.groups` is a count. Adding the group names to every row to serve one section of one page is more surface than the section is worth; matching by route already refuses a verdict about routes the page does not publish.

**Render one blended score per route.** Rejected in the [Village note](2026-09-05-daliesk-village.md) and again here: the columns a blend hides are the ones that decide whether a row means anything.

## Acceptance criteria

- A unit test proves a Workshop-district session and a held-out session never appear in the published rows and are counted in `withheld`, with their sessions counted as well as their rows.
- A unit test proves the staleness switch at the exact threshold: `now - newestSessionAt === staleAfterMs` renders numbers, one millisecond later renders the notice in place of every number, and the JSON carries `stale: true` with no rows.
- A unit test proves a row carrying two pricing digests publishes no cost, and one carrying exactly one publishes the cost beside that digest.
- A unit test proves a row whose sessions state no composition digest renders `pending`, and one whose sessions disagree renders `pending` too.
- A unit test proves `resolved` and `parity` are two columns whose values are never combined, and that a row with no parity renders none rather than its certificate rate.
- A unit test proves a snapshot with no experiment result renders the no-ranking sentence, and one carrying a verdict for two published routes renders that verdict.
- A Loader-booted e2e runs one fleet plan in the `workshop` district and one outside it through a real `cordis.yml`, snapshots, renders, and asserts the workshop rows are absent from the published rows and present in the counts.
- A keyless snapshot pins the rendered HTML and the JSON document with timestamps normalized.
- The scorekeeper's per-file coverage stays at 100 % with the two new facts and the three new row fields.

## Risks

- **A page that is honest and unreadable.** Eleven columns before a ranking is what the publication rules require and what a reader will not scan. The mitigation is typographic, not editorial: tabular numerals, a fixed column order, and no column that can be dropped without dropping a rule.
- **A stale page nobody notices is stale.** The staleness notice replaces the numbers rather than sitting beside them precisely because a banner above a table of numbers is read as decoration. The remaining risk is a deployment configuring `staleAfterMs` longer than its own cadence, which no gate can catch.
- **Withheld counts as a disclosure.** The count of withheld Workshop rows is itself a fact about a client engagement. A deployment that cannot publish the count publishes no page; splitting the count out would be a second publication rule with a second way to be wrong.
- **A verdict paired by route, not by group.** Two experiments over the same route pair under different plans both match the same published rows, so a caller handing the snapshot several results for one pair publishes several rankings. The plan digest on every ranking is what keeps them distinguishable; a caller that wants one publishes one.
- **The live projection stays proposed.** Until it lands the page is only as current as the process that folds it, and the refresh interval it names is a claim about that process which the page itself cannot check.
