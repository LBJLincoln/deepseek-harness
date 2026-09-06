# @deepseek-ai/dsh-verification

English | [中文](README.zh.md)

Event-sourced executable completion standards for an agent session's goal. A validator authors the standard before implementation, may extend it, and may weaken it only through an evidenced relaxation; a certificate is recorded only by a fully passing run, and completion admission asks for exactly that certificate. The [verification-seams Agent Note](../../../.agents/notes/proposed/architecture/2026-08-29-verification-improvement-oversight-seams.md) owns the design rationale.

## Config

```yaml
- id: verification
  name: '@deepseek-ai/dsh-verification'
  config:
    maxChecks: 256
    maxCases: 1024
    maxTextChars: 16384
```

`maxChecks` bounds one standard's active checks; `maxCases` bounds the cases those checks hold in total; `maxTextChars` bounds every recorded outcome, run instruction, evidence, root-cause, and detail text. All three must be positive safe integers.

## Service contract

`ctx.completionStandards` accepts only the exact live `Agent` instance registered under its id. `get()` returns a detached `StandardView`; mutations use a `StandardRef { id, revision }` compare-and-set fence and reject stale refs. At most one standard is current per session; `author()` creates a revision-one standard for a goal and rejects a second standard for the same goal, while a standard for a different goal supersedes the previous one. `extend()` appends checks and never rewrites existing ones; `relax()` removes exactly one check and records non-empty unsatisfiability evidence. Both authoring verbs take `AuthoredCheck`s and validate any weighted cases they hand in. `recordRun()` demands exactly one result per active check plus the run's `RunEvidence` (`executor`, either `runner` or `agent-reported`; the optional `treeHash` of the workspace tree the run covered; and the optional `tampered` marker its caller alone can know): every run appends a `verification/run` event carrying all of its results in check order, its attempt number, that evidence, and the run's `verdict`, and only a `passed` verdict commits a durable certificate while every other returns the failing subset. Before anything is appended, `recordRun()` refuses an isolation claim the session's own durable record does not support, with `VERIFICATION_ISOLATION_UNPROVEN` — the run event carries the claim too, so an unproven level never reaches the log at all. An attempt number is one plus the runs already recorded for the same standard id across its revisions, so attempts and flakiness replay from the log alone. `issueDirective()` records the root-cause aggregation a consumer relays to the implementer. `assertCertified()` returns the certificate covering the exact current revision for one goal and otherwise throws, which makes it the admission read an orchestrator places before `ctx.goals.complete()`. When a goal service is composed, the service also registers the same admission as a deny-only `completionGuard()` on `ctx.goals`, so `GoalService.complete()` itself rejects an uncertified completion of a measured goal; unmeasured goals complete untouched.

Every mutation appends one durable session event carrying complete post-mutation state: `verification/standard` (author, extend), `verification/relaxation`, `verification/run`, `verification/certificate`, or `verification/directive`. Strict replay validates revisions, append-only check growth, relaxation form, run coverage and attempt numbering, verdict agreement with the results, case tallies against their check's reference, parity against those tallies, directive clusters against the cased checks they name, certificate coverage, and timestamp continuity, and any standard mutation invalidates the prior certificate. The session log is the only durable authority; a fresh service instance rebuilds its view from it.

### Weighted cases

A check may carry `cases`: `{ count, weightTotal, sha256 }`, the durable reference to the case bodies a validator authored for it. The bodies never enter the log — `author()` and `extend()` take them beside the reference on an `AuthoredCheck` and store the reference alone, so the log stays the size of the standard while the [validator's reservation](../../improvement/environment-runner/README.md#weighted-cases-and-the-reservation) holds what the cases say. `resolveAuthoredCases()` is the exported validation both verbs apply before anything is committed; it refuses with `VERIFICATION_INVALID_CASE` a reference without bodies or bodies without a reference, a reference that does not describe the bodies handed in, a case id that is not lower-kebab-case or repeats another, a weight that is not a positive safe integer, an `argv` word that needs shell quoting, a staged file path that is not a normalized workspace-relative path, an unknown or repeated channel, a configured channel with no expected value, an unknown normalizer id, and a `treeScope` that no case compares or a case comparing `tree` without one. `maxCases` bounds a standard's cases the way `maxChecks` bounds its checks.

A case names the channels it compares — `exit`, `stdout`, `stderr`, and `tree` (the work tree under the check's `treeScope`) — and passes only when every one of them matches its expected digest. Each byte channel is normalized first, through an ordered list from this closed set:

| Normalizer | Effect |
|---|---|
| `crlf` | Rewrites every `\r\n` to `\n`. |
| `trailing-whitespace` | Drops spaces and tabs at the end of each line. |
| `blank-lines` | Drops leading and trailing blank lines and collapses each interior run of them to one. |
| `iso8601-timestamps` | Replaces each ISO-8601 timestamp with `<timestamp>`. |
| `temp-paths` | Replaces each temporary-directory prefix with `<temp>`. |
| `json-canonical` | Reserializes valid JSON with sorted keys and no insignificant whitespace, and leaves anything else unchanged. |

Every entry is a pure function over UTF-8 bytes and idempotent under repetition; `normalizeCaseBytes()` applies a chain, `caseChannelDigest()` digests the result, and `caseBodiesSha256()` and `checkCasesRef()` derive the reference a check must carry. The set is closed because each entry widens what counts as equal.

`hashWorkspaceTree(root, normalizers?)` is the same comparison at whole-tree scale: SHA-256 over every regular file under a directory — relative POSIX path, then bytes, in sorted path order, each field NUL-terminated — which is what a `tree` channel digests for one case's scope and what a run's `treeHash` states for the whole workspace. It lives here rather than in either caller because the executor that records a digest and the [judge](../judge/README.md) that re-derives it from a copy must not disagree over path spelling, sort order, or normalization.

### Parity, and what it does not decide

`recordRun()` derives a cased check's status from its `cases` tally — `pass` only when every case passed, whatever status the caller reported — and refuses a tally whose `total` or `weightTotal` disagrees with the check's reference, whose `passed` or `weightPassed` exceeds its own total, or whose `failed` list is longer than the failures it counts, and a tally answering a check that references no cases. A caseless result of a cased check keeps the status it was given, which is how a tampered attempt records checks it never executed. The `verification/run` event then carries `parity: { weightPassed, weightTotal }` summed over the results that carry cases, and omits it when none does.

`parity` records how much of the measured behaviour the candidate reached and certifies nothing: the certificate rule is unchanged, so a run holding one failing case certifies nothing however much weight passed. Strict replay enforces both halves — a cased result's status must follow its cases, and a run's parity must sum its results' case weights.

`issueDirective()` accepts `clusters: [{ checkId, channels, count, weight }]` beside the root cause and detail, and refuses a cluster naming a check that is unknown or carries no cases, or whose count or weight exceeds that check's reference. The [environment runner](../../improvement/environment-runner/README.md#the-clustered-directive) builds them from the failed cases of one run.

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
