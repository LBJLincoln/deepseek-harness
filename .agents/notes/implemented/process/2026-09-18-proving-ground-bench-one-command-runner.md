# Agent Note: One command for the Proving Ground bench

Status: implemented

English | [中文](2026-09-18-proving-ground-bench-one-command-runner.zh.md)

## Problem

The Proving Ground bench (`examples/headless-agent/tests/fixtures/proving-ground-bench/`) ran only through hand-typed commands such as `node_modules/.bin/tsx .../experiment-driver.ts .../overlays/with-spawn.cordis.yml plan.json`, launched from an ad-hoc directory the operator created by hand, against a plan file that lived outside the repository. A plan was therefore neither reviewable in a pull request nor reproducible by a second person without first learning which driver a plan's shape needs, which overlay a `spawn` implementer or an attempt cap requires, and where to put the run's session store.

## Decision

Every plan the program has run is committed as a fixture under `examples/headless-agent/tests/fixtures/proving-ground-bench/plans/*.json`, copied byte for byte from the operator's working copies, with a `plans/README.md` (plus its Chinese pair) stating what each one compares, its tier, arms, and seed, the overlay it needs, and the recorded run it produced where one exists.

`scripts/proving-ground.ts`, run as `pnpm run bench -- <subcommand> …`, is the one command. `plans` and `environments` list what is available. `fleet`/`experiment` resolve a plan (by checked-in name or by path) and an optional `--overlay` name against `overlays/*.cordis.yml`, create `.proving-ground/runs/<plan>-<UTC timestamp>/` (gitignored) or the given `--out`, copy the plan there as `plan.json`, append one banner line to `run.log`, and run the existing `fleet-driver.ts`/`experiment-driver.ts` unchanged from that directory, streaming and teeing their output to it. `fold`, `record`, `summarize`, `census`, and `admit` forward their arguments to the existing `fold-driver.ts` and `data/proving-ground/tools/*.mjs` unchanged. `--fixture <name>` on `plans`, `environments`, `fleet`, `experiment`, and `admit` resolves the same names against another bench fixture's `plans/`, `overlays/`, `cordis.yml`, and admission script instead, the [polyglot bench](../../proposed/architecture/2026-09-22-polyglot-bench-public-comparability.md) being the other one; the drivers are this fixture's for every fixture, since they read the composition they are given. The script owns only path resolution, argument validation, the banner, and process execution; no driver, tool, or scoring logic moves into it, so an ad-hoc plan file or a hand-built composition still runs exactly as before by invoking a driver directly.

`environments --tier`/`--held-out` narrow `registry-driver.ts`'s own printed JSON to the aggregate field the flag asks for, because the driver's summary carries per-tier and held-out counts but no per-environment tier or heldOut listing to filter against; giving both flags together reports the two counts independently rather than an intersection neither field can answer.

## Alternatives considered

- **Teach each driver its own CLI conveniences (plan-name lookup, `--overlay`, an out-directory default).** Rejected: the same path-resolution and banner logic would then be duplicated across `fleet-driver.ts`, `experiment-driver.ts`, `fold-driver.ts`, and the four `data/proving-ground/tools/*.mjs` scripts, each maintained separately, where a single wrapper keeps it in one place while every driver stays exactly what its own `boot()` call already expects.
- **Grow the registry listing with a per-environment tier and heldOut breakdown so `--tier`/`--held-out` could filter `ids`.** Rejected for this change: it would extend `registry-driver.ts`'s own output, which the keyless registry smoke also asserts against, to serve a CLI convenience; the aggregate counts the driver already prints answer the flags' actual question — how many — without touching that output.
- **Keep run directories under the fixture tree, tracked by git, instead of a gitignored `.proving-ground/`.** Rejected: a run directory holds session logs, an observatory page, and export files, which is exactly what `data/proving-ground/`'s own recording flow (`record-run.mjs`) is for; landing scratch runs inside a tracked fixture directory would put every local run in `git status` until it is either recorded or deleted by hand.

## Consequences

- A person with a logged-in `claude` CLI and the product installed can run `pnpm run bench -- fleet <plan>` or `pnpm run bench -- experiment <plan>` with no other setup and no `DEEPSEEK_API_KEY`; `data/proving-ground/README.md`'s "Running the bench" section states the commands.
- Every plan the program measured against is now diffable and reviewable like any other fixture; a new plan is added the same way, as a checked-in JSON file, and `plans/README.md` gains a row for it.
- The wrapper is a second place, beside each driver's own header comment, that names a plan file's fields and the overlay-selection rule; `bench plans` and `plans/README.md` both read the same JSON rather than restating it by hand, which is what keeps the two descriptions from drifting apart.
