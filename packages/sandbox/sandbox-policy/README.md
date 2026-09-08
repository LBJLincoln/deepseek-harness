# dsh-sandbox-policy — the sandbox policy home (`ctx.sandboxPolicy`)

English | [中文](README.zh.md)

The single owner of sandbox-policy resolution: the deployment's default [`SandboxMode`](../sandbox/README.md) and fallback root, each session's durable mode override and immutable workspace root, and the directories the read barrier denies that session beside the workspace it grants. Every enforcing capability receives one resolved policy per call; before each request, the model receives the current policy without a separate capability inventory.

## Why a shared home

Filesystem tools, one-shot bash commands, and terminal sessions may enforce the same mode vocabulary in different combinations. If each resolved its own `mode` + `workspaceRoot`, they could drift into a split world, exactly what [the sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) warns against. Each enforcing backend consumes the complete owner-resolved policy, while the current context describes only what that policy means for any available operation the DSH file sandbox enforces. The [cross-family fs sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-14-cross-family-fs-sandbox.md) records the shared-policy decision.

## Config

- `mode` — the deployment default `SandboxMode` (`read-only` / `workspace-write` / `danger-full-access`), validated at load. Default `read-only` (fail-safe).
- `workspaceRoot` — the fallback directory `workspace-write` may write under for agentless calls or sessions without a cwd. Default `process.cwd()`, resolved to its absolute filesystem identity either way. A normal agent call uses its session header's immutable `cwd` instead.

## API

- `ctx.sandboxPolicy.resolve({ session?, mode? })` — resolves one complete per-call policy. An explicit approved mode outranks the session's last `sandbox/mode` event, which outranks `defaultMode`; the session's immutable `cwd` is canonicalized with filesystem semantics before becoming `workspaceRoot`, otherwise the configured fallback applies. Canonicalization precedes lexical normalization so `symlink/..` agrees with process working-directory resolution. `deniedReadRoots` comes from [`ctx.readBarrier`](../../verification/read-barrier/README.md) when one is composed, normalized absolute, canonical, and duplicate-free; it is empty for every other session and for every composition without a barrier. `grantedReadRoot` carries that barrier's granted workspace beside it, canonicalized the same way and absent under the same conditions: a denied root that is a strict ancestor of it leaves it readable, which each backend expresses in its own dialect.
- `ctx.sandboxPolicy.defaultMode` / `ctx.sandboxPolicy.workspaceRoot` — the deployment default and fallback root used by `resolve()`.
- `enforceReadBarrier(ctx, capability, wrap)` — what a sandbox-consuming executor calls so the barrier's scope census can report its capability as `denied-at-executor`. It waits for `readBarrier`, `sandboxPolicy`, and `sandbox` together, probes `wrap` with the barrier's own root as the denied directory, and registers the claim only when that probe succeeds; a refusing probe or an unconfining deployment mode records `unenforced` with the reason instead. A capability may not claim an enforcement its own backend never applies, so the probe runs the same wrap a real call would.
- `sandbox:policy` — a request-time cache-safe context contribution derived directly from `resolve({ session })`. It states the mode's capability-neutral file-effect contract and the canonical session workspace under `workspace-write`; tool owners retain operation-specific denial and escalation guidance.
- `effectiveSandboxMode(events)` — the pure fold of a session's `sandbox/mode` events (the last switch wins, or `undefined`), used inside `resolve()`.
- `setSandboxMode(session, mode)` — THE write path for a per-session override: appends exactly one `sandbox/mode` event. The switch IS its event; nothing mutates the mode out of band.
- `SANDBOX_MODES` — every mode, for option advertisement and runtime validation.

The optional `./invariant` companion rejects a forged durable `sandbox/mode` event whose value falls outside that closed vocabulary; Session and its companion own the surrounding storage and core execution-enclosure rules. The agent loop logs the assembled full runtime-context snapshot as a sourced `user/message`, so exact policy input remains reconstructable without an in-memory “last told” mirror.

## The per-session store

A runtime switch is one log-only `sandbox/mode` event on the session it applies to. `effective = explicit grant ?? fold(events) ?? deployment default`, so an override survives restart by replay and two sessions never see each other's state. Workspace identity does not need another event: the immutable `SessionHeader.cwd` recorded at creation is the root for every call in that session. The event stays log-only; before the next request, the owner contributes the current fact to the full runtime-context snapshot.

## Model Experience

### Current file sandbox policy

#### What the model sees

One `sandbox:policy` contribution in the current runtime-context snapshot for every agent session. It does not enumerate mounted capabilities. Tool plugins retain operation and escalation guidance, approval policy contributes separately to the same snapshot, and plan guidance remains `dsh-plan-mode`'s system section.

##### Read-only

```markdown
Current DSH file policy: read-only. Any available operation enforced by the DSH file sandbox cannot modify files in the standing mode. Do not refuse a required modification from this policy alone: try an available tool normally and follow any denial and escalation guidance it returns.
```

##### Workspace-write

```markdown
Current DSH file policy: workspace-write. Any available operation enforced by the DSH file sandbox may modify files under the session workspace: "<workspace root>". Some platform temporary areas may also be writable.
```

##### Danger-full-access

```markdown
Current DSH file policy: danger-full-access. The DSH file sandbox does not restrict file modifications by available operations.
```

#### Token effect

One concise durable context message on the first request and each effective policy change; unchanged requests add nothing. `workspace-write` carries only the canonical session workspace path; platform-specific temporary paths are summarized without adding host-dependent bytes.

#### KV Cache effect

The stable system prompt remains byte-identical across mode changes. A changed full context snapshot is appended after retained history, preserving the prior cached prefix; subsequent unchanged requests reuse that retained snapshot.

## Known Limitations and Deferred Work

- **One primary workspace root per session** — policy resolves `SessionHeader.cwd`; extra writable roots are not part of `SandboxExecutionPolicy`.
- **The denied read roots are absent from the model-visible context** — `sandbox:policy` states the file-effect mode only, because a session that must not read a directory must not be told the directory's path either. The refusal each executor returns is what the model sees.
- **The enforcement probe reflects the deployment default mode** — `enforceReadBarrier` resolves an agentless policy once at mount, so a session that later escalates to `danger-full-access` keeps a claim taken under the narrower default. The certificate rule that consumes the census is what refuses such a run.
- **File-effect modes only** — `SandboxMode` governs file effects; network and process policy are outside its vocabulary, so no knob here restricts them.
- **Temporary areas are deliberately summarized** — enforcing backends grant different platform temporary areas, which are selected after policy resolution and therefore cannot be enumerated truthfully in the current context.
