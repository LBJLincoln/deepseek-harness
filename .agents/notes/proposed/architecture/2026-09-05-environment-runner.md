# Agent Note: Environment runner

Status: proposed

English | [中文](2026-09-05-environment-runner.zh.md)

## Problem

Nothing runs an environment. The [trajectory-export note](2026-09-05-trajectory-export-and-environment-registry.md) landed the two ends of the improvement loop: the registry holds tasks with verifiers and the exporter turns finished sessions into rewarded records. Between them an implementer must receive the task, a validator must author the completion standard from the environment's checks, execute those checks after the implementer stops, record the run, and complete the goal only under a certificate. Today only the `drive-verification` test fixture performs these steps, by hand, inside `agent/pre-step` of one configured root agent, with hard-coded results instead of executed checks.

Every run needs its own session. A trajectory is one session; the headless bundle and the fixtures drive one root agent per process, so evaluating N environments costs N processes and N boots, and every session's workspace is the process working directory. Running the loop inside one composition needs a fresh session per run, rooted at a per-run workspace.

Isolation is a claim only the deployment can make. A certificate records the isolation the run executed under, and code that executes checks in-process cannot observe whether the implementer could reach the validator's standard or fixtures.

## Proposal

Add `@deepseek-ai/dsh-environment-runner` (`ctx.environmentRuns`) to the `improvement/` group: the automated validator for environments whose checks are command lines.

**One session per run.** `run({ environment, workspace, model?, repetition?, group?, signal? })` reads the definition from `ctx.environments`, overlays `task.fixture` (an existing absolute directory) onto `workspace` when the task declares one and hashes its files, and creates a fresh agent through `ctx.agents.create` with `meta.cwd = workspace`, the requested model route or the composition's `agentDefaultModel` selection, and the same `installModelSelection` setup the headless bundle uses. The bash tool resolves its default working directory from the session header's `cwd`, so the implementer works inside the run's workspace without any capability being re-rooted. A per-run model route is what lets one process serve a whole model matrix.

**The stamp comes first.** Before anything else enters the log, the runner appends the `environment/run` event: the environment id and kind, the held-out flag, the content hashes of prompt, fixture, and checks, the repetition and group, the model route, and the declared isolation. The stamp is the durable link from a session to its environment; the trajectory fold reads it, the exporter withholds held-out sessions by it, and a curator decontaminates by its content hash. The vocabulary and the strict decoder live in `dsh-environments`, because the stamp describes the environment domain and more than one consumer reads it.

**Goal and standard before the first token.** After the stamp, the runner creates the goal (`objective` is the task prompt; the round cap comes from config or the goal service default) and disarms it at once, so a composed goal-round driver never continues the goal on its own: the runner owns attempts. It then authors the standard from the environment's checks verbatim. The implementer never receives the checks through the runner. The read barrier is not complete with this slice: an implementer preset that composes a log-reading tool or shares the executor's filesystem can still reach the standard, so a certificate from this runner is as strong as the deployment's isolation claim and no stronger; the filesystem-authority barrier is the next slice.

**The runner is the validator.** After each attempt reaches whole-agent idle, the runner executes every active check of the current standard through `ctx.shell`: `resolve({ command: check.run, workdir: workspace, timeoutMs })` then `run(spec)`. Exit code `0` without timeout or abort is `pass`; anything else is `fail`. Evidence is the exit fact followed by the bounded tails of stdout and stderr. `recordRun(agent, ref, isolation, results)` commits a certificate or returns the failing subset. Certified: the runner completes the goal through `ctx.goals.complete`, which the verification guard admits. Not certified: the runner records one directive (`rootCause` names the count of failing checks; `detail` carries the failing evidence and never a check id, outcome, or command) and, while attempts remain, queues a follow-up user turn carrying the directive inside a `<validation_failed>` block.

**Isolation is configuration.** `isolation` is a required `Config` field with no default: `none`, `process`, or `host`, exactly the value the deployment can defend. A local composition that shares the filesystem between implementer and validator is `none`; a run whose checks and fixtures live on another account or host is `host`. The runner writes the configured value into every certificate.

