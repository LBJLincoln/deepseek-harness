# @deepseek-ai/dsh-budget-policy

English | [中文](README.zh.md)

A durable spend ceiling for one session: configured token, wall-clock, and cost caps, tightened by whatever caps the session's own log records, are measured against that log before every proposed step, and the first cap the log exceeds records a `budget/breach` event, blocks the session's goal, and rejects the step so no further model request is made. Every step a priced route served also records a `usage/priced` event, so what a session cost is a durable fact rather than an in-memory total. Nothing is measured in memory — the caps read the same durable events a replay reads, so a recorded breach or price is reproducible by anyone holding the log. Decision record: [the budget-policy Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-budget-policy.md).

## Config

```yaml
- id: budget-policy
  name: '@deepseek-ai/dsh-budget-policy'
  config:
    maxInputTokens: 2000000      # billed input: uncached input + cache reads + cache writes
    maxOutputTokens: 400000      # output tokens, provider-reported
    maxTotalTokens: 2400000      # input + output
    maxWallMs: 3600000           # span between the log's first and last event
    maxCostEur: 25               # priced routes only; needs a non-empty pricing table
    pricing:
      deepseek/deepseek-chat:
        inputEurPerMillionTokens: 0.25
        outputEurPerMillionTokens: 1.0
```

Every cap is optional and uncapped when omitted, so an empty configuration is a valid policy that never stops a step and never reads the log. A cap is exceeded only when measured spend is strictly greater than its value: `0` stops the session at the first recorded spend, and a session exactly on budget keeps running.

Validation happens at plugin load, before any session can depend on a cap the policy could not enforce. A cap or rate that is not a finite non-negative number throws, and `maxCostEur` without a non-empty `pricing` table throws — an unpriced route has no cost cap, so a cost ceiling over an empty table would silently enforce nothing.

`pricing` keys are `provider/model`, matching the provenance each assistant message carries. A route absent from the table contributes its tokens to the token caps but nothing to `costEur`, so token caps remain the enforcement of last resort for a route whose price the deployment has not stated.

## Plugin contract (namespace: `budget-policy`)

A function/namespace plugin (`name` / `inject` / `Config` / `apply`), not a service. It injects `ctx.agents` and registers one prepended `agent/pre-step` listener and one `agent/turn-stopping` listener; `ctx.goals` is read optionally through `ctx.get('goals')`, so the policy enforces identically in a composition without the goal domain.

The pre-step listener is prepended so the budget decision precedes every listener that would build request context or reserve continuation work for a step that cannot run. On a breach it does not call `next()`: the chain short-circuits and the loop closes the turn with reason `blocked`, having opened no step.

`foldBudgetSpend(events, pricing)`, `measuredFor(spend, cap)`, `unpricedUsage(events, pricing)`, `foldSessionCaps(events)`, `tightenedCaps(configured, session)`, `BUDGET_CAP_ORDER`, and `pricingTableDigest(pricing)` are exported so a supervisor can recompute any recorded measurement, price, or enforced cap from the log.

### Measuring spend from the log

`assistant/message` is the single usage source: it carries a step's final provider accounting, so the earlier `assistant/chunk` usage sample for the same step is deliberately ignored rather than counted twice. A message without `usage` contributes nothing. Billed input is the disjoint sum of `inputTokens`, `cacheReadTokens`, and `cacheWriteTokens`; output is `outputTokens` as the provider reported it. Each message prices against its own `provider/model` provenance, so a route switch mid-session bills each step at the rate configured for the route that served it.

`maxWallMs` measures the span between the log's first and last event times. It therefore counts idle gaps between events, including the gap across a process restart, but not time elapsed since the newest event — which is what makes the measurement a function of the log rather than of the clock at read time.

### Per-session caps

A session created for a narrower purpose than the whole deployment records its own ceilings as a `budget/caps` event carrying any subset of the five cap fields. The caps enforced for that session are the configured caps tightened by the latest `budget/caps` in its log: a cap only the record carries applies as written, a cap both carry applies at the smaller of the two, and a cap neither carries stays uncapped. A record can therefore only ever narrow what the deployment configured, which is what lets an orchestrator hand one session a slice of the deployment's budget without being able to grant it more.

The caps are folded from the log like the spend they bound, so a resumed session enforces exactly the caps its own log records and the model sees nothing: `budget/caps` reaches no model request. A `maxCostEur` recorded on a session whose routes the `pricing` table does not name measures against a cost of zero and therefore never trips, exactly as a configured cost cap does over an unpriced route.

### What a breach does

1. Appends `budget/breach` with the cap that tripped, the measured spend, and the configured value it exceeded. The caps are evaluated in the fixed order `maxInputTokens`, `maxOutputTokens`, `maxTotalTokens`, `maxWallMs`, `maxCostEur`, and the first one exceeded is the one recorded.
2. Blocks a current `active` goal through `ctx.goals.block` with code `budget-exhausted` and the message `Session budget <cap> exceeded: <measured> of <limit>.` The block is durable and disarms continuation, so a goal-round driver does not resume the goal afterwards. A composition without `ctx.goals`, without a current goal, or whose goal already left `active` still gets the breach record and the stopped turn.
3. Returns `{ kind: 'reject' }`, which ends the turn without opening a step.

