# @deepseek-ai/dsh-program

English | [中文](README.zh.md)

Programs: the durable ledger of one client deliverable decomposed into many goals. A program is a frozen spec, one program session holding `program/*` events, one department session and git worktree per goal, and one integration session whose certificate over the merged head is what a release claims. Every ledger event is appended after the fact it records is durable, so a restarted process reconciles each goal from its department's own log and worktree, never runs a department twice, and never releases without a certificate. The [program-ledger Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-program-ledger.md) owns the design rationale.

## Config

```yaml
- id: program
  name: '@deepseek-ai/dsh-program'
  config:
    workspaceRoot: /var/lib/dsh/delivery
    requireSignoff: true
    maxConcurrentGoals: 3
    maxGoalRounds: 8
    branchPrefix: program
    evidenceMaxChars: 2000
```

| Field | Meaning |
|---|---|
| `workspaceRoot` (required) | The git repository the program delivers into. Every worktree is minted under it at `<workspaceRoot>/<programId>/<key>`, so the deployment points it at a checkout whose `baseRevision` the program's branches start from. It must be an absolute path the composed shell can carry unquoted, which the plugin checks at load. |
| `requireSignoff` (required) | Whether the program session must carry a `signoff/recorded` before departments start and before the program releases. A client district sets it; both refusals carry `PROGRAM_SIGNOFF_REQUIRED`. |
| `maxConcurrentGoals` (required) | Departments of one program that run at the same time. Dependencies bound this further: a goal starts only once every goal it depends on has certified. |
| `maxGoalRounds` (required) | The round cap every department and integration goal is created with, and the number of validation attempts this service drives before recording a department `failed`. |
| `branchPrefix` (required) | Branch namespace of every worktree: `<branchPrefix>/<programId>/<key>`. Lower-kebab-case git ref components. |
| `evidenceMaxChars` (required) | Bound of each recorded check evidence and each directive detail. Keep it at or below the verification domain's `maxTextChars`, which refuses longer text. |

The service requires `agents`, `agentDefaultModel`, `agentPresets`, `completionStandards`, `goals`, `sessions`, `sessionPersistence`, and `shell`; it reserves the read-barrier run directory when `readBarrier` is composed. `verify-village-composition` counts a composition of this package as a district composition, so it must also carry a capped budget policy, a session persistence backend, and the checkpoint policy.

## Service contract

`ctx.programs.start(spec)` validates and freezes the spec, resolves its presets, and drives the program the spec identifies: a program whose session does not exist yet is opened, one whose session exists is reconciled instead of forked, and one whose ledger already carries a closing record is reported unchanged. `ctx.programs.resume()` reconciles every program in the persistence root whose ledger has no closing record and carries it on; the plugin runs it once over the settled Loader tree, and an operator or driver may call it again. Both entry points run through one queue, so no program is ever driven by two passes at once.

`programSpecDigest(spec)` is the SHA-256 hex over the canonical spec: the objective, the base revision, the token ceiling, the goals sorted by key with each goal's dependencies sorted, and the integration's checks and gates in authored order. `signoff` is excluded — it names the artefact the program's signatures attest rather than what the program runs, so the same goals signed over two artefacts are one program. `program-<digest>` is the program id, the program session's id, and the prefix of every department session id (`<programId>-<key>`), which is what makes "one session per key" a property of the identity rather than of a lookup.

### The two signatures

Under `requireSignoff: true`, opening a program reads `signoff/recorded { transition: 'spec-freeze' }` from the program session and releasing reads `signoff/recorded { transition: 'release' }` before `program/end { outcome: released }`; each must attest the digest `spec.signoff.artefactSha256` names, and this service never writes one. The caller records them through `ctx.signoffs` ([`@deepseek-ai/dsh-signoff`](../../governance/signoff/README.md)) on the session `programIdFor(programSpecDigest(resolveProgramSpec(spec)))` addresses — derivable before the program exists, because the program id is the spec digest. `start` continues that log rather than replacing it, so the signatures stay in the same session as the ledger. A program whose release signature is missing refuses at the closing edge and stays open: the next pass reconciles it from its departments and releases once the signature is recorded.

`resolveProgramSpec(spec)` refuses a spec before anything runs: a key that is not lower-kebab-case or declared twice, a dependency on itself, on an unknown key, or stated twice, a dependency cycle, a budget field that is not a finite non-negative number, a goal with no check, a repeated check id, an integration that declares neither a check nor a gate, and an integration check claiming a `gate-<n>` id the gates own.

## The ledger

The service creates one session per program and appends to it, flushing at every step so a process that dies leaves a truthful record.

| Event | Written when | Payload |
|---|---|---|
| `program/start` | Before any department exists | `programId`, `specSha256`, the frozen `spec`, `baseRevision`, and `signoff` — the attested artefact digest — when the spec named one |
| `program/goal` | Once per status change, after the fact it records is durable | `programId`, `key`, `status`, and the `sessionId`, `workspace`, `revision`, or `reason` that status carries |
| `program/integration` | When the merged worktree exists, then when it certifies or fails | `programId`, `status` (`running`, `certified`, `failed`), `mergedRevision`, `sessionId`, `reason` |
| `program/resume` | When a later process picks the program up | `programId` and the reconciled count per status over every goal of the spec |
| `program/end` | Once the program is over | `programId`, `outcome` (`released`, `failed`, `abandoned`), and `mergedRevision` for a released one |
| `program/member` | At creation, in the department or integration session rather than the ledger | `programId` and the `key` that session works |

