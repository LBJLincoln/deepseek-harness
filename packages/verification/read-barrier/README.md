# @deepseek-ai/dsh-read-barrier

English | [中文](README.zh.md)

The read barrier (`ctx.readBarrier`): the policy home for reads an implementer session must not perform, in the role [`dsh-sandbox-policy`](../../sandbox/sandbox-policy/README.md) plays for sandbox mode and workspace root. It owns one validator-owned directory tree, mints the per-run directory a validator stocks with what its checks execute, collects the directories other plugins register, resolves one policy per session, and decides containment through the filesystem seam. It denies nothing by itself: each path-opening capability enforces the decision in the operation that opens paths, which is what [`@deepseek-ai/dsh-fs-read-barrier`](../../fs/fs-read-barrier/README.md) does for `ctx.fs`. The [read-barrier Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-read-barrier.md) owns the design rationale.

## Config

```yaml
- id: read-barrier
  name: '@deepseek-ai/dsh-read-barrier'
  config:
    root: ~/.dsh/verification
    denyRoots:
      - /srv/evaluation/fixtures
```

| Field | Meaning |
|---|---|
| `root` (default `<harness home>/verification`) | Absolute or `~`-prefixed directory the barrier owns. Created `0700` at load; an existing directory readable beyond its owner is rejected there, and so is a path that is not absolute after `~` expansion. |
| `denyRoots` (default `[]`) | Further absolute or `~`-prefixed directories denied alongside `root`, for directories no plugin registers through `protect()`. |

The denied set for a role is deliberately not a field: which directories an `implementer` may read is a security invariant, not a deployment choice. The service requires `fs`, because containment is decided through that seam rather than by parsing path strings.

## Service contract

`ctx.readBarrier.reserve(agent)` mints `<root>/runs/<sessionId>/` owner-only, records that session as the `implementer`, and returns the absolute path; reserving the same session again returns the same directory. It is synchronous so the role is in force the moment the caller returns. A validator writes there what its checks execute — the standard snapshot, one script per check, any held-out fixture — so the command line the implementer can observe in a process listing names a file whose content it cannot read. The reservation is dropped when the agent is disposed.

`ctx.readBarrier.protect(path)` denies one more directory for as long as the registration lives and returns its disposer, so a plugin that owns a directory contributes it as an effect instead of a deployment repeating it in configuration. Two registrations of one path both hold; the directory leaves the denied set when the last is disposed.

`ctx.readBarrier.resolve({ session })` answers one `ReadBarrierPolicy { role, root, denied }`. A session holding a reservation is the `implementer`; every other session and every agentless call is `unrestricted`. `denied` lists the root first, then the configured extras, then each registration, without repeats.

`ctx.readBarrier.denies(policy, target)` decides containment for an already-resolved `FsTarget`. Roles `validator` and `unrestricted` are denied nothing. For an `implementer`, each denied directory is canonicalized through `ctx.fs.resolve` immediately before `ctx.fs.contains` tests it, so an ancestor symlink swapped since the target was resolved is caught; a directory the backend cannot resolve leaves containment undecidable and the read is denied.

`ctx.readBarrier.recordDenial(session, policy, capability, target)` appends the log-only `read-barrier/denied` event — `{ version, role, capability, displayPath, root }`, with `capability` naming the seam that refused — and returns the payload it appended. The barrier owns the write so every refusing seam produces the same evidence; the path is already in the log inside the model's own `tool/call` arguments, so the record adds evidence and no new disclosure.

The separately published `./invariant` companion rejects a refusal recorded for any role but `implementer`, one carrying an unknown payload version or capability, and one naming a different barrier root than the session's earlier refusals.

## Model Experience

### Refused reads

#### What the model sees

Nothing this package renders. Its decision reaches the model only as the refusal the enforcing capability returns from the operation the model called: for `ctx.fs` reads that is [`dsh-fs-read-barrier`](../../fs/fs-read-barrier/README.md), which owns the exact message. No prompt section, tool schema, or tool description mentions the barrier, and a session that never reads a denied path cannot tell it is composed.

#### Token effect

Zero direct tokens. A refused read replaces the tool result the model would have received with the enforcing capability's short error, so a denial spends fewer tokens than the read it refused.

#### KV Cache effect

Append-only, and prefix-stable: the barrier adds nothing to the system prompt or to tool schemas, and its own event is log-only, so an existing reusable request prefix survives every refusal.

## Known Limitations and Deferred Work

- **The role comes from a reservation only** — a session is the `implementer` because a validator reserved its run directory; a preset cannot declare `implementer` or `validator` for itself yet, so `validator` and `unrestricted` are indistinguishable at the deny decision (both are denied nothing).
- **Nothing enforces beyond `ctx.fs`** — `shell`, `subprocess`, `terminal`, and out-of-process subagent and workflow executors open paths this service does not fence, so a composed bash tool still reads the barrier root. The `ReadBarrierCapability` vocabulary names those seams; only `fs` decides today.
- **No isolation claim reads this policy** — `dsh-verification` still records the isolation level its caller passes, and no certificate precondition consults the barrier or the refusals it recorded.
- **Trusted code in the implementer's own process** — a plugin with direct `Session` or `ctx.fs` access appends counterfeit refusals and reads any path. The barrier confines the composed executors, not the process.
- **Owner-only modes stop other accounts, not the model** — the `0700` root is protection against another operating-system user; the harness process runs as the same user as its tools, so the barrier, not the mode, is what denies the model.
