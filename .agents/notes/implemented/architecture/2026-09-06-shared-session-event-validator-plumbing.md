# Agent Note: Shared session-event validator plumbing

Status: implemented

English | [中文](2026-09-06-shared-session-event-validator-plumbing.zh.md)

## Problem

Several package-owned invariant companions check a durable session-event relation against the events committed immediately before each candidate. Each implements the same two-phase shape by hand: replay every already-loaded session's committed events in order, then subscribe to Cordis's `internal/dispatch` and re-check every future `session/event` dispatch against the dispatching session's currently committed events — the events immediately preceding the candidate, since Session dispatches before publishing it. `dsh-budget-policy`, `dsh-goal-round-driver`, and `dsh-scorekeeper` implemented this identically enough that `pnpm run duplication` flagged their seed loops as clones of each other. `dsh-shifts`, `dsh-experiments`, and `dsh-tool-todo` carried the same plumbing under a `jscpd:ignore` marker that existed only to hide the same duplication from the gate.

## Decision

`@deepseek-ai/dsh-invariants` exports `sessionEventValidator(validate, sessions)`, an `InvariantInstaller` factory:

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

declare function sessionEventValidator<TEvent>(
  validate: (prior: readonly TEvent[], event: TEvent, fail: InvariantFailure) => void,
  sessions: (ctx: Context) => Iterable<{ readonly events: readonly TEvent[] }>,
): InvariantInstaller
```

`validate` is the package-owned relation check; `sessions` is the calling package's own session accessor, always `ctx => ctx.sessions.list()` in every current caller. The returned installer runs `validate` for every event already committed to each session `sessions` returns, threading the events preceding each one as `prior`, then subscribes to `internal/dispatch` and runs `validate` again for every live `session/event` dispatch, passing the dispatching session's committed events as `prior`. It injects the `sessions` service — the same dependency every hand-rolled version already declared.

The helper is generic over the caller's session and event types rather than importing `Session`/`SessionEvent` from `@deepseek-ai/dsh-session`: that package's own `./invariant` companion already depends on `dsh-invariants`, so an import running the other way would form a circular package reference. `dsh-budget-policy`, `dsh-goal-round-driver`, `dsh-scorekeeper`, `dsh-shifts`, `dsh-experiments`, and `dsh-tool-todo` build their installer this way, deleting their private seed-loop and dispatch-listener copies and every `jscpd:ignore` marker that existed only to hide this duplication.

`scripts/package-invariants.ts`'s static check — which requires a non-empty installer to accept and visibly use its bound failure reporter — recognizes a `sessionEventValidator(validate, sessions)` call the same way it already recognized a direct `(ctx, fail) => …` installer and an `Object.assign(fn, { inject })` wrapper: it resolves `validate` (an inline function or a local named-function reference in the same file) and checks that function's own last parameter, since `sessionEventValidator` never hides or drops it.

Companions whose per-event check needs more than the committed session-event log keep their own installers: `dsh-permission-presets` also needs an injected service beyond `sessions` to resolve a preset reference, and `dsh-commands` keys mutable per-session state by `Session` object identity rather than recomputing from a `prior` events array (`dsh-read-barrier` needs the `Session` object the same way). `dsh-schedule` refolds the whole session stream per candidate rather than checking one event against its prefix. `dsh-llm-retry` and `dsh-time-context` add a `session/created` listener and branch across more than one per-event-type check function. A larger family — `dsh-goal`, `dsh-verification`, `dsh-hook-protocol`, `dsh-user-approval`, `dsh-compaction`, `dsh-session`, `dsh-tools`, and `dsh-tool-workflow` — carries per-session incremental fold state across three listeners (seed, `session/created`, and a staged `internal/dispatch`/`session/event` commit pair), a different plumbing shape this helper does not cover. `dsh-sandbox-policy` is a verbatim instance of the shape this helper extracts and remains a candidate for the same migration.

## Alternatives considered

- **A base class or mixin the companions extend.** Rejected: `InvariantInstaller` is a plain function value, and Cordis plugin composition already expects `apply`/`inject` exports rather than inheritance; a factory function matches the existing shape without a new composition mechanism.
- **Import `Session`/`SessionEvent` from `dsh-session` for a precisely-typed helper.** Rejected: `dsh-session`'s own invariant companion depends on `dsh-invariants`, so the reverse import would form a circular TypeScript project reference and a circular package dependency. Genericity over the caller-supplied session/event shape avoids both at the cost of one accessor parameter per caller.
- **Force every companion sharing the seed-and-dispatch outer loop onto this signature regardless of what its check needs.** Rejected for `dsh-permission-presets` and `dsh-commands`: their checks need an extra injected service or session-identity-keyed mutable state the `(prior, event, fail)` signature does not carry, and reshaping them to fit would change their own logic, not just extract shared wiring.
- **Extend the helper to also cover the stage-then-commit companions.** Rejected: that shape carries per-session incremental fold state across two additional listeners the seed-and-dispatch shape does not need; unifying them would either force the simpler companions to carry unused state or complicate the helper for callers that do not need it.

## Consequences

- `pnpm run duplication` no longer flags the three originally-cloned seed loops, and six companions no longer carry a `jscpd:ignore` marker whose only purpose was hiding this duplication.
- A new companion with this exact shape adds one `validate` function and one `sessionEventValidator(validate, ctx => ctx.sessions.list())` call instead of re-deriving the seed-and-dispatch wiring; `scripts/package-invariants.ts` accepts the pattern without a companion-specific carve-out.
- `dsh-invariants` still imports no product package: the helper's `sessions` and event types are caller-supplied generics, and the service still owns none of the six companions' actual relation checks.
- `dsh-permission-presets`, `dsh-commands`, `dsh-read-barrier`, `dsh-schedule`, `dsh-llm-retry`, `dsh-time-context`, `dsh-sandbox-policy`, and the stage-then-commit family keep their own hand-rolled installers; their outer-loop resemblance to the extracted shape remains, but jscpd's clone threshold does not flag it, and — outside `dsh-sandbox-policy` — forcing them onto the new signature would change what each depends on or computes.
