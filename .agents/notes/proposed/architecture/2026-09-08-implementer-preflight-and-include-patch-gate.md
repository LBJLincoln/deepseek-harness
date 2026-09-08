# Agent Note: The implementer preflight a plan runs, and the include patch that must reach something

Status: proposed

English | [中文](2026-09-08-implementer-preflight-and-include-patch-gate.zh.md)

## Problem

A frozen paired experiment ran its entire baseline arm — 16 cells and about an hour of model budget — and then every cell of its candidate arm was refused by [`dsh-environment-runner`](../../../../packages/improvement/environment-runner/README.md) with `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE`: `implementer provider "spawn" is unavailable: no subagent provider is registered under that name`.

The provider was missing because the composition overlay never composed it. [`dsh-fleet`](../../../../packages/improvement/fleet/README.md) keeps a cell whose run throws as a cell error, which is what makes one broken cell not fail a plan, so all 16 refusals were recorded as cell errors and the fleet run reported normally. The experiment then folded a comparison with `seedsPaired: 0` and a verdict of `inconclusive`. Nothing failed loudly anywhere: the only record that the candidate arm never ran is a per-cell error string in a report, and the shape of that report is the same one a genuinely inconclusive comparison produces.

The refusal itself is correct and it is already early — `requireImplementer(implementer, model)` runs before any agent exists, checking that the named provider is composed, that this process can confine it under the deployment's isolation, that it can be told which model to run, and that a budget policy exists to bound it. It is private, so the only way to reach it is to start a cell. `ExperimentService.run()` documents that "Every refusal happens before the first cell runs"; for this refusal it was not true, and the cost of that is one arm of model spend per plan.

The composition-side cause is a second silent skip. The overlay carried `- id: subagent-spawn` as a non-insert patch, and the base composition names no entry under that id. `applyEntryPatches` in [the vendored include plugin](../../../../vendor/include/src/index.ts) warns `patch: entry %C not found` and skips such a patch rather than refusing it, so the overlay mounted without the row it exists to add. The warning goes to the loader logger of a bench boot nobody reads. Two more checked-in compositions carry the same defect today: `examples/headless-agent/e2b.cordis.yml` patches `subprocess` and `fs-local` through `advanced.cordis.yml`, whose own entries are one nested include below, and the proving-ground `route-only` overlay patches a `tool-fs-search` row the bench base never composes.

## Proposal

**The runner publishes the preflight it already performs.** `EnvironmentRunner.checkImplementer(implementer, model)` takes one implementer and one stamped route, returns nothing, and throws the same `EnvironmentRunError` codes — `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE`, `ENVIRONMENT_RUN_IMPLEMENTER_UNCONFINED`, `ENVIRONMENT_RUN_IMPLEMENTER_MODEL_UNSUPPORTED`, `ENVIRONMENT_RUN_IMPLEMENTER_UNBOUNDED`. It calls the private `requireImplementer` and discards the resolved implementer, so there is one resolution and a caller cannot be told something `run()` would not enforce. A route implementer is refused nothing, because the session's own model route is what a run naming no implementer already uses.

**The fleet refuses a plan before it mints a workspace.** `FleetService.run()` calls the preflight during plan validation, after the environment selection and the model default and before any cell is enumerated or any `mkdtemp` runs, once per route the plan names. The route it passes is the one the runner stamps: the plan's first ladder rung where that rung names a model, and the cell's own route otherwise. The runner's error propagates unchanged, so the plan is refused with the provider named instead of running as a plan of error cells.

**The experiment refuses at freeze.** `ExperimentService.freeze()` runs the preflight for both arms, each against its own `{ provider, model }` route, in the per-arm validation loop that already refuses a conflicting first ladder rung, and before `agreedCaps` resolves the caps the digest freezes. Arms run in role order, so this is what keeps a candidate arm's missing provider from spending the baseline arm first.

