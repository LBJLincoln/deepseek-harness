# Agent Note: The sealed cell workspace, a run directory a cell cannot read

Status: proposed

English | [中文](2026-09-08-sealed-cell-workspace.zh.md)

## Problem

A fleet lays its cells out as siblings. [`dsh-fleet`](../../../../packages/improvement/fleet/README.md) creates one `cell-<id>` directory per cell directly under the run directory, and the run directory also holds `plan.json`, the run log, and the fixture material every cell of the slot was cut from. Every cell agent runs with its workspace as its cwd and, in the bench composition that produced this repository's records, an unconfined `dsh-bash-local` executor and no read barrier. Its cwd was a convention, not a fence: `cd ..` reached the whole experiment.

The cells took the invitation. [`data/proving-ground/tools/census-escapes.mjs`](../../../../data/proving-ground/tools/census-escapes.mjs) reads a recorded run and reports, per cell, the tool calls whose path arguments name the run directory or another cell of the same run. Over the eighteen recorded runs it finds cells that left their own workspace in ten of them: 4 of 12 cells in `2026-09-07-bench-h1-harness-loop-t2`, 11 of 18 in `2026-09-07-bench-h1-harness-loop-t4`, 3 of 36 in `2026-09-07-bench-e2-harness-vs-product-t3`, 8 of 36 in `2026-09-08-bench-e1-haiku-vs-sonnet-t3`, 7 of 36 in `2026-09-08-bench-e1-sonnet-vs-opus-t3`, 6 of 32 in `2026-09-08-bench-e2-harness-vs-product-t5`, 7 of 18 in `2026-09-08-bench-e3-attempts1-t3`, 3 of 18 in `2026-09-08-bench-e3-baseline-t3`, 15 of 18 in `2026-09-08-bench-e4-knowledge-pack-t3`, and 9 of 16 in `2026-09-08-bench-h1-harness-loop-t5`. The commonest form is a cell that runs `cd <run directory> && cat plan.json run.log` and then diffs its own source against a sibling's.

Two went further than reading. In `2026-09-07-bench-h1-harness-loop-t2` the `code:csv-codec` cell `cell-cUuWY2` ran `cp cell-cUuWY2/src/csv.js cell-R8QtdK/src/csv.js`, putting its own solution into the other repetition of its own task, so the second repetition's verdict measures the first cell's work. In `2026-09-08-bench-e2-harness-vs-product-t5` the first `code:sheet-eval` cell `cell-Cr3CtN` wrote its whole solution into the second cell's workspace, `cell-XNKQXT`. Both runs are paired experiments whose statistic is a per-environment difference between two arms; a cell that writes into another cell's workspace breaks the independence the resampling assumes, and a cell that reads the plan knows which arm it is.

No cell implemented by the out-of-process product left its workspace in any record. Nothing enforced that either: those cells run a foreign agent in the workspace with its own tool stack, and the harness session that holds their certificate records no tool call at all, so a delegated cell's zero is what this process can see rather than what the delegate did.

## Proposal

The run seals the cell's workspace against the directory it sits in, for exactly as long as the run lasts.

[`EnvironmentRunner.run()`](../../../../packages/improvement/environment-runner/src/index.ts) calls `ctx.readBarrier.denyFor(agent.session, dirname(request.workspace))` after creating the cell agent and disposes the registration when the run ends, so the denial covers the attempts, the check executions, and nothing outside them. A composition without a barrier gets a no-op disposer, which is what its `isolation: none` claim already states.

`denyFor` is the per-session sibling of the barrier's existing `protect()`: it adds one directory to the denied set of ONE session, keyed per registration so two registrations of one path both hold. The runner's own session and every other cell's session keep reading the directory; only the cell that owns the workspace is denied it.

A denial that covers the parent covers the workspace too, so the policy carries the workspace beside the denied set and the two are ordered. `ReadBarrierPolicy` gains `granted` — the session's cwd — and one rule governs every enforcement dialect: **a denied directory that is a STRICT ancestor of the granted workspace denies the rest of that ancestor's subtree and leaves the workspace whole; a denied directory that IS the workspace, or that lies inside it, denies exactly as it would without the grant.** The rule is expressed four times, once per dialect that can open a path:

