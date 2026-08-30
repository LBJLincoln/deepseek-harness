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

`ctx.completionStandards` accepts only the exact live `Agent` instance registered under its id. `get()` returns a detached `StandardView`; mutations use a `StandardRef { id, revision }` compare-and-set fence and reject stale refs. At most one standard is current per session; `author()` creates a revision-one standard for a goal and rejects a second standard for the same goal, while a standard for a different goal supersedes the previous one. `extend()` appends checks and never rewrites existing ones; `relax()` removes exactly one check and records non-empty unsatisfiability evidence. `recordRun()` demands exactly one result per active check: a fully passing run commits a durable certificate in check order, and any failure returns the failing subset without a durable record. `issueDirective()` records the root-cause aggregation a consumer relays to the implementer. `assertCertified()` returns the certificate covering the exact current revision for one goal and otherwise throws, which makes it the admission read an orchestrator places before `ctx.goals.complete()`. When a goal service is composed, the service also registers the same admission as a deny-only `completionGuard()` on `ctx.goals`, so `GoalService.complete()` itself rejects an uncertified completion of a measured goal; unmeasured goals complete untouched.

Every mutation appends one durable session event carrying complete post-mutation state: `verification/standard` (author, extend), `verification/relaxation`, `verification/certificate`, or `verification/directive`. Strict replay validates revisions, append-only check growth, relaxation shape, certificate coverage, and timestamp continuity, and any standard mutation invalidates the prior certificate. The session log is the only durable authority; a fresh service instance rebuilds its view from it.

The separately published `./invariant` companion maintains an independent fold of each attached session. It rejects malformed verification changes before they enter the durable log, and rejects a `goal/change` completion for a goal that a current standard measures without a covering certificate.

## Extension points

Policy consumers call the service verbs and fold the four events from the session log. When a projection registry is composed, a `verification` session projection serves the same state to clients: the whole current standard with its certificate and directive count, `null` before authorship. A certificate is a replayable record of which checks passed with what evidence and under which isolation level (`none`, `process`, `host`), so evaluation and training-data pipelines can score sessions from the log alone: per-agent tallies of certificates earned, directives received, and relaxations recorded derive from the events without new instrumentation. Consumers use the `Agent` interface and session events rather than importing the agent loop.

## Model Experience

Indirectly, through the policy consumers that relay `verification/directive` text to the implementer and admit goal completion; every event this service appends is log-only and never enters model history.

#### KV Cache effect

No direct invalidation; a relaying consumer owns any request-prefix changes its messages cause.

## Known Limitations and Deferred Work

- **Admission requires the goal service** — enforcement runs inside `GoalService.complete()` through the registered completion guard when both services are composed; an assembly without `ctx.goals` keeps only the service verbs and `assertCertified()` for its own callers, and the invariant companion still rejects an uncertified completion stream wherever it is installed.
- **No read barrier** — this package owns durable state only; denying implementer reads of standard artifacts is filesystem-policy work in a separate plugin, and until it exists the standard's `run` instructions are readable by any in-process consumer of the log.
- **Directive delivery is consumer work** — directives are log-only records; without a consumer that relays them as plugin-sourced user messages, the implementer never sees them.
- **No run executor** — the validator agent executes checks with its own tools and reports results; this package records outcomes and never spawns processes.
- **Trusted in-process producers** — a plugin with direct `Session` access can append counterfeit verification data. Strict replay detects malformed or inconsistent records and fails at that record; this is integrity detection, not plugin isolation.