A goal's status is `pending` before it has a department, `running` while one works, `blocked` while it waits for an operator's resume through the goal domain, `certified` once its own log carries a certificate, `merged` once a certified integration covers its branch, `failed` when it ended without a certificate, and `abandoned` when the program ended before it started. The [persistence catalog](../../../docs/persistence-catalog.md) carries each payload's declaration.

## Departments

A goal starts as a department once every goal it depends on has certified. The service adds a git worktree on `<branchPrefix>/<programId>/<key>` from the base revision, creates the department session through `ctx.agents.create` with `meta.cwd` at that worktree and the goal's preset mounted, reserves the read-barrier run directory when a barrier is composed, stamps the session with `program/member`, appends `budget/caps` with the goal's budget, creates the goal with the configured round cap, and authors the goal's standard from its `checks` — then records the department `running`.

The service is the department's validator. It delivers the goal's objective as one user turn, runs the standard's checks through the shell executor rooted at the worktree, and records the run; a passing run certifies, completes the goal, and records `certified` with the branch head that certificate cites. A failing run issues a directive and delivers one more turn, up to `maxGoalRounds` attempts; a department that never certifies is recorded `failed`, and one whose goal reached the blocked phase — a breached budget, for instance — is recorded `blocked` with the blocking code and left for an operator. The service never writes into a department's worktree: whatever the branch head carries is what the department committed.

## Integration and release

Once every goal is certified, the service adds the integration worktree at `<workspaceRoot>/<programId>/@integration` — a key no lower-kebab-case goal key can claim — from the base revision, records `program/integration { running }`, and merges each department branch in dependency order with `git merge --no-ff`. It then creates the integration session over that worktree with a standard authored from `integration.checks` followed by one `gate-<n>` check per entry of `integration.gates`, so the integration certificate covers the gates as well as the checks. The checks run before any model turn, so a clean merge that passes needs none; a merged head that does not pass is what the integration goal is for. The certificate records `program/integration { certified, mergedRevision }`, every goal moves to `merged`, and `program/end { released, mergedRevision }` follows. A merge that fails and a merged head that never passes both record `program/integration { failed, reason }` and end the program `failed`.

## Resume

`resume()` lists persisted sessions, loads every program session with a `program/start` and no `program/end`, and reconciles each goal from its department's own log and worktree rather than from the ledger: a department session that does not exist is `pending`, one whose worktree is gone is `failed` because the branch is the evidence its certificate cites, one whose log carries a certificate is `certified` with the branch head read from the worktree, one whose goal is blocked is `blocked`, and anything else is `running`. Every status the reconciliation discovered is recorded, together with a declaration for any goal the ledger never recorded at all, before `program/resume` states the counts. Departments that are still running are resumed in place through `ctx.agents.resume` and the goal domain's own resume; pending goals whose dependencies have certified are started. Because a department's session id is derived from the program id and the key, no key ever gets a second session.

A program's optional `spec.tokenCeiling` is folded from the usage of every session carrying its `program/member` stamp, at each department start. A program that has spent its ceiling starts no further department, records the goals that never started `abandoned`, and ends `abandoned`.

## Git operations

Every git command runs through the composed shell under whatever policy that executor applies, in `workspaceRoot` for worktree creation and in the worktree itself for merges and revision reads. The program creates worktrees and branches under its own prefix, merges department branches into its own integration worktree, and reads `HEAD`. It never commits, never writes a file into any worktree, and never touches a branch outside `<branchPrefix>/<programId>/`. Paths and revisions are checked against a no-quoting-needed character set before they reach a command line, because shell quoting is dialect-specific and this service does not know the composed shell's dialect.

## Model Experience

None, as the ledger records what departments delivered and writes no model-visible input of its own; the goal objective, the standard, and the composed preset own every model-facing effect of a department session, and no `program/*` event ever enters a model request.

#### KV Cache effect

Independent per department: each department and the integration is its own session with its own request history, and this package neither extends nor rewrites any of them. The one turn it delivers is an ordinary user message appended at the end, so a department's own prefix stays reusable across its attempts.

## Known Limitations and Deferred Work

- **The scorekeeper does not fold programs** — the `program/member` stamp is written for it, but no facts group reads it yet, so a program's spend and certification rates are read by hand from the ledger and the member sessions.
- **A signature is recorded, not authenticated** — `requireSignoff` gates on a `signoff/recorded` whose principal the deployment's identity provider supplied; nothing here or in `@deepseek-ai/dsh-signoff` verifies that the id names the person who signed.
- **The release signature is read at the closing edge only** — a program whose spec freeze is signed but whose release is not runs every department and its integration before refusing, so the refused pass costs the whole program's work; nothing asks for the release signature earlier.
- **One program at a time per process** — every pass runs through one queue, so two programs started concurrently are driven one after the other. Concurrency inside a program is what `maxConcurrentGoals` bounds.
- **A blocked department needs an operator** — the ledger records the blocking code and stops; nothing re-arms a blocked goal, so a program with one ends `failed` until a person resumes that goal through the goal domain and starts the program again.
- **Departments claim their isolation without staging their checks** — the run directory is reserved so the barrier records the session as an implementer, but check scripts are not staged there, so a goal declaring `isolation` above `none` is refused by the verification domain unless the session's own census proves the claim.
- **A resumed department keeps its admitted rounds** — the round cap is a property of the goal, so a program that restarts often exhausts its departments' caps sooner; the ledger makes that visible as `failed`.
