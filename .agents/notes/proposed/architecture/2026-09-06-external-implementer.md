# Agent Note: The external implementer, any coding agent under the runner's certificates

Status: proposed

English | [中文](2026-09-06-external-implementer.zh.md)

## Problem

The Proving Ground measures one implementer and one only: the harness itself. [`EnvironmentRunner.run()`](../../../../packages/improvement/environment-runner/src/index.ts) creates a cell agent through `ctx.agents.create`, installs the run's model selection on it, and drives its turns with `agent.followup` until the whole agent goes idle. Everything the certificate rests on hangs off that one agent — the `environment/run` stamp, the reservation the barrier mints for its session, the standard authored before the first turn, the check-owned digest, the checks the runner executes itself, `verification/run` with `executor: 'runner'`, the certificate, and the directive that opens the next attempt. The measurement is sound and the implementer is fixed.

So a comparison the harness cannot make is the one a customer asks for first: how does another coding agent do on the same environment, under the same standard, measured by the same validator? Today the only answer is to reimplement the environment suite inside that agent's own harness and compare two numbers that were produced by two validators, two fixtures, and two definitions of "passed" — which compares the scoreboards, not the agents.

The seam that would run such an agent already exists and is composed in shipped profiles. [`dsh-subagent`](../../../../packages/subagent/subagent/README.md) is a named-provider registry whose `start(name, request)` establishes one child run and resolves its terminal result, with the out-of-process providers [`subagent-claude-code`](../../../../packages/subagent/subagent-claude-code/README.md), `subagent-codex`, `subagent-acp`, and `subagent-dsh-sdk` launching a foreign agent in the delegating session's workspace, and the in-process `subagent-spawn-in-process` and `subagent-fork-in-process` running a child on the parent's own composition. Nothing connects that seam to the runner, so the harness can delegate a subtask from a tool call but cannot delegate the work of a measured cell.

