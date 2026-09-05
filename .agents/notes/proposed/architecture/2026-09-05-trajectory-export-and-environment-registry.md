# Agent Note: Trajectory export and the environment registry

Status: proposed

English | [中文](2026-09-05-trajectory-export-and-environment-registry.zh.md)

## Problem

Nothing turns a finished session into a training or evaluation record. The session log carries every model-visible input under the model-visible ⟺ logged invariant, and the [verification seam](2026-08-29-verification-improvement-oversight-seams.md) records certificates that gate goal completion, but the only export in the repository is the human ZIP download of a raw log in [`dsh-session-log-export`](../../../../packages/session-query/session-log-export/README.md). A reinforcement-learning pipeline outside this repository (prime-rl, slime, NeMo RL) consumes rollouts with rewards; the harness produces sessions with certificates, and no code bridges the two.

Rewards have no record. A `verification/certificate` proves that one goal's active checks passed under a stated isolation level, and `GoalService.complete()` admits a measured goal only with a covering certificate, but no record states that one trajectory earned one reward for one task in a form a trainer or a leaderboard reads. Every consumer would re-derive messages and rewards from raw events with its own private fold.

Tasks with verifiers exist only as test fixtures. The keyless snapshot suites are the sole task definitions with executable checks, and they are test infrastructure: nothing declares a task, its checks, and whether it is held out, so nothing can evaluate a harness or model change against a fixed suite or export rejection-sampled data per task. The [component-registry note](2026-09-01-component-registry-seam.md) needs the same declaration to score components per task.

## Proposal

Add the improvement seam's first two packages in a new `improvement/` group. Both are composition-time services in the style of `dsh-components`; neither executes a task.

**Trajectories (`dsh-trajectories`, `ctx.trajectories`).** `foldTrajectory(meta, events)` is a pure, deterministic projection of one session header and its event log into a `Trajectory`: the session identity and lineage; the last `request/header`'s call config, system prompt, and tool schemas; the ordered model-visible messages, each carrying the seq of the event it came from; per-step token usage; a reward with an explicit basis; and provenance. Messages come from the surface events `user/message`, `assistant/message`, and `tool/result`, projected to a chat message list with `user`, `assistant`, and `tool` roles; reasoning blocks are kept and flagged, tool calls keep the raw argument string from `tool/call`, and tool results keep the call correlation. The verifier decides the reward when the log holds a completion standard for the goal: basis `certificate`, `outcome: 1` with a covering certificate and `outcome: 0` without one; a goal that completed with no standard ever authored yields `outcome: null` with basis `uncertified-completion`, and a log with no goal yields `outcome: null` with basis `none`; the covering certificate, the goal snapshot, the directive count, and the relaxation count travel as fields. Provenance names the agent preset from `agent-preset/selected`, the provider and model, the certificate's isolation level, and the component ids in play derived from the tool calls (`tool:<name>`), the preset (`composition:<preset>`), and the provider (`model-provider:<provider>`), using the component registry's id scheme.

`TrajectoryService.export(request)` reads persisted sessions through `ctx.sessionPersistence.inspect()`, folds each one, and writes one JSON line per trajectory through a caller-supplied sink; `jsonlFileSink(path)` is the shipped file sink. The request names the session ids or defaults to every persisted session, and may keep only rewarded trajectories. The returned report counts sessions read, trajectories written, rewarded trajectories, and skipped sessions with their reasons. The service writes no session event: export is a read, and writing to the source log would change what a later export reads.

The record format is `dsh-trajectory/1`: one JSON object per line whose `messages` follow the chat-completion message list every trainer's chat template consumes, with rewards and provenance beside them. Token ids and logprobs are absent by design: the harness never sees token ids, and on-policy capture belongs to a trainer's inference proxy, as Agent Lightning and Polar do it. Prior art for the shape: verifiers' `Trace` (a message graph with tool calls, driven through an OpenAI-dialect interception server), SWE-agent and SWE-smith trajectory files, and the OpenAI chat-completion message list.

