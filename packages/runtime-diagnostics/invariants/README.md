# dsh-invariants

English | [中文](README.zh.md)

Configurable registry service for package-owned runtime invariant checks. The root plugin registers `ctx.invariants`; it contains no product checks or product-package imports. Every workspace package publishes a `./invariant` companion that registers its exact npm package name.

## Service: `InvariantRegistry` (`ctx.invariants`)

```ts
interface Config {
  enabled?: boolean
  package_allowlist?: string[]
  package_blocklist?: string[]
}
```

Defaults are `enabled: true`, `package_allowlist: []`, and `package_blocklist: []`. A package is selected only when the service is enabled, the allowlist is empty or at least one allowlist pattern matches its full npm name, and no blocklist pattern matches. Blocklist matches therefore override allowlist matches.

Each entry is a case-sensitive JavaScript regular-expression source compiled with `new RegExp(pattern)`. Matching is unanchored unless the source supplies `^` and `$`; `/pattern/flags` syntax is not parsed. Blank, whitespace-padded, invalid, or duplicate entries within one list fail service startup. A valid pattern may match no currently loaded package so later loading and HMR remain deterministic.

`ctx.invariants.register(packageName, installer)` reserves one active registration for the full npm package name, including when filters keep its installer inactive, and returns its disposer. An enabled contribution runs in a dedicated child Cordis fiber. The installer can declare its required services through `installer.inject` and receives `fail(message)`, which throws an `InvariantError` bound to the registering package. Synchronous or asynchronous installer completion is joined before registration succeeds; failure disposes the child and releases ownership atomically.

The service owns every registration fiber, while the returned disposer also belongs to the companion fiber. Unloading either side removes listeners, trace state, and the reservation. A companion can therefore reload and register the same package name without retaining its previous state. Session-backed companions rebuild their baseline from durable events; live-only companions observe operations that begin after reload.

`InvariantError` extends `Error`, carries stable `code: 'INVARIANT'`, and exposes the owning `packageName` without adding a product dependency to the service.

Session itself owns immutable, surface-valid log storage in every composition: it takes one lossless JSON snapshot of each candidate, validates complete cited source-event coverage and positional replacement, restricts `tool/result` replacement to one current result's `content`, deep-freezes the accepted record, and exposes the log through immutable array snapshots. The `dsh-session` invariant companion checks the remaining cross-record rules that Session does not own.

## Helper: `sessionEventValidator`

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

