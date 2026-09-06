# Agent Note: Programs, the durable ledger for multi-goal software delivery

Status: proposed

English | [中文](2026-09-06-program-ledger.zh.md)

## Problem

The second goal of the lab, the best agentic software creation through the harness, is a program: one client deliverable decomposed into many goals, each run by a department in its own session, workspace, preset, isolation, and budget, integrated on a merged head, and released only on a certificate of that head. The harness runs one goal per session by design (`ctx.goals` keeps one current goal), the environment runner runs one goal per cell, and the shift driver runs plans of cells; nothing maps a deliverable to the goals it decomposes into, records which department owns each goal and at which revision, restarts a half-finished deliverable without repeating or dropping a department, or certifies the merged head as one thing. The [four-goal note](2026-09-05-four-goal-workflows.md) names this the program ledger (W2 stage 5) and the integration goal (stage 8), both proposed, and its rollout item 11 defers durable orchestration to a journaling workflow engine that does not exist. The published counterpart is a shipped multi-goal runner whose validation contract is authored before the features are decomposed; the [competitive baselines note](2026-09-06-competitive-baselines.md) ranks the ledger among the five most valuable additions. The practice already exists in this repository's own development: one goal per agent per worktree, gates before every merge, an integration pass on the merged head. This note turns that practice into a plugin whose record is the session log.

## Proposal

A `@deepseek-ai/dsh-program` plugin under `packages/improvement/program`, beside the fleet and the shift driver whose session-per-unit ledger pattern it shares, providing `ctx.programs`. A program is a frozen spec, one program session holding `program/*` events, one department session per goal created the way the runner creates a cell, one worktree per department from the program's base revision, and one integration session whose certificate is the program's. The department sessions are the authority for their own state; the program session is the index a restart reads, and every ledger event is appended after the fact it records is durable.

### The spec and its identity

