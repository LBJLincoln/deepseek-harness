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
    maxFailedCases: 20
```

| Field | Meaning |
|---|---|
| `isolation` (required) | `none`, `process`, or `host`: the isolation the deployment can defend for its check runs. A local composition that shares the filesystem between implementer and validator is `none`; a run whose checks and fixtures live on another account or host is `host`. Written into every certificate and stamp; nothing in-process can verify it. |
| `maxAttempts` (default `1`) | Implementer turns before the run is reported uncertified; each turn is followed by one validation. |
| `maxGoalRounds` (optional) | Round cap handed to goal creation; absent applies the goal service default. |
| `checkTimeoutMs` (optional) | Timeout override for each check command and each case, capped by the executor; absent applies the executor default. |
| `evidenceMaxChars` (default `2000`) | Bound of each evidence string and of the directive detail. It must not exceed the verification service's `maxTextChars`, or `recordRun` rejects the result loudly. |
| `maxFailedCases` (default `20`) | Failed cases one check result names. The rest are still counted and weighed in the tally; only their per-case entries are dropped, which is what keeps a run of hundreds of cases out of the log. |

The service requires `environments`, `agents`, `agentDefaultModel`, `goals`, `completionStandards`, `shell`, and `sessions`. It also uses [`ctx.readBarrier`](../../verification/read-barrier/README.md) when the composition provides it; without it the run reserves nothing and the checks execute their instructions inline, which is what an `isolation: none` claim already says.

## Service contract

`ctx.environmentRuns.run({ environment, workspace, model?, repetition?, group?, district?, signal? })` reads the definition from the registry, overlays `task.fixture` (an existing absolute directory) onto `workspace` and hashes its files, and creates a fresh agent with `meta.cwd = workspace`, the requested `model` route or the composition's default selection, and the model-selection setup the headless bundle uses. Before anything else enters the log it appends the `environment/run` stamp: environment id and kind, `heldOut`, the content hashes of prompt, fixture, and checks, `repetition` (default `0`), `group`, and `district`, the model route, and the configured isolation. It then creates the goal from the task prompt, disarms it so a composed goal-round driver never continues it, and authors the standard from the environment's checks verbatim.

With a barrier composed, the run reserves `<barrier root>/runs/<sessionId>/` before the stamp, copies a held-out environment's fixture to `fixture/` there, and rewrites each attempt's check command to source a script the reservation holds. The reservation is stocked before the implementer's first turn and again at each attempt with `standard.json` and one `checks/<checkId>/` directory per active check, holding its `run` script and, for a check that carries cases, the `cases.jsonl` those cases live in — so the implementer sees a command line naming a file whose content the barrier denies it. A check id that is not a single path segment, and a reservation path the check command line cannot carry unquoted, both fail the run with `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT`.

Each attempt sends the prompt as a user turn, waits for whole-agent idle, [digests the check-owned set](#tamper-on-check-owned-paths), overlays `task.fixture` onto the workspace again so implementer edits to validator-owned files never reach the checks, digests the workspace files, and executes every active check of the current standard through `ctx.shell` with `workdir: workspace`. A check without cases runs once: exit code `0` without timeout or abort is `pass`, anything else `fail`; evidence is the exit fact followed by the bounded tails of stdout and stderr. A check with cases runs [once per case](#weighted-cases-and-the-reservation). `recordRun` records the run under `{ executor: 'runner', treeHash }` — one durable `verification/run` event per attempt, passing or failing, carrying `parity` when any check had cases — and commits a certificate or returns the failing subset. Certified: the goal is completed, which the verification guard admits. Not certified: one [directive](#the-clustered-directive) is recorded, and while attempts remain the next turn carries it in a `<validation_failed>` block.

## Weighted cases and the reservation

For a check whose environment supplied [case bodies](../environments/README.md#weighted-cases), the runner runs the candidate once per case in the workspace, in authored order. Each case empties the check's `treeScope` when it declares one, stages the case's `files`, appends the case's `argv` words to the check's command line, and feeds its `stdin`. Every configured channel is then normalized and digested: `exit` against `expected.exitCode`, `stdout` and `stderr` against their digests, and `tree` against the digest of every regular file under `treeScope` as the case left it. A truncated stream fails its channel, because the executor dropped bytes the digest covers. A case passes only when every configured channel matched.

The result carries `cases: { passed, total, weightPassed, weightTotal, failed }`; its status follows the cases, so one failing case fails the check. `failed` names up to `maxFailedCases` entries, each with the mismatching channels and the exit class (`zero`, `nonzero`, `signal`, or `timeout`). Evidence is the tally line followed by each named failure with its own exit fact and captured output — the raw bytes stay in the session log, which the read barrier denies an implementer.

## The clustered directive

A failed run issues one directive. `rootCause` names the count of failing checks. `detail` is one numbered line per entry: a cased check contributes one line per failure cluster — its failed cases grouped by the channels that disagreed and by exit class — naming the check's validator-authored `outcome`, the cluster's count and weight against the check's totals, the channels, and how the candidate ended; a check without cases contributes its recorded evidence line. The event also carries `clusters: [{ checkId, channels, count, weight }]` for the observatory, and `detail` stays bounded by `evidenceMaxChars`.

A cluster line names no case id, no expected digest, and no byte of captured output: what a hidden case expects is the case, so a wall that holds on the filesystem and leaks through the directive holds nothing. A caseless check keeps forwarding its evidence line, which is the older rendering an environment migrates away from by giving its checks cases.

The report carries the environment id, the session id, the stamp exactly as appended, one entry per attempt with its check results and workspace digest, `certified`, the certificate when one run passed, and the model usage summed over the session's assistant messages. The session is flushed and the agent handle disposed on every path, including a thrown error.

`EnvironmentRunError` codes: `ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`, `ENVIRONMENT_RUN_INVALID_WORKSPACE`, and `ENVIRONMENT_RUN_INVALID_FIXTURE` reject before any agent exists; `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT`, `ENVIRONMENT_RUN_GOAL_REPLACED`, and `ENVIRONMENT_RUN_STANDARD_LOST` name a check the reservation cannot carry, an implementer that replaced the goal, or a standard that is no longer current, after the session was flushed. `resolveConfig(config)` is the exported defaulting step.

Call `run()` only over a settled composition: the runner creates agents through the registry factory the agent loop registers. The durable record is the session log; the trajectory exporter folds it into a `dsh-trajectory/1` line whose `environment` field is the stamp and withholds held-out sessions by it.

## Tamper on check-owned paths

The check-owned set is the barrier's reserved directory, when one was minted, plus every path the environment declares in [`task.immutable`](../environments/README.md#the-immutable-set): a declared file digests its bytes, a declared directory its whole tree, and a declared path that is gone digests as absent, so a deletion counts as much as a rewrite. The runner digests the whole set once before the implementer's first turn and again at the start of every attempt, before the fixture is restored — the overlay would otherwise put back exactly what the comparison is looking for.

A digest that differs from the one the validator left ends the run: no check is executed, every result of that attempt records that it was not, `recordRun` receives `tampered: true` and writes `verdict: 'tampered'`, no certificate can follow it, the goal stays out of `complete`, one directive states the tamper, and the implementer receives it as its last validation follow-up. The trajectory exporter reads the recorded verdict and scores the session `0` on its `tamper` basis. After every validation the runner re-digests the set it just rewrote, so its own `standard.json` and check scripts are the baseline the next attempt is measured against.

## Model Experience

### Task prompt and validation follow-up

#### What the model sees

The environment's `task.prompt` arrives as the first user message of a fresh session with the composition's ordinary system prompt and tools; the checks never appear. After a failed validation, while attempts remain, the next user message is the block below, where `<rootCause>` reads `N of the standard's checks failed` and `<detail>` numbers one line per failure cluster of a cased check — its authored outcome, the cluster's count and weight, the channels that disagreed, and how the candidate ended — and one evidence line (exit fact, stdout and stderr tails) per failing check without cases, bounded by `evidenceMaxChars`. A tampered attempt sends the same block carrying the fixed tamper directive below and then ends the run; that text names neither a path nor a check, because a digest comparison knows that the check-owned set changed and nothing more.