**Report and record.** `run()` returns the environment id, the session id, the stamp exactly as appended, one entry per attempt with its check results, whether the run certified, the certificate when it did, and the accumulated model usage, after flushing the session. The durable record is the session log itself: the stamp, `goal/change`, the four `verification/*` events, and the messages. The exporter folds it into a `dsh-trajectory/1` line whose reward basis is `certificate` and whose `environment` field is the stamp; the runner writes exactly one session event of its own, and a run whose standard never records a fully passing run leaves no per-run record of its failing executions until `dsh-verification` gains a `verification/run` event.

**Config.** `isolation` (required); `maxAttempts` (positive integer, default 1: one implementer turn followed by one validation is a single-shot evaluation, and more is a deployment choice); `maxGoalRounds` (optional, handed to goal creation; the goal service default applies when absent); `checkTimeoutMs` (optional per-check override, capped by the executor); `evidenceMaxChars` (positive integer, default 2000, the bound on each evidence string and on the directive detail; it must not exceed the verification service's `maxTextChars`, or `recordRun` rejects the result loudly).

## Alternatives considered

**Drive the composition's root agent.** One process per environment and no per-run workspace: the fixture's shape, not a runner's.

**Let the goal-round driver continue attempts.** Rounds continue until the model declares completion, which the guard refuses without a certificate, so validation would never run between rounds. The runner disarms the goal and validates at each idle.

**Execute checks through `ctx.subprocess`.** That bypasses the executor's credential scrub, timeout cap, sandbox policy, and output bounds. `ctx.shell` is the seam that owns command execution.

**A model validator running procedures.** A check whose `run` is a procedure (`inspect the assistant text`) needs a judge, and judges belong to the oversight seam. This runner executes command lines; a procedure fails loudly as a non-zero exit whose evidence says so, and environment authors write command checks.

**Infer isolation.** Nothing in-process can observe the deployment's isolation. A defaulted `none` would silently devalue every certificate from an isolated deployment, and a defaulted `host` would lie.

**Send the directive as a system or tool message.** The follow-up is the channel a human validator would use; a user turn keeps the session shape the exporter and the round driver already understand.

## Acceptance criteria

- `run()` over an environment whose single check passes returns `certified: true` with one attempt, a certificate carrying the configured isolation, the goal in phase `complete`, and a persisted session whose first event is the `environment/run` stamp; the exported trajectory has reward `1` with basis `certificate` and carries the stamp as `environment`.
- `run()` over an environment whose check fails returns `certified: false` after exactly `maxAttempts` attempts with one directive per attempt, and every follow-up turn carries the directive as a user message; the exported trajectory has reward `0` with basis `certificate`.
- An export over a held-out environment's session withholds the line and counts it as `heldOut` unless the request sets `includeHeldOut`; the content hash of two runs of the same environment is identical, and differs when the prompt, the fixture, or a check changes.
- A check that times out, is aborted, or dies from a signal is `fail` with evidence naming the cause, and no evidence exceeds `evidenceMaxChars`.
- An unknown environment id, a relative or missing workspace or fixture directory, an implementer that replaced the goal, and a lost standard each reject with a stable `EnvironmentRunError` code; the first three reject before an agent exists.
- The agent handle is disposed and the session flushed after every run, on success and on failure; a Loader-booted composition runs two environments in one process as two sessions.

## Rollout

1. This note, the `environment/run` stamp in `dsh-environments`, the package, the Loader-booted e2e over the headless fixtures, and the trajectory export of its sessions with held-out withholding.
2. A `verification/run` event in `dsh-verification` for every executed run, passing or failing, so attempts and flakiness replay from the log; the read barrier as filesystem authority (a validator root the implementer's executor cannot read, tool guards, implementer presets without log-reading tools); per-run repetitions natively in the runner for group sampling.
3. `/environments` and `/trajectories` commands; the `environment` component adapter once the registry emits registration events.
4. Rejection-sampling export per environment and per-component reward statistics (phase 3 of the trajectory-export note).

## Risks

Under `isolation: none` the checks run with the implementer's privileges in the same workspace; a deployment that needs a defensible certificate runs the validator on another account or host and configures `isolation` accordingly.

A fixture overlaid onto a non-empty workspace overwrites same-named files. The runner refuses a workspace that is not a directory but does not require it to be empty, because a task may legitimately start from an existing checkout.

Evidence carries command output into the session log and from there into exported trajectories; the exporter is not a redaction layer (trajectory-export note, Risks).