`ProgramSpec` is `{ objective, baseRevision, goals, integration, signoff? }`. Each goal is `{ key, objective, preset, isolation, budget, dependsOn, checks }`: `key` a lower-kebab-case identity unique in the program, `preset` the id of a shipped preset whose declared role is `implementer`, `isolation` a `CertificateIsolation`, `budget` the per-session caps of the budget policy (`maxTotalTokens`, `maxWallMs`, `maxCostEur`), `dependsOn` a list of goal keys forming a directed acyclic graph, and `checks` the `StandardCheck` list compiled for that goal before any department starts. `integration` is `{ checks, gates }`: the standard run against the merged head and the shell gates (the repository's own lint, test, and doc-sync commands) that must pass beside it. `signoff` is `{ artefactSha256 }`, the artefact the program's signatures attest; `Config.requireSignoff` decides whether the program session must carry a `signoff/recorded` over that artefact before departments start, and a client-district composition sets it. `programSpecDigest(spec)` is the SHA-256 hex over the canonical spec with goals sorted by key; the program id is `program-<digest>`, so the same frozen spec started twice is the same program, and a second `start` of a program whose session already exists resumes it instead of forking it.

### The ledger

The program session carries: `program/start { programId, specSha256, spec, baseRevision, signoff? }`; `program/goal { programId, key, status, sessionId?, workspace?, revision?, reason? }` at every status change, `status` in `pending | running | blocked | certified | failed | merged | abandoned`, `revision` the department branch head when the status was recorded, `reason` the blocking code or failure text; `program/integration { programId, status, mergedRevision?, sessionId? }` with `status` in `running | certified | failed`; `program/resume { programId, statuses }` with the reconciled count per status when a later process picks the program up; and `program/end { programId, outcome, mergedRevision? }` with `outcome` in `released | failed | abandoned`. Each department session carries one `program/member { programId, key }` stamp at creation, the counterpart of the runner's `environment/run` stamp, so the scorekeeper can fold a program's sessions without the index. Every status in the ledger is derivable: `certified` follows a `verification/certificate` in the department's log, `blocked` a `goal/change` into the blocked phase, `merged` a merge commit whose parents include the department branch head, `failed` a goal cleared or a session ended without a certificate past its round cap.

### Departments

A goal whose `dependsOn` are all `merged` starts as a department: the program adds a git worktree at `<workspaceRoot>/<programId>/<key>` on a branch `program/<programId>/<key>` from the base revision, creates the department session through `ctx.agents.create` with `meta.cwd` at that worktree and the goal's preset mounted with its declared role, reserves the read-barrier root when a barrier is composed, appends `program/member`, creates the goal with the goal's objective and the configured round cap, authors the goal's standard from `checks` as the validator, and appends `budget/caps` with the goal's budget to the department session. The budget policy gains that one event: the caps it enforces for a session are the configured caps tightened by the session's `budget/caps` when present, folded from the log like everything else it reads, so a department cannot outspend its goal and the model sees nothing. At most `Config.maxConcurrentGoals` departments run at a time; a department's goal that reaches the blocked phase records `program/goal { status: blocked, reason }` and waits for an operator's resume through the goal domain, a goal that completes with a certificate records `certified` with the branch head, and a goal that ends without one past its cap records `failed`. The program never writes into a department's worktree.

### Integration and release

When every goal is `certified`, the program creates the integration worktree from the base revision, merges the department branches in dependency order with merge commits, and starts the integration session over that worktree with the `integration.checks` as its standard and a goal whose objective is to make the merged head pass the standard and the `gates`; a clean merge whose checks pass on the first attempt needs no model turn, and a conflicting merge is what the integration department's goal is for. Its certificate is recorded as `program/integration { status: certified, mergedRevision }`, and each department goal moves to `merged`. `program/end { outcome: released, mergedRevision }` follows only that certificate and the release `signoff/recorded` on the program session, which `requireSignoff` reads at the closing edge exactly as it reads the spec freeze when the program opens.

### Resume

`ctx.programs.resume()` runs on the application's ready event and on demand: it lists persisted sessions, loads every program session with a `program/start` and no `program/end`, reconciles each goal from its department session's log (phase, certificate, branch head read from the worktree), appends `program/resume` with the counts, resumes departments whose sessions exist and whose goals are active but disarmed through the goal domain's resume, starts departments for `pending` goals whose dependencies are merged, and never creates a second session for a key that has one. A department whose worktree is missing while its session exists is `failed` with that reason, because the branch is the evidence the certificate cites. A program's token ceiling (`spec.tokenCeiling`, optional) is folded from every member session's usage at each start, the way the shift driver reduces a plan's ceiling, so a restarted program cannot spend past its ceiling by forgetting what it spent.

### Composition

The plugin requires `agents`, `sessions`, `sessionPersistence`, `goals`, `completionStandards`, `shell`, and `agentPresets`; it reads `readBarrier` optionally. `verify-village-composition` counts a composition of `dsh-program` as a district composition, so it must carry the budget policy, persistence, and the checkpoint policy. Config: `workspaceRoot`, `requireSignoff`, `maxConcurrentGoals`, `maxGoalRounds`, `branchPrefix`.

### What slices 1 to 3 landed differently

- **A goal starts on `certified` dependencies, not `merged` ones.** `merged` follows the single integration pass, which needs every goal certified, so requiring it to start a dependent deadlocks every program that has one. `merged` stays what a certified integration records.
- **The program is its departments' validator and drives their attempts.** It creates each goal, disarms it the way the environment runner does, delivers the objective, runs the standard's checks through the shell, records the run, and issues a directive between attempts; `maxGoalRounds` is both the goal's cap and the attempt bound. A resumed department takes the goal domain's own resume edge — the durable record that this process took it back over — before the service disarms it again, so the composed goal-round driver stays the path an operator's own resume takes.
- **Two composition facts the note did not list.** `agentDefaultModel` is a required injection, because a department session needs a model route; and `Config.evidenceMaxChars` bounds recorded evidence, because the verification domain refuses text longer than its own `maxTextChars`.
- **`workspaceRoot` is the repository.** The note named a directory worktrees are minted under but no repository holding `baseRevision`; the landed field is the git repository the program delivers into, with `<workspaceRoot>/<programId>/<key>` under it.
- **The integration is a key, and its gates are checks.** The integration worktree and session use `@integration`, which no lower-kebab-case goal key can claim; each entry of `integration.gates` becomes one `gate-<n>` check of the integration standard, so the certificate covers the gates, and an integration check claiming such an id is refused at spec validation. The integration session mounts the roster's default preset and claims `none` isolation.
- **The digest excludes `signoff`.** It names the artefact the signatures attest rather than what the program runs, so the same goals signed over two artefacts are one program.
- **The ledger declares before it reports.** `program/start` is followed by one `pending` record per goal, and a reconciliation declares any goal the ledger never recorded, so the first record of a key is always `pending` and the companion can check every later transition against it. `program/integration` may enter at `failed` when its worktree could not be created at all.
- **A department session id is derived** as `<programId>-<key>`, which makes "never a second session for a key" a property of the identity rather than of a lookup.
- **The barrier reservation stages nothing.** The run directory is reserved so the barrier records the department as an implementer, but check scripts are not written into it, so a goal declaring isolation above `none` is refused by the verification domain unless the session's own census proves the claim.
- **`abandoned` has a producer.** A program that reaches its `tokenCeiling`, or that ends before a pending goal started, records those goals `abandoned`; a ceiling stop ends the program `abandoned` rather than `failed`.

## Alternatives considered

**A workflow-engine script as the orchestrator.** Rejected for now: the worker-thread engine journals nothing, so a program dies with its process; the journaling engine of the four-goal note's item 11 can host this loop later without changing the ledger events.

**Several goals inside one session.** Rejected: one current goal per session is the goal domain's design, and departments need their own workspace, preset, isolation, budget, and barrier reservation; parallelism is between sessions.

**One shared workspace for every department.** Rejected: departments collide, and the merge of independent branches onto the base revision is the integration test a shared tree would skip.

**A plan authored freely by an orchestrating model.** Rejected: the four-goal note derives the plan from the compiled standards; a program's goals and their checks are frozen in the spec digest before the first department starts, which is what makes the same deliverable reproducible.

**A ledger file beside the sessions.** Rejected, as for the shift driver: a second authority that persistence, replay, the session query tools, and the invariant companions do not know.

## Acceptance criteria

- A Loader-booted e2e over a temporary git repository runs a program of two goals with a dependency through mock models: two department worktrees on their branches, a certificate per department, `program/goal` transitions `pending → running → certified → merged`, an integration merge with a certificate, and `program/end { outcome: released }`; the scorekeeper's export shows every member session with its `program/member` stamp.
- The same fixture killed after the first department's certificate is durable and restarted on the same persistence root reconciles `certified` from the log, appends `program/resume`, starts only the pending goal, creates no second session for any key, and ends released.
- `requireSignoff: true` refuses `start` without a signoff record and refuses release without one, each with a pinned error; the digest of a spec is stable under goal reordering and changes with any check, budget, or dependency.
- A department whose budget policy breaches records `program/goal { status: blocked, reason: budget-exhausted }`, and the program does not start dependents; a department missing its worktree on resume is recorded `failed` with that reason.
- The invariant companion rejects a `program/goal` before `program/start`, an illegal status transition, `merged` before `program/integration { certified }`, and `program/end { released }` without a certified integration, each with a failing fixture; the budget policy's companion rejects a `budget/caps` that widens a configured cap.
- A composition of `dsh-program` without the budget policy, persistence, or the checkpoint policy fails `verify-village-composition` with a message naming the program.

## Rollout

1. Landed. `dsh-program`: the spec digest, the program session and `program/*` events, departments with worktrees and `program/member`, resume, the invariant companion, the two-goal e2e with kill and restart, the README pair, catalogs regenerated.
2. Landed. `budget/caps` in the budget policy: the event, the tightening fold, the companion rule, and the program writing it.
3. Landed. Integration: the merge in dependency order, the integration session, `program/integration`, release. The `verify-village-composition` rule of item 4 landed with it, because a program composition without a capped budget policy is exactly what the ceiling and the per-department caps rely on.
4. Downstream: the scorekeeper's `program` facts group from `program/member`, the shift driver able to schedule programs as slots.
5. Landed. Governance: both `requireSignoff` gates read a `signoff/recorded` from the program session — `spec-freeze` when it opens, `release` before it ends released — over the artefact `spec.signoff` names, recorded by the caller through `ctx.signoffs` ([attributable-decisions note](2026-09-06-attributable-decisions.md)). Still needed: the validation instrument's `standard_author` authoring a program's checks from the frozen spec.
6. Later, the journaling workflow engine hosts the loop; the ledger events do not change.

## Risks

- **Git from a service.** Worktrees, branches, and merges run through the composed shell under the sandbox policy; the program touches only its own worktrees and never a department's tree except by merging its branch, and a dirty integration tree fails the integration goal rather than being cleaned.
- **Round caps on resume.** A resumed department keeps its admitted rounds, so a program that restarts often exhausts caps sooner; the ledger makes that visible as `failed` with the reason.
- **Parallel spend.** Departments spend concurrently; the goal budgets bound each and the program ceiling bounds the sum, folded from the logs at every start.
- **Long programs and log size.** A program's own log stays small (one event per transition); the department logs are where the work is, and the scorekeeper reads them as it reads any session.
- **A signature is recorded, not authenticated.** The gate reads a principal the deployment's identity provider supplied; nothing verifies that the id names the person who signed, so `requireSignoff` proves a record exists over the right artefact, not that a particular person made it.
