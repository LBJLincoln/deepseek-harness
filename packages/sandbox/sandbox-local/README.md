# @deepseek-ai/dsh-sandbox-local

English | [中文](README.zh.md)

Local implementation of the [`dsh-sandbox`](../sandbox/) seam. It selects and caches one platform runner: Linux prefers a working `bwrap` then Landlock; macOS uses Seatbelt; Windows uses the ACL restricted-token runner. Multiple candidates are probed in order, while a sole candidate is selected directly.

The package root exports the default and named `LocalSandboxProvider` plugin and `Config`; platform profile builders stay internal.

Unsupported platforms and unusable runners fail closed with `SANDBOX_UNAVAILABLE`; execution never silently falls through unconfined. Each wrap carries structured runner-failure rules so consumers can distinguish a broken sandbox from a command failure. The [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) owns selection rationale and profile differences.

Policy is per call; the provider stores only the mechanism and cached runner verdict. Each wrap reports enforcement completeness plus backend-specific denial signatures and runner-failure rules. Landlock requires exit 125 and a `landlock-run:` fatal line after excluding only the exact partial-enforcement notice; a notice with child exit 1, 2, or 125 remains a child outcome. Bubblewrap and Seatbelt remain signature-only because neither public contract reserves a launcher-failure status. Consumers spawn the returned argv directly, so a missing or unexecutable runner is an out-of-band spawn failure while a successfully launched child exit 126 or 127 remains ordinary. `runnerCommand` skips probes and requires one or more non-empty, single-line, case-insensitive `runnerFailureSignatures` entries for the custom runner's own fatal dialect. Because its mechanism is unknown, it carries both Linux denial dialects. `probeTimeoutMs` bounds functional probes. The [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) owns selection and failure semantics.

## Denied read roots per backend

A policy's `deniedReadRoots` is expressed by the rung that confines, in that rung's own dialect. `bwrap` mounts an empty tmpfs over each root, after the read-only root bind and any workspace bind so the later mount is what the process sees. Landlock rulesets are allow-lists with no deny form and no rule removal, so each granted root is carved: the launcher receives the siblings at every level between the grant and a denied directory instead of the grant itself, which means a directory created under a carved level after the ruleset is built is not granted either. The Seatbelt profile appends one `(deny file-read* (subpath …))` form per root, last, because SBPL's last matching form wins and the denial must outrank the write allow-lists.

The Windows ACL rung cannot express a read denial at all, so a non-empty `deniedReadRoots` refuses the wrap with `SandboxReadDenialUnavailableError` naming the backend and the root: its `WRITE_RESTRICTED` token consults the restricting SIDs for write access only, and a deny ACE on the directory would apply to the validator that owns it just as much as to the confined child. An `isolation` claim that needs the denial therefore fails on Windows rather than the denial silently going unenforced.

The Seatbelt profile is allow-default with `(deny file-write*)` plus write allow-lists, so exactly the mode's promised file effects are governed: `read-only` grants the `/dev/null` literal alone; `workspace-write` adds the workspace root, `/tmp`, and the per-user darwin temp dir (`os.tmpdir()` — the platform's real temp area for mkstemp-family tools), every root canonicalized because Seatbelt matches resolved paths (`/tmp` IS `/private/tmp`). Apple marks the `sandbox-exec` CLI deprecated but ships it on every macOS; the functional probe is what fails closed if that ever changes.

The Windows rung keeps one deterministic write SID and standing ACE per workspace, but gives every live session/workspace pair a random private temp directory with a distinct SID and revocable ACE. Sessions sharing a workspace therefore share its intended write authority without inheriting one another's temp authority. A fresh provider always chooses a new temp path and SID, so crash residue cannot block or authorize a resumed session; agentless calls receive the same per-invocation isolation from the runner. A workspace equal to or containing the platform temp root fails before any ACL mutation because its inheritable workspace ACE would otherwise reach every private temp child.

[`@deepseek-ai/node-addon-landlock-run`](https://www.npmjs.com/package/@deepseek-ai/node-addon-landlock-run) supplies the platform launcher, functional probe, and CLI argument vocabulary. This provider owns only mode-to-grant mapping and runner selection. Keeping path resolution and probe parsing with the versioned binary prevents contract drift.

```yaml
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
```

Consumers: [`@deepseek-ai/dsh-bash-sandbox`](../../shell/bash-sandbox/); see [the acp-agent example](../../../examples/acp-agent/) for the runnable default composition.

## Model Experience

Indirectly, through [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md) and [`dsh-tool-bash`](../../shell/tool-bash/README.md), which render this provider's enforcement and denial facts while the [`dsh-sandbox`](../sandbox/README.md) seam owns the `SANDBOX_UNAVAILABLE` text and runner selection and profiles stay outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Windows ACL enforcement is partial** — the restricted token must retain Everyone for process initialization, so external objects granting Everyone write access remain writable; NTFS hard links also alias one file object across workspace and external paths. The provider reports `enforcement: 'partial'` rather than overstating that boundary as full.
- **Landlock may be partial** — older supported kernel ABIs confine only the access classes they expose, reported as `enforcement: 'partial'` rather than overstated as full.
- **Seatbelt depends on deprecated `sandbox-exec`** — macOS still ships it, but this provider cannot replace or probe that private policy engine if Apple removes it.
- **Runner selection is cached for the provider lifetime** — installing, removing, or repairing a runner requires reloading the plugin before selection changes.
- **The Landlock carve-out is taken at wrap time** — the launcher's grants list the directories that existed when the ruleset was built, so a directory created afterwards directly under a carved level is unreadable to that confined process. Only a policy with a non-empty `deniedReadRoots` carves at all.
- **No backend denies reads on Windows** — the ACL rung refuses such a wrap instead, so a Windows deployment can enforce file effects but cannot back an isolation claim that rests on denied reads.
- **`runnerCommand` is an operator assertion** — a configured custom runner skips functional probes and is assumed to implement the bwrap-compatible profile honestly; if it is itself a Bash script, its interpreter startup runs before that script applies confinement.
