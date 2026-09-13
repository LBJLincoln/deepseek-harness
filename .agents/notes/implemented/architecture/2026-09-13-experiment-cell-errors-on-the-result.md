# Agent Note: Cell errors on the experiment result

Status: implemented

English | [中文](2026-09-13-experiment-cell-errors-on-the-result.zh.md)

## Problem

An experiment's result stated how many repetitions failed to pair, as `unpaired` on each cell, but never why. The fleet keeps a cell that produced no report as a `FleetCellError` (the runner's thrown code and message, or the fleet's own code for a cell it never started) and announces it on the observe-only `fleet/cell` event, but the experiments service folded the two fleet reports into a result that dropped every error, and the bench driver wrote only that result. On 2026-09-08 the drop arm of the routing hypothesis lost its whole candidate arm to a subagent provider the overlay had not composed: the stored result read `inconclusive` with `seedsPaired: 0` and sixteen `unpaired` repetitions, and carried no trace of the sixteen `ENVIRONMENT_RUN_IMPLEMENTER_UNAVAILABLE` refusals, so the cause was recovered by re-running one cell by hand. The preflight that now refuses an unavailable provider before any cell runs ([note](../../proposed/architecture/2026-09-08-implementer-preflight-and-include-patch-gate.md)) closes that cause and not the class: a cell that throws mid-run, a route the circuit breaker stopped scheduling, or a cell left unstarted at the plan's token ceiling still left no mark on the result.

## Decision

`ExperimentResult` carries `errors`: every cell either arm kept as an error, baseline arm first, each arm in its fleet's cell order, as `{ arm, environment, repetition, code?, message }`. The fold copies the fleet's `FleetCellError` verbatim and interprets nothing; each entry is one repetition counted as `unpaired` on its environment's cell, with the reason. The field is required on the type and an experiment whose cells all reported carries `[]`, so a stored result is complete on its own and a reader never has to decide whether a missing field means no errors or an older writer. The cells' rates, the spend, the interval, and the verdict are unchanged, and the observatory, which reads verdicts and arms, is unaffected. Under the pre-release stance, results written before this change lack the field and stay as recorded under `data/proving-ground/`; nothing reads a stored result back into the type.

## Alternatives considered

- **Persist both `FleetRunReport`s beside the result.** Rejected: the reports repeat every cell's stamp, attempts, and usage that the sessions already hold, and the result is the fold over the sessions. What the sessions cannot say is why a repetition has no session at all, and that is the one thing the result owes the reader.
- **Have the driver subscribe to `fleet/cell` and write its own error log.** Rejected: every driver and every later consumer would repeat it, while the experiments service already holds both reports when it folds. A fact about the result belongs on the result.
- **Fail the experiment at the first cell error.** Rejected: an arm that loses one cell to a breaker or a mid-run throw still pairs the rest, and the paired statistics stay valid over the pairs that exist. The errors now say what was lost instead of discarding what was measured.

## Consequences

A stored result names the cause of every unpaired repetition with the fleet's code and message, at the cost of one entry per errored cell on the result line, which is small next to the sessions. Consumers that build results by hand, such as the observatory's tests, supply `errors: []`. The fleet's `fleet/cell` event and the runner's error codes remain the sources of the facts; this field copies them onto the durable record the experiment leaves behind.

## Testing

The package tests cover a cell refused without a code, a cell the fleet refused with `FLEET_TOKEN_CEILING_REACHED` and its message, and an experiment where nothing paired, whose result lists eight errors, four per arm, beside sixteen unpaired repetitions.
