# Agent Note: The RLVR base model and the recipe that trains it

Status: proposed

English | [中文](2026-09-19-rlvr-recipe-and-base-model.zh.md)

## Problem

The third objective is a roughly 120B open-weight model trained by RLVR on this harness's certified runs, and [the objectives note](../process/2026-09-19-objectives-step-back.md) lists its three blockers in order: a key for an open-weight route, the base-model decision, and compute. This note closes the second one and writes the recipe, so that when a key and compute arrive the only remaining work is running it.

Three facts bound what this note can be. No experiment can be run here: the repository has no open-weight route, no training compute is attached to it, and nothing below has been measured. The training corpus is empty: every one of the 32 recorded runs ran on the operator's Claude Code login under an agreement that admits `evaluation` alone, [`dsh-data-use`](../../../../packages/governance/data-use/README.md) forbids widening a session's purposes after the fact, and [`dsh-curator`](../../../../packages/governance/curator/README.md) withholds every session whose terms do not admit an export's purpose — so [the v1 fold](../../../../data/proving-ground/datasets/2026-09-18-proving-ground-v1/README.md) is a dry run of the record format and the reward basis, not training data, and no later decision can make it training data. And the recipe below is a plan: its numbers are projections from recorded token totals, not results.

## Proposal

Train **Qwen3.5-122B-A10B** with an SFT warm-up on certified `dsh-trajectory/1` records followed by GRPO whose reward is the environment runner's own certificate, over the bench environments, reporting only the held-out split.

### The base model

Every candidate at or near 120B total parameters that is open-weight, published with a downloadable checkpoint, and current as of today. The Hub listings for `openai`, `zai-org`, `Qwen`, `mistralai`, `moonshotai`, `MiniMaxAI`, `nvidia`, `inclusionAI`, and `ByteDance-Seed` were read on 2026-09-19; nothing else in that size class appeared.

| Model | Licence | Total / active | Architecture | Context | Tool calling | Weight format | Source |
|---|---|---|---|---|---|---|---|
| Qwen3.5-122B-A10B | Apache-2.0 (verbatim text in `LICENSE`) | 122B / 10B | MoE, 48 layers, 256 experts (8 routed + 1 shared), Gated DeltaNet linear attention with gated attention every fourth layer, vision encoder, MTP | 262,144 native, 1,010,000 with YaRN | Native; Qwen-Agent, Qwen Code, vLLM, SGLang | BF16 safetensors, 39 shards; official FP8 and GPTQ-Int4 siblings | https://huggingface.co/Qwen/Qwen3.5-122B-A10B |
| gpt-oss-120b | Apache-2.0 | 117B / 5.1B | MoE, 36 layers, 128 experts, 4 per token, harmony response format | 131,072 | Native function calling, browsing, Python | MXFP4 MoE weights; attention, router, embeddings and `lm_head` unquantized | https://huggingface.co/openai/gpt-oss-120b |
| GLM-4.5-Air | MIT | 106B / 12B (Hub reports 110B) | `glm4_moe`, hybrid thinking and direct modes | 128K | Native; tool parser in transformers, vLLM, SGLang | BF16, official FP8 sibling | https://huggingface.co/zai-org/GLM-4.5-Air |
| Mistral-Small-4-119B-2603 | Apache-2.0 | 119B / 6.5B | MoE, 128 experts, 4 active, multimodal, per-request reasoning effort | 256K | Native; `--tool-call-parser mistral` | safetensors; official FP8, NVFP4 and EAGLE siblings | https://huggingface.co/mistralai/Mistral-Small-4-119B-2603 |
| Devstral-2-123B-Instruct-2512 | "Modified MIT", barred above $20M consolidated monthly revenue | 123B (Hub reports 125B) | `ministral3` | 256K | Native | FP8 checkpoint only | https://huggingface.co/mistralai/Devstral-2-123B-Instruct-2512 |
| Qwen3-Next-80B-A3B-Instruct | Apache-2.0 | 80B / 3B | MoE, 512 experts, 10 activated, Gated DeltaNet hybrid, MTP, no thinking blocks | 262,144 native, 1,010,000 with YaRN | Native | BF16 | https://huggingface.co/Qwen/Qwen3-Next-80B-A3B-Instruct |
| Qwen3-Coder-480B-A35B-Instruct | Apache-2.0 | 480B / 35B | `qwen3_moe` | — | Native | BF16 | https://huggingface.co/Qwen/Qwen3-Coder-480B-A35B-Instruct |
| Qwen3-Coder-30B-A3B-Instruct | Apache-2.0 | 30.5B / 3B | `qwen3_moe` | — | Native | BF16 | https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct |

