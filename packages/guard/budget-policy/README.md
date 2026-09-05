# @deepseek-ai/dsh-budget-policy

English | [中文](README.zh.md)

A durable spend ceiling for one session: configured token, wall-clock, and cost caps are measured against the session log before every proposed step, and the first cap the log exceeds records a `budget/breach` event, blocks the session's goal, and rejects the step so no further model request is made. Nothing is measured in memory — the caps read the same durable events a replay reads, so a recorded breach is reproducible by anyone holding the log. Decision record: [the budget-policy Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-budget-policy.md).

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

A function/namespace plugin (`name` / `inject` / `Config` / `apply`), not a service. It injects `ctx.agents` and registers one prepended `agent/pre-step` listener; `ctx.goals` is read optionally through `ctx.get('goals')`, so the policy enforces identically in a composition without the goal domain.

The listener is prepended so the budget decision precedes every listener that would build request context or reserve continuation work for a step that cannot run. On a breach it does not call `next()`: the chain short-circuits and the loop closes the turn with reason `blocked`, having opened no step.

`foldBudgetSpend(events, pricing)` and `measuredFor(spend, cap)` are exported so a supervisor can recompute any recorded measurement from the log.

### Measuring spend from the log

`assistant/message` is the single usage source: it carries a step's final provider accounting, so the earlier `assistant/chunk` usage sample for the same step is deliberately ignored rather than counted twice. A message without `usage` contributes nothing. Billed input is the disjoint sum of `inputTokens`, `cacheReadTokens`, and `cacheWriteTokens`; output is `outputTokens` as the provider reported it. Each message prices against its own `provider/model` provenance, so a route switch mid-session bills each step at the rate configured for the route that served it.

`maxWallMs` measures the span between the log's first and last event times. It therefore counts idle gaps between events, including the gap across a process restart, but not time elapsed since the newest event — which is what makes the measurement a function of the log rather than of the clock at read time.

### What a breach does

1. Appends `budget/breach` with the cap that tripped, the measured spend, and the configured value it exceeded. The caps are evaluated in the fixed order `maxInputTokens`, `maxOutputTokens`, `maxTotalTokens`, `maxWallMs`, `maxCostEur`, and the first one exceeded is the one recorded.
2. Blocks a current `active` goal through `ctx.goals.block` with code `budget-exhausted` and the message `Session budget <cap> exceeded: <measured> of <limit>.` The block is durable and disarms continuation, so a goal-round driver does not resume the goal afterwards. A composition without `ctx.goals`, without a current goal, or whose goal already left `active` still gets the breach record and the stopped turn.
3. Returns `{ kind: 'reject' }`, which ends the turn without opening a step.

Spend never decreases, so a later step in the same session breaches again: each stopped step records its own event, and the durable log states exactly how many attempts the exhausted budget turned away. Raising a cap and reloading the deployment is the way to resume.

### Invariant companion

`@deepseek-ai/dsh-budget-policy/invariant` recomputes each durable breach independently: the recorded `measured` must exceed `limit`, and for the log-derived caps it must equal this package's fold over exactly the events preceding the record. `maxCostEur` depends on the deployment pricing table, which the log does not carry, so a cost breach is checked only for the exceeded-its-limit relation.

## Model Experience

### Stopped step

#### What the model sees

Nothing. A breach is decided before the step opens, so no prompt section, tool schema, tool result, or message text is added, and no model request is made for the stopped step or for any later step while the cap holds. The breach record and the goal's `budget-exhausted` block reason are durable state for humans and supervising processes, not model-visible content.

#### Token effect

Zero added tokens, and the request the stopped step would have sent is never spent.

#### KV Cache effect

Independent: the request surface is neither extended nor rewritten, so an already-reusable prefix stays reusable; the session simply issues no further request while the cap holds.

## Known Limitations and Deferred Work

- **Session-scoped only** — the caps measure one session log. A deployment that wants a per-workspace, per-user, or per-day ceiling has no aggregation point here; subagent sessions carry their own logs and their own independent budgets.
- **Cost covers priced routes only** — usage on a `provider/model` absent from `pricing` adds tokens but no cost, so `maxCostEur` cannot be the sole ceiling for a deployment whose routes are not all priced.
- **One input rate per route** — the table prices billed input with a single number, so a provider that discounts cache reads against cache misses is priced at the uncached rate.
- **No warning before the stop** — the policy has no advisory threshold that tells the model to wrap up before the cap trips; the first model-visible consequence of an exhausted budget is that the turn ends.
- **Raising a cap needs a reload** — caps are load-time configuration, so an exhausted session resumes only after the deployment is reconfigured and reloaded; there is no runtime grant.
