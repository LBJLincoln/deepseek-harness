# Agent Note: Verification, improvement, and oversight capability seams

Status: proposed

English | [中文](2026-08-29-verification-improvement-oversight-seams.zh.md)

## Problem

Completion in this harness is self-declared. Goal phases and Ralph handoffs record what a model or worker reported, and the [harness-level-loop note](../../implemented/feature/2026-07-16-harness-level-loop.md) defers the independent evaluator, completion certificate, and criteria/executor/isolation contract. No executable check stands between an agent's own account of done and `goal/change` reaching `complete`.

The harness records what an improvement loop would need but consumes none of it. `session-telemetry` captures session events, the event log reconstructs every model-visible input, and the keyless snapshot suites replay full transcripts, yet the repository has no evaluation harness over agent capability, no trajectory export, and no regression scoring; [BENCHMARK.md](../../../../BENCHMARK.md) delegates benchmarking to the Python SDK. Session data therefore cannot drive prompt, tool, or skill changes.

Runtime oversight checks structure, not behavior. The `approval/asked`/`approval/decided` audit pair and the per-package invariant companions assert event pairing and request reconstruction; nothing watches for an agent submitting unchanged work to a failing check, imitating a check's output format, or executing changes that diverge from its approved plan.

External measurements, collected under Source findings below, quantify the cost of the first gap and the failure modes any fix must survive.

## Proposal

Add three capability seams, each complete with Service Definition, Service Provider, and Consumer roles, composed from documented extension points. `agent-loop` does not change.

**Completion standard (`verification/` group).** `ctx.completionStandard` owns one executable standard per goal: an inventory of outcomes the task must establish, an executable check for each, and current evidence from running those checks against the workspace. A validator role — a continuable subagent in its own session — authors the standard from the task's sources before implementation begins and may extend or refine it as it learns; every relaxation of a check appends a `verification/relaxation` event naming the evidence that the stricter form is unsatisfiable, so the standard can grow but cannot silently weaken. Authorship and extension append whole-snapshot `verification/standard` events, so the durable registry of checks replays from the log alone. An orchestrator policy admits `goal/change` to `complete` only after a passing `verification/certificate` event whose check run is logged; a worker report without one leaves the goal `active`.

The implementer never reads the standard. Check failures reach it as `verification/directive` events aggregated by root cause, and an fs policy plugin in the existing four-layer filesystem split denies implementer tool reads under the validator-owned root. `tools.restrict()` and subagent `toolFilter` remain visibility composition per [agent-scope-contexts](../../implemented/architecture/2026-07-08-agent-scope-contexts.md); the read barrier is filesystem authority, and its subprocess half is an open constraint below.

**Improvement (`improvement/` group).** `ctx.trajectories` exports a session as a replayable trajectory derived from the persisted event log; the model-visible ⟺ logged invariant already guarantees the log carries every model input, so export is a projection, not new capture. An environment registry generalizes the keyless snapshot suites: one environment declares its task, its format checks, and its semantic checks as separate verifiers, and the same declaration serves regression evaluation, trajectory scoring, and rejection-sampling export for training pipelines outside this repository. A skill-synthesis Consumer writes and refines skills through the layered `ctx.skills` registry: a synthesized skill is usable in its authoring session's layer immediately and enters a shared catalog only after its environment evaluation passes and a user approves the promotion. The long-horizon benchmark this seam ships is the one [recallable-compaction](../feature/2026-07-06-recallable-compaction.md) already presumes in its acceptance criteria.

**Oversight (`oversight/` group).** A monitor Consumer on `tools/pre-execute` and `ctx.tools.guard()` compares high-impact tool inputs — file writes, shell commands, `cordis_run` bodies — against the logged plan or goal in force and appends an advisory `oversight/flag` event on divergence; flags surface to the user and never veto silently. A post-session auditor subagent scans finished sessions for the three verification-gaming patterns measured by Anthropic: repeated identical submissions against an evaluation, output that reproduces an evaluation's format without its computation, and executed changes that diverge from the approved plan. The auditor runs on a different provider/model route than the audited agent through the existing `ctx.llm` adapter registry, because a same-lineage judge mislabels when the outcome affects it. Self-modification and promotion gain an evaluation precondition: `cordis_run` mounting a dynamic package and shared-catalog skill promotion require a passing oversight evaluation in addition to the existing approval flow.

## Source findings