The [read barrier's slice 5](2026-09-05-read-barrier.md) already decided what an out-of-process child costs a claim: such a provider registers `enforceByRefusal('subagent')` and refuses every implementer start under a `process` or `host` isolation claim, recording `unenforced` under `none`. Nothing states what that means for a run whose *whole implementer* is that child, because no such run exists.

## Proposal

Give the run request one more field and the attempt loop one more way to do the work, and change nothing else about what the runner measures.

**The request field.** `EnvironmentRunRequest` gains `implementer?: { kind: 'route' } | { kind: 'subagent', provider: string, label? }`, and `resolveImplementer(request)` is the exported defaulting step that answers `{ kind: 'route' }` for a request that names none — the same request/spec split `resolveConfig` uses for the deployment's own choices. `route` is the run the harness already does: the cell agent's own model route implements the task. `subagent` names one registered `ctx.subagents` provider, and every attempt of the cell becomes one child run on it.

The provider is validated before an agent exists, against the composition rather than against a name list. A request naming a provider fails with `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` when `ctx.subagents` is not composed and when it holds no provider under that name, each message naming the provider it could not resolve. A provider that runs its child **outside this process** fails with `ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED` whenever the deployment's `isolation` is above `none`: the read-barrier census cannot confine a foreign agent that brings its own tool stack, so a certificate claiming `process` or `host` over it would assert something no executor enforced. An in-process provider is refused nothing, because its child joins the parent's standing composition through the agent factory and keeps the deployment's own isolation. Which providers are which is the subagent seam's own fact, published as `runsOutOfProcess(capabilities)` beside `NO_START_CAPABILITIES`: a child in another process honors none of the four parent-enforced start features, and an in-process driver composes the child itself and enforces all of them.

**The delegated attempt loop.** For `kind: 'subagent'` the runner creates the cell agent and its session exactly as today — the stamp, the budget caps the deployment composed, the standard authored before any work starts, the reservation under the read barrier, `agent/session-start` — and then, instead of sending the task as a user turn, starts one child run per attempt:

```ts ignore-check
ctx.subagents.start(provider, { prompt: [attempt text], parent: cellAgent, signal, label })
```

The attempt text is the environment's task prompt on the first attempt and the directive follow-up on every later one, which is the same text the route implementer receives; the child's working directory is the cell workspace, because every provider derives the child's cwd from the delegating parent session's `cwd` and the runner already creates the cell agent with `meta.cwd = workspace`. The runner awaits the run's result, appends one durable `environment/delegation { attempt, provider, runId, stopReason, structured?, usage? }` to the cell session, and disposes the run. Then it validates exactly as today: the check-owned digest, the checks executed by the runner through `ctx.shell`, `recordRun` with `executor: 'runner'`, and a certificate or a directive.

A child that ends in any way at all is still validated. A refusal, an error, or a cancellation leaves the workspace as the child left it, and the checks decide what that is worth — the run's verdict is what the tree does, never what the implementer reported about itself.

**What a delegated certificate proves, and what it does not.** It proves that the runner ran the standard's checks, itself, on the tree the external agent left, after restoring its immutable paths from the fixture and after finding the check-owned set unchanged. That is the whole of what a `runner` certificate ever proved, and delegation does not weaken it: no part of the measurement moved into the child.

It does not prove anything about how the work was done. No model-visible history of the external implementer reaches our log: the child's prompts, tool calls, and reasoning stay in its own product, so a delegated cell's session carries the stamp, the standard, the delegation records, the runs, and the certificate, and no assistant turn at all. The trajectory exported from it therefore carries no step, and it is not training data — it is a measurement. Its usage is the same: an in-process child's spend is recorded on the delegation event because that child ran on our own route, and an out-of-process child's is absent because this process never saw a token of it.

**The census under a delegated cell.** Nothing new records it. A composition that mounts an out-of-process provider registers `enforceByRefusal('subagent')`, so the cell session's `read-barrier/scope` names `subagent` as `unenforced` under an `isolation: none` deployment — with the reason the barrier already writes — and as `denied-at-executor` under a claim above it, where the runner refused the run before it started. The stamp is what names the provider that ran, so a fold reads the implementer from the same record it reads the route and the isolation from.

**Fleet, shifts, and the leaderboard.** `FleetPlan.implementer` and `ShiftDistrictConfig.plan.implementer` forward one implementer to every cell of a plan, and the shift digest freezes it, so a district that changes implementer opens a new shift identity instead of resuming the old one. `EnvironmentRunStamp` gains `implementer`, the string the runner stamps every run with: `route` for the composition's own model route, the provider name for a delegated one. The scorekeeper's `SessionFactsEnvironment` reads it, the scoreboard row key carries it, and the observatory publishes it as one more column — so two implementers on one environment are two rows, never one averaged row. A row that averaged an external coding agent's certificate rate together with the harness's own would answer no question anyone asked.

## Alternatives considered

**Run the external agent through a tool the cell agent calls.** `dsh-tool-subagent` already exposes exactly that, and a preset could give the cell agent a `subagent_claude_code` tool. Then the harness is the implementer and the external agent is its subcontractor: the route writes the prompts, decides when to stop, and appears in the trajectory. That measures the harness's delegation skill, not the other agent.

**Let the external agent report its own checks.** `RunEvidence.executor` already distinguishes `agent-reported` from `runner`, and `recordRun` caps an `agent-reported` run at `isolation: none`. Asking the child for its verdict would be cheaper and would produce a number that no longer means the same thing as the harness's own. The runner keeps executing the checks; that is the only reason the two rows are comparable.

**Add a second runner for external implementers.** A parallel service would duplicate the stamp, the reservation, the tamper digest, the certificate, and the directive loop, and the two copies would drift on exactly the details a comparison depends on. The implementer is one field on the request because everything else about the measurement must stay literally the same code.

**Name the out-of-process providers in the runner's config.** A name list goes stale the moment a provider is added and a deployment could shorten it to get its claim accepted. The provider's own capability advertisement is what the seam already uses to reject accepted-then-ignored features, and it fails closed: a provider that advertises nothing is treated as unconfinable.

**Fold the delegated child's tokens into the run report.** The report's `usage` sums the cell session's own assistant messages, and a delegated cell has none. Adding the child's spend there would make one number mean "what this session cost" for a route cell and "what some other agent cost" for a delegated one. The delegation event carries what this process can honestly account for, and the report keeps its meaning.

## Acceptance criteria

- Over `examples/headless-agent/tests/fixtures/external-implementer/`, a Loader-booted composition whose cells delegate to the in-process `spawn` provider over the mock route certifies `smoke:round-trip`, fails `smoke:unsatisfiable` after two attempts, and leaves one `environment/delegation` event per attempt in each cell session, each naming its own child run. A unit spec over a stubbed subagent service pins the prompts those children receive: the task statement first, the `<validation_failed>` follow-up the failed attempt produced second.
- The stamp, the exported facts, and the leaderboard row of those cells all carry `implementer: 'spawn'`, and a route-implemented cell of the same environment carries `implementer: 'route'`; the scoreboard folds them as two rows.
- `ctx.environmentRuns.run` with `implementer: { kind: 'subagent', provider: … }` rejects with `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` when no subagent service or no such provider is composed, and with `ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED` for an out-of-process provider under `isolation: 'process'`, in all three cases before any agent is created.
- `examples/headless-agent/tests/fixtures/village-claude-implementer/` composes the `claude-code` provider with the runner, the fleet, the budget policy, persistence, the checkpoint policy, the scorekeeper, the observatory, and the trajectory exporter, and `verify-village-composition` accepts it. Its e2e drives the real product on the host's own authentication and self-skips unless `DSH_E2E_CLAUDE_CODE=1` is set, because nothing in CI holds that account.

## Risks

An external implementer sees the workspace and nothing else the harness controls. Its own settings decide its model, its tools, and its permissions, so two runs of one provider on two hosts are not the same implementer even though the stamp names them alike. The stamp records the provider, never the product version or the account behind it, and a published comparison has to say so.

A delegated cell's certificate is only as good as the immutable set the environment declared and its restoration, exactly as a route cell's is — but the external agent is likelier to reach outside the task than a preset-composed harness agent, because no `tools.restrict()` or read barrier of ours applies to it. At `isolation: none` that is stated rather than prevented, and above `none` the run is refused instead.

The delegated trajectory is empty of steps by construction. A pipeline that reads trajectories without checking the implementer would train on a certified session that contains no work; the `implementer` field on the stamp is what a curated export has to filter on, and nothing yet forces it to.

Concurrency multiplies processes. A fleet at `maxConcurrent: n` delegating to an out-of-process provider runs `n` foreign agents at once, each with its own installation, cache, and network use, and the harness's token ceiling cannot see any of it — only the deployment's own limits apply.
