# @deepseek-ai/dsh-environment-runner

English | [中文](README.zh.md)

Environment runner: one registered environment as one fresh, validated session. The runner stamps the session with the environment it runs, creates the goal, authors the completion standard from the environment's checks, has each attempt implemented by the session's own model route or by an [external coding agent](#the-two-implementers), executes the checks through the shell executor after each attempt, records the run, and completes the goal only under a certificate. The [environment-runner](../../../.agents/notes/proposed/architecture/2026-09-05-environment-runner.md), [external-implementer](../../../.agents/notes/proposed/architecture/2026-09-06-external-implementer.md), [budget-parity](../../../.agents/notes/proposed/architecture/2026-09-08-budget-parity-for-delegated-cells.md), and [attempt-ladder](../../../.agents/notes/proposed/architecture/2026-09-08-attempt-ladder.md) Agent Notes own the design rationale.

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
    maxLadderRungs: 8
    maxGoalRounds: 8
    checkTimeoutMs: 120000
    evidenceMaxChars: 2000
    maxFailedCases: 20
    topP: 0.95
```

| Field | Meaning |
|---|---|
| `isolation` (required) | `none`, `process`, or `host`: the isolation the deployment can defend for its check runs. A local composition that shares the filesystem between implementer and validator is `none`; a run whose checks and fixtures live on another account or host is `host`. Written into every certificate and stamp; nothing in-process can verify it. |
| `maxAttempts` (default `1`) | Implementer turns before the run is reported uncertified; each turn is followed by one validation. A request that carries an [attempt ladder](#the-attempt-ladder) sets its own bound instead. |
| `maxLadderRungs` (default `8`) | Rungs one request's attempt ladder may name. A ladder is the attempt bound of the run that carries it, so this is how far a plan file may push a deployment; a longer ladder fails the run with `ENVIRONMENT_RUN_INVALID_LADDER`. |
| `maxGoalRounds` (optional) | Round cap handed to goal creation; absent applies the goal service default. |
| `checkTimeoutMs` (optional) | Timeout override for each check command and each case, capped by the executor; absent applies the executor default. |
| `evidenceMaxChars` (default `2000`) | Bound of each evidence string and of the directive detail. It must not exceed the verification service's `maxTextChars`, or `recordRun` rejects the result loudly. |
| `maxFailedCases` (default `20`) | Failed cases one check result names. The rest are still counted and weighed in the tally; only their per-case entries are dropped, which is what keeps a run of hundreds of cases out of the log. |
| `topP` (optional) | Nucleus-sampling mass between 0 and 1 every request of every run asks for. It is a deployment choice rather than a per-run one: a suite compares cells only while every cell samples the same way. Absent leaves the composition's own sampling in place. |

The service requires `environments`, `agents`, `agentDefaultModel`, `goals`, `completionStandards`, `shell`, and `sessions`. It also uses [`ctx.readBarrier`](../../verification/read-barrier/README.md) when the composition provides it; without it the run reserves nothing, denies nothing above the workspace, and the checks execute their instructions inline, which is what an `isolation: none` claim already says. A run that names a subagent implementer additionally uses [`ctx.subagents`](../../subagent/subagent/README.md).

## Service contract

`ctx.environmentRuns.run({ environment, workspace, implementer?, model?, ladder?, repetition?, group?, district?, policyVersion?, seed?, signal? })` returns the stamp, one entry per attempt with the route that attempt ran on, the certificate when a run passed, the accumulated `usage`, and the `caps` the cell ran under. It reads the definition from the registry, overlays `task.fixture` (an existing absolute directory) onto `workspace` and hashes its files, and creates a fresh agent with `meta.cwd = workspace`, the requested `model` route or the composition's default selection, and the model-selection setup the headless bundle uses. Before anything else enters the log it appends the `environment/run` stamp: environment id and kind, `heldOut`, the content hashes of prompt, fixture, and checks, `repetition` (default `0`), `group`, and `district`, the `policyVersion` and `seed` the run asked for, the model route, the configured isolation, and the `implementer` name. It then creates the goal from the task prompt, disarms it so a composed goal-round driver never continues it, and authors the standard from the environment's checks verbatim.

With a barrier composed, the run also denies the cell the directory its workspace sits in — `dirname(workspace)` — for the length of the run, through `ctx.readBarrier.denyFor`, and disposes that registration when the run ends. A fleet lays each cell's workspace out as a sibling under the run directory, so that one denial covers the run's plan and log and every other cell at once; naming each sibling instead would leave the run directory itself listable, which states the experiment the cell is part of. The barrier grants the session's own workspace beneath the denial, so the cell reads and writes its own files unchanged. Without a composed barrier nothing is denied, which is what an `isolation: none` claim already says.

With a barrier composed, the run reserves `<barrier root>/runs/<sessionId>/` before the stamp, copies a held-out environment's fixture to `fixture/` and any [declared reference](#the-staged-reference) to `reference/` there, and rewrites each attempt's check command to source a script the reservation holds. The reservation is stocked before the implementer's first turn and again at each attempt with `standard.json` and one `checks/<checkId>/` directory per active check, holding its `run` script and, for a check that carries cases, the `cases.jsonl` those cases live in — so the implementer sees a command line naming a file whose content the barrier denies it. A check id that is not a single path segment, and a reservation path the check command line cannot carry unquoted, both fail the run with `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT`.

Each attempt hands the prompt to the implementer and waits for its work to end, then [digests the check-owned set](#tamper-on-check-owned-paths), copies every `task.immutable` path from the fixture onto the workspace again so implementer edits to validator-owned files never reach the checks while every other file stays as the implementer left it, digests the workspace files, and executes every active check of the current standard through `ctx.shell` with `workdir: workspace`. A check without cases runs once: exit code `0` without timeout or abort is `pass`, anything else `fail`; evidence is the exit fact followed by the bounded tails of stdout and stderr. A check with cases runs [once per case](#weighted-cases-and-the-reservation). `recordRun` records the run under `{ executor: 'runner', treeHash }` — one durable `verification/run` event per attempt, passing or failing, carrying `parity` when any check had cases — and commits a certificate or returns the failing subset. Certified: the goal is completed, which the verification guard admits. Not certified: one [directive](#the-clustered-directive) is recorded, and while attempts remain the next turn carries it in a `<validation_failed>` block.

## The attempt ladder

`ladder` names one rung per attempt, in attempt order: attempt `i` runs on `ladder[i - 1].model`, and a rung that names no model runs the request's own `model`. Present, the ladder's length is the run's attempt bound and overrides the composition's `maxAttempts`, because the caller that chose a model per attempt is the caller that chose how many attempts there are. `resolveLadder(ladder, model, maxRungs)` is the exported resolution step; an empty ladder and one past `maxLadderRungs` both fail with `ENVIRONMENT_RUN_INVALID_LADDER` before an agent exists.

The stamp records the ladder beside `model`, which stays the first attempt's route, so a fold that groups by route alone still sees where the run started while a fold that groups by the arm sees the whole escalation. Every `EnvironmentRunAttempt` states the `model` it ran on and the `transcript` it ran under. A route implementer changes route through the model selection the runner installed on the cell agent, applied before the attempt's first step; a delegated one starts its child on the rung's model id, because a provider names its own models and the rung's harness `provider` is a fact about the route rather than an argument the provider takes.

Model-visible and logged stay equivalent: what the model is asked to be is the request header of every step, which the cell session already logs, and the attempt record and the stamp state what was asked for, never what a provider ran. A delegated attempt's `environment/delegation` carries the child's `reportedModel` for the same reason.

## The transcript interface

The two implementers differ in more than where the work happens: a route implementer keeps the transcript of its earlier attempts and a delegated one drops it, so the same ladder is two instruments.

- **`kept` — the route implementer.** Every attempt is another user turn of the one cell session, so the model sees the task, its own earlier work, and each directive in order. The follow-up turn is the `<validation_failed>` block alone: the task statement is already in the transcript above it.
- **`dropped` — the subagent implementer.** Every attempt is one fresh child that holds nothing of the earlier ones. Its first prompt is the task statement; every later prompt is the task statement again, a blank line, and the `<validation_failed>` block. The `environment/delegation` event records `attempt` and `restatedTask`, which is `true` for exactly those later attempts, so a reader of the log can tell a restated prompt from the first one without the prompt text.

Each attempt of the report states which of the two it ran under, so a reader comparing two arms of one ladder never has to know which implementer produced which row. `implementerTranscript(implementer)` is the exported answer.

A `keep` arm on an out-of-process child is a gap rather than a choice: it would need the provider to resume the same foreign session across attempts, and [the subagent seam](../../subagent/subagent/README.md) advertises no resume capability for the out-of-process backends. The in-process [`spawn`](../../subagent/subagent-spawn-in-process/README.md) provider is the route's `drop` arm instead: it runs the child on the parent's own composition and route, so a pair of arms differing only in the transcript interface is one composition away.

## The two implementers

`implementer` says who does the work of each attempt, and `resolveImplementer(request)` is the exported defaulting step that answers `{ kind: 'route' }` for a request that names none. `route` sends the attempt's prompt to the cell agent as a user turn and waits for whole-agent idle, which is the run the harness measures of itself. `{ kind: 'subagent', provider, label? }` starts one child run per attempt on that registered [`ctx.subagents`](../../subagent/subagent/README.md) provider instead — `ctx.subagents.start(provider, { prompt, parent: cellAgent, signal, model, label })` — awaits its result, and appends one `environment/delegation { attempt, restatedTask, provider, runId, stopReason, structured?, usage?, reportedModel?, reportedUsage?, reportedCostUsd? }` to the cell session before validating. What each attempt's prompt carries is [the transcript interface](#the-transcript-interface), and the child's working directory is the cell workspace, because every provider derives it from the delegating parent session's `cwd`.

`model` is the attempt's own rung, which is the run's stamped model for a run without a ladder, so the arm a cell is published under is the arm that did the work. A fleet or shift naming a subagent implementer must therefore name models the PROVIDER accepts verbatim: for [`claude-code`](../../subagent/subagent-claude-code/README.md) those are the product's own ids and aliases (`opus`, `sonnet`, `haiku`), which is what the bench composition's `llm-claude-code` catalog already names its `productModel` values, so one plan can compare the harness loop and the product loop on the same model names. `ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED` refuses a provider that cannot be told which model to run, before an agent exists, because a stamped session claiming an arm the child never ran is a mislabelled measurement rather than a failed run.

The runner still creates the cell agent, its session, the stamp, the goal, the standard, and the reservation, and still executes every check itself, so a delegated cell's certificate is the same certificate: it states that the runner ran the standard's checks on the tree the external agent left, after restoring the immutable paths from the fixture and finding the check-owned set unchanged. It states nothing about how the work was done. No model-visible history of an external implementer reaches the log, so a delegated cell's session carries no assistant turn, the exported trajectory carries no step, and the run reports no `usage` of its own. The delegation event holds what accounting there is, and at most one of its two spend fields: `usage` for an in-process child, summed from its own session because its tokens were spent on a route this process owns; `reportedUsage` and `reportedCostUsd` for an out-of-process one, which are the foreign product's own claim about a spend no log here can see. `reportedModel` records what the child's backend said it ran, against the requested model on the stamp. Certificates alone cannot separate two implementers that both certify on their first attempt, so attempts, wall time, and this spend are the measures that do. A child that refuses, errors, or is cancelled is recorded and validated exactly like one that completed, because the run's verdict is what the tree does.

A named provider is resolved before an agent exists. `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` names the provider when `ctx.subagents` is not composed and when it holds no provider under that name. `ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED` refuses a provider that runs its child outside this process — the four out-of-process backends, which [advertise no parent-enforced start-time capability](../../subagent/subagent/README.md) — whenever the configured `isolation` is above `none`: the read-barrier census cannot confine a foreign agent that brings its own tool stack. An in-process provider is refused nothing, because its child joins the parent's standing composition and keeps the deployment's own isolation. A composition that mounts an out-of-process provider records `subagent` as `unenforced` in its scope census under an `isolation: none` deployment, which is the state the barrier already writes for it; the stamp is what names which provider ran.

A tampered delegated attempt records its directive and ends the run without starting another child: the cell has no transcript of its own to carry the follow-up, and no certificate can follow a void attempt.

### The budget a delegated attempt runs under

A route attempt proposes steps, so [the budget policy](../../guard/budget-policy/README.md) measures and stops it at the deployment's caps without the runner asking. A delegated attempt proposes none, so the runner asks: it reads the same caps from `ctx.sessionBudgets` and applies them itself, and `ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED` refuses a delegated run in a composition that holds no budget policy, before an agent exists. A route run in such a composition is simply uncapped, because a deployment composing no policy has chosen no budgets; a delegated run would be uncapped where a route run under the same deployment is not, which is what the refusal prevents.

Around each attempt the runner does three things, all through `ctx.sessionBudgets`:

1. **Measures before the attempt.** `enforce(agent)` runs before the child starts, which is where the pre-step check sits too. A cap the cell already exceeds records `budget/breach`, blocks the goal, and ends the run: no child starts, and the workspace is not measured again because the previous attempt's validation already measured exactly this tree. A cell that ran out is a failed cell, not a longer one — and a cell that certified on the attempt that exhausted its budget still completes, because nothing measures it after the work is done.
2. **Arms the wall budget.** `remainingWallMs` becomes a deadline on the child's cancellation, one millisecond past the cap so the recorded span strictly exceeds it. An attempt the deadline ends records `stopReason: 'budget-deadline'`, which is what separates the cell's own budget from the seam's `aborted` that an operator's cancellation also produces. That attempt did work, so the tree it left is validated, and the `budget/breach` recorded when the deadline fired ends the run afterwards. A child a provider refuses to start because the deadline already fired leaves no delegation record; the breach is the record.
3. **Charges what the child spent.** `recordForeignSpend` writes one `usage/foreign` per child run — `reportedUsage` for an out-of-process child, the in-process child's summed `usage` otherwise, and `reportedCostUsd` converted at the deployment's `foreignCostEurPerUsd`. The budget fold adds it, so `maxTotalTokens` and a cost cap bound a delegated cell exactly as they bound a route cell, from the next attempt's measurement onward.

`ctx.environmentRuns.cellCaps(implementer)` answers what one cell of an arm runs under, and every report states it as `caps`. A route cell runs under every configured cap; a delegated cell runs under the same list minus a `maxCostEur` the deployment states no `foreignCostEurPerUsd` for, because a ceiling in one currency cannot bound a price in another. [Experiments](../experiments/README.md) refuse a plan whose two arms resolve to different lists.

## Sampling and what a replay reproduces

The request's `seed` and the deployment's `topP` are pinned on the agent's model selection, so every request the cell makes carries the same sampling and each is reconstructable from the session's `request/header` events. `seed` must be a safe non-negative integer; anything else fails the run with `ENVIRONMENT_RUN_INVALID_SEED` before an agent exists. The stamp carries `seed` because it is what distinguishes two cells of one plan; `topP` is constant across the deployment and stays in the request header alone.

A seed records what the run **asked for**, never what the provider did. An adapter whose wire has no `seed` field drops it, a provider that accepts one may still ignore it, and no provider promises identical tokens across model or infrastructure versions. What a replay reproduces is the session log — the prompt, the tools, the header, and the transcript — not a fresh sample from the model.

`policyVersion` is free-form text naming the checkpoint or policy the route served; the runner writes it into the stamp verbatim and never resolves it, so a fold keying measured difficulty by policy version compares the strings its logs carry.

## Weighted cases and the reservation

For a check whose environment supplied [case bodies](../environments/README.md#weighted-cases), the runner runs the candidate once per case in the workspace, in authored order. Each case empties the check's `treeScope` when it declares one, stages the case's `files`, appends the case's `argv` words to the check's command line, and feeds its `stdin`. Every configured channel is then normalized and digested: `exit` against `expected.exitCode`, `stdout` and `stderr` against their digests, and `tree` against the digest of every regular file under `treeScope` as the case left it. A truncated stream fails its channel, because the executor dropped bytes the digest covers. A case passes only when every configured channel matched.

The result carries `cases: { passed, total, weightPassed, weightTotal, failed }`; its status follows the cases, so one failing case fails the check. `failed` names up to `maxFailedCases` entries, each with the mismatching channels and the exit class (`zero`, `nonzero`, `signal`, or `timeout`). Evidence is the tally line followed by each named failure with its own exit fact and captured output — the raw bytes stay in the session log, which the read barrier denies an implementer.

## The clustered directive

A failed run issues one directive. `rootCause` names the count of failing checks. `detail` is one numbered line per entry: a cased check contributes one line per failure cluster — its failed cases grouped by the channels that disagreed and by exit class — naming the check's validator-authored `outcome`, the cluster's count and weight against the check's totals, the channels, and how the candidate ended; a check without cases contributes its recorded evidence line. The event also carries `clusters: [{ checkId, channels, count, weight }]` for the observatory, and `detail` stays bounded by `evidenceMaxChars`.

A cluster line names no case id, no expected digest, and no byte of captured output: what a hidden case expects is the case, so a wall that holds on the filesystem and leaks through the directive holds nothing. A caseless check keeps forwarding its evidence line, which is the older rendering an environment migrates away from by giving its checks cases.

The report carries the environment id, the session id, the stamp exactly as appended, one entry per attempt with its route, its transcript interface, its check results and workspace digest, `certified`, the certificate when one run passed, the model usage summed over the session's assistant messages, and `escapesDenied` — the `read-barrier/denied` records the cell's own log carries, which is `0` for a cell that stayed inside its workspace and for every run without a barrier. The scorekeeper folds the same records out of the persisted log, so the report and its scoreboard column cannot disagree. The session is flushed and the agent handle disposed on every path, including a thrown error.

`EnvironmentRunError` codes: `ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`, `ENVIRONMENT_RUN_INVALID_SEED`, `ENVIRONMENT_RUN_INVALID_LADDER`, `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE`, `ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED`, `ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED`, `ENVIRONMENT_RUN_INVALID_WORKSPACE`, and `ENVIRONMENT_RUN_INVALID_FIXTURE` reject before any agent exists; `ENVIRONMENT_RUN_UNSAFE_CHECK_SCRIPT`, `ENVIRONMENT_RUN_GOAL_REPLACED`, and `ENVIRONMENT_RUN_STANDARD_LOST` name a check the reservation cannot carry, an implementer that replaced the goal, or a standard that is no longer current, after the session was flushed; `ENVIRONMENT_RUN_NO_REFERENCE` and `ENVIRONMENT_RUN_NO_RESERVATION` refuse a reference staging the environment or the composition cannot support. `resolveConfig(config)` is the exported defaulting step.

Call `run()` only over a settled composition: the runner creates agents through the registry factory the agent loop registers. The durable record is the session log; the trajectory exporter folds it into a `dsh-trajectory/1` line whose `environment` field is the stamp and withholds held-out sessions by it.

## The staged reference

An environment that declares [`task.reference`](../environments/README.md#the-reference-directory) hides one directory of its fixture from the implementer and hands it to the validator. The first overlay of the fixture deletes that directory from the workspace afterwards, and the restoration before each validation copies only the immutable paths, which the runner refuses when one names the reference or lies inside it, so the implementer's tree never holds it; the reservation receives a copy at `reference/`, where the barrier denies an implementer every read. The reference sits inside the reservation, so the [check-owned digest](#tamper-on-check-owned-paths) already covers it: rewriting the reference under the validator voids the attempt exactly as rewriting a check script does.

`ctx.environmentRuns.stageReference(agent, environmentId)` mints one agent's reservation and stocks it with that environment's reference, for a validator deriving the standard before any implementer runs. It resolves the reference to the same `reference/run` entry the runner's own reservation carries, so [the instrument](../../verification/tool-standard-author/README.md) finds it at one path whichever session holds it. An unknown environment, one that declares no reference, and a composition with no read barrier are refused with `ENVIRONMENT_RUN_UNKNOWN_ENVIRONMENT`, `ENVIRONMENT_RUN_NO_REFERENCE`, and `ENVIRONMENT_RUN_NO_RESERVATION`.

`captureCase(shell, execution)` and `caseExpectation(capture, comparator)` are exported for the same reason: the runner measures a candidate with them and the instrument records a reference with them, so what a case means is one procedure rather than two that can drift. `captureCase` empties the `treeScope`, stages the case's files, appends its `argv`, and feeds its `stdin`; `caseExpectation` digests the channels a comparator names and leaves out a channel the run could put no value on — a signalled exit, a stream the executor truncated.

## Tamper on check-owned paths

The check-owned set is the barrier's reserved directory, when one was minted, plus every path the environment declares in [`task.immutable`](../environments/README.md#the-immutable-set): a declared file digests its bytes, a declared directory its whole tree, and a declared path that is gone digests as absent, so a deletion counts as much as a rewrite. The runner digests the whole set once before the implementer's first turn and again at the start of every attempt, before the fixture is restored — the overlay would otherwise put back exactly what the comparison is looking for.

A digest that differs from the one the validator left ends the run: no check is executed, every result of that attempt records that it was not, `recordRun` receives `tampered: true` and writes `verdict: 'tampered'`, no certificate can follow it, the goal stays out of `complete`, one directive states the tamper, and the implementer receives it as its last validation follow-up. The trajectory exporter reads the recorded verdict and scores the session `0` on its `tamper` basis. After every validation the runner re-digests the set it just rewrote, so its own `standard.json` and check scripts are the baseline the next attempt is measured against.

## Model Experience

### Task prompt and validation follow-up

#### What the model sees

For a route-implemented run the environment's `task.prompt` arrives as the first user message of a fresh session with the composition's ordinary system prompt and tools; the checks never appear. A delegated run sends the same text to the child instead, which reads it under its own product's prompt and tools. After a failed validation, while attempts remain, the next user message carries the block below, where `<rootCause>` reads `N of the standard's checks failed` and `<detail>` numbers one line per failure cluster of a cased check — its authored outcome, the cluster's count and weight, the channels that disagreed, and how the candidate ended — and one evidence line (exit fact, stdout and stderr tails) per failing check without cases, bounded by `evidenceMaxChars`. A tampered attempt sends the same block carrying the fixed tamper directive below and then ends the run; that text names neither a path nor a check, because a digest comparison knows that the check-owned set changed and nothing more. A route implementer receives the follow-up block alone, because the session above it already holds the task and its own work; a delegated one receives `task.prompt`, a blank line, and then the block, because its child holds neither, which is the transcript interface each implementer runs under.

##### Validation follow-up

```markdown
<validation_failed>
<rootCause>
<detail>
Continue working on the task; the validator runs again when you stop.
</validation_failed>
```

##### Restated validation follow-up, to a fresh child

```markdown
<task.prompt>

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

One user message per attempt: the prompt, then one follow-up block per failed validation whose size is bounded by `evidenceMaxChars`. A delegated later attempt repeats `task.prompt` ahead of that block, so its first message costs the task statement again — the only prompt tokens the transcript interface adds, against a whole transcript a route attempt carries. The tamper follow-up is fixed text. Nothing is added to the system prompt or to tool schemas.

#### KV Cache effect

Append-only for a route implementer: each follow-up extends the same session after its reusable prefix, so the conversation prefix stays cacheable across attempts, and a ladder that changes route between attempts moves that prefix to another model's cache. A delegated implementer starts a fresh child per attempt, so nothing of the earlier attempt is cached for it whatever the ladder does.

## Known Limitations and Deferred Work

- **A `keep` transcript on an out-of-process child is unavailable** — a delegated arm always drops the transcript, because resuming one foreign session across attempts needs a provider resume capability [the subagent seam](../../subagent/subagent/README.md) does not advertise. The in-process `spawn` provider is the route's `drop` counterpart until one does.
- **The barrier covers filesystem reads only** — an implementer preset that composes a log-reading tool, or a bash check-running executor, still reaches the standard through a seam the barrier does not fence; a certificate from this runner is as strong as the configured `isolation` claim, which nothing here verifies.
- **An external implementer is named, never characterized** — the stamp records the provider, not the product version, the settings, or the account behind it, so two hosts running one provider are not the same implementer even though their rows read alike. Its own tool stack and permissions stay outside every limit this harness enforces; only its [spend is bounded](#the-budget-a-delegated-attempt-runs-under), and only as far as its own backend reports it.
- **A provider that reports no spend is bounded by the wall cap alone** — `usage/foreign` states what the child's backend published, so a backend publishing neither tokens nor a price leaves the token and cost caps measuring zero for that work. Nothing here can observe a spend a foreign product does not report.
- **The wall deadline is a clock, the wall cap is a log span** — the deadline is armed from the cell log's first event, the same anchor `maxWallMs` is measured from, but a delegated cell appends nothing while its child runs. The two therefore agree to within the gap between the cell's newest event and the child's end.
- **A reserved check runs by being sourced** — the command line is `. <script>`, which a POSIX shell executor runs exactly as it would the inline instruction; a composed PowerShell executor cannot source an extensionless file, so such a deployment runs without a barrier.
- **The immutable paths are the only restoration** — each validation copies the declared immutable paths back from the fixture; every other fixture file and every file the implementer added stays in the workspace and reaches the checks, so a fixture file the implementer must not change has to be declared immutable.
- **Tamper detection is a digest comparison** — it reports that the check-owned set changed, never who changed it or how, so a legitimate build step that rewrites a file inside the immutable set voids its run; environment authors declare the set narrowly, and a false verdict costs one run rather than a wrong certificate.
- **Command checks only** — a check whose `run` is a procedure fails as a non-zero exit with the evidence saying so; judges belong to the oversight seam.
- **Sequential checks and cases, one repetition per call** — checks run one after another in the workspace and a cased check runs its cases in authored order, so a large case set costs one executor start per case; group sampling repeats `run()` with `repetition` and `group` set by the caller.
- **A case's `argv` rides the check's command line** — the words are appended verbatim and must need no shell quoting, which authoring enforces, because the composed shell's dialect is not known where the standard is authored. A case that needs an argument holding spaces stages it as a file instead.
- **A caseless check still forwards its output** — the clustered directive closes the wall for cased checks; a check that carries no cases keeps sending its bounded stdout and stderr tails to the implementer.
- **Fixture overlay does not clear the workspace** — same-named files are overwritten; the runner refuses a workspace that is not a directory but does not require it to be empty.