declare function sessionEventValidator<TEvent>(
  validate: (prior: readonly TEvent[], event: TEvent, fail: InvariantFailure) => void,
  sessions: (ctx: Context) => Iterable<{ readonly events: readonly TEvent[] }>,
): InvariantInstaller
```

Builds the installer for a companion whose check is "validate every event already committed to each tracked session, then keep validating every future one at the exact point Session dispatches it, before deciding whether to publish it." `validate` is the package-owned relation check, called with the events that precede the candidate in the same session (oldest first) as `prior`, the candidate itself, and the bound failure reporter. `sessions` reads every currently tracked session from the calling package's own session service; every current caller passes `ctx => ctx.sessions.list()`.

The returned installer first calls `validate` for every event already committed to each session `sessions` returns, threading the events preceding each one as `prior`, then subscribes to `internal/dispatch` and calls `validate` again for every future `session/event` dispatch, passing the dispatching session's currently committed events as `prior`. It injects the `sessions` service. The helper is generic over the caller's own session and event types rather than importing `Session`/`SessionEvent` from `@deepseek-ai/dsh-session`, which itself depends on this package for its own `./invariant` companion — an import running the other way would form a circular package reference.

`dsh-budget-policy`, `dsh-goal-round-driver`, `dsh-scorekeeper`, `dsh-shifts`, `dsh-experiments`, and `dsh-tool-todo` build their companion this way. `pnpm run verify-package-invariants` recognizes a `sessionEventValidator(validate, sessions)` call the same way it recognizes a direct `(ctx, fail) => …` installer: it resolves `validate` — inline or a local named-function reference — and checks that function's own last parameter for the same accept-and-use-the-reporter rule.

## Package companions

Publication and registration are exhaustive; runtime assertions are deliberately not synthetic. A companion installs a check only when its package owns an observable event relationship or relevant mutable-data relationship. Confirming a required method, plugin name, injection, effect, or fixed pure-function result is a type, load, or unit-test concern rather than a runtime invariant.

When no plausible runtime relationship exists, the companion uses an empty installer with a package-specific leading `No runtime invariant:` comment explaining why. This is common for pure utilities, thin implementations whose behavior is already observed through their interface package, composition-only packages, binaries, persistence adapters whose contracts require crash and round-trip tests, and test-support packages. The explanation must be revisited when the owner gains mutable state or an event protocol.

The current executable companions protect these relationships:

| Companion | Checks |
|---|---|
| `dsh-session`, `dsh-agent`, `dsh-scope`, `dsh-agent-loop` | Session enclosure and call/result trace, agent-status transitions, inbox FIFO conservation, scoped subjects, and model-request reconstruction. |
| `dsh-llm`, `dsh-llm-retry`, `dsh-tools`, `dsh-system-prompt` | Stream grammar, durable retry position and bounds, tool-pipeline stages and frozen results, and authoritative prompt-assembly data. |
| `dsh-compaction`, `dsh-hook-protocol`, `dsh-sandbox-policy` | Durable compaction and hook pairing, compaction metadata, and sandbox-mode vocabulary. |
| `dsh-fs`, `dsh-subagent`, `dsh-workflow` | Filesystem event identity, provider/child pairing, and workflow/agent lifecycle identity. |
| `dsh-goal`, `dsh-goal-round-driver` | Durable goal source/content agreement, revision and lifecycle transitions, timestamps, sequential admitted rounds, and reconstructed continuation prompts. |
| `dsh-permission-presets`, `dsh-user-approval` | Active-preset references and approval asked/decided audit pairing. |
| `dsh-jobs`, `dsh-tool-todo` | Task snapshot lifecycle/ownership fields and durable whole-list todo structure. |
| `dsh-time-context` | Durable clock readings agree with the session's open turn and next pre-step position and elapsed baseline; rendered time parses and does not postdate its event. |

The root entrypoint of each owner remains independent of diagnostics. Loading the service alone installs no product checks, and loading a companion without the service waits on its declared `invariants` injection.

`pnpm run verify-package-invariants` discovers all workspace packages. It rejects generated markers, unexplained empty installers, non-empty installers that omit or ignore the reporter, incorrect registration names, and incomplete export, publication, dependency, TypeScript-reference, or bundle wiring. This source rule is a minimum ownership check; focused tests prove each executable companion's semantics.

## Composition

```ts
import type { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SessionInvariant from '@deepseek-ai/dsh-session/invariant'

declare const ctx: Context

ctx.plugin(InvariantRegistry, {
  enabled: true,
  package_allowlist: ['^@deepseek-ai/dsh-'],
  package_blocklist: ['^@deepseek-ai/dsh-agent-loop$'],
})
ctx.plugin(SessionInvariant)
```

The standard agent composition mounts the service and its four core stateful companions. Custom compositions explicitly add companions for other loaded packages whose contracts they want checked; filters can disable or select registrations without changing package entrypoints.

Every ordinary Vitest topology mounts an explicitly enabled service and the current test package's companion. Focused suites cover valid and invalid observations for executable companions, while one exhaustive topology mounts all companions to prove registration and disposal wiring.

## Model Experience

None, as the service and companions observe runtime events and mutable snapshots without altering prompts, messages, schemas, streams, or tool results.

#### KV Cache effect

None; invariant checks do not assemble or send provider requests.

## Known Limitations and Deferred Work

- Request reconstruction covers requests explicitly marked by the loop before freezing; direct one-shot LLM calls remain outside that marker contract even when callers freeze them or attach a session id.
- Live-only lifecycle companions cannot reconstruct operations that began before their own reload. Standard and test compositions mount them before the corresponding operations begin.
- Regular-expression filters are fixed for the service lifetime; changing them requires ordinary Cordis plugin reload.