##### Validation follow-up

```markdown
<validation_failed>
<rootCause>
<detail>
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

##### Tamper follow-up

```markdown
<validation_failed>
the files this task is measured with were modified during the attempt
Those files belong to the validator: the task is to make them pass, never to change them. This run is void and no certificate can follow it.
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

#### Token effect

One user message per attempt: the prompt, then one follow-up block per failed validation whose size is bounded by `evidenceMaxChars`. The tamper follow-up is fixed text. Nothing is added to the system prompt or to tool schemas.

#### KV Cache effect

Append-only: each follow-up extends the same session after its reusable prefix, so the conversation prefix stays cacheable across attempts.

## Known Limitations and Deferred Work

- **The barrier covers filesystem reads only** — an implementer preset that composes a log-reading tool, or a bash check-running executor, still reaches the standard through a seam the barrier does not fence; a certificate from this runner is as strong as the configured `isolation` claim, which nothing here verifies.
- **A reserved check runs by being sourced** — the command line is `. <script>`, which a POSIX shell executor runs exactly as it would the inline instruction; a composed PowerShell executor cannot source an extensionless file, so such a deployment runs without a barrier.
- **The fixture overlay is the only restoration** — each validation restores validator-owned fixture files, but files the implementer added outside the fixture stay in the workspace and reach the checks.
- **Tamper detection is a digest comparison** — it reports that the check-owned set changed, never who changed it or how, so a legitimate build step that rewrites a file inside the immutable set voids its run; environment authors declare the set narrowly, and a false verdict costs one run rather than a wrong certificate.
- **Command checks only** — a check whose `run` is a procedure fails as a non-zero exit with the evidence saying so; judges belong to the oversight seam.
- **Sequential checks and cases, one repetition per call** — checks run one after another in the workspace and a cased check runs its cases in authored order, so a large case set costs one executor start per case; group sampling repeats `run()` with `repetition` and `group` set by the caller.
- **A case's `argv` rides the check's command line** — the words are appended verbatim and must need no shell quoting, which authoring enforces, because the composed shell's dialect is not known where the standard is authored. A case that needs an argument holding spaces stages it as a file instead.
- **A caseless check still forwards its output** — the clustered directive closes the wall for cased checks; a check that carries no cases keeps sending its bounded stdout and stderr tails to the implementer.
- **Fixture overlay does not clear the workspace** — same-named files are overwritten; the runner refuses a workspace that is not a directory but does not require it to be empty.
