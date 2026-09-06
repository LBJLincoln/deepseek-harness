# @deepseek-ai/dsh-verification

English | [中文](README.zh.md)

Event-sourced executable completion standards for an agent session's goal. A validator authors the standard before implementation, may extend it, and may weaken it only through an evidenced relaxation; a certificate is recorded only by a fully passing run, and completion admission asks for exactly that certificate. The [verification-seams Agent Note](../../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md) owns the design rationale.

## Config

```yaml
- id: verification
  name: '@deepseek-ai/dsh-verification'
  config:
    maxChecks: 256
    maxTextChars: 16384
```

`maxChecks` bounds one standard's active checks; `maxTextChars` bounds every recorded outcome, run instruction, evidence, root-cause, and detail text. Both must be positive safe integers.

## Service contract

`ctx.completionStandards` accepts only the exact live `Agent` instance registered under its id. `get()` returns a detached `StandardView`; mutations use a `StandardRef { id, revision }` compare-and-set fence and reject stale refs. At most one standard is current per session; `author()` creates a revision-one standard for a goal and rejects a second standard for the same goal, while a standard for a different goal supersedes the previous one. `extend()` appends checks and never rewrites existing ones; `relax()` removes exactly one check and records non-empty unsatisfiability evidence. `recordRun()` demands exactly one result per active check plus the run's `RunEvidence` (`executor`, either `runner` or `agent-reported`; the optional `treeHash` of the workspace tree the run covered; and the optional `tampered` marker its caller alone can know): every run appends a `verification/run` event carrying all of its results in check order, its attempt number, that evidence, and the run's `verdict`, and only a `passed` verdict commits a durable certificate while every other returns the failing subset. Before anything is appended, `recordRun()` refuses an isolation claim the session's own durable record does not support, with `VERIFICATION_ISOLATION_UNPROVEN` — the run event carries the claim too, so an unproven level never reaches the log at all. An attempt number is one plus the runs already recorded for the same standard id across its revisions, so attempts and flakiness replay from the log alone. `issueDirective()` records the root-cause aggregation a consumer relays to the implementer. `assertCertified()` returns the certificate covering the exact current revision for one goal and otherwise throws, which makes it the admission read an orchestrator places before `ctx.goals.complete()`. When a goal service is composed, the service also registers the same admission as a deny-only `completionGuard()` on `ctx.goals`, so `GoalService.complete()` itself rejects an uncertified completion of a measured goal; unmeasured goals complete untouched.

Every mutation appends one durable session event carrying complete post-mutation state: `verification/standard` (author, extend), `verification/relaxation`, `verification/run`, `verification/certificate`, or `verification/directive`. Strict replay validates revisions, append-only check growth, relaxation form, run coverage and attempt numbering, verdict agreement with the results, certificate coverage, and timestamp continuity, and any standard mutation invalidates the prior certificate. The session log is the only durable authority; a fresh service instance rebuilds its view from it.

### What a run's verdict says

A run's `verdict` states what the run means: `passed` when every result passed, `failed` when one did not, and `tampered` when the caller reports that the files it measures the task with changed under it — the [environment runner](../../improvement/environment-runner/README.md#tamper-on-check-owned-paths) digests them and passes `tampered: true`. Only `passed` certifies, so a tampered run certifies nothing whatever its results say, and replay rejects a `passed` verdict with a failing result or a `failed` verdict with none. A recorded payload that omits `verdict` reads as its results decide, because only tamper cannot be derived from them.

The separately published `./invariant` companion maintains an independent fold of each attached session. It rejects malformed verification changes before they enter the durable log, rejects a `goal/change` completion for a goal that a current standard measures without a covering certificate, rejects a `verification/certificate` that no fully passing `verification/run` of the same standard revision precedes, rejects one over a run whose verdict is not `passed`, rejects one whose `executor` differs from the run it cites, and applies the identical isolation rule `recordRun()` applies live — so a forged certificate fails replay wherever the companion is installed.

### What an isolation claim requires

`isolationProblem(events, isolation, executor)` decides the rule over one session log alone, which is what makes the live refusal and the replay refusal the same rule on the same evidence. A live barrier would add nothing: everything it knows about a session is already in the `read-barrier/scope` census [`dsh-read-barrier`](../read-barrier/README.md) appended before that session's first request.

| Level | What the record must carry |
|---|---|
| `none` | Nothing. A session that composed no barrier certifies exactly as before. |
| `process` | A `read-barrier/scope` census with role `implementer` and no `unenforced` capability, and a `runner` executor. |
| `host` | Everything `process` requires plus a `read-barrier/attestation` the barrier verified. |

Two rules apply at every level, `none` included. A census listing a tool that carries a [tool authority](../../core/tools/README.md) forfeits the certificate, so composing a log-reading tool costs the certificate even if the runtime guard was somehow bypassed. A `request/header` assembling a tool name the census does not cover forfeits it too, which is what catches a tool added after the census was taken.

## Extension points

Policy consumers call the service verbs and fold the five events from the session log. When a projection registry is composed, a `verification` session projection serves the same state to clients: the whole current standard with its certificate and the session's directive and run counts, `null` before authorship. A certificate is a replayable record of which checks passed with what evidence, under which isolation level (`none`, `process`, `host`), and by which executor (`runner` or `agent-reported`, copied from the run it cites), so evaluation and training-data pipelines can score sessions from the log alone: per-agent tallies of certificates earned, runs attempted, directives received, and relaxations recorded derive from the events without new instrumentation. Consumers use the `Agent` interface and session events rather than importing the agent loop.

## Model Experience

Indirectly, through the policy consumers that relay `verification/directive` text to the implementer and admit goal completion; every event this service appends is log-only and never enters model history.

#### KV Cache effect

No direct invalidation; a relaying consumer owns any request-prefix changes its messages cause.

## Known Limitations and Deferred Work

- **Admission requires the goal service** — enforcement runs inside `GoalService.complete()` through the registered completion guard when both services are composed; an assembly without `ctx.goals` keeps only the service verbs and `assertCertified()` for its own callers, and the invariant companion still rejects an uncertified completion stream wherever it is installed.
- **The rule reads records, not the live runtime** — an isolation claim is checked against what the session logged, so a composition whose barrier is present but never appended a census cannot claim above `none`, and a plugin able to append a counterfeit census can claim what it likes. Only `host` rests on evidence produced outside the process.
- **Directive delivery is consumer work** — directives are log-only records; without a consumer that relays them as plugin-sourced user messages, the implementer never sees them.
- **No run executor** — the validator agent executes checks with its own tools and reports results; this package records outcomes and never spawns processes. `executor: 'agent-reported'` says the implementer's own session accounted for its checks, which is why it may certify only at `none`.
- **Trusted in-process producers** — a plugin with direct `Session` access can append counterfeit verification data. Strict replay detects malformed or inconsistent records and fails at that record; this is integrity detection, not plugin isolation.
