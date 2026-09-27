# Agent Note: The development branch runs the repository gates on hosted runners

Status: implemented

English | [中文](2026-09-27-branch-ci-on-hosted-runners.zh.md)

## Problem

The upstream workflow `.github/workflows/ci.yml` runs on pushes to `master` and on pull requests only, on the enterprise runner label `dsh-ubuntu-24-04-16core`, which this fork does not have. The development branch `claude/coding-agent-harness-u9l4gt` therefore carried 488 commits past `master` (47f943859) without one CI verdict. The local pre-push discipline ([dsh-pre-push-checks](../../../skills/dsh-pre-push-checks/SKILL.md)) runs focused checks by design, so drift that crosses packages was invisible: the first branch runs found a stale `docs/module-graph.md`, two knip findings, a rotten bubblewrap pin (`0.9.0-1ubuntu0.2` had left `noble-updates`), a plan-listing test pinned to a count, real-product spend assertions that hold only on the enterprise host, three uncovered locations (the pwsh executor's read-barrier probe and the in-process driver's `model` branch), a duplicate `tool-pwsh` loader entry in the pwsh terminal lane, 28 session fixtures committed in the unpacked layout, two loader-composition expectations recorded before the `model` capability landed, and a translation-prompt snapshot recorded before its gold-pair documents changed.

## Decision

`.github/workflows/branch-ci.yml` runs the same three gate groups the enterprise lanes run (`check:ci:static`, `check:ci:coverage`, `check:ci:consumers`) on hosted `ubuntu-latest` runners on every push of the development branch and on manual dispatch. Worker counts are sized for the runners' four cores: the static job runs two gates at a time; the coverage job runs one gate at a time with three vitest workers; the consumers job runs one gate at a time because the browser suites time out when a second gate's build shares the cores, and it caps oxlint at two threads and publint at two concurrent packages and skips the Node-compatibility typecheck. One concurrency group per ref cancels a superseded run. The static job checks out full history because the archive gate reads the trusted base from the checkout. Telemetry is disabled for every job. `scripts/prepare-ci-bubblewrap.sh` pins the bubblewrap package to the version `noble-updates` currently serves (`0.9.0-1ubuntu0.3`) with its SHA-256, so the sandbox lanes stay reproducible and a future pin rot fails the install step by name instead of silently changing the sandbox under test.

## Alternatives considered

**Add branch triggers to the enterprise `ci.yml`.** Rejected: its runner label does not exist for the fork and its lane shape assumes sixteen cores.

**A self-hosted runner in the development container.** Rejected: the container is ephemeral and reclaimed between sessions; a verdict must not depend on it.

**Keep relying on the local pre-push checks.** Rejected by the evidence under Problem: the discipline is right for a push and wrong as the only gate, and the branch had accumulated exactly the cross-cutting drift it cannot see.

**Install bubblewrap unpinned.** Rejected: an unpinned install makes the sandbox lane's binary drift with the mirror; the pin is the reproducibility, and its maintenance cost is visible at the failing step.

## Consequences

Every push of the development branch gets a verdict on hosted runners; the branch's first green run is the first CI evidence for the work since `master`. The pwsh sandbox spec's read-barrier probe tests run only where `pwsh` is installed, which the hosted runners are, so the coverage gate holds on CI and on a developer host with PowerShell. The bubblewrap pin will rot with the next `noble-updates` release and the install step names it. Of the two web e2e timeouts on the fourth run, `workspace-management` (a hover poll) was load: it passed on the fifth run with the consumers job at one gate at a time. `agent-preset-selection` was not: the judge and validator presets added on 2026-09-06 had no English display names, so the English preset menu listed them in Chinese and every assertion after the menu golden failed in cascade; the fifth run showed it plainly. The development container cannot run the web e2e lanes at all: the repository's Playwright wants headless-shell r1228 and the container ships r1194, so those lanes' verdict is CI's alone.

## Verification

Runs one to four on the branch each found the defects listed under Problem, and each was fixed in the commit that followed. The fifth run found two more: the pwsh probe test expected the bash spec's `read-only` default where its own composition resolves `workspace-write` (fixed in `038e8f019`), and the preset-name defect above (fixed with English names for both presets and the two web goldens re-recorded against the built app). Locally before that commit: `npx tsc --noEmit -p tsconfig.host.json` passes; oxlint passes on the changed packages; `pnpm run verify-module-graph` reports the graph up to date; the in-process driver's tests hold its source at 100% coverage; both loader-composition tests pass against the built `lib/` (`DSH_EXAMPLE_MODE=lib`); the translation-prompt snapshot was re-recorded from the current gold pairs and passes; `pnpm run migrate:packed-session-fixtures` rewrote the 28 fixtures and the layout snapshot passes; the ACP scenario `subagent-continuable-inheritance`, which timed out in a local run of the whole consumers group under load, passes alone.
