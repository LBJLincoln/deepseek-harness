# @deepseek-ai/dsh-observatory

English | [中文](README.zh.md)

The public page, folded from the persisted logs and nothing else. `ctx.observatory.snapshot()` folds the scoreboard through the scorekeeper over every persisted session, withholds the configured districts and the held-out split from its public rows while counting what it dropped, and records when it folded and how new its newest session is. `render(snapshot, now)` turns one snapshot into a self-contained HTML page and the same publication as JSON, and shows the staleness notice in place of every figure once the fold is too old. The service writes no session event. The [observatory Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-observatory.md) owns the design rationale, and the [Village note](../../../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md) owns the publication rules it enforces.

## Config

```yaml
- id: persistence
  name: '@deepseek-ai/dsh-session-persistence-jsonl'
  config:
    root: './.sessions'
- id: scorekeeper
  name: '@deepseek-ai/dsh-scorekeeper'
- id: observatory
  name: '@deepseek-ai/dsh-observatory'
  config:
    withhold:
      districts: ['workshop']
      heldOut: true
    staleAfterMs: 3600000
    refreshIntervalMs: 900000
```

| Key | Default | Meaning |
|---|---|---|
| `withhold.districts` | none | Districts whose rows never reach the public page. The package ships no district name: a deployment states the districts whose sessions may not leave it. |
| `withhold.heldOut` | none | Whether held-out rows are withheld as well. |
| `staleAfterMs` | none | Age of the newest folded session past which the page shows the staleness notice in place of every figure. |
| `refreshIntervalMs` | none | Batch refresh interval, printed on the page as the cadence its numbers were folded under. |

Every key is required. What a deployment withholds, how old is too old, and how often it refolds are statements the page makes to its readers, and none has a value this package could pick on a deployment's behalf. The service requires the scorekeeper and a session persistence backend.

`costRequiresDigest` is fixed at `true` and is deliberately not a config key: a row priced under two pricing tables states a sum across tables rather than a price, so publishing that sum as a cost would misstate it however the deployment feels about it. The same holds for the two rules beside it — `resolved` and `parity` are two columns and neither is ever computed from the other, and no ranking appears without an `ExperimentResult` verdict.

## Service contract

`ctx.observatory.snapshot({ experiments? })` lists every persisted session header, folds the scoreboard through `ctx.scorekeeper.leaderboard()` over exactly those sessions, and partitions the rows. Withholding is a row operation because it is already a session operation: the scoreboard key carries `district` and `heldOut`, so every session of a withheld row is withheld and no withheld session can reach a published row. A row withheld for both reasons is counted under its district, which is checked first.

Rows come back ordered by route, environment, isolation, held-out split, and district. The scoreboard's own order is the order its session store listed the sessions in, which no backend promises to keep, so an unordered page would reshuffle between folds that measured the same thing.

`foldedAt` is when the fold ran; `newestSessionAt` is the newest `createdAt` among the session headers the fold read, absent when the store held none. `refreshIntervalMs` travels in the snapshot so the rendered page names the cadence it was produced under.

No session event carries an `ExperimentResult` — the experiment service writes its result to a sink and stamps its arms into the run `group` — so a fold that is handed none publishes no ranking. A caller that ran an experiment passes its results in `experiments`, and the snapshot keeps only the results whose two arm routes both appear in the published rows.

`ctx.observatory.render(snapshot, now)` returns `{ html, json }`, two faces of one publication that state the same facts. `now` decides staleness against `staleAfterMs`; a fold that read no session is stale by the same rule, having nothing whose age could be current.

The pure functions behind both are exported for tests and offline tools: `withhold`, `orderRows`, `rankable`, `isStale`, `publishRow`, `publishDocument`, and `renderHtml` with `escapeHtml`, `duration`, `NO_RANKING_SENTENCE`, and `STALE_SENTENCE`.

## The published column set

One table row per scoreboard row, in this order:

| Column | What it states |
|---|---|
| Route | `provider/model` of the row's stamp. |
| Implementer | Who did the work: `route` for the session's own model route, or the subagent provider name of a delegated cell. Rows never average across it. |
| Environment | The environment id the row's sessions ran. |
| District | The district every session of the row was stamped with, `none` for a row outside every district. |
| Isolation | The isolation the runs declared; rows never average across it. |
| Certificate executor | The executors of the row's certificates, `no certificate` for a row that certified nothing. Two entries mean the row's certificates disagree, and no single executor stands beside its rate. |
| Composition digest | The digest every session of the row states, `pending` when a session states none or two disagree. |
| Held out | Whether the environment is reserved for evaluation. |
| Tamper | `not instrumented` for a row whose sessions recorded no run, `tampered <n> of <runs>` when a run found the check-owned files changed, `no tamper` otherwise. |
| Resolved | The certificate rate under its own name, with its certified-over-runs counts; `no run` for a row that recorded none. |
| Parity | The mean weighted pass rate over the sessions that measured cases, `none` when none did. |
| Cost per certified session | The mean cost beside the one pricing digest that priced the row, `not published` otherwise. |

The page also names its fold time, its newest folded session, its batch refresh interval, and its staleness threshold; states what withholding removed; and closes with either the rankings a verdict earned or the sentence that no ranking is published without a paired experiment.

## Publication rules the service enforces

- **Rows before rankings.** A ranking is published only for an `ExperimentResult` whose two arm routes both appear in the published rows, so a verdict is never the only evidence of a session. A fold carrying no verdict prints the sentence instead.
- **`resolved` and `parity` are two columns.** The certificate rate says every case of every active check passed; the weighted pass rate says how much of the measured behaviour the sessions reached. Nothing here merges them, ranks across them, or renders one as the other.
- **Cost travels with its digest.** A row publishes a cost per certified session only when exactly one pricing table priced it, and always beside that digest.
- **`pending` beats a partial attribution.** A composition digest covering part of a row would attribute the whole row to a composition that did not run all of it, so a row whose sessions disagree publishes `pending`.
- **Withholding is counted, never hidden.** A row that disappears without a count inflates every rate computed from the rest, so the page states the withheld districts and the rows and sessions each reason removed.
- **Stale replaces, never annotates.** Past `staleAfterMs` the notice takes the place of every figure and the JSON carries `stale: true` with no row and no ranking; a banner over a table of numbers is read as decoration and the numbers are read as current.

## Model Experience

None, as the observatory folds persisted logs into a page and a JSON document; it adds nothing to any model request.

#### KV Cache effect

None; the service neither adds to nor changes any model request.

## Known Limitations and Deferred Work

- **The page is a batch, not a live projection** — every fold reads every persisted session, and the page states the refresh interval its deployment configured rather than one it can verify. The live leaderboard is [Village rollout item 7](../../../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md); a fold across sessions has no projection seam yet, because `ProjectionDefinition` and the projection cache are both keyed by one session.
- **The service hosts nothing** — it returns the page and the document to its caller. A deployment that wants the status page on the public web writes both to its own web root or object store on its own schedule; this package opens no port and writes no file.
- **A raw excerpt stays behind a signoff** — the page publishes folded figures only. No prompt, transcript, evidence string, or check body reaches it, and publishing any raw session excerpt needs the data steward's `SignoffRecord` and the export's redaction profile, neither of which exists yet.
- **Verdicts arrive from the caller, not the log** — no session event carries an `ExperimentResult`, so a fold cannot recover a verdict from the logs alone, and two experiments over the same route pair under different plans both match the same published rows. Every published ranking names its plan digest so they stay distinguishable.
- **Withheld counts are themselves a disclosure** — the number of withheld Workshop rows is a fact about a client engagement. A deployment that cannot publish that count publishes no page.
