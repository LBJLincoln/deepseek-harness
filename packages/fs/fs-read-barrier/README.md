# @deepseek-ai/dsh-fs-read-barrier

English | [中文](README.zh.md)

The **fs-read-barrier plugin**: it refuses a read of a validator-owned path over the `ctx.fs` provider contract ([`@deepseek-ai/dsh-fs`](../fs/README.md)) — through the `fs/read-intent` event gate, **NOT** through a method service. It is the read counterpart of the write and edit policy [`@deepseek-ai/dsh-fs-observation-policy`](../fs-observation-policy/README.md) contributes through the same gate. It registers **no** service and declares **no** `Config`, because every deployment-varying value belongs to [`ctx.readBarrier`](../../verification/read-barrier/README.md) above it.

```ts
import type { Context } from '@deepseek-ai/cordis'
import * as FsReadBarrier from '@deepseek-ai/dsh-fs-read-barrier'

declare const ctx: Context

// Load it alongside a ctx.fs provider, the @deepseek-ai/dsh-read-barrier service it
// injects, and the read executors that dispatch fs/read-intent
// (@deepseek-ai/dsh-tool-fs, @deepseek-ai/dsh-tool-str-replace-editor).
await ctx.plugin(FsReadBarrier)
```

## How the gate participates

| Event | This plugin's listener |
|---|---|
| `fs/read-intent` | Derives the calling session from the opaque actor, resolves the barrier policy for it, and returns an `FsReadDenial` with code `FS_READ_BARRIER_DENIED` for a denied target after appending the barrier's `read-barrier/denied` record. Delegating: every other read calls `next()`. |

The slot delegates rather than deciding alone, because a barrier that owned it would stop every later read policy from deciding. An actor with no agent session — a direct plugin call — delegates too: the barrier resolves roles per session, and a call without one is unrestricted.

The containment test grants the session's own workspace before it denies an ancestor, exactly as [`ctx.readBarrier.denies`](../../verification/read-barrier/README.md) orders the two: a session denied the directory its workspace sits in keeps reading its own files, while every other path under that directory — a sibling workspace, a file beside it — is refused.

Beside the listener the plugin calls `ctx.readBarrier.enforce('fs')`, which is what makes a composition's scope census report `fs` as `denied-at-executor` instead of `unenforced`. The registration lives exactly as long as the listener, so a composition that drops this plugin drops the claim with it and can no longer certify `process` isolation.

The refusal is dispatched before any metadata round-trip. [`dsh-tool-fs`](../tool-fs/README.md) dispatches inside `resolveRegularReadTarget` before `ctx.fs.stat`, covering `read` and `read_image`, and [`dsh-tool-str-replace-editor`](../tool-str-replace-editor/README.md) dispatches on the `view` command before its own stat, so a denied path never reveals presence or absence.

## No method coupling

The plugin influences reads only through the event, so removing it leaves `dsh-tool-fs` reading through the bare provider exactly as before; loading it back layers the policy on. It does inject `readBarrier` — the policy it enforces has an owner, and a composition that mounts this plugin without the barrier stays pending rather than silently allowing every read.

## Model Experience

### Refused read

#### What the model sees

The tool result of a refused `read`, `read_image`, or `str_replace_editor` `view` is the error below, carrying code `FS_READ_BARRIER_DENIED` and `<path>` as the backend's model-facing path for the target. The tool layer appends no recovery instruction, because no retry of the same call succeeds; the read tools' own `Error: ` framing surrounds it like every other filesystem failure. Nothing else changes: the read tools stay registered and their schemas are untouched, so the refusal is a property of the operation, not of what the model can see.

##### Read denial

```markdown
read denied: "<path>" is validator-owned — it is not part of this task; continue without it
```

#### Token effect

Zero tokens on allowed reads. A denial adds the small retained error result and avoids the file content the read would have returned.

#### KV Cache effect

Append-only; the plugin adds no prompt section and no schema, so an already-reusable request prefix stays reusable and the denial extends the conversation like any other tool result.

## Known Limitations and Deferred Work

- **Only reads through `ctx.fs` are refused** — `glob`, `grep`, and the bash tools open paths outside this seam, so a composition that mounts them leaves those routes to a denied directory open.
- **Directory listings are refused whole** — `str_replace_editor` `view` of a directory is denied by the same containment test, so an implementer cannot list a denied directory to learn only that it exists.
- **The denial names the resolved path** — the message repeats the target's model-facing path, which the model supplied; it discloses no other path and no fact about whether the target exists.