Spend never decreases, so a later step in the same session breaches again: each stopped step records its own event, and the durable log states exactly how many attempts the exhausted budget turned away. Raising a cap and reloading the deployment is the way to resume.

### What a priced step records

`usage/priced` states the price of one `assistant/message` whose `provider/model` the `pricing` table names: the `turn` and `step` it prices, that route's `provider` and `model`, the `inputTokens` (billed input) and `outputTokens` it charges for, the `inputEurPerMillionTokens` and `outputEurPerMillionTokens` applied, the resulting `costEur = (inputTokens * inputEurPerMillionTokens + outputTokens * outputEurPerMillionTokens) / 1_000_000`, and a `pricingDigest`. The digest is the lowercase SHA-256 of the whole configured table — route keys ordered by code unit, each entry serialized as its input rate then its output rate — so a reader can tell which table version priced a step and one changed rate changes the digest. Rates travel in the record itself, which is what makes session cost replayable without the deployment configuration. A route the table does not name records nothing.

Which steps to price is read from the log, not remembered: a step is priced when its message carries `usage`, its route is priced, and no `usage/priced` in the log already carries its turn and step. A resumed session therefore prices exactly what its predecessor left unpriced, and never prices a step twice. The records are written at two points — inside the pre-step listener, before the caps are read, so the last message before a breach is priced by the same step that records the breach; and at `agent/turn-stopping`, so the final step of a turn that closes normally is priced too.

A turn that ends by error or abort reaches neither point, so its last message stays unpriced until the session's next pre-step or stop boundary; a session abandoned in that state keeps one unpriced step in its log.

### Invariant companion

`@deepseek-ai/dsh-budget-policy/invariant` recomputes each durable record independently. A breach's recorded `measured` must exceed `limit`, and for the log-derived caps it must equal this package's fold over exactly the events preceding the record; `maxCostEur` depends on the deployment pricing table, which the log does not carry, so a cost breach is checked only for the exceeded-its-limit relation. A price must cite an earlier `assistant/message` with the same turn and step whose billed tokens and route it reproduces exactly, its `costEur` must equal its own rates applied to its own tokens, and no earlier `usage/priced` may carry the same turn and step.

A `budget/caps` record may only tighten. The deployment's configured caps are not in the log, so the companion compares each cap against the caps the same session's earlier `budget/caps` records already fold to: raising one of those, or dropping it so the cap disappears, is rejected at append. Widening a cap the deployment configured is outside what the log can show and is refused by the enforcing fold instead, which never takes a recorded value above the configured one.

## Model Experience

### Stopped step

#### What the model sees

Nothing. A breach is decided before the step opens, so no prompt section, tool schema, tool result, or message text is added, and no model request is made for the stopped step or for any later step while the cap holds. The breach record, the pricing records, and the goal's `budget-exhausted` block reason are durable state for humans and supervising processes; none of them is a surface event, so none reaches a model request.

#### Token effect

Zero added tokens, and the request the stopped step would have sent is never spent.

#### KV Cache effect

Independent: the request surface is neither extended nor rewritten, so an already-reusable prefix stays reusable; the session simply issues no further request while the cap holds.

## Known Limitations and Deferred Work

- **Session-scoped only** — the caps measure one session log. A deployment that wants a per-workspace, per-user, or per-day ceiling has no aggregation point here; subagent sessions carry their own logs and their own independent budgets.
- **Cost covers priced routes only** — usage on a `provider/model` absent from `pricing` adds tokens but no cost and records no `usage/priced`, so `maxCostEur` cannot be the sole ceiling for a deployment whose routes are not all priced, and an unpriced session has no cost the log can state.
- **A turn that ends by error or abort leaves its last step unpriced** — pricing happens at the next pre-step or at the normal stop boundary, and neither is reached when a turn fails or is cancelled. The record lands at the session's next pre-step or stop; a session abandoned right after such a turn keeps one unpriced step.
- **One input rate per route** — the table prices billed input with a single number, so a provider that discounts cache reads against cache misses is priced at the uncached rate.
- **No warning before the stop** — the policy has no advisory threshold that tells the model to wrap up before the cap trips; the first model-visible consequence of an exhausted budget is that the turn ends.
- **Raising a cap needs a reload** — configured caps are load-time configuration, so an exhausted session resumes only after the deployment is reconfigured and reloaded; a `budget/caps` record can only tighten, so there is no runtime grant either.
- **No session-cap authority** — any writer of a session's log can record `budget/caps`, and the record is honoured because it can only narrow. Nothing states which orchestrator owns a session's caps, so two writers on one session simply compose by last-wins-then-tighten.
