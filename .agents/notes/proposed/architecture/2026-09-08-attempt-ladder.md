# Agent Note: The attempt ladder and the transcript interface

Status: proposed

English | [中文](2026-09-08-attempt-ladder.zh.md)

## Problem

Every attempt of a cell runs on one model. [`EnvironmentRunner.run()`](../../../../packages/improvement/environment-runner/src/index.ts) resolves one route from `request.model`, stamps it, creates the cell agent on it, and drives `maxAttempts` attempts against it; the fleet forwards one route per cell and the experiments service freezes one route per arm. The routing questions the [hypothesis program](2026-09-07-hypothesis-program.md) exists to answer are therefore unaskable here. E5 needs a cell that starts cheap and escalates on its second attempt, and E6 needs repeated attempts on one tier at a matched budget; both are a model per attempt index, and the harness has no field for one.

The second half of the problem is a defect rather than a gap. A route implementer continues the same cell session, so the directive follow-up reaches a model that already holds the task statement and its own earlier work. A delegated implementer starts one fresh child per attempt through `ctx.subagents.start`, and that child was handed `followupText(directive)` alone: a `<validation_failed>` block naming failing checks of a task the child had never been told. The product loop was measured that way at tier 5 of the bench, and it recovered almost nothing on later attempts — an arm that was reported as the product's multi-attempt behaviour and was in fact the product being asked to continue work it had no statement of.

The two halves meet in one measurement. The routing results the program is testing — escalation recovers under half the gap and costs more than starting strong, and dropping the cheap transcript beats keeping it — are claims about what an attempt inherits. Running them needs the model per attempt AND a stated, correct answer to what each implementer carries between attempts, or the arms measure the defect instead of the hypothesis.

## Proposal

One field on the request, one fact on every attempt, and one named interface between them.

**The ladder.** `EnvironmentRunRequest` gains `ladder?: readonly { model?: EnvironmentRunModel }[]`. Attempt `i` runs on `ladder[i - 1].model`, or on `request.model` for a rung that names none. Present, the ladder's length is that run's attempt bound and overrides the composition's `maxAttempts`, because the caller that chose a model per attempt is the caller that chose how many attempts there are. `resolveLadder(ladder, model, maxRungs)` is the exported resolution step, alongside `resolveConfig` and `resolveImplementer`; an empty ladder and one past the configured `maxLadderRungs` fail with `ENVIRONMENT_RUN_INVALID_LADDER` before an agent exists, because a run with no attempt and a run past the deployment's ceiling are both misconfiguration rather than failure.

A rung is an object rather than a bare model so a later per-attempt choice — a per-attempt reasoning effort, a per-attempt budget — extends it without moving what a rung at a position already means.

**What each attempt states.** `EnvironmentRunStamp` gains `ladder`, the resolved routes in attempt order, present only for a run the caller laddered; `model` stays the first attempt's route, so a fold grouping by route still sees where a run started while a fold grouping by the arm sees the whole escalation. Every `EnvironmentRunAttempt` states the `model` it ran on. Model-visible stays logged without a new event: the request header of every step already records the model asked for, and the stamp and the attempt record state what was asked for rather than what a provider ran — which is why a delegated attempt's `environment/delegation` keeps carrying the child's own `reportedModel` beside it.

**How each implementer changes route.** A route implementer changes it through the `ModelSelectionRef` the runner already installs on the cell agent and now keeps: `selection.current` is set to the rung before the attempt's first turn, and [`installModelSelection`](../../../../packages/core/agent/src/model-selection.ts) applies it at the next prompt assembly. A delegated implementer is started on the rung's model id, since a provider names its own models; the rung's harness `provider` is a fact about the route the stamp records, never an argument a provider takes.

## The transcript interface

The two implementers are two instruments on the same ladder, and the difference is now named on every attempt as `transcript: 'kept' | 'dropped'`.

**`kept` is the route implementer.** Every attempt is another user turn of the one cell session. The model reads the task, its own earlier work, and each directive in order, and the follow-up is the `<validation_failed>` block alone because the task statement is already above it.

**`dropped` is the subagent implementer.** Every attempt is one fresh child holding nothing of the earlier ones. Its first prompt is the task statement; every later prompt is the task statement, a blank line, and the `<validation_failed>` block. That is the defect fixed: a child is given the work and the complaint, not the complaint alone. The `environment/delegation` event records `restatedTask`, `true` for exactly those later attempts, so a reader of a log can tell a restated prompt from a first one without the prompt text; `attempt` was already there.

`implementerTranscript(implementer)` is the exported answer and every attempt record carries it, so a reader comparing two arms of one ladder never has to know which implementer produced which row.

**The `keep` arm on a foreign child is a gap.** Keeping an out-of-process child's transcript across attempts would need the provider to resume the same foreign session, and [the subagent seam](../../../../packages/subagent/subagent/README.md) advertises no resume capability for the four out-of-process backends. The in-process [`spawn`](../../../../packages/subagent/subagent-spawn-in-process/README.md) provider is the route's `drop` counterpart instead: it runs the child on the parent's own composition and route, so a pair of arms differing only in the transcript interface is one composition away and needs no foreign product.

## The ladder in a plan

`FleetPlan.ladder` is forwarded verbatim to every cell, so one plan is one ladder and a fleet row cannot mix a laddered cell with an unladdered one; the fleet refuses a ladder with no rung once, at the plan boundary, and leaves the rung ceiling to the runner's config where a deployment states it.

