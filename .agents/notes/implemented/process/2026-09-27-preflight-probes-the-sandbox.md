# Agent Note: The nightly preflight asks the bench's sandbox provider before the loop runs

Status: implemented

English | [中文](2026-09-27-preflight-probes-the-sandbox.zh.md)

## Problem

On 2026-09-27 the nightly Routine was rehearsed in a fresh cloud session. Its preflight passed every step (install, build, the Claude Code CLI, the login, the queue's dry run), and then all six cells of the smoke fleet failed with `SANDBOX_UNAVAILABLE`: the bench runs every cell confined, the fresh container had neither bubblewrap nor a built Landlock launcher, and the shell executor refused to run unconfined. The cells still reached the model for 13 to 17 steps each and billed tokens before the refusal, so the night spent twelve minutes and real usage proving what a two-minute check could have said. The preflight checked everything the loop needs except the one host capability every cell needs.

## Decision

`data/proving-ground/tools/preflight.mjs` gains a `sandbox` step between `build` and `cli`. It asks the provider the bench composes rather than reproducing its probe: a child Node process runs in `packages/sandbox/sandbox-local`, so `@deepseek-ai/cordis` resolves through the provider's own dependencies and `./lib/index.js` is the provider the build step just emitted; it plugs `LocalSandboxProvider` into a fresh context, asks `confine(['true'], …)` for a sealed cell's policy (`workspace-write` on a workspace, one denied read root beside it), and runs the wrapped argv. The step passes only when the wrap exists and exits 0, and records the selected runner and its enforcement on the ledger line; a refusal records the provider's own error, `SANDBOX_UNAVAILABLE` with its remedy text, in the stopped line's tail. The Routine's prompt gains the host-state step that makes a fresh container pass: install bubblewrap when `bwrap` is absent.

## Alternatives considered

**Copy the provider's bubblewrap probe into the preflight.** Rejected: the provider's chain is bubblewrap then Landlock on Linux, with its own argv and its own denied-root rules; a copy would pass on a host the provider refuses, or fail on one it accepts, the first time either side changes.

**Detect the failure inside the fleet and stop after the first refused cell.** Useful, and separate: the fleet should not run a composition whose sandbox cannot confine, but the preflight's job is to stop before the loop spends anything, and it is the place the Routine already commits as evidence of a night that never reached the loop.

**Rely on the environment's setup script.** It is the durable fix for fresh sessions and the user's to make; the preflight still has to say when it was not made.

## Consequences

A host with no usable backend now stops the nightly at the `sandbox` step in under a second, with a committed preflight line that names the refusal. The step needs the build to have run, which the step order guarantees; `--steps sandbox` alone on a tree without a build stops with the import error in its tail. The Routine can move to a fresh session per firing once a fresh container passes this step after installing bubblewrap.

## Verification

On this container, which has bubblewrap 0.9.0: `node data/proving-ground/tools/preflight.mjs --steps sandbox` passed in 0.2 s with `runner=bwrap enforcement=full`. With bubblewrap hidden from `PATH` (`PATH=/opt/node22/bin`), the same command stopped at `sandbox` in 0.1 s with `code: "SANDBOX_UNAVAILABLE"` and the provider's message naming bubblewrap and Landlock as the remedies. Both test lines were removed from `loop/preflight.jsonl` afterwards.
