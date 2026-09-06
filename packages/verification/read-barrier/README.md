# @deepseek-ai/dsh-read-barrier

English | [中文](README.zh.md)

The read barrier (`ctx.readBarrier`): the policy home for reads an implementer session must not perform, in the role [`dsh-sandbox-policy`](../../sandbox/sandbox-policy/README.md) plays for sandbox mode and workspace root. It owns one validator-owned directory tree, mints the per-run directory a validator stocks with what its checks execute, collects the directories other plugins register, resolves one policy per session, decides containment through the filesystem seam, records what each session composed, and verifies the host attestation a `host` isolation claim needs. It denies nothing by itself: each path-opening capability enforces the decision in the operation that opens paths, which is what [`@deepseek-ai/dsh-fs-read-barrier`](../../fs/fs-read-barrier/README.md) does for `ctx.fs`. The [read-barrier Agent Note](../../../.agents/notes/proposed/architecture/2026-09-05-read-barrier.md) owns the design rationale.

## Config

```yaml
- id: read-barrier
  name: '@deepseek-ai/dsh-read-barrier'
  config:
    root: ~/.dsh/verification
    denyRoots:
      - /srv/evaluation/fixtures
    hostAttestation: /srv/attestation/run.json
    isolationClaim: process
```

| Field | Meaning |
|---|---|
| `root` (default `<harness home>/verification`) | Absolute or `~`-prefixed directory the barrier owns. Created `0700` at load; an existing directory readable beyond its owner is rejected there, and so is a path that is not absolute after `~` expansion. |
| `denyRoots` (default `[]`) | Further absolute or `~`-prefixed directories denied alongside `root`, for directories no plugin registers through `protect()`. |
| `hostAttestation` (default none) | Absolute or `~`-prefixed file an external account writes. Without a file the barrier verified, no certificate may claim `host` isolation. |
| `isolationClaim` (default `none`) | The isolation this deployment intends its certificates to claim: `none`, `process`, or `host`. It decides only what a capability the harness cannot fence in-process does for an implementer session — refuse to start under `process` or `host`, run unenforced under `none`. It grants nothing; what a certificate may actually claim is decided by [`dsh-verification`](../verification/README.md) over the census below. |

The denied set for a role is deliberately not a field, and neither are the authorities a role may hold: both are security invariants, not deployment choices. The service requires `fs`, because containment is decided through that seam rather than by parsing path strings.

## Service contract

`ctx.readBarrier.reserve(agent)` mints `<root>/runs/<sessionId>/` owner-only, records that session as the `implementer`, and returns the absolute path; reserving the same session again returns the same directory. It is synchronous so the role is in force the moment the caller returns. A validator writes there what its checks execute — the standard snapshot, one script per check, any held-out fixture — so the command line the implementer can observe in a process listing names a file whose content it cannot read. The reservation is dropped when the agent is disposed.

`ctx.readBarrier.protect(path)` denies one more directory for as long as the registration lives and returns its disposer, so a plugin that owns a directory contributes it as an effect instead of a deployment repeating it in configuration. Two registrations of one path both hold; the directory leaves the denied set when the last is disposed.

`ctx.readBarrier.enforce(capability)` records that one path-opening capability — `fs`, `shell`, `subprocess`, `terminal`, `subagent`, or `workflow` — denies the barrier's directories in the operation that opens paths, for as long as the registration lives, and returns its disposer. A composed capability without one is `unenforced` in the census, and an isolation claim above `none` is refused while any such entry stands. [`enforceReadBarrier`](../../sandbox/sandbox-policy/README.md) is how each sandbox-consuming executor makes this call, so no capability claims an enforcement its own backend never applies.

`ctx.readBarrier.enforceByRefusal(capability)` is its sibling for the executors this process cannot fence: a worker thread recovers the host process's privileges and an out-of-process agent brings its own tool stack, so neither can deny a read where it opens paths. The census follows `isolationClaim` — `denied-at-executor` under `process` or `host`, where `startRefusal` refuses every implementer start, and `unenforced` with that reason under `none`, where the capability runs and denies nothing.

