# @deepseek-ai/dsh-environment-runner

English | [中文](README.zh.md)

Environment runner: one registered environment as one fresh, validated session. The runner stamps the session with the environment it runs, creates the goal, authors the completion standard from the environment's checks, drives the implementer turn by turn, executes the checks through the shell executor after each turn, records the run, and completes the goal only under a certificate. The [environment-runner Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md) owns the design rationale.

## Config

```yaml
- id: environments
  name: '@deepseek-ai/dsh-environments'
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-official
    model: deepseek-v4-flash
- id: environment-runner
  name: '@deepseek-ai/dsh-environment-runner'
  config:
    isolation: none
    maxAttempts: 2
    maxGoalRounds: 8
    checkTimeoutMs: 120000
    evidenceMaxChars: 2000
```

| Field | Meaning |
|---|---|
| `isolation` (required) | `none`, `process`, or `host`: the isolation the deployment can defend for its check runs. A local composition that shares the filesystem between implementer and validator is `none`; a run whose checks and fixtures live on another account or host is `host`. Written into every certificate and stamp; nothing in-process can verify it. |
| `maxAttempts` (default `1`) | Implementer turns before the run is reported uncertified; each turn is followed by one validation. |
| `maxGoalRounds` (optional) | Round cap handed to goal creation; absent applies the goal service default. |
| `checkTimeoutMs` (optional) | Timeout override for each check command, capped by the executor; absent applies the executor default. |
| `evidenceMaxChars` (default `2000`) | Bound of each evidence string and of the directive detail. It must not exceed the verification service's `maxTextChars`, or `recordRun` rejects the result loudly. |

The service requires `environments`, `agents`, `agentDefaultModel`, `goals`, `completionStandards`, `shell`, and `sessions`. It also uses [`ctx.readBarrier`](../../verification/read-barrier/README.md) when the composition provides it; without it the run reserves nothing and the checks execute their instructions inline, which is what an `isolation: none` claim already says.

## Service contract

`ctx.environmentRuns.run({ environment, workspace, model?, repetition?, group?, signal? })` reads the definition from the registry, overlays `task.fixture` (an existing absolute directory) onto `workspace` and hashes its files, and creates a fresh agent with `meta.cwd = workspace`, the requested `model` route or the composition's default selection, and the model-selection setup the headless bundle uses. Before anything else enters the log it appends the `environment/run` stamp: environment id and kind, `heldOut`, the content hashes of prompt, fixture, and checks, `repetition` (default `0`) and `group`, the model route, and the configured isolation. It then creates the goal from the task prompt, disarms it so a composed goal-round driver never continues it, and authors the standard from the environment's checks verbatim.

With a barrier composed, the run reserves `<barrier root>/runs/<sessionId>/` before the stamp, copies a held-out environment's fixture to `fixture/` there, and rewrites each attempt's check command to source a script the reservation holds. Each attempt writes `standard.json` and one `checks/<checkId>` script per active check into the reservation, so the implementer sees a command line naming a file whose content the barrier denies it. A check id that is not a single path segment, and a reservation path the check command line cannot carry unquoted, both fail the run with `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT`.

Each attempt sends the prompt as a user turn, waits for whole-agent idle, overlays `task.fixture` onto the workspace again so implementer edits to validator-owned files never reach the checks, digests the workspace files, and executes every active check of the current standard through `ctx.shell` with `workdir: workspace`: exit code `0` without timeout or abort is `pass`, anything else `fail`; evidence is the exit fact followed by the bounded tails of stdout and stderr. `recordRun` records the run under `{ executor: 'runner', treeHash }` — one durable `verification/run` event per attempt, passing or failing — and commits a certificate or returns the failing subset. Certified: the goal is completed, which the verification guard admits. Not certified: one directive is recorded (`rootCause` names the count of failing checks; `detail` carries the failing evidence and never a check id, outcome, or command), and while attempts remain the next turn carries the directive in a `<validation_failed>` block.

The report carries the environment id, the session id, the stamp exactly as appended, one entry per attempt with its check results and workspace digest, `certified`, the certificate when one run passed, and the model usage summed over the session's assistant messages. The session is flushed and the agent handle disposed on every path, including a thrown error.

`EnvironmentRunError` codes: `ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`, `ENVIRONMENT_RUN_INVALID_WORKSPACE`, and `ENVIRONMENT_RUN_INVALID_FIXTURE` reject before any agent exists; `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT`, `ENVIRONMENT_RUN_GOAL_REPLACED`, and `ENVIRONMENT_RUN_STANDARD_LOST` name a check the reservation cannot carry, an implementer that replaced the goal, or a standard that is no longer current, after the session was flushed. `resolveConfig(config)` is the exported defaulting step.

Call `run()` only over a settled composition: the runner creates agents through the registry factory the agent loop registers. The durable record is the session log; the trajectory exporter folds it into a `dsh-trajectory/1` line whose `environment` field is the stamp and withholds held-out sessions by it.

## Model Experience

### Task prompt and validation follow-up

#### What the model sees

The environment's `task.prompt` arrives as the first user message of a fresh session with the composition's ordinary system prompt and tools; the checks never appear. After a failed validation, while attempts remain, the next user message is the block below, where `<rootCause>` reads `N of the standard's checks failed` and `<detail>` lists one numbered evidence line per failing check (exit fact, stdout and stderr tails), bounded by `evidenceMaxChars`.

##### Validation follow-up

```markdown
<validation_failed>
<rootCause>
<detail>
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

#### Token effect

One user message per attempt: the prompt, then one follow-up block per failed validation whose size is bounded by `evidenceMaxChars`. Nothing is added to the system prompt or to tool schemas.

#### KV Cache effect

Append-only: each follow-up extends the same session after its reusable prefix, so the conversation prefix stays cacheable across attempts.

## Known Limitations and Deferred Work

- **The barrier covers filesystem reads only** — an implementer preset that composes a log-reading tool, or a bash check-running executor, still reaches the standard through a seam the barrier does not fence; a certificate from this runner is as strong as the configured `isolation` claim, which nothing here verifies.
- **A reserved check runs by being sourced** — the command line is `. <script>`, which a POSIX shell executor runs exactly as it would the inline instruction; a composed PowerShell executor cannot source an extensionless file, so such a deployment runs without a barrier.
- **The fixture overlay is the only restoration** — each validation restores validator-owned fixture files, but files the implementer added outside the fixture stay in the workspace and reach the checks.
- **Command checks only** — a check whose `run` is a procedure fails as a non-zero exit with the evidence saying so; judges belong to the oversight seam.
- **Sequential checks, one repetition per call** — checks run one after another in the workspace, and group sampling repeats `run()` with `repetition` and `group` set by the caller.
- **Fixture overlay does not clear the workspace** — same-named files are overwritten; the runner refuses a workspace that is not a directory but does not require it to be empty.