- the in-process fs gate tests containment in `denies()`, and carves a denial out only for the ancestor the grant lies strictly beneath;
- bwrap applies filesystem operations in argv order, so the ancestor's `tmpfs` is mounted, the workspace is bound back from the host, and any denied root inside the workspace is `tmpfs`-mounted after that;
- Landlock rulesets are allow-lists with no deny form, so the carve-out of `/` excludes the ancestor's subtree and the workspace is then granted back as its own rule, itself carved around any denial inside it;
- Seatbelt evaluates SBPL forms in order with the last match winning, so the ancestor's `deny file-read*` comes first, the workspace's `allow file-read*` after it, and every other denial last.

What the barrier refuses is counted where a reader already looks. The run report carries `escapesDenied`, the scorekeeper folds `read-barrier/denied` into `tools.escapesDenied` and sums it per scoreboard row, and [the observatory](../../../../packages/improvement/observatory/README.md) publishes that sum in its own column beside the tamper column — never merged with it, because a refused read is a cell that tried to leave its workspace and a tamper is a cell that changed the files it was measured with.

The bench and the live district compose the confinement the [read barrier](2026-09-05-read-barrier.md) already defines: the local sandbox provider, the sandbox policy in `workspace-write` mode, `dsh-bash-sandbox` in place of `dsh-bash-local`, the barrier, and the fs read gate. Both stay at `isolation: none`, because both delegate some cells to the product and the runner refuses an out-of-process implementer under a higher claim. The bench's `route-only` overlay, whose arms all run on the session's own route, patches the runner and the barrier to `isolation: process`, which is the claim its executors can prove.

## The denied directory is the parent, not each sibling

Denying each sibling cell would stop the copying and leave the leak. The run directory holds `plan.json` and the run log as well as the cells, so listing it or reading one file in it tells the model the experiment it is part of: which arm it is, how many repetitions there are, which environments the plan holds, and what the other cells already did. That is a model-visible input the session log cannot reconstruct and the composition never intended, and it is available from the directory itself without touching a sibling.

Denying the parent also holds while the fleet is still writing it. A sibling list computed when the run starts is stale the moment the next cell's workspace is created; the parent is one path known before the agent exists, and every cell the fleet adds later falls under it. The workspace survives because the grant is ordered against the denial, not because the denial enumerated what to skip.

## The product arm stays unconfined, and the census audits it

An out-of-process implementer brings its own tool stack, its own settings, and its own process tree. `dsh-subagent-claude-code` registers `enforceByRefusal('subagent')` for exactly that reason: under `isolation: process` or `host` the barrier refuses every implementer start, and under `none` the capability runs and denies nothing. A bench whose candidate arm is that provider therefore cannot raise its claim without refusing the arm it exists to measure, so the base composition stays at `none` and the harness-side confinement it does compose binds the cell agents it does own.

That leaves the delegated arm audited rather than fenced. The census is the audit: it reads the recorded session logs and reports what each cell's own tool calls named, and it says plainly that a delegated cell records none, so its zero is the absence of evidence. A comparison between the two arms has to carry that asymmetry — the route arm is confined and counted, the delegated arm is neither — rather than read two zeroes as one fact.

## What the earlier records lose

Every record dated 2026-09-08 or earlier ran unconfined in the sibling layout, so its rows are measurements of cells that could see the experiment. The census gives the per-record counts and [`data/proving-ground/README.md`](../../../../data/proving-ground/README.md) states them before the runs table. What a reader loses depends on the record: a cell that only listed the run directory read the plan and the log, so its transcript contains an input the composition never meant to give it and the log cannot reconstruct; a cell that diffed a sibling's source saw another cell's solution to the same task, so its attempt count is not the number of attempts an isolated cell would need; and the two cells that copied or wrote into another workspace make the affected repetition's verdict a measurement of the other cell. The affected paired experiments — the tier-2 `h1-harness-loop` record and the tier-5 `e2-harness-vs-product` record — are reread as upper bounds on the route arm, not as the difference they state, until they are rerun confined.

## Alternatives considered

