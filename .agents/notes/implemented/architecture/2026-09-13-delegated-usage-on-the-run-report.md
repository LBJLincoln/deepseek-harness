# Agent Note: Delegated usage on the run report

Status: implemented

English | [中文](2026-09-13-delegated-usage-on-the-run-report.zh.md)

## Problem

A run report's `usage` was the sum of the cell session's own assistant messages, and a delegated run has none: its attempts are child runs, and what each child spent is recorded on the cell's `environment/delegation` events as `reportedUsage` (an out-of-process child) or `usage` (an in-process child this process summed) and charged to the cell's budget as `usage/foreign`. The report left `usage` absent, so every consumer of reports read a delegated arm as spending nothing: the fleet's leaderboard rows summed zero tokens for it, an experiment's `spend` and token deltas measured the harness-native arm alone, and the offline fold of the drop arm on 2026-09-08 had to take the candidate's spend from a scratch script over the delegation events instead of from the reports it folded. The cell's budget already counted those tokens; only the report did not.

## Decision

The runner sums, into one `usage`, what the session's assistant messages report and what each delegation charged the cell: `reportedUsage` when the child's backend published one, the in-process child's own summed `usage` otherwise, which is exactly the charge `recordForeignSpend` writes. A run drives its turns or delegates them, never both, so the sum never counts one token under two views. `usage` stays absent when no message and no child reported any, which is the case for a child whose backend publishes no usage; that cell is bounded by the wall cap alone, as the runner README already states. The report type, the runner README, and the experiments README's limitation on delegated spend say so; the fleet and experiment sums need no change, because they already read `usage` from every reported cell.

## Alternatives considered

- **Add a second field, `foreignUsage`, and keep `usage` native.** Rejected: every consumer that sums spend across arms would have to add two fields and decide their precedence, which is the decision the runner already made when it charged the budget; one field with one documented meaning keeps the fleet and the experiments unchanged.
- **Read the delegation events in the fleet and the experiments instead.** Rejected: both fold reports, not session logs, and a report is the runner's statement of what the run cost; a consumer that has to re-derive a report field from the log makes the field a lie.
- **Leave the report as it was and document the scratch script.** Rejected: the recorded spend of every delegated arm in `data/proving-ground/` was computed outside the harness, which is what this repository's runs exist to avoid.

## Consequences

Fleet rows, experiment spend, and token deltas now include delegated cells, so a comparison of a route arm with a delegated arm compares a harness log's counts with a product's published counts, and says so in the experiments README. Records written before this change carry reports without `usage` for delegated cells and stay as recorded; the session logs hold the delegation events, so a later fold can recompute them. The runner's package tests assert the summed usage for an in-process pair of children and for an out-of-process child that reported it beside one that did not.