**An unmatched include patch fails a gate.** `verify-cordis-config` resolves each `@deepseek-ai/cordis-plugin-include` entry's `path` against the directory of the file the entry is written in, parses the included file as an entry list, and calls `applyEntryPatches` with a warning sink that collects instead of logging. Every collected warning becomes a gate error naming the file, the entry, and the included path. Calling the include's own function is what keeps the gate and the mount from disagreeing: ids match through group `config` lists, an `insert` adds ids a later patch in the same list may target, and the four skip conditions — an unmatched id, an insert into a row that is not a group, a patch carrying no id, and a `name` that disagrees with its target — are the plugin's, not a second implementation of them. An include whose file is absent uses its `initial` list, which is what the plugin writes there and reads back; an include naming a path that can be read as nothing else is an error too.

The three compositions the gate rejects are fixed with it. The two proving-ground overlays gain `insert:` patches, which is what they meant. `e2b.cordis.yml` layers over `cordis.yml` directly and restates the rows `advanced.cordis.yml` adds, because the local `fs` and `subprocess` providers it must disable are only reachable in the file that declares them — and both of those services may be provided once per composition, so that overlay could not boot.

## Alternatives considered

**Let the fleet record the refusal as a plan-level error instead of forwarding the runner's.** A `FLEET_IMPLEMENTER_UNAVAILABLE` would keep every refusal the fleet raises inside `FleetError`. It also restates four conditions the runner owns, and the message a planner reads would be the fleet's paraphrase of a provider fact the runner is authoritative about. Forwarding keeps one text and one code per condition.

**Have the fleet resolve the plan's ladder through `resolveLadder` before checking.** The runner's resolution also validates rung count against the runner's own `maxLadderRungs`, which is deliberately a per-cell refusal rather than a plan-level one, so calling it here would move that ceiling to the plan. Reading `ladder[0].model` is the stamping rule alone, which is all the preflight needs.

**Check the implementer once for the plan rather than once per route.** The current conditions do not read the route, so one call would raise the same errors. The runner's method answers for one stamped route, and every route a plan names is a route its cells would be stamped with; asking about each is what makes the plan's question the same question its cells ask.

**Make the include throw on an unmatched patch instead of gating the files.** Refusing at mount is the loudest possible failure, and it changes the vendored plugin: patch lists compose one layer per source, and a layer that patches a row another layer may or may not insert is a supported use of the skip. The gate reads the checked-in composition, where every layer is known, so it can be strict without constraining the runtime.

**Follow nested includes when building the id map.** It would make `e2b.cordis.yml` pass unchanged. It would also make the gate say a patch reaches an entry that at mount it does not, since `applyEntryPatches` recurses through group entries only. A gate that models something other than the mount is worse than no gate.

## Acceptance criteria

- `ctx.environmentRuns.checkImplementer` throws each of the four implementer codes for the composition that provokes it, creates no agent and starts no child, and returns for a composed in-process provider and for `{ kind: 'route' }`.
- A fleet plan naming a subagent provider the composition does not hold rejects with `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE`, hands no cell to the runner, and leaves the plan's `workspaceRoot` empty. A plan whose provider is composed checks each route it names, and a laddered plan checks the first rung's model.
- An experiment whose candidate arm names such a provider rejects from `run()` with no `ctx.fleet.run` call at all, so the baseline arm runs no cell; a plan both of whose arms are honorable checks baseline then candidate, each against its own route.
- `verify-cordis-config` rejects a composition whose include entry carries a non-insert patch matching no entry of the included file, and accepts patches that reach an entry directly, inside a group, and through a row an earlier `insert` in the same list added. The gate passes over every checked-in composition.

## Risks

- **The preflight is a snapshot of the composition, not a reservation.** Nothing keeps a provider registered between the plan check and the last cell, so a provider disposed mid-run still fails its cells the way it does today. The check removes the case where the plan could never have run, not the case where it stopped being able to.
- **A plan-level refusal replaces a partial result with none.** A driver that could previously read a fleet report whose cells all failed now gets a thrown error and no report. That is the intent for an implementer the composition cannot honor, and it is a behavior change for any consumer that treated the all-errors report as a normal outcome.
- **The include gate is as strict as the compositions are honest.** It reads the file each include entry names, so a composition assembled at runtime from a path this gate cannot resolve is still unchecked, and a patch list whose target file is generated during a boot passes on its `initial` list rather than the file that will exist. Both are outside what a checked-in composition states.
