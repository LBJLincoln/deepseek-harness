# Agent Note: Departments delegated to an external coding agent

Status: proposed

English | [中文](2026-09-06-program-external-implementer.zh.md)

## Problem

A program staffs each of its goals with one department: a harness agent in its own git worktree, driven through the LLM seam turn by turn, then integrated, released, and signed off ([program-ledger note](2026-09-06-program-ledger.md)). That is the only way to staff one. A lab that wants to know whether its own harness beats another coding agent on the same deliverable, or a client district that already pays for one, has no way to put that agent behind a department: the subagent seam can run an external coding agent as a child ([`ctx.subagents`](../../../../packages/subagent/subagent/README.md)), but nothing connects it to the ledger, the worktree, the caps, the checks, or the certificate. Without that connection the comparison is not a comparison — the external agent would be measured by whatever it says about itself, while a harness department is measured by checks a validator ran on the tree it left. The measurement the program already owns is the interesting half, and it is the half an external agent cannot supply.

## Proposal

`ProgramSpec.implementer` names how every department of one program is staffed: `{ kind: 'route' }`, the harness agent this service drives through the LLM seam, or `{ kind: 'subagent', provider, label? }`, one child run of a registered subagent provider per attempt. Everything else the program owns stays the program's: the ledger events, the department worktree and branch, the `program/member` stamp, the `budget/caps` record, the standard authored from the goal's `checks`, the round cap, the certificate, the integration merge, the release, and both signatures. The program is still the validator; only who writes the code changes.

### The spec field and the identity it changes

`resolveProgramSpec` materializes `{ kind: 'route' }` when the caller omits the field, so a frozen spec always states its staffing, and `programSpecDigest` covers it. A program staffed differently is therefore a different program: the same goals delivered by the harness and by an external agent get different ids, different sessions, and different worktrees, which is what makes a comparison between them two runs rather than one run mutated. `program/start` copies the resolved `implementer` beside `baseRevision` for a reader of that event alone.

### What one delegated attempt is

The department is opened exactly as today — worktree, session with `meta.cwd` at the worktree, preset, `program/member`, `budget/caps`, goal, standard — and then, instead of a user turn, one attempt is one `ctx.subagents.start(provider, { prompt, parent: departmentAgent, signal, label? })`. The prompt is the goal objective on the first attempt and the same check-failure text a driven department would receive on later ones. In-process providers and every shipped out-of-process one derive the child's working directory from the delegating parent session's `cwd`, which is the department worktree, so the child works on the department branch without the program passing a path. The run's result is awaited, `program/delegation { goalKey, attempt, provider, runId, stopReason, structured?, usage? }` is appended to the department session and flushed, the run is disposed, and the department's checks then run on the tree the child left exactly as they run on the tree a driven department left. The round cap bounds delegated attempts as it bounds turns.

### Refusals at the department that makes the decision

A delegated department refuses to start when `ctx.subagents` is not composed or has no provider under that name, with `PROGRAM_IMPLEMENTER_UNAVAILABLE` naming the provider, and when the goal claims an isolation above `none` while the provider runs its child outside this process, with `PROGRAM_IMPLEMENTER_ISOLATION`. The second rule is the honest one: isolation above `none` is a claim over what the session's own read-barrier census proves about its executors, and no executor of this process mediated a child in another one. An in-process provider joins the parent's standing composition, keeps the same census and role, and may therefore keep the deployment's isolation. Both refusals are made in the operation that starts the department, before its worktree exists, and land in the ledger as `program/goal { failed, reason }`.

### Reconciliation

A restarted process reads a delegated department the way it reads any other: the department's own log is the authority, a certificate in it is `certified`, and everything else is `running` and resumed. The delegation events are part of that log, and the highest attempt they record is what the resumed pass continues after, so an attempt that already ended is never run a second time. The invariant companion holds the same relation: a `program/delegation` follows the session's `program/member` for the same key and carries an attempt strictly greater than every attempt the session already recorded.

### What a delegated certificate proves

The program ran the goal's checks, through the shell executor, in the department worktree, on the tree the external agent left, and recorded the run and the certificate in the department's own session. That is the whole claim. It does not prove anything about how the tree was produced: for an out-of-process provider no model-visible history of the implementer lives in our log, the department's trajectory carries no steps, and `usage` is recorded only for a child this process published and whose own session log accounts for tokens. A reader comparing a delegated department with a driven one is comparing certificates over trees, which is the comparison that means something, not transcripts.