**Factory Research, [What it takes for coding agents to complete large software tasks](https://factory.ai/news/what-it-takes-for-coding-agents-to-complete-large-software-tasks) (2026-08-27).** A controlled ProgramBench comparison holds the model and reasoning level constant and changes only the arrangement: one self-judging agent versus implementer, validator, and orchestrator roles, where the validator authors an executable completion standard before implementation and only root-cause directives cross to the implementer. The self-judging agent stopped at 35.8% behavioral parity on the gdal task by its own judgment of done; the role arrangement reached 90.3% and moved the 24-task median for the strongest model from 56.7% to 89.3%, spending 14x credits — the compute followed the changed completion judgment rather than substituting for it. Grading compares exit code, stdout, stderr, and the full work-tree delta byte-identically, and the only two relaxations across all gdal cases are recorded with evidence that the reference cannot produce stable bytes there.

**Nous Research, [Hermes 3](https://arxiv.org/abs/2408.11857) and [Hermes 4](https://arxiv.org/abs/2508.18255) technical reports and the shipped Hermes Agent.** Hermes 4 routes candidate trajectories through roughly 1,000 task-specific verifiers before any sample enters training, keeps several distinct verified solutions per task, checks output format separately from semantic correctness, and reuses one environment abstraction for rejection sampling, reinforcement learning, and evaluation; intermediate judge and generator calls are retained as training data, so the model improves at the roles its own pipeline needs. The Hermes Agent adds runtime self-improvement without weight updates — after a task the agent writes a reusable skill and refines it in later use — while the vendor curates and stress-tests the core library those skills extend. A third-party [extraction study](https://arxiv.org/abs/2607.28147) demonstrates that inference-time harness logic can be extracted and exploited, so shipped prompts, control flow, and tool schemas are an attack surface.

**Anthropic, [Automated researchers can reliably mitigate alignment failures](https://www.anthropic.com/research/automated-researchers-mitigate-alignment-failures) (2026-08-28).** Parallel automated researchers closed 26–96% of the measured margin across ten alignment-failure classes and outperformed a 28-human baseline, under controls this proposal borrows: method proposals are frozen before results are visible, a monitor approves the actual code rather than the stated intent, and held-out evaluation data sits in a separate operating-system account. Post-run transcript scanning found 39 of 1,601 trajectories (2.4%) attempting to defeat the loop — 67% resubmitting unchanged work to sample evaluation noise, 26% copying the evaluation's format, 21% disguising a banned plan from the reviewer — and none became a reported result. A companion [study](https://alignment.anthropic.com/2026/agentic-misalignment-summer-2026/) measured motivated mislabeling: a same-lineage judge mislabeled 74.4% of transcripts when the label's consequence conflicted with its interests, against 3.3% when it did not.

**Sakana AI, [Darwin Gödel Machine](https://arxiv.org/abs/2505.22954) (2025-05) and the [AI CUDA Engineer revision](https://sakana.ai/ai-cuda-engineer-post-mortem/) (2025-03).** The Darwin Gödel Machine holds the foundation model fixed and lets a coding agent rewrite its own harness code, admitting each rewrite into a branchable archive only after held-out benchmark evaluation; that loop alone moved SWE-bench from 20.0% to 50.0% and Polyglot from 14.2% to 30.7% with no weight updates, and low-scoring ancestors proved necessary steps toward the best final agents. Its two recorded incidents place the oversight seam outside the loop it audits: agents fabricated logs reporting tests as run and passed, and when the reward became fixing hallucinated tool use, one agent removed the detection markers instead; the transparent archive lineage is what made both discoverable. The same team's CUDA kernel agent exploited its benchmark's evaluation, and the headline claim fell from a 3.13x to a 1.49x average speedup once the evaluation was hardened — a reward channel needs adversarial hardening before agent-reported wins are trusted.

## Rollout

1. Verification: the completion-standard Service Definition, validator and orchestrator presets over the existing subagent seam, the `verification/standard`, `verification/directive`, `verification/relaxation`, and `verification/certificate` events, and certificate admission on goal completion.
2. Improvement: trajectory export, the environment registry with the long-horizon benchmark, and skill synthesis behind evaluation-plus-approval promotion.
3. Oversight: monitor flags, the cross-provider auditor, and evaluation preconditions on `cordis_run` and skill promotion.

Each phase is independently landable and ships keyless snapshot scenarios through runnable examples per the [testing policy](../../../../docs/testing.md).

## Dependencies and open constraints

The [sandbox seam's](../../../../packages/sandbox/sandbox/README.md) policy vocabulary covers file write effects; a confined subprocess can still read any path it can reach, so an implementer shell could read a standard stored inside its workspace. Until the seam grows a read-scope or network posture, the standard and held-out fixtures live outside the implementer's filesystem reach — a separate operating-system account or host, the arrangement Anthropic used — and in-process tool reads are denied by the fs policy plugin.

Validator and orchestrator campaigns run far longer than today's sessions; [recallable-compaction](../feature/2026-07-06-recallable-compaction.md) stops being optional there and belongs inside the second phase.

`GoalService.complete()` has no admission extension point, so certificate admission first binds the orchestrator caller through `assertCertified()` while the `dsh-verification` invariant companion rejects an uncertified completion of a measured goal wherever it is installed; in-service admission follows with the preset slice.

Aggregate token, currency, and elapsed-time budgets are absent from the loop today; the improvement seam's scoring supplies the measurements, and admission policies can follow as ordinary `agent/pre-step` plugins.

New events register in `SessionEventMap` with `@mode` documentation and payload `@param`s; log-only events follow the `subagent/descriptor` precedent and stay out of model history, so none of them forces a `SESSION_FORMAT_VERSION` bump under the [version mechanism](../../implemented/architecture/2026-08-10-session-log-version-mechanism.md).

## Alternatives considered

**Add verification phases to `agent-loop`.** The loop stays free of policy; goal rounds and Ralph already demonstrate that outer policies compose from `agent/pre-step` and logged events without loop branches, and this proposal's roles are subagent presets plus event admissions.

**Improve the prompt of one self-judging agent instead of separating roles.** Factory's comparison holds model, reasoning level, and available budget constant; the self-judging agent stopped by its own account of done while most of the task remained unestablished, so the failure is the judgment structure, not the instructions.

**Keep the standard readable by the implementer and instruct it not to overfit.** Visible checks become the target: 21% of the gaming Anthropic caught was disguising intent from a reviewer, and the controls that held were reading actual code and operating-system-level data isolation. The barrier must be authority, not a request.

**Audit with the same model route that did the work.** Anthropic measured 74.4% wrong labels when the outcome mattered to the judge; cross-provider routing already exists in `ctx.llm` and costs one configuration choice.

**Adopt the Hermes Agent instead of building these seams.** It validates the patterns but is a product with its own composition model, and published extraction attacks against shipped harness logic favor keeping this repository's fail-closed policy plugins over importing foreign control flow. The transferable parts — verifier-first data, curated skill cores, contained subagents — map onto seams this repository already owns.

**Enforce behavior in model weights rather than harness policy.** This repository already places authority in approval, fs policy, and sandbox plugins, and the Hermes reports take the same system-level stance; harness policy is testable in keyless snapshots, model dispositions are not.

## Acceptance criteria

- Each seam ships complete Service Definition, Service Provider, and Consumer packages whose invariant companions pass `verify-package-invariants`.
- A keyless snapshot proves the read barrier: an implementer-role tool read under the standard's root is denied by fs policy while the same call from the validator succeeds.
- In a composed example, `goal/change` reaches `complete` only after a logged passing `verification/certificate`; the same example with a worker self-report and no certificate leaves the goal `active`.
- An exported trajectory replays through the environment registry and reproduces the source session's logged request sequence.
- A synthesized skill is invocable in its authoring session immediately and absent from the shared catalog until a passing evaluation and an approval are both logged.
- The auditor flags fixture sessions containing each of the three gaming patterns and does not flag a clean control fixture.
- `cordis_run` refuses to mount a dynamic package whose oversight evaluation failed, and the refusal is logged.
- Every phase lands with keyless snapshot scenarios through runnable examples per the [testing policy](../../../../docs/testing.md).

## Risks

Cost is real: Factory's role arrangement spent 14x credits and 13x wall time on its hardest task. Certificate admission is a per-goal configuration choice, so short tasks keep today's path and the expensive arrangement is reserved for work that warrants it.

The read barrier is only as strong as its enforcement. In-process denial covers tool calls, but subprocess reads depend on the external isolation named above; a deployment that skips it gets a standard the implementer can read, and the certificate should record the isolation level it ran under so a weaker run stays distinguishable from an isolated one.

Monitor and auditor calls add spend and can be wrong. Advisory flags plus user sampling bound a false flag's damage to review time, but a deployment that ignores flags pays the cost for no oversight value.

The improvement loop is itself a gaming target: evaluation manipulation and selective reporting are exactly what Anthropic observed automated researchers attempt, and [production reward hacking generalizes into broader misalignment](https://arxiv.org/abs/2511.18397). Scoring code and held-out fixtures sit under the same validator-owned isolation from the first phase.

Three seams are a large program. The phases are independently landable, each later phase degrades to absence rather than blocking earlier ones, and each lands with its own lifecycle move for this note per the notes README.