**Environments (`dsh-environments`, `ctx.environments`).** An `EnvironmentDefinition` declares one task with verifiers: a branded `EnvironmentId`, a `kind` from the merge-extensible `EnvironmentKindMap` (the registry ships no kind), `name`, `description`, the task prompt and its fixture, the executable `checks` in the verification seam's `StandardCheck` vocabulary, a `heldOut` flag, the owning package, `provenance` (`curated` or `synthesized`), and an optional `lineage`. Sharing the check vocabulary is the point: the environment's checks are the completion standard a validator authors when the task runs, so evaluation and production measure the same thing. `register()` returns its disposer and rejects a duplicate id or an environment without checks loudly; `list()` filters by kind and held-out status; `get()` reads one. Environments become `environment` components through an adapter in a later slice.

**How the loop closes.** An environment runs as a session whose completion standard is authored from its checks; a passing run records a certificate; the certificate makes the trajectory's reward; the exporter writes the trajectory; a trainer consumes it; the next checkpoint is evaluated on held-out environments before it replaces anything. This slice lands the two ends, the registry and the exporter. The runner that mounts an environment as a session is the next slice.

## Alternatives considered

**Export token ids and logprobs from the harness.** Providers stream text and blocks, never token ids; logprob capture is the trainer's inference proxy. The harness exports what it owns: model-visible text with evidence.

**Score trajectories with a model judge inside the exporter.** Rewards come from verifiers; judge councils belong to the oversight seam and score separately. A judge in the exporter would make every export a model call and a gameable one.

**Reuse the ZIP export.** A raw log is not a training record; every trainer would re-derive messages and rewards with its own fold. One fold, in the repository, tested against the assembled application, is the contract.

**Fold directives and relaxations into the reward.** Sparse outcome rewards with adequate group size train coding agents (CANOPY reports dense shaping worth under two points); process signals are exported as fields so a trainer decides.

**A database for environments.** Like components, the registry is composition-time truth; durable facts ride session events and the storage domain.

**A `trajectory/exported` session event.** Export must not write to the log it reads; the export report and the sink's own metadata are the record.

## Acceptance criteria

- `foldTrajectory` over the verification-domain fixture's log yields `outcome: 1` with basis `certificate` and the certificate's check ids; over a log whose standard has no covering certificate, `outcome: 0` with basis `certificate`; over a log whose goal completes with no standard, `outcome: null` with basis `uncertified-completion`; over a log with no goal, basis `none`.
- Every exported message carries the seq of its source event, and the exported message content equals the derived history a `Session` prepared from the same seed reports.
- `ctx.trajectories.export()` over a JSONL persistence store writes one line per persisted session, counts the rewarded ones, reports a session it cannot read by id and reason without aborting the rest, and returns zero counts over an empty store.
- `ctx.environments.register()` rejects a duplicate id and an environment with no checks; disposing the registration removes it; `list({ heldOut: true })` returns only held-out environments.
- A Loader-booted composition that runs the verification-domain fixture and then exports its session produces one JSONL line whose reward basis is `certificate`.

## Rollout

1. This note, `dsh-environments`, `dsh-trajectories` with the fold, the service, the JSONL sink, and the Loader-booted export proof.
2. The environment runner: mount an environment as a session, author its standard from the checks, run the agent, record the run; the `environment` component adapter; `/environments` and `/trajectories` commands.
3. Rejection-sampling export per environment, rewarded-trajectory statistics per component id for leaderboards, and a taskset export for verifiers-compatible trainers.

## Risks

Off-policy text. A trainer re-tokenizes exported text through its chat template, which suits supervised and rejection-sampled training and not strict on-policy reinforcement learning; the record format states this, and on-policy runs go through an inference proxy in front of the same harness.

Reward gaming. A certificate covers the checks its standard held; checks authored by the implementer make the reward gameable. The trajectory carries the certificate's isolation level so a trainer can keep only `process` or `host` runs.

Secrets in transcripts. Tool results may carry credentials or private data; the exporter is not a redaction layer. The telemetry redaction rules are the precedent for a later filter, and the sink is where a deployment applies one.

Log size. Sessions with long streams hold many `assistant/chunk` events; the fold reads assembled messages and ignores chunks, and export streams one line at a time.