**Give each cell a run directory of its own.** One directory per cell, with the plan and the log somewhere else, removes the sibling layout instead of fencing it. It also removes the fleet's ability to write one plan beside the cells it plans, changes every recorded run's layout, and leaves a cell free to walk to wherever the plan moved. The denial is one registration in the runner; the layout is the fleet's, the recorder's, and every existing record's.

**Deny each sibling cell as it is created.** This stops the copying and the diffing, and leaves the plan and the run log readable, which is the larger leak. It also needs a registration per cell per run, kept current while the fleet is still creating workspaces, where the parent is one path known before the first agent exists.

**Confine with the workspace root alone, and drop the read barrier.** `dsh-sandbox-policy` in `workspace-write` mode already confines WRITES to the workspace, so the copy into a sibling would have failed. Reads stay open under every mode: `deniedReadRoots` is what expresses a read denial, and it comes from the barrier. Composing the sandbox without the barrier would have stopped one of the two incidents and none of the reading.

**Make the workspace grant a sandbox-policy field instead of a barrier one.** The grant exists to order a denial the barrier owns, and the barrier is the one place that knows the session's role. A policy field would let a deployment grant a workspace the barrier never denied an ancestor of, and the two would disagree about what a certificate means. `grantedReadRoot` on the execution policy is the barrier's answer carried to the backends, not a second source of it.

**Count refused reads as tool errors.** The scoreboard already counts `toolErrors`, and a refusal often surfaces as one. It is not the same fact: a refusal is recorded whether or not the tool that asked reported an error, and a row that mixed them could not distinguish a cell that tried to leave its workspace from one whose command failed. `escapesDenied` is its own column for the same reason `tampered` is.

## Acceptance criteria

- Over [`examples/headless-agent/tests/fixtures/sealed-cell/`](../../../../examples/headless-agent/tests/fixtures/sealed-cell/cordis.yml), a Loader-booted composition laid out the way a fleet lays one out — a plan, a run log, and two `cell-*` workspaces side by side — runs the registered environment in one of them and certifies it: the cell reads the file staged in its workspace, creates the file its check measures, and the sibling's own file is unchanged. Its confined shell's listing of the parent names neither the sibling, nor the plan, nor the run log, and both files it tried to copy out of the run directory stay empty. [The e2e](../../../../packages/improvement/environment-runner/tests/sealed-cell.e2e.ts) runs on the backend `dsh-sandbox-local` resolves on the host, probed in the provider's own chain order, and skips with a named reason only where none can confine.
- The `read` tool's refusal of `../plan.json` in that run appends one `read-barrier/denied` record naming the `fs` capability, the run report carries `escapesDenied: 1`, and a scoreboard row over that session carries the same count.
- Unit specs pin the precedence rule at its edges in the fs gate and in each backend dialect: a denied root that is the workspace's parent, one that is a grandparent, one that IS the workspace, and one inside the workspace.
- `pnpm run verify-cordis-config` and `pnpm run verify-village-composition` accept the bench, its five overlays, and the live district, and the keyless bench e2e still registers and admits every task.
- `census-escapes.mjs` reports every recorded run, and `record-run.mjs` prints the census with each record it writes.

## Risks

The denial is only as strong as the backend under it. On a host where no sandbox backend can confine a command, `dsh-bash-sandbox` fails closed and the cell's shell cannot run at all, so a bench run on such a host fails rather than measuring an unconfined cell — a louder outcome than the defect, but an outcome.

`escapesDenied` counts attempts, not cells. One cell that reads the run directory ten times and ten cells that read it once produce the same row total. That is deliberate — a repeated attempt is a different fact from a single one — but a reader comparing rows has to know it, and the per-cell breakdown lives in the census, not the row.

The census's third reason, a `..` opening a path, is a heuristic over shell commands: quoted data inside an embedded script — a URI reference such as `../g` — reads the same as a path. Over this corpus it accounts for three calls, one of them wrong, and no cell count depends on it; the tool counts the reasons apart so a total that rests on it is visible. The two other reasons match literal run-tree paths and are exact.

A cell can still read everything outside the run tree that the sandbox mode allows. The barrier denies the experiment, not the host: under `workspace-write` the confined process keeps a read-only view of the rest of the filesystem, so a cell that knows where the repository is could read the environment definitions from it. The fixture material the checks restore is what makes that detectable, and no recorded run has done it.