## Alternatives considered

**A per-goal implementer instead of a per-program one.** Rejected: the program-level field is what makes "the same deliverable, staffed two ways" two program ids over the same goals. A spec mixing implementers across its goals would produce one digest whose departments cannot be attributed, and nothing asks for that today; the field can be pushed down to the goal later without changing any event.

**A second `ProgramService` config field rather than a spec field.** Rejected: staffing decides what the program runs, so it belongs to the frozen spec and inside the digest. As deployment config it would sit outside the identity, and the same program id would mean one thing on one host and another elsewhere — exactly what freezing the spec exists to prevent.

**Delegating through the subagent tool instead of the seam.** Rejected: the tool is a model-facing consumer that lets an agent decide to delegate. Here the program decides, before any turn, and no department model is involved at all; reaching the tool would require a driven department whose only job is to call it, which spends a route and adds a transcript that says nothing.

**Letting a delegated department report its own result.** Rejected: an `agent-reported` run may certify only at `isolation: 'none'` and is the implementer's own account of its checks. The program already runs the checks itself as `executor: 'runner'`, and that is the only thing the external agent cannot fake.

**Refusing every out-of-process delegation under a composed read barrier here.** Rejected as duplication: the providers already call `assertOutOfProcessAllowed` in the operation that would launch the child, so a barrier that denies the department's role refuses the start on its own. The program's own rule is about the isolation the certificate would claim, which the barrier does not decide.

**A `program/delegation` event on the program session instead of the department's.** Rejected: the department session is the authority for its own state, and the ledger is the index a restart reads. Putting attempts in the ledger would make the program session grow with the work and would give reconciliation a second authority to reconcile against.

## Acceptance criteria

- A Loader-booted keyless e2e composes an in-process provider that inherits the parent route over the mock route and runs a one-goal program with `implementer: { kind: 'subagent', provider: … }`: the department certifies, its log carries one `program/delegation` for attempt 1 and a `verification/certificate`, and the program releases.
- The same fixture with a check the mock cannot satisfy records one `program/delegation` per attempt up to `maxGoalRounds` and ends the program `failed`.
- A composition naming a provider nothing registered fails the department with `PROGRAM_IMPLEMENTER_UNAVAILABLE` naming that provider; a goal at `isolation: 'process'` or `'host'` delegated to an out-of-process provider fails with `PROGRAM_IMPLEMENTER_ISOLATION`, both before a worktree is created.
- The digest of one spec changes when its `implementer` changes and is unchanged when the caller omits the field, which resolves to `{ kind: 'route' }`.
- A department whose log already records a delegated attempt that ended resumes at the next attempt and never repeats the recorded one; the invariant companion rejects a `program/delegation` without a `program/member` for its key and one whose attempt does not advance.
- A with-key style fixture composes the real `claude-code` provider with the program and runs a one-goal program whose check reads a file the child must create; it self-skips unless the operator opts in, because it drives a real external CLI on the host's own authentication.

## Risks

- **The tree is the only evidence.** A delegated department's certificate says what the checks found and nothing about the process that produced it. A deployment that needs the transcript has to use an in-process provider, whose child session is an ordinary persisted session, or accept that the record stops at the worktree.
- **An external agent under no harness policy.** An out-of-process child brings its own tool stack, its own permissions, and its own network reach; the program's sandbox, approval policy, and read barrier reach the department session, not the child process. The worktree bounds what it should touch, not what it can. The reverse also bites: those settings decide whether an unattended child may write at all, and one that may not still ends its runs normally, so a department whose external agent was silently denied is indistinguishable from one that tried and could not — both read as `failed` after the round cap, with the check evidence as the only explanation.
- **Spend the program cannot see.** The program ceiling folds sessions carrying `program/member`, and a delegated child's spend is either in a separate unstamped session or outside this process entirely. `usage` on the delegation event records what a locally published child cost; nothing bounds an external agent's own billing.
- **Attempts are coarser than turns.** A driven department can be steered mid-attempt; a delegated one is one prompt and one result, so a round cap of `n` buys `n` chances rather than `n` messages. Programs delegating to an external agent will want a smaller cap and a larger per-attempt scope.
- **Provider capabilities decide the isolation rule.** The out-of-process test reads the provider's advertised start-time capabilities, which every shipped out-of-process backend declares empty for exactly this reason. A future backend that runs a child in another process while advertising a start-time capability would defeat the test, and the rule would have to move to an explicit marker on the seam.
