# @deepseek-ai/dsh-shifts

English | [中文](README.zh.md)

Shifts: the durable driver of an unattended fleet. Each district opens a slot on its cadence, freezes what the slot runs into a content digest, and records the whole shift as `shift/*` events in the slot's own session log. That ledger is the only thing a restarted process reads: it resumes an interrupted shift under the same identity, runs exactly the cells that never started, and refuses a slot whose district has already spent its window. The [village-shifts Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-village-shifts.md) owns the design rationale.

## Config

```yaml
- id: fleet
  name: '@deepseek-ai/dsh-fleet'
  config:
    workspaceRetention: remove-all
- id: shifts
  name: '@deepseek-ai/dsh-shifts'
  config:
    workspaceRoot: /var/lib/dsh/workspaces
    startImmediately: true
    districts:
      - district: workshop
        plan:
          environments:
            filter:
              heldOut: false
          models:
            - provider: <provider>
              model: <model>
          repetitions: 4
          policyVersion: policy-2026-09
          seed: 100
          tokenCeiling: 4000000
        cadence:
          intervalMs: 21600000
        spendWindow:
          windowMs: 86400000
          maxTokens: 12000000
```

| Field | Meaning |
|---|---|
| `workspaceRoot` (required) | Existing absolute directory the fleet mints each cell's `cell-*` workspace under. Checked when the plugin loads, so a deployment whose disk is not mounted fails before a slot opens. |
| `districts` (required) | At least one district, each named once. The name reaches every cell's run stamp, so an export or a scoreboard can partition by it. |
| `districts[].plan.environments` | `{ ids: [...] }` in the given order, or `{ filter: { kind, heldOut } }` resolved against the registry when the slot freezes. |
| `districts[].plan.models` | At least one model route. The driver enumerates its own cells to compute a pending set and to digest the plan, so the routes are named here instead of taken from whatever default the composition currently selects. |
| `districts[].plan.repetitions` | Positive repetitions per environment and route; repetition indexes start at `0`. |
| `districts[].plan.policyVersion` (optional) | Checkpoint or policy the district's routes serve. Every cell's run stamp carries it verbatim. |
| `districts[].plan.seed` (optional) | Base sampling seed of the district; each cell samples with `seed + repetition`, as the [fleet README](../fleet/README.md#policy-version-and-the-base-seed) states. |
| `districts[].plan.tokenCeiling` (optional) | Positive input-plus-output token ceiling of one shift. A resumed shift runs under this ceiling minus what its own sessions already spent. |
| `districts[].cadence.intervalMs` (required) | Positive milliseconds between consecutive slots of the district. |
| `districts[].spendWindow` (optional) | `windowMs` and `maxTokens`: the trailing window across slots. Absent runs every slot the cadence opens. |
| `startImmediately` (required) | Whether a district with no slot in the ledger opens one as the process starts. `false` waits one interval first. |

The service requires `fleet`, `sessions`, and `sessionPersistence`, and reads the environment registry the fleet itself injects; a slot that cannot reach it is refused with `SHIFT_INVALID_PLAN` rather than frozen over an empty inventory.

## Service contract

`ctx.shifts.start()` resumes every interrupted shift, then opens each district's due slot and arms its cadence timer. The loop runs once per process: the plugin starts it over the settled Loader tree and a second call joins the same run, so a driver can await the first slot without racing the plugin. `ctx.shifts.stop()` disarms every timer, cancels the fleet run in flight through its signal, and waits for the slots that are settling; plugin disposal calls it.

`shiftDigest(plan)` is the SHA-256 hex over the district, the environment ids sorted by code unit after a filter is resolved against the registry, the model routes in listing order, the repetition count, the policy version and base seed the cells sample under, and the token ceiling. A district that changes its policy version or its seed therefore opens a new shift identity rather than resuming the old one, which is correct: its cells measure a different thing. The workspace root, the cadence, and the spend window are deployment choices and stay out of it: they decide what a deployment pays for, not what the shift runs. `shiftId(digest, scheduledAt)` is `shift-<digest>-<scheduledAt>`, the slot time in epoch milliseconds — so two processes computing the same slot compute the same identity without counting anything. That id is the shift session's id and the `group` on every cell's run stamp, which is how the sessions of one shift stay grouped durably.

## The ledger

The driver creates one session per slot and appends to it, flushing at every step so a process that dies leaves a truthful record.

| Event | Written when | Payload |
|---|---|---|
| `shift/start` | Before the shift's first cell starts | `shiftId`, `digest`, the frozen `plan`, `scheduledAt` |
| `shift/cell` | Once per cell, after that cell's own session is durable | `shiftId`, `cell`, the cell's `sessionId` when one exists, and an `outcome` of `reported` with its `certified` flag, `error` with the fleet's code and message, or `interrupted` |
| `shift/resume` | When a later process picks the shift up | `shiftId`, `done`, `pending` |
| `shift/skipped` | When a slot is refused; the session holds this one event and no `shift/start` | `digest`, `scheduledAt`, `reason` (`overlap` or `spend-window`) |
| `shift/end` | Once the shift is over | `shiftId`, `outcome` (`completed`, `ceiling`, or `stopped`), `spend`, and `cells` counted per outcome |

The [persistence catalog](../../../docs/persistence-catalog.md) carries each payload's declaration. Cost in EUR is not a shift field: it is folded from the `usage/priced` events of the cell sessions, so a published cost is always a logged fact.

## Resume

On start the driver lists persisted sessions, loads every shift session with a `shift/start` and no `shift/end`, and for each computes the pending cells as the plan's cells minus those the ledger already recorded, minus those whose `environment/run` stamp exists in a session created at or after the shift session's own `createdAt`. The stamp scan is what keeps the ledger honest when a process died before writing a record; the `createdAt` bound is what keeps an older instance of the same plan out of the answer.

A cell whose session exists while the ledger never recorded it is an orphan: it is recorded as `shift/cell` with `outcome: interrupted` and never run again under the same repetition, because a second session for one cell would double-count it in every pass@k fold over the group. The crash is an outcome of the harness under test and stays an error row. The resumed shift then appends `shift/resume`, runs the pending cells through `ctx.fleet.run` under the same group and district with the plan's ceiling reduced by what its own sessions already spent, and closes with `shift/end`.

## Cadence and refusals

One shift per district is in flight at a time. The next slot of a district is its previous `shift/start.scheduledAt` plus `intervalMs`, read from the ledger, so a restart neither drifts nor doubles a slot; slots that passed while no process ran are not caught up and the hole stays visible in the slot arithmetic. Each firing arms the next slot before it runs the current one, so slots keep arriving on the cadence: one that lands on a still-running shift is refused with `shift/skipped { reason: overlap }` rather than delayed into it. Before a shift starts, the driver folds `shift/end.spend` over the district's slots inside `windowMs`; a start that would begin with the window exhausted is refused with `shift/skipped { reason: spend-window }` and creates no cell. The per-cell caps stay with the budget policy and the per-plan ceiling with the fleet; the window is the third layer, across plans.

## Supervision

The driver holds nothing in memory a restart needs, so a host supervisor restarting the process is the whole recovery story.

```ini
[Unit]
Description=DeepSeek Harness shift driver
After=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/node /opt/dsh/lib/bin.js --config /etc/dsh/shifts.cordis.yml
WorkingDirectory=/var/lib/dsh
Restart=always
RestartSec=10
Environment=DEEPSEEK_API_KEY=/run/secrets/deepseek
KillSignal=SIGTERM
TimeoutStopSec=300

[Install]
WantedBy=multi-user.target
```

A container deployment uses its own restart policy instead — `docker run --restart=always --volume dsh-sessions:/var/lib/dsh/sessions --volume dsh-workspaces:/var/lib/dsh/workspaces <image>` — with both the persistence root and the workspace root on volumes that outlive the container, since the ledger is the recovery record. `TimeoutStopSec` must exceed the longest cell, because disposal cancels the run and waits for the cells that are settling; a shorter timeout turns a clean stop into orphans.

### Runbook

| Condition | What the ledger shows | What to do |
|---|---|---|
| The orchestrator crashed | A shift session with `shift/start` and no `shift/end`; after the restart, `shift/resume` and one or more `shift/cell` records with `outcome: interrupted` | Nothing, unless the interrupted count keeps growing: the restart resumes the shift. Repeated orphans in one district are the finding. |
| A model route is out past the retry budget | `shift/cell` records with `outcome: error` carrying `FLEET_ROUTE_BREAKER_OPEN`, and a `shift/end` whose `cells.error` covers most of the plan | Stop the district (remove it from the config and restart) until the route recovers; the spend window limits what a flapping route can cost meanwhile. |
| The shift timer is dead | The district's latest `shift/start.scheduledAt` is more than one `intervalMs` old and no `shift/skipped` follows it | Check that the process is up and that its config still names the district; the ledger cannot tell a stopped timer from a stopped process. |
| The disk is full | Nothing — the ledger is what fails to be written | Alert on free space at the persistence root and the workspace root; `workspaceRetention: remove-all` on the fleet bounds the checkouts, but session logs have no retention policy yet. |
| A tool call hangs | Nothing — the shift stays open with no new `shift/cell` | Alert on a shift whose latest `shift/cell` is older than the expected cell duration; the tool-timeout policy bounds a call the executor can see, not one the provider never answers. |

## Model Experience

None, as the shift driver only schedules fleet runs; the environment runner owns every model-visible effect of each cell, and no `shift/*` event ever enters a model request.

#### KV Cache effect

None; the driver neither adds to nor changes any model request, and the shift session it writes carries no message the surface projects.

## Known Limitations and Deferred Work

- **The ledger is not folded into a scoreboard** — a shift's rows are read by hand from the `shift/*` events until the scorekeeper folds them; a district column on a scoreboard row and one row per shift do not exist yet.
- **`verify-village-composition` does not name the driver** — a shift composition that lacks persistence fails on the fleet's own village rule, so the diagnostic points at the fleet entry rather than at the driver whose ledger the missing backend would drop.
- **Session logs have no retention policy** — workspace retention bounds the checkouts, but a deployment running for months grows its persistence root without limit, and the resume scan reads every session in it once per slot with a spend window.
- **A slot is refused, never queued** — a slot that arrives on a running shift, or on an exhausted spend window, leaves a `shift/skipped` and is gone; nothing re-opens it when the shift ends or the window rolls forward.
- **A cadence shorter than a slot's own scan floods the ledger** — every slot that lands while the previous one is still reading the persistence root is refused for the overlap and leaves its own session, so a millisecond cadence writes refusals faster than the refusing slot can record its own reason; cadences are minutes, and one overlap record per running shift is deferred work.
- **The cadence reads the host clock** — a clock jump moves a slot and never doubles one, because the ledger decides, but a district whose host clock runs backwards past a whole interval opens its next slot late.
