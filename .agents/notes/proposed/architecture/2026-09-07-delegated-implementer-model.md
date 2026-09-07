# Agent Note: The delegated implementer runs the model its cell names, and says what it cost

Status: proposed

English | [中文](2026-09-07-delegated-implementer-model.zh.md)

## Problem

[The external implementer](2026-09-06-external-implementer.md) connected the subagent seam to the environment runner: `{ kind: 'subagent', provider }` starts one child run per attempt and records it as `environment/delegation`, while the runner still stamps, standardizes, validates, and certifies exactly as before. The stamp carries the cell's model — `environment/run` holds `{ provider, model }`, every observatory row and scorekeeper fact is keyed by it, and a paired experiment's arms are told apart by it.

That model never reaches the child. [`EnvironmentRunner.delegate()`](../../../../packages/improvement/environment-runner/src/index.ts) calls `ctx.subagents.start(provider, { prompt, parent, signal, label? })`, and the start request has no way to name a model, so [`subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md) invokes the SDK with no `model` option and the product runs whatever the installation's own settings select. A running fleet's product processes show `claude --output-format stream-json … --permission-mode acceptEdits --no-session-persistence` and no model flag, and no cell session log holds the product's model anywhere. A plan naming `models: [{ provider: 'claude-code', model: 'sonnet' }]` with a subagent implementer therefore publishes rows labelled `sonnet` whose work was done by the installation default, and a paired experiment whose candidate arm names a subagent implementer compares two arms that may have run the same model.

The same delegation records no spend. `environment/delegation.usage` is present only for a child this process published, whose assistant messages are in a log here; the runner's own comment says an out-of-process child "leaves no log here to sum". So a delegated cell reports zero tokens and no cost while a route cell reports its full usage, and the two are not comparable on anything but the certificate. Two product-loop fleets just certified 12/12 tier-2 and 18/18 tier-3 cells in one attempt each: at that difficulty the certificate rate separates nothing, and attempts, wall time, and spend are the only measures left. The product reports both — its `system`/`init` message names the model and its terminal `result` message carries `usage` and `total_cost_usd` — and the harness discards them.

## Proposal

Carry the model down the seam, carry the child's own account of itself back up, and record both on the delegation.

The start request gains `model?: string`, the provider-specific identifier the child MUST run, gated by a new `SubagentCapabilities.model` exactly like the four features before it: the service rejects a start naming a model on a provider that advertises `model: false`, with the seam's existing `UNSUPPORTED_CAPABILITY` code, before the provider is reached. The contract the flag buys is that a provider never silently runs another model — one that advertises the capability and cannot honor a particular identifier rejects the start rather than falling back.

The result gains the child's own account, all three optional and all three absent when the backend states nothing: `reportedModel` is the model that backend says it ran, `reportedUsage` the token accounting it reported, `reportedCostUsd` the price it put on the run. They are the child's claim rather than an echo of the request, which is what makes them worth recording: an alias resolves to a concrete version, and a spend no harness log can see becomes a number. A provider that composes its child in this process reports the model — it is the child's own resolved route — and no spend, because the child's session log already accounts for it.

`SubagentCapabilities.model` is not read by `runsOutOfProcess`, for the same reason `harnessTools` is not: a product backend advertises it while its child still runs wherever it already runs.

Per provider:

| Provider | `model` | Why |
|---|---|---|
| `subagent-claude-code` | honored | the SDK's `model` option, which the CLI takes as `--model`, in both modes; reports model, usage, and cost from the SDK stream |
| `subagent-spawn-in-process`, `subagent-fork-in-process` | honored | replaces the model on the route the child inherits from its parent; reports the child's own resolved model |
| `subagent-dsh-sdk` | honored | the model the child runtime is initialized with, replacing the configured default for that child alone |
| `subagent-codex` | refused | the verified app-server protocol baseline carries no model on `thread/start`, and no usage or cost on its notifications |
| `subagent-acp` | refused | `session/new` names no model, and the protocol reports no accounting |

The runner starts every child on the run's own stamped model, resolved before `requireImplementer` so a provider that cannot be told which model to run is refused there — `ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED`, beside the two refusals already made before an agent exists. A stamped session claiming an arm the child never ran is a mislabelled measurement, not a failed run, so it must not be created. `environment/delegation` gains `reportedModel?`, `reportedUsage?`, and `reportedCostUsd?` beside the existing `usage?`; a delegation states at most one accounting, so a reader sums both without double-counting.

The scorekeeper folds them into the facts a scoreboard is built from: `identity.implementerModel` is the model the last delegation that stated one reported, read against `environment.model` — "requested `sonnet`, child reported `claude-sonnet-…`" — and `efficiency.delegated` is the summed spend, where a route-implemented cell reports its work in the token fields beside it. `delegated.costUsd` is a foreign product's own pricing and is never added to `costEur`, which is a harness pricing table in another currency.

### What a fleet may name

A plan naming a subagent implementer must name models the PROVIDER accepts verbatim. For `claude-code` those are the product's own ids and aliases, which is already what the bench composition's `llm-claude-code` catalog uses as its `productModel` values (`opus`, `sonnet`, `haiku`), so one plan compares the harness loop and the product loop under the same model names with no translation table.

### What the program ledger does not get

[`packages/improvement/program`](../../../../packages/improvement/program/README.md) delegates a department the same way, but its frozen `implementer` spec carries only `kind`, `provider`, and `label` — it names no model to forward. Giving it one means extending the frozen spec and its digest, which changes every existing program id, so this slice leaves a Known Limitation instead.

## Alternatives considered

**A bespoke `SUBAGENT_MODEL_UNSUPPORTED` error code.** The seam already rejects an unsupported start-time feature through one code, from one loop, over a flag-per-option table whose JSDoc states the one-to-one correspondence. A second code for the fifth option would be an unexplained asymmetry, and the rejection a caller must handle is the same one.

**Reading the reported model from the child session instead of the run result.** Only bridge mode has a child session; the black-box mode that a delegated cell actually uses has none. The result is the one place both modes can answer, and it is where the runner already reads `structured` and `stopReason`.

**Adding the reported tokens to `efficiency.inputTokens`.** That field is documented as the sum over this session's own `assistant/message` usage, and a delegated cell has none. Merging a foreign product's claim into it would make one number mean two things and would silently change what every existing row reports.

**Letting an in-process child report usage too.** The parent already holds that child's session and sums it into `environment/delegation.usage`; a second path to the same fact is a second source for it.

## Acceptance criteria

- A start naming `model` on a provider advertising `model: false` is rejected with `UNSUPPORTED_CAPABILITY` before the provider's `start` runs, and one on a provider advertising it reaches that provider verbatim.
- The real `claude` CLI, driven through the provider's keyless real-product test, sends the named model on its Messages request instead of the settings model, and reports it back through `init`; the same test's runs report the product's `usage` and `total_cost_usd` on the completed, errored, and cancelled paths alike.
- A delegated run records `reportedModel` and, for an out-of-process provider, `reportedUsage`/`reportedCostUsd` on `environment/delegation`, and every child of a run is started on the model the run's stamp carries.
- A run whose implementer provider advertises `model: false` is refused with `ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED` and creates no agent.
- Over the Loader-booted `examples/headless-agent/tests/fixtures/external-implementer/` composition, each delegation names the stamped model, the certified cell's facts state `implementerModel` and a non-zero `efficiency.delegated.inputTokens` while its own `inputTokens` stays `0`.

## Risks

**A model identifier that means two things.** `SubagentStartRequest.model` is a harness model id for an in-process provider and a product id for an out-of-process one, so a fleet that switches implementers without switching model names may name something one provider accepts and the other does not. The failure is loud — the product refuses an unknown `--model`, and an unregistered harness model fails the child's first request — but it is a run-time failure for the in-process case rather than a start-time one, since the seam does not hold the child's model registry.

**A reported cost that invites arithmetic.** `reportedCostUsd` and `costEur` are different currencies from different pricing authorities. The types keep them apart and the READMEs say so, but nothing prevents a consumer from adding them; a shared money type is the eventual answer and is not this slice.
