# Agent Note: The W3 feed fields — sampling on the call configuration, policy version and seed on the run stamp, near-duplicate admission

Status: proposed

English | [中文](2026-09-06-w3-feed-fields.zh.md)

## Problem

Rollout item 8 of the [Daliesk Village note](2026-09-05-daliesk-village.md) names four things the Proving Ground needs before it feeds a reinforcement-learning step: `policyVersion` and `seed` on the stamp, masked terminal reasons in the trajectory fold, near-duplicate admission against the held-out suite, and a device-slot resource in the budget policy. The first and third are blocked on vocabulary the harness does not have. Nothing in `LlmCallConfig` can pin a sampling seed, so a group of rollouts cannot state what it sampled with and two cells of one repetition index are not comparable by construction. Nothing on `EnvironmentRunStamp` names the checkpoint a route served, so the `EnvironmentStats` fold that W1 stage 2 and W3 stages 2 and 9 read cannot key measured difficulty by policy version — the gap [J3 named in the council review](2026-09-05-daliesk-village.md#council-review). And the environment registry admits any prompt a producer declares, so a synthesized training environment may restate a held-out one and quietly contaminate every number computed from the split.

## Proposal

Land the first half of item 8: the sampling vocabulary, the two stamp fields with their forwarding through the fleet, experiments, and shifts, and near-duplicate admission. Masked terminal reasons in the trajectory fold and the device-slot budget stay open and are not touched here.

### Sampling on the call configuration

`LlmCallConfig` gains `seed?: number` (a safe non-negative integer) and `topP?: number` (0 to 1) beside `temperature`, so both are epoch-level state the loop logs in `request/header` rather than a per-call knob. `GenerateOptions` gains the same two fields, `callConfigEquals` compares them, and the DeepSeek adapter serializes them as `seed` and `top_p` exactly as it serializes `temperature`. An adapter whose wire has no equivalent — `@deepseek-ai/dsh-llm-pi-ai`, the mock server, the replay provider — builds its request field by field and therefore drops them, which is the intended behaviour rather than a gap.

A replay reconstructs what a run *asked for*, never what the provider did with it. Providers may ignore a seed, and none of them promise identical tokens across model or infrastructure versions; the logged value is the request, and the transcript is what the log actually reproduces. Every README that documents the fields says so in those terms.

`ModelSelectionRef` gains `sampling?: AgentSampling`, applied by the `agent/request` listener `installModelSelection` already registers. Sampling deliberately stays out of `ModelSelection`: a person picking a model picks a route and a reasoning effort, while a seed is chosen by whatever composed the Agent, and widening `ModelSelection` would push a seed into the user-facing model picker and the API surface behind it.

### `policyVersion` and `seed` on the stamp

`EnvironmentRunRequest` gains optional `policyVersion` (free-form; the harness never resolves it) and optional `seed`, and `EnvironmentRunStamp` carries both. The runner refuses a seed that is not a safe non-negative integer, writes both fields into the stamp, and pins `{ seed, topP }` as the session's sampling so every request of the cell samples identically. `topP` is a runner `Config` field rather than a request field: a suite compares cells only while every cell samples the same way, so it is a deployment choice, while the seed varies per cell by design.

A `FleetPlan` and an `ExperimentPlan` gain `policyVersion` and a **base** `seed`; each cell runs with `seed + repetition`. One repetition index therefore means one seed across every route and environment of a plan, which is what makes the paired experiment design compare like with like. A `ShiftDistrictConfig.plan` gains both, freezes them into `ShiftPlan`, and forwards them to the fleet run.

The stamp carries `seed` but not `topP`, because the seed is what distinguishes two cells of one plan while `topP` is constant across the deployment and already reconstructable from `request/header`.

### Near-duplicate admission

`EnvironmentRegistry` gains `Config.nearDuplicate?: { threshold }`. When it is set, registering a training-eligible environment whose prompt reaches `threshold` against any registered held-out environment is refused, and so is a held-out environment that reaches it against a registered training-eligible one — contamination is symmetric, and which side registers second is an accident of composition order. The similarity is the Jaccard coefficient of word 5-gram shingles over a prompt lower-cased, with every run of non-alphanumeric characters as one separator and the resulting whitespace collapsed; a prompt shorter than five words contributes its whole word list as one shingle, so two identical short prompts still score 1. The refusal names both ids, the similarity, and the threshold. Absent config keeps today's behaviour: whatever a producer declares is registered.

`ctx.environments.nearestHeldOut(prompt)` returns the nearest held-out environment and its similarity whether or not a threshold is configured, so the curator of [W3 stage 1](2026-09-05-four-goal-workflows.md) can score a proposal before paying for a run.

### Deviations from the notes

**The Village note says "the stamp gains `policyVersion` and `seed`" and nothing about `topP`.** `topP` is added to the call configuration because a seed without a nucleus mass is only half a sampling pin, but it is deployment state: it lives on the runner's `Config`, not on a plan or a request, and it stays off the stamp because `request/header` already records it.

**A seed is refused at three places rather than one.** The runner refuses one it is about to stamp, and the fleet and experiment plans refuse a base they are about to do arithmetic on, so a bad base fails the plan instead of surfacing as every cell failing separately. All three read one exported `isSeed`, so the three refusals cannot drift apart.

**The four-goal-workflows note lists `harnessVariant` and `reasoningEffort` as proposed stamp extensions beside these two.** Both stay open here; `harnessVariant` waits for the [composition manifest](2026-09-05-composition-manifest.md), and a reasoning effort is already reconstructable from `request/header`.

**The experiment plan digest freezes `policyVersion` and `seed`, which no note asked for.** Both arms' sessions are found in the logs by the groups the digest mints, so two comparisons that differ in either field would otherwise collide on one group and blend in a fold. `EXPERIMENT_PLAN_VERSION` and `SHIFT_PLAN_VERSION` both move to `2`; pre-release, no stored digest is honoured across the change.

**`nearestHeldOut` is a registry method rather than a free function.** It reads the registry inventory, which no free function can reach.

## Alternatives considered

**Put the seed on `AgentOptions` instead of the call configuration.** Rejected: `AgentOptions` is creation metadata that no session event carries, so a seed there would reach a model request without being reconstructable from the log — the model-visible ⟺ logged rule. `LlmCallConfig` is already logged as `request/header`.

**Widen `ModelSelection` with the sampling scalars.** Rejected: it is the persisted, user-facing route selection behind `agent-default-model` and the model-picker UI, and a seed is not something a person picks with a model.

**Derive each cell's seed by hashing the cell key instead of `base + repetition`.** Rejected: a hash makes a seed unpredictable from the plan, so an operator cannot reproduce one cell without reading its stamp, and paired designs would need the hash to agree across arms anyway. Addition gives the same pairing with an arithmetic anyone can restate.

**Admit near-duplicates and filter them at export instead.** Rejected: the run has already been paid for by then, and a contaminated environment that reached the registry is visible to every consumer between registration and export.

**Compare prompts by embedding distance rather than shingles.** Rejected: it needs a model call at registration time, which makes composition-time registration asynchronous and non-deterministic. Shingled Jaccard is deterministic, needs nothing but the two prompts, and catches the restatement case the split is exposed to.

**Refuse only the training-eligible side.** Rejected: the held-out suite is sometimes extended after training environments exist, and the contamination is identical in that direction.

## Acceptance criteria

- A session whose run pinned a seed carries it on `environment/run` and in the `request/header` that built every one of its requests, and a fleet plan with a base seed produces cell seeds `base + repetition` on the stamps, proven by unit tests and one assertion in the fleet e2e.
- The DeepSeek adapter emits `seed` and `top_p` exactly when the request carries them; adapters without those wire fields still round-trip a request that carries them.
- With `nearDuplicate` configured, a fixture pair whose similarity sits just below the threshold registers and one that reaches it is refused with an error naming both ids and the similarity, in both directions across the split.
- `decodeEnvironmentRun` accepts a stamp carrying either new field and refuses a seed that is not a non-negative integer.
- Absent `nearDuplicate`, absent `seed`, and absent `policyVersion` leave every existing transcript and stamp unchanged.

## Risks

- **A seed reads as a reproducibility promise.** No provider offers one across model versions, and the harness cannot detect a provider that ignored the field. Every place the seed is documented states that it records the request, not the outcome; a leaderboard that presents seeded rows as reproducible would repeat the Village's credibility problem in the opposite direction.
- **A threshold is a blunt instrument.** Word shingles catch restatement and miss paraphrase, so admission is a floor, not proof of independence. A curator reading `nearestHeldOut` before proposing is the intended workflow; the threshold only stops the obvious case.
- **A plan digest that freezes more fields invalidates fewer resumptions.** A district that changes its policy version opens a new shift identity rather than resuming the old one. That is correct — the cells measure a different thing — but an operator who edits a policy version mid-week will see a fresh shift rather than a continuation.
- **Half of rollout item 8 remains.** Masked terminal reasons in the trajectory fold and the device-slot budget are untouched; until the fold masks them, truncated, aborted, and provider-error sessions still score as failures, and no reinforcement-learning step should read these groups.