`ctx.readBarrier.cannotEnforce(capability, reason)` records that a composed capability cannot enforce on this host, with the reason the capability supplies — the backend that cannot express the denial, or a deployment mode that runs commands unconfined. The certificate refused over such a census names the reason instead of only the capability. An `enforce()` registration for the same capability outranks it.

`ctx.readBarrier.startRefusal(capability, session)` answers the exact refusal a capability that cannot be confined in-process must return instead of starting, or `undefined` when it may start. Every start of such a capability asks here, so the refusal is decided in the operation that would open the paths. `startRefusalMessage(capability, claim)` owns the text.

`deniedReadRoots(policy)` answers the directories a resolved policy actually denies its holder: every denied directory for an `implementer`, none for any other role. One place decides which roles the denied set binds, so a process runner filling its own denial and the in-process `denies()` test cannot disagree.

`ctx.readBarrier.declareComposition(agent, { presetId, role })` records what a preset roster composed for one agent. A declared role outranks a reservation, because only the composition knows what was actually mounted; a preset that declares none leaves the reservation to decide. [`dsh-agent-presets`](../../preset/agent-presets/README.md) is the only caller: nothing a session itself runs may raise its own role.

`ctx.readBarrier.resolve({ session })` answers one `ReadBarrierPolicy { role, root, denied }`. A session whose preset declared a role holds that role; otherwise a session holding a reservation is the `implementer`, and every other session and every agentless call is `unrestricted`. `denied` lists the root first, then the configured extras, then each registration, without repeats.

`ctx.readBarrier.denies(policy, target)` decides containment for an already-resolved `FsTarget`. Roles `validator` and `unrestricted` are denied nothing. For an `implementer`, each denied directory is canonicalized through `ctx.fs.resolve` immediately before `ctx.fs.contains` tests it, so an ancestor symlink swapped since the target was resolved is caught; a directory the backend cannot resolve leaves containment undecidable and the read is denied.

`ctx.readBarrier.recordDenial(session, policy, capability, target)` appends the log-only `read-barrier/denied` event — `{ version, role, capability, displayPath, root }`, with `capability` naming the seam that refused — and returns the payload it appended. The barrier owns the write so every refusing seam produces the same evidence; the path is already in the log inside the model's own `tool/call` arguments, so the record adds evidence and no new disclosure.

`deniedAuthority(role, authority)` answers the first authority a role may not hold. Every authority a [`ToolDefinition`](../../core/tools/README.md) declares is denied to an `implementer` and none to any other role, so an authority merged into `ToolAuthorityMap` later is denied by this same rule rather than by a list that would go stale. `authorityDenialMessage(tool, authority)` owns the text the guard returns.

### The composition census

Before a session's first `request/header`, the barrier appends one log-only `read-barrier/scope` carrying `{ version, role, presetId?, root, denied, census, enforcement }`. `census` is one `{ name, authority }` entry per tool the session's registry view resolves, sorted by tool name because registry order follows concurrent Loader mounts and would otherwise make two runs of one composition record different censuses; it makes the composition's authority durable rather than composition-time-only. `enforcement` is one entry per path-opening capability, valued `denied-at-executor`, `unenforced`, or `not-composed`, in a fixed capability order; an `unenforced` entry carries the `reason` its capability recorded, when it recorded one. When a `hostAttestation` file is configured and verifies — a regular file owned by another operating-system account and unwritable by this one — the barrier appends one log-only `read-barrier/attestation` beside it, carrying `{ version, path, owner, sha256 }`. An absent or unverifiable file records nothing and logs a warning; the claim it would have supported is refused instead of the run failing.

The barrier also registers one `ctx.tools.guard()` on each agent's own context at `agent/created`, denying any execution whose definition carries an authority that session's role forbids. Guards run after every `tools/pre-execute` listener and are monotonic, so no later listener can turn the denial back into permission. The `mountPreset` audit covers the preset's composition; the guard covers a tool registered into the agent's own layer afterwards.

