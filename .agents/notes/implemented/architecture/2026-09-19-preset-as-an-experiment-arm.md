# Agent Note: An agent preset as an experiment arm

Status: implemented

English | [中文](2026-09-19-preset-as-an-experiment-arm.zh.md)

## Problem

An experiment arm named a model route and an implementer, and nothing else. `EnvironmentRunRequest` carried no agent preset, so the only way to measure one agent composition against another was to run two whole fleets under two overlay files — two runs, two hours, two groups, and no frozen pair. The bench's knowledge hypothesis is exactly that measurement: record `data/proving-ground/2026-09-08-bench-h4-craft-skills-t5` mounted three craft skills through `overlays/with-craft-skills.cordis.yml` and had to be folded offline against four earlier sealed runs of the same model on the same cells, because the two compositions could not be arms of one plan. A comparison assembled that way carries every difference between the two runs, and the [experiments](../../proposed/architecture/2026-09-05-experiments.md) README recorded the gap as a known limitation.

## Decision

`EnvironmentRunRequest` gains `preset`, an agent preset id. The runner mounts it through `ctx.agentPresets.mount` inside the agent factory's `setup` — the roster's one supported call site, where the join is installed while the cell agent is still unpublished, so a composition that fails there rolls the whole cell back. A request that names none mounts nothing, which is what every run made before the field existed already did; the default is not applied silently, because a cell that ran the deployment's own rows under an arm labelled with a preset would publish a measurement of a composition it never ran.

Both refusals happen before any agent exists, and `ctx.environmentRuns.checkPreset(preset)` raises the same two without running anything, mirroring `checkImplementer`: `ENVIRONMENT_RUN_PRESET_UNAVAILABLE` for a preset named where no roster is composed, `ENVIRONMENT_RUN_UNKNOWN_PRESET` for one no root supplies or discovery reports unusable. The fleet preflights each distinct preset once per plan and the experiments service both arms at freeze, so a candidate arm the roster cannot compose refuses the plan instead of spending the baseline arm in full first.

The preset is recorded twice, because the two records answer different questions. The cell session's creation header carries it as `meta.agentPreset`, which is what a cold read of that one log resolves; the `environment/run` stamp carries it as `preset`, which is what a fold over a whole batch reads. The preset decides the tool schemas and prompt sections of every request the cell makes, so recording it is what the model-visible ⟺ logged rule requires. `EnvironmentRunStamp` keeps `version: 1`, because an optional field is not a structural format change, and the trajectory export carries the stamp verbatim rather than restating the field.

A fleet plan's `models` entries become `FleetModelEntry` — a model route plus an optional `preset` — so two entries over one route under two presets are two arms. `fleetCellKey`, the fleet leaderboard row, the scorekeeper's facts and row key, and the observatory's published row, sort key, and table all carry the preset; a cell key without one renders exactly as it always has, so a ledger written for a plan with no preset still matches the plan it recorded. An experiment arm gains `preset`, `planDigest` freezes it in role order, and the result restates it beside the arm's route and implementer. `EXPERIMENT_PLAN_VERSION` moves to `7`.

## Alternatives considered

- **Keep comparing compositions by overlay file.** Rejected: two overlay runs are two batches, so the comparison carries the hour, the harness state, and the registry of each, and the pair is never frozen under one digest. The offline fold behind the h4 record is the evidence of what that costs.
- **Put the preset on the fleet plan rather than on each model entry.** Rejected: one plan would then be one composition, so a fleet could not compare two of them in one interleaved batch, and the experiments service would still need the field per arm. The entry is where the route already lives, and the two travel together into the cell.
- **Mount the roster's default preset when a request names none.** Rejected: a hidden default at a package boundary. Every composition that runs cells today composes no roster, and silently joining one would change what those cells' models see without any plan asking for it.
- **Record the preset only on the session header.** Rejected: a fold over a batch reads the run stamps, not the headers, so a scoreboard could not key a row by the composition and two presets over one route would average together.
- **Make the preset part of the arm's model route.** Rejected: `EnvironmentRunModel` is the route a request is sent on, and the stamp, the certificate, and every route preflight read it as one. A composition is not a route, and folding it in would make `provider/model` stop identifying what was called.
- **Carry the preset into shift plans too.** Rejected for now: a shift plan restates the implementer but not the attempt ladder, so its arm vocabulary is already narrower than a fleet's, and nothing schedules a district that varies its composition. Adding it would bump `SHIFT_PLAN_VERSION` for a field with no consumer.

## Consequences

Two agent compositions over one model route are one frozen paired experiment: the arms interleave, the digest covers both presets, each cell's session states the composition it ran, and the result names it. The knowledge hypothesis the bench folded offline is now a plan — `plans/e9-preset-craft-vs-plain-t5.json` on the `with-presets` overlay, whose roster supplies a `bench` preset composing nothing of its own and a `bench-craft` preset mounting the same three craft skills as a second skill root.

A scoreboard row is now keyed by the preset as well, so a deployment that starts naming presets splits rows that used to merge; rows folded from logs written before the field exists are unchanged, because an absent preset keys as it always did. The observatory table gains a `Preset` column and the fleet's Markdown leaderboard a `Preset` cell, so both renderings moved and their expected outputs were re-recorded.

What the preset changes is bounded by what a preset composition can express. A preset cannot mount the prompt registry or the tool registry itself, so an arm's composition is whatever rows its `agent.cordis.yml` names on top of the deployment's own; and the digest freezes the preset id, not the preset's content, so two runs of one digest are comparable only under an unchanged preset directory — the same limit the digest already has for the harness commit and the environment content hashes.

## Testing

The runner's unit tests cover the mount, the header and the stamp, a run that names none, both refusals through `run()` and through `checkPreset`, and a roster whose roots supply nothing. The fleet's cover the per-entry forwarding, one preflight per distinct preset, two rows over one route, the cell key, and the refusal before any cell. The experiments' cover a pair whose arms differ only in the preset, the digest in role order, and the refusal before the baseline arm runs. The keyless `experiment-presets` snapshot runs the assembled composition through the Loader and a headless process: its document holds the frozen result and, per cell, the preset on the stamp beside which persona section reached that cell's model, so the logged composition is shown to be the composition that ran. The experiments e2e drives the same composition with a preset no root supplies and reads back a process that exited on the refusal with no session written.