`ExperimentArmPlan.ladder` rides through to every cell of that arm and is digested into the plan digest, one entry per rung with `null` for a rung that names no model. Its first rung is the arm's own route: it names either no model or exactly the arm's `provider` and `model`, and any other route is refused with `EXPERIMENT_LADDER_CONFLICT`. The arm's model is what the result and every scoreboard row are published under, so a first attempt on another route would publish the arm's identity over a route it never ran; requiring the first rung to be the arm keeps one meaning of `ladder` in the runner, the fleet, and the arm.

The scorekeeper's `SessionFactsEnvironment` and `ScoreboardRow` carry the rungs and the row key includes them, and the observatory publishes them as a `Ladder` column beside the route. Without that, a cheap-then-strong cell and a plain cheap cell would fold into one row on their shared first rung and the escalation would be invisible in exactly the comparison it was run for.

## The arms this enables

Each is one plan file over the bench, at `isolation: none`, both arms under one budget:

| Arm | Model | Ladder | Implementer |
|---|---|---|---|
| Start strong | the largest tier | `[{}, {}, {}]` | route |
| Cheap-then-strong, keep | the small tier | `[{}, { model: large }, { model: large }]` | route |
| Cheap-then-strong, drop | the small tier | the same three rungs | `spawn` |
| Downshift | the largest tier | `[{}, { model: small }, { model: small }]` | route |

E5 is the paired comparisons among them: start-strong against cheap-then-strong measures the handoff tax, the two cheap-then-strong arms differ only in the transcript interface, and the downshift arm against start-strong measures what the cheap tier retains. E6 is start-strong against the best of them at a matched token budget, which is the repeated-attempt arm the same ladder writes with rungs that name no model.

## Alternatives considered

**A per-attempt model on the composition's config instead of the request.** A deployment choice cannot vary per arm, and two arms of one experiment run in one composition. The ladder is what a plan compares, so it belongs to the plan.

**A bare `readonly EnvironmentRunModel[]`.** Simpler to write and closed to extension: the next per-attempt choice would either become a parallel array indexed by the same position or force every existing plan file to be rewritten. A rung object costs one pair of braces per rung today.

**Keep `maxAttempts` as the bound and let a shorter ladder repeat its last rung.** Then a three-rung ladder under `maxAttempts: 2` silently drops its third rung, and a one-rung ladder under `maxAttempts: 5` is indistinguishable from no ladder. One number decides how many attempts there are, and when a ladder is present that number is its length.

**Let the arm's model be the first rung implicitly, so the ladder names attempts two onward.** No conflict could then exist, at the price of `ladder` meaning one thing on a request and another on an arm — the arm's `ladder[0]` would be the second attempt. The refusal keeps one meaning everywhere and costs one repeated model in a plan file, which `{}` writes without repeating anything.

**Give the delegated child a transcript by replaying the earlier attempts' messages into its prompt.** The harness holds none of them: a child's turns stay in its own product, so the replay would be a summary the harness invented. Restating the task is the whole of what the harness honestly knows the child is missing.

**Fix the delegated follow-up without naming the interface.** The prompt would be correct and the two implementers would still differ silently in what an attempt inherits, which is the variable E5 is measuring. The fact is on every attempt record because it is what tells two arms apart.

## Acceptance criteria

- `ctx.environmentRuns.run` with `ladder: [{}, { model: <other> }]` runs two attempts under a composition configured for one, reports `attempts[0].model !== attempts[1].model`, stamps `model` as the first rung and `ladder` as both, and leaves the cell agent's model selection on the second rung. An empty ladder and one past `maxLadderRungs` reject with `ENVIRONMENT_RUN_INVALID_LADDER` before any agent is created.
- Over `examples/headless-agent/tests/fixtures/attempt-ladder/`, a Loader-booted keyless composition runs the same two-rung ladder twice — once on the route and once delegated to the in-process `spawn` provider — and the e2e reads back from the persisted logs that the route cell's `request/header` events name both rungs in order, that its follow-up carries the directive alone, and that the second child's own session was asked the task statement again ahead of the same directive.
- The `environment/delegation` of every later delegated attempt carries `restatedTask: true` and the first carries `false`; every attempt record carries `transcript`, `kept` for a route cell and `dropped` for a delegated one.
- A fleet plan and an experiment arm accept `ladder`, the experiments service refuses an arm whose first rung names another route with `EXPERIMENT_LADDER_CONFLICT`, and two arms that ladder differently freeze to two digests.
- A laddered cell and an unladdered cell on the same first rung fold into two scoreboard rows and publish as two observatory rows.

## Risks

- **A ladder multiplies what a plan spends.** Its length is the attempt bound, so a three-rung arm costs up to three attempts per cell where the deployment's `maxAttempts` allowed one. `maxLadderRungs` is the deployment's ceiling on that, and the budget policy's caps still stop a cell that runs past them; a plan that ladders is projected at its own length by whoever writes it.
- **The two transcript interfaces differ in more than the transcript.** A delegated child also brings its own system prompt, tools, and permissions, so a `keep`-versus-`drop` pair is only a clean contrast when both arms run the same provider — which is what the in-process `spawn` arm is for. A route-against-product pair measures the whole instrument, and its rows say so through `implementer`.
- **A rung records what was asked for.** A provider that silently serves another model makes the stamp a request rather than a fact; `reportedModel` on the delegation event is the only check, and only for a provider that reports one.
- **The restated prompt changes what earlier delegated runs measured.** Every recorded delegated multi-attempt cell under `data/` was run under the old follow-up, so its later attempts are not comparable with a cell run after this change. Those runs are a measurement of the defect and stay in the record as one.