Published coding and agentic results, each as its publisher reports it:

| Model | SWE-bench Verified | Terminal Bench 2 | LiveCodeBench v6 | Other | Reported by |
|---|---|---|---|---|---|
| Qwen3.5-122B-A10B | 72.0 | 49.4 | 78.9 | CodeForces 2100, BFCL-V4 72.2, TAU2-Bench 79.5 | Qwen, on the model card, 2026-09-19 |
| gpt-oss-120b | 62.4 | 18.7 (Qwen's table) | 82.7 (Qwen's table) | 62.0 in Qwen's table | OpenAI model card, https://arxiv.org/abs/2508.10925, 2025-08-05; Terminal Bench 2 and LiveCodeBench from Qwen's card |
| GLM-4.5-Air | not published in the sources read | — | — | 59.8 average over 12 benchmarks, against GLM-4.5's 63.2 | z.ai model card; the GLM-4.5 report at https://arxiv.org/abs/2508.06471 gives 64.2 for the 355B GLM-4.5, not for Air |
| Mistral-Small-4-119B-2603 | not published on the card | — | claimed above gpt-oss-120b with 20% less output | AA-LCR 0.72 at 1.6K characters | Mistral, on the model card, 2026-09-19 |
| Devstral-2-123B-Instruct-2512 | 72.2 | 32.6 | — | SWE-bench Multilingual 61.3 | Mistral, on the model card, 2026-09-19 |
| Qwen 3 Coder Plus (480B) | 69.6 | 25.4 | — | SWE-bench Multilingual 54.7 | Mistral's comparison table on the Devstral 2 card, 2026-09-19 |

Known RL recipes, all read 2026-09-19:

