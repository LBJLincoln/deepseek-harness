# @deepseek-ai/dsh-sandbox

English | [中文](README.zh.md)

Process-sandbox Service Definition. Owns the `ctx.sandbox` service contract ([`SandboxProvider`](src/index.ts)) and the confinement vocabulary the harness shares: `SandboxMode` (`read-only` / `workspace-write` / `danger-full-access`, file effects only), `SandboxEnforcement` (`full` / `partial`, per kernel ABI), `SandboxExecutionPolicy` (the complete per-call mode, workspace root, and denied read roots), `SandboxPolicy` (its confined subset), and the fail-closed `SANDBOX_UNAVAILABLE` error. As the Service Definition role of the [capability-seam split](../../../.agents/notes/implemented/architecture/2026-06-13-capability-seams.md), it depends only on cordis (+ the harness error base), never on a backend.

The contract in one line: `ctx.sandbox.confine(argv, policy)` returns the argv to spawn INSTEAD of your own — wrapped so the process (and everything it spawns) runs confined — plus the selected backend's enforcement completeness, denial dialect (`denialSignatures`), and structured runner-failure evidence (`runnerFailureRules`); when no backend is usable it throws rather than passing the argv through unconfined. The [core type catalog](../../../docs/subsystems/sandbox.md#wrapped-argv-and-classification-dialects) owns the exact classifier shape.

Policy rides the call, not the provider: two consumers may confine under different policies at the same instant (bash under `read-only` while a confined child agent keeps its state directory writable), and an approved escalated retry is just a new call with a wider policy.

**Denied read roots are the second, mode-independent half of a policy.** `deniedReadRoots` lists absolute, canonical, duplicate-free directories the confined process may not READ under, whatever its `SandboxMode` says about writes. [`dsh-sandbox-policy`](../sandbox-policy/README.md) fills it from the read barrier for the calling session and normalizes it through `normalizeDeniedReadRoots`; it is empty for every session the barrier denies nothing, which is every session in a deployment that composes no barrier. A backend that confines file effects but cannot express a non-empty entry refuses the wrap with `SandboxReadDenialUnavailableError`, which carries `SANDBOX_UNAVAILABLE` and names the backend and the root — the isolation claim that asked for the denial fails rather than the denial silently going unenforced.

**Same-world confinement only.** A backend shares the host's filesystem and kernel (`bwrap`, Landlock, Seatbelt); `workspaceRoot` names the filesystem-canonical real host directory. Workspace identity is resolved before lexical normalization, so a valid cwd containing `symlink/..` grants the directory where `chdir` actually lands rather than an unrelated lexical parent. Containers, microVMs, and remote executors are NOT backends of this seam — they replace the Service Providers for whole capability seams (`ctx.shell`, `ctx.fs`) as environment-coherent groups. The boundary and its rationale: [the sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md).

Implementations: [`@deepseek-ai/dsh-sandbox-local`](../sandbox-local/) (Linux: `bwrap`, else the per-platform Landlock launcher; macOS: `sandbox-exec`/Seatbelt). Consumers: [`@deepseek-ai/dsh-bash-sandbox`](../../shell/bash-sandbox/) (wraps `['bash', '-c', command]`).

## Model Experience

### Confinement error, indirectly

#### What the model sees

Through [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md) and [`dsh-tool-bash`](../../shell/tool-bash/README.md), failure to enforce a requested mode produces code `SANDBOX_UNAVAILABLE` and one of the exact errors below: the first when no backend is usable at all, the second when a usable backend cannot express the policy's denied read roots. An execution-time runner failure adds ` Runner failure: <detail>` to the first.

##### No usable backend

```markdown
sandbox mode "<mode>" is requested but no sandbox backend is usable on this host; refusing to run the command unconfined. Install bubblewrap or run a Landlock-enforcing kernel (Linux), ensure sandbox-exec is usable (macOS), or ensure the ACL restricted-token runner can start (Windows) — otherwise switch the consumer to danger-full-access.
```

##### No expressible read denial

```markdown
sandbox backend "<backend>" cannot deny reads under "<root>": <reason>; refusing to run the command with the read barrier unenforced.
```

#### Token effect

Conditional error text is visible for that call and retained in history until compaction.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **File effects and denied read roots are the whole policy vocabulary** — the seam expresses no network, process, syscall, device, or credential restrictions.
- **A denied read root is a directory, not a rule** — the seam has no per-file, per-extension, or conditional read denial, and no backend reports which denied path a confined process tried to open.
- **Same-world confinement only** — containers, microVMs, and remote execution require replacing capability implementations rather than adding a provider here.
- **Denial reporting is a stderr dialect** — the seam returns backend signatures instead of a typed runtime denial channel, so consumers that need classification must infer it from the child process's output.
- **Runner diagnostics are in-band** — exit status plus stderr evidence cannot prove which process wrote a matching line, so a confined child that deliberately mimics its runner can cause an availability/diagnostic false attribution. This cannot bypass confinement; an out-of-band runner-status channel is deferred.
- **One provider per context** — composing different sandbox mechanisms simultaneously requires a provider-level ladder or separate Cordis contexts; callers choose policy per call, not backend identity.