The separately published `./invariant` companion rejects a refusal recorded for any role but `implementer`, one carrying an unknown payload version or capability, and one naming a different barrier root than the session's earlier records. It rejects a census of unknown version, one for an unknown role, one recording enforcement for a capability that opens no path or a decision outside the vocabulary, and a second census in one session; and an attestation of unknown version or with no file path.

## Model Experience

### Refused reads

#### What the model sees

Nothing this package renders. Its decision reaches the model only as the refusal the enforcing capability returns from the operation the model called: for `ctx.fs` reads that is [`dsh-fs-read-barrier`](../../fs/fs-read-barrier/README.md), which owns the exact message. No prompt section, tool schema, or tool description mentions the barrier, and a session that never reads a denied path cannot tell it is composed.

#### Token effect

Zero direct tokens. A refused read replaces the tool result the model would have received with the enforcing capability's short error, so a denial spends fewer tokens than the read it refused.

#### KV Cache effect

Append-only, and prefix-stable: the barrier adds nothing to the system prompt or to tool schemas, and its own events are log-only, so an existing reusable request prefix survives every refusal.

### Refused starts

#### What the model sees

A model that delegates to an out-of-process subagent provider, or starts a worker-thread workflow, in an implementer session whose deployment claims `process` or `host` gets the text below through that seam's own typed error. Nothing announces the refusal in advance: the tool stays listed, because withdrawing it would tell the session what it is being kept away from.

##### Start refusal

```markdown
"<capability>" opens paths this process cannot confine and does not start in an implementer session under the "<claim>" isolation claim
```

#### Token effect

One short error in place of the child's result. A model that retries spends it again; the capability never starts, so no child tokens are spent at all.

#### KV Cache effect

Prefix-stable. No schema and no prompt section changes, so the refusal is an ordinary appended tool result.

### Refused tool calls

#### What the model sees

An implementer session calling a tool whose definition declares an authority gets the tool registry's ordinary `Error: ` framing around the text below, and no recovery instruction, because no retry of the same call succeeds. `authority` is never model-visible on its own: `schemas()` whitelists name, description, and parameters, so the tool stays listed and callable-looking until it is called.

##### Authority denial

```markdown
"<tool>" carries the "<authority>" authority and is not callable in an implementer session
```

#### Token effect

One short error in place of the tool result, once per attempt. A model that retries the same tool spends that error again; nothing shortens the schema it keeps seeing.

#### KV Cache effect

Prefix-stable. The guard changes no schema and no prompt section, so the denial is an ordinary appended tool result.

## Known Limitations and Deferred Work

- **A process runner denies whole directories, not reads** — `shell`, `subprocess`, and `terminal` deny through the sandbox backend's own mount, ruleset, or profile, so a confined process sees the denied directory as empty rather than receiving this package's message. Only `ctx.fs` reads carry the barrier's own refusal text.
- **`isolationClaim` is a deployment statement, not a grant** — raising it makes the out-of-process executors refuse and nothing else. A deployment that raises it without composing the enforcement still has its certificate refused, by the census rather than by this field.
- **The census is a snapshot** — it lists the tools the session started with. A tool registered afterwards is covered by the runtime guard and by the certificate rule that cross-checks each `request/header` against the census, not by the census itself.
- **The attestation proves an owner, not a run** — the barrier verifies that another operating-system account owns an unwritable file and records its digest; it does not yet compare that digest against the environment content hashes the `environment/run` stamp carries.
- **Trusted code in the implementer's own process** — a plugin with direct `Session` or `ctx.fs` access appends counterfeit refusals and reads any path. The barrier confines the composed executors, not the process.
- **Owner-only modes stop other accounts, not the model** — the `0700` root is protection against another operating-system user; the harness process runs as the same user as its tools, so the barrier, not the mode, is what denies the model.