- **Qwen3.5-122B-A10B.** verl supports the Qwen3.5 series with Ulysses sequence parallelism and ships a GRPO demo (https://github.com/verl-project/verl/issues/6061); later pull requests carry `examples/grpo_trainer/run_qwen3_5_122b_a10b_megatron.sh` (https://github.com/verl-project/verl/issues/6582, https://github.com/verl-project/verl/issues/6587). slime carries Qwen3.5 model and weight-bridge plugins (https://github.com/thudm/slime/issues/1641, https://github.com/thudm/slime/issues/1676) and a fix for cross-sequence state leakage in its packed linear-attention path (https://github.com/thudm/slime/issues/1686). Osmosis reports GRPO on this exact checkpoint at 16×H200 for LoRA and 64×H200 for full fine-tuning, TP=2 and EP=8, 16K context, with LoRA 44% above full fine-tuning in token throughput (https://osmosis.ai/blogs/unlocking-lora-moe-rl-for-qwen3-5, published 2026-04-03).
- **gpt-oss-120b.** LoRA and QLoRA through Unsloth and TRL. The MXFP4 kernels implement no backward pass, so training in any other library requires upcasting the MoE weights to BF16, and BF16 LoRA needs about 210 GB of VRAM against about 65 GB for QLoRA (https://unsloth.ai/docs/models/gpt-oss-how-to-run-and-fine-tune).
- **The GLM line.** slime is the framework its vendor trains it with, for GLM-4.5 through GLM-5.3 (https://github.com/THUDM/slime).
- **Mistral Small 4.** The card points at Axolotl for fine-tuning. No RLVR recipe at this size appeared in the sources read.
- **Devstral 2 123B.** No published RL recipe appeared in the sources read.

**Recommendation: Qwen3.5-122B-A10B. Runner-up: Mistral-Small-4-119B-2603.**

The two reasons that decide it. First, it is the only model in the size class that is permissively licensed, published as BF16 weights, and already has a working RLVR path at exactly this size — a named verl GRPO script for the 122B-A10B checkpoint, slime plugins for the architecture, and a third-party GRPO run on 16 to 64 H200s. Everything else forces a compromise: gpt-oss-120b's MXFP4 weights have no backward pass and must be upcast before a single gradient step; Devstral 2 123B, the one model whose SWE-bench number matches, is barred by its revenue clause; Mistral Small 4 is licensed correctly but publishes neither a SWE-bench number nor an RL recipe. Second, its published agentic results lead the class on the axis this harness actually measures — a terminal, a shell, a test command and a validator: Terminal Bench 2 at 49.4 against 32.6 for Devstral 2 and 18.7 for gpt-oss-120b, with SWE-bench Verified at 72.0, level with Devstral 2. Its 262,144-token native context also covers the rollouts the bench produces, whose tier-5 cells recorded up to 53,787 output tokens each.

What would change the choice. A GLM model returning to the 106B-to-130B class under MIT would win on first-party RL tooling, because slime is what its vendor trains it with; z.ai's mid-size line currently runs 31B (GLM-4.7-Flash) and 321B (GLM-5.3-Flash), with nothing between. A requirement that the reported number be repository-scale editing rather than terminal work would put Devstral 2 123B level, which only its licence then excludes. A requirement for a text-only checkpoint — Qwen3.5-122B-A10B carries a vision encoder — moves the choice to Qwen3-Next-80B-A3B-Instruct at 80B. A hard ceiling of one 8-GPU node for the whole training job moves it to gpt-oss-120b on 5.1B active parameters, accepting the upcast. And a legal review that reads Qwen's `LICENSE` as anything other than the verbatim Apache 2.0 text it contains moves it to Mistral Small 4.

### The recipe

#### The corpus

Only sessions whose pinned `dataUse/terms` admit `training` may enter it, which today means sessions produced by a route on an open-weight model under an agreement that lists that purpose. No such route exists here, so the corpus is empty and stays empty until the open-weight overlay lands. [The v1 fold](../../../../data/proving-ground/datasets/2026-09-18-proving-ground-v1/README.md) — 521 trajectories, 367 at reward `1`, 48 at `0`, 106 unmeasured — exercises the record format, the credential scan, the exclusion rules and the reward basis, and is not training data; [`build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs) is the tool a real fold will reuse unchanged.

#### The SFT warm-up

One `dsh-trajectory/1` record is one training sequence. Its fields map as follows, and [`dsh-trajectories`](../../../../packages/improvement/trajectories/README.md) owns their definitions:

- `system` becomes the system message verbatim, and `tools` the tool schemas, both rendered into the position the target model's own chat template puts them. Neither is re-authored: the warm-up must teach the tool surface the RLVR rollouts will see.
- `messages` becomes the chat sequence in the order it holds, `user` and `tool` roles as context and `assistant` as the target. The loss covers assistant content blocks and `toolCalls[].arguments` and nothing else.
- Reasoning blocks are kept on the turn being predicted and dropped from history, which is what Qwen3.5's own chat template does with thinking content.
- `environment` is the split key: it carries `heldOut`, the prompt, fixture and checks hashes, the repetition and the group, so deduplication and the held-out withholding are decided from the stamp rather than from the text.
- `reward.outcome` is the row filter. Only `1` enters the warm-up, which the exporter's `rewardedOnly: true` already produces.
- `config`, `steps` and `provenance` are not trained. `provenance` pins the warm-up to one composition so its tool schemas match the rollouts'.

Attempts and directives need no special handling. A route-implemented run keeps its transcript, so every attempt of a cell is one session and one record, and the validator's `<validation_failed>` block is already an ordinary user message inside `messages`. The warm-up therefore trains the whole recovery — failed edit, directive, fix, stop — as one sequence, which is the behaviour the harness exists to produce. Do not split attempts into separate samples: a directive means nothing without the work above it.

Failed attempts are not kept as negatives in the warm-up. A trajectory whose outcome is `0` is excluded entirely and reserved for the RLVR stage, where it is the negative half of its own group. Rejected attempts *inside* a certified trajectory stay in the sequence and are trained on; the ablation that masks them is an acceptance criterion below, not a settled choice.

#### The RLVR stage

One rollout is one cell: one `ctx.environmentRuns.run()` call on one environment in a fresh workspace with the environment's fixture overlaid, its goal created, and its completion standard authored from the environment's own checks before any work starts ([`dsh-environment-runner`](../../../../packages/improvement/environment-runner/README.md)).

The reward is the certificate and nothing else. `reward.outcome` is `1` when a certificate covers the current standard revision and `0` when a standard exists without one. A run whose last `verification/run` carries `verdict: 'tampered'` scores `0` and stays in its group: editing the validator's files is a behaviour to penalize, not a measurement to discard, which is where the RLVR reward deliberately departs from the corpus builder's rule of excluding tampered rows unconditionally.

Parity — the weighted pass fraction over the validator's hidden cases — is **not** in the loss, in any form, shaping included. `dsh-trajectories` states why: a pass rate rewards a candidate that overfits the failing cases it was shown and abandons the rest. Parity is used outside the loss, for two things: ordering which environments to resample when a group has no variance, and retiring an environment whose parity stays flat at zero across epochs into a too-hard pool. Both are logged; neither reaches a gradient.

The algorithm is GRPO with group-relative advantages, no value network, clip-higher, and no KL term to a reference policy — the warm-up is the reference, and holding the policy near it caps exactly the gain the stage is for. Groups with zero reward variance are dropped rather than shaped, so a saturated environment costs its rollouts and no gradient. Group size is 8: one environment, eight cells at seeds `base + 0` through `base + 7`, which is what `repetitions: 8` on a fleet plan already produces, since each cell runs at `seed + repetition` ([`dsh-fleet`](../../../../packages/improvement/fleet/README.md)). Rollout context is capped at 131,072 tokens; per-cell spend stays on the caps [the bench composition](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/cordis.yml) already sets, `maxTotalTokens: 1500000` and `maxWallMs: 1200000` ([`dsh-budget-policy`](../../../../packages/guard/budget-policy/README.md)). Attempts stay at the composition's `maxAttempts: 3`, so a rollout measures the same thing a bench cell measures.

#### What is reported

The certificate rate on the eight held-out environments, and nothing else: `code:glob-brace`, `code:ini-parse`, `code:kv-log-store`, `code:lru-ttl-cache`, `code:retry-policy`, `code:semver-ranges`, `code:topo-sort`, `code:wrap-justify`. They are already withheld everywhere it matters — the runner stamps `heldOut`, the exporter withholds such sessions unless asked otherwise, and the observatory withholds them — and the checked-in `held-out-sonnet-all` plan runs exactly them at `repetitions: 2` ([plans](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/plans/README.md)). Eight environments at two repetitions is sixteen cells, so one flip is 6.25 points: this split is a smoke test of the pipeline, not a number to publish. Growing the held-out split is a precondition of reporting, not a follow-up.

#### Compute for one epoch

Assumptions, all stated so each can be checked: 32 trainable environments of the 40 registered, eight held out; group size 8; one epoch is one pass, so 256 rollouts. Generated tokens per rollout come from the recorded fleet leaderboards under [the records](../../../../data/proving-ground/README.md) — 11,911 per cell at tier 4, 13,242 at tier 2, 18,852 at tier 3, 53,787 at tier 5, and 22,704 across the held-out sweep — giving 20,000 to 55,000 per rollout. Sequence length per rollout, prompt and completion together, is 30,000 to 100,000 tokens, derived from the v1 manifest's 178,531,239 prompt tokens over 6,966 model calls, about 25,600 per call. Active parameters are 10B. Forward cost is `2 × A × tokens`, a training step `6 × A × tokens`.

- Generated per epoch: 5.1M to 14.1M tokens. Sequence tokens per epoch: 7.7M to 25.6M.
- Generation, prefill included: 0.26 to 0.79 EFLOP. Policy update: 0.46 to 1.5 EFLOP. Total **0.7 to 2.3 EFLOP per epoch**, which is 1 to 4 H200-hours of arithmetic.
- Wall clock is set by rollout latency, not arithmetic. At NVIDIA's measured 720.3 output tokens per second per GPU for this checkpoint on an agentic trace of 64K median input and 400 median output at a 90% KV-cache hit rate (H200, FP8, TP2 with MTP; https://github.com/ai-dynamo/dynamo/blob/5593e8857c508bebce7259e107a85c57cd142fd8/docs/fern/pages/recipes/model-recipes/qwen3-5-122b.mdx, read 2026-09-19), one 8×H200 node decodes an epoch's tokens in 0.25 to 0.7 hours. Check execution adds 256 cells at tens of seconds each — a tier-5 cell runs up to 170 validator cases one process at a time ([`code:uri-resolve`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/environments/uri-resolve/task.json)) — which is 0.2 to 0.9 hours at the concurrency the fleet already supports.
- **One epoch: 1 to 4 hours** on the Osmosis configuration of 16×H200 for LoRA, or 64×H200 for full fine-tuning. At one policy update per epoch, a run of 50 to 150 updates is 50 to 600 hours — two days to three and a half weeks — and the arithmetic is never the constraint.

The constraint is the prompt set. Thirty-two environments at group size 8 is 256 rollouts per epoch, which is one to two orders of magnitude below what published RLVR runs use, and the bench is saturated below tier 5 by every model measured so far. More environments, not more GPUs, is what the recipe needs next.

#### How the harness serves rollouts today

Without a line of new code: `pnpm run bench -- fleet <plan>` runs one checked-in plan through [the bench wrapper](../../../../scripts/proving-ground.ts); `ctx.fleet.run(plan)` enumerates environment × model × repetition cells, each in its own fresh workspace, at most `maxConcurrent` in flight, with a per-route breaker and a token ceiling, and returns one leaderboard row per route and environment; `ctx.environmentRuns.run()` is the rollout and the certificate is already in the session log; `policyVersion` is free-form text written verbatim into every stamp, which is where the checkpoint identity goes so a fold can key reward by checkpoint; and the run directory's exported trajectories are the `dsh-trajectory/1` lines a trainer reads. [`dsh-experiments`](../../../../packages/improvement/experiments/README.md) gives the frozen paired comparison for measuring a checkpoint against its predecessor.

#### The smallest code additions, named

1. **Route the bench exports through the curator.** [fleet-driver.ts](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/fleet-driver.ts) and [experiment-driver.ts](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/experiment-driver.ts) call `ctx.trajectories.export()`, the unredacted exporter that reads no terms. A training corpus needs `ctx.curator.export({ purpose: 'training', … })` instead, exactly as [the curator e2e driver](../../../../examples/headless-agent/tests/fixtures/curator/driver.ts) already calls it. Without this the terms gate binds nothing on the path the corpus actually comes from.
2. **An open-weight route overlay and a `training` agreement.** A `cordis.yml` overlay that replaces `llm-claude-code` with [`dsh-llm-deepseek`](../../../../packages/llm/llm-deepseek/README.md) or a self-hosted OpenAI-compatible route through [`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md), plus a `data-use` block naming an agreement that admits `training`. Configuration, but it does not exist: none of the seven checked-in overlays swaps the route.
3. **`stopReason` on the trajectory record.** `dsh-trajectories` names this gap itself: a session that a budget, an abort or a provider error ended exports outcome `0`, and a trainer cannot tell it from a genuine failure. Without the field, every budget-ended rollout is a negative and the policy learns to finish early.
4. **On-policy capture.** The record carries no token ids and no logprobs by design. Put them in the trainer's inference proxy in front of the harness rather than in a session event — the harness never sees token ids, and the RL framework already expects rollouts from its own sampler.
5. **Per-environment group statistics in the export** — best-of-N selection and per-environment reward mean and variance, which `dsh-trajectories` lists as deferred. Optional: the stamps carry environment, repetition and group, so a trainer can fold them offline.

## Alternatives considered

**gpt-oss-120b as the base.** Its 5.1B active parameters are the cheapest rollouts in the class and its Apache-2.0 licence is clean. Rejected on two grounds: MXFP4 has no backward pass, so every training configuration begins by upcasting the MoE weights and gives back the memory advantage that motivated the choice; and its Terminal Bench 2 score of 18.7 is the weakest agentic result in the class, on the axis this harness measures most directly.

**Devstral-2-123B as the base.** The best SWE-bench Verified number among the open-weight candidates at 72.2, and built for agentic coding. Rejected on the licence: its "Modified MIT" bars any company above $20M consolidated monthly revenue from exercising the rights, which is a commercial gate rather than an open-weight licence, and it applies to derivatives. An FP8-only checkpoint is a second, smaller objection.

**GLM-4.5-Air as the base.** MIT, 106B/12B, and slime is its vendor's own RL framework, which is the strongest tooling story in the table. Rejected on age and succession: it dates from August 2025, its own vendor's mid-size line has moved to 31B and 321B with nothing at its size, and its published agentic numbers are a twelve-benchmark average rather than the task-level results the other candidates publish.

**Waiting for the next model rather than deciding now.** Rejected: the decision blocks the recipe, the recipe blocks the overlay work, and the recipe is mostly base-model-independent. Revisiting on the next GLM Air-class release is cheaper than leaving the objective undecided.

**Parity as reward shaping.** Adding `λ · parity` to the reward would give gradient where an all-zero group gives none, and the hidden cases sit behind the read barrier so the model cannot read them. Rejected anyway: the visible test suite is in the workspace, a pass fraction rewards special-casing it, and `dsh-trajectories` states the rule the harness already commits to. Dropping zero-variance groups costs rollouts and keeps the reward honest.

**Splitting each attempt into its own SFT sample.** It would multiply the corpus and shorten sequences. Rejected: a `<validation_failed>` directive is only interpretable against the work that earned it, so a split sample teaches the model to answer a directive it has no context for.

**Reporting the full 40-environment certificate rate.** Simpler and higher-powered. Rejected: an environment the policy trained on is not evidence about the policy, and the withholding machinery exists precisely to keep those two numbers apart.

## Acceptance criteria

- The recommended base model's `LICENSE` file is the verbatim Apache License 2.0, checked by byte comparison against the canonical text before any weights are downloaded.
- One bench run on an open-weight route is recorded under `data/proving-ground/` whose sessions carry `dataUse/terms` listing `training`, and whose export manifest reports `withheldByTerms: 0` for a `purpose: 'training'` export.
- Both bench drivers call `ctx.curator.export`, and a run recorded afterwards carries a `curation` block with `redactionApplied: true` on every exported line.
- The SFT corpus builder writes only rows whose `reward.outcome` is `1`, and a rebuild with `--check` reproduces the manifest's digests and counts.
- A rollout batch driven as one fleet plan at `repetitions: 8` produces eight cells per environment at seeds `base + 0` through `base + 7`, each stamped with the checkpoint's `policyVersion`.
- The reported number is produced by the `held-out-sonnet-all` plan alone, and no held-out environment id appears in any file of the training corpus.
- The masked-attempt ablation is run: a warm-up that masks rejected attempts inside certified trajectories is compared against one that trains them, on the held-out split, as a frozen pair.
- `stopReason` is a field of `dsh-trajectory/1`, and a rollout ended by a budget breach is masked rather than scored `0`.

## Risks

- **The corpus stays empty.** Every step below the base-model decision waits on a key for an open-weight route. The recipe is unfalsifiable until one exists.
- **Thirty-two environments is too small a prompt set.** Group size 8 over 32 environments is 256 rollouts an epoch, and the bench is saturated below tier 5. The policy can memorize the set long before the held-out split moves.
- **Eight held-out environments cannot carry a claim.** One flip is 6.25 points at sixteen cells. Any number reported from this split before it grows will be over-read.
- **The certificate is a coarse reward.** Binary terminal reward over long agentic rollouts gives weak credit assignment across attempts, and dropping zero-variance groups discards most of a saturated bench.
- **Redaction can corrupt training text.** `dsh-curator` rewrites every string outside its enumerated exceptions, and its IPv4 rule rewrites dotted-quad-shaped version strings; a profile tuned for client transcripts can make a record unusable for training. A training export needs its rule hits audited against the environments' own text.
- **Vendor benchmark numbers are vendor numbers.** Every coding and agentic result in the table above is self-reported or quoted from a competitor's table, under undisclosed scaffolds. They rank candidates; they are not this harness's measurements, and the bench is the only instrument that answers for this harness.
- **The published RL recipes are for a different workload.** The verl and slime Qwen3.5 paths and the Osmosis throughput figure are math and short-context runs; a 100K-token agentic rollout with tool calls is a heavier and less-tested regime, and slime's own packed linear-attention fix shows the class of bug that regime finds.
