# Agent Note: The Operations Center's cycle timeline, shift board and next action

Status: implemented

English | [中文](2026-09-29-ops-cycles-and-shift-board.zh.md)

## Problem

The [Operations Center](2026-09-28-operations-center.md) showed what was working and what needed attention, but not the enterprise's own rhythm. The cycle steps were anonymous bars in the 24-hour swimlanes, so the operator could not read which step of which cycle failed or with what exit code. The next cycle was a clock time in a tile with no countdown. The running shift was visible only as agent cards, with no ticket list and no stage per department. The transcript capture's age came from the checkout's history, so it lagged the capture's real push by up to one fetch. The shipped commits showed `cancelled` where `pnpm run enterprise:verdicts` showed `failure`: the collector took the first later run of any conclusion from its single read of 50 runs, while the report skips runs that rendered no verdict and pages further back. The most urgent action sat below the fold at phone width.

## Decision

**The collector reports cycles, the shift and shipped tickets.** [`scripts/enterprise-ops.ts`](../../../../scripts/enterprise-ops.ts) adds three optional fields to `OpsSnapshot` ([`contract.ts`](../../../../apps/command-deck/deck/contract.ts)). A snapshot from an earlier collector lacks them, and the deck still reads it, so the schema stays 2. The fields are:

- `cycles`: every cycle of the window, newest first, from its log, else its committed record, else its commits. Each step carries its exit code and duration. A running cycle adds its running step and the steps it has still to reach. The scheduler's `<cycle> exit=<n>` line marks a cycle that died past its logged steps as failed.
- `shift`: the shift that holds the shift lock, else the newest shift. A running shift is read from its scratch run. The program ledger's `program/goal` events give each department's stage, and a review session's `verdict:` line moves a certified ticket to review, integration or rejected. An ended shift is read from its committed `result.json`, with the furthest stage each unshipped ticket reached. A run log whose closing result carries `error` belongs to a shift that could not finalize or push. That shift's assembled tickets are halted at integration with the error as their reason, never shipped, and the attention queue flags the shift (`shift-unpushed:<id>`) with its kept clone and the decision it needs: push the clone by hand, or leave the tickets for the next shift. The ledger is what reached the branch, so a ticket line it holds for the shift overrides the scratch run and clears both flags. A line written after the fact carries `recordedBy`, which the board and the shipped list show as a recovered push. Such a line also settles its cycle's failed `shift` and `pull-after-shift` steps, which drop to low severity and name who recorded the shift.
- `big.shippedTickets`: the newest shipped tickets, each with its commit and Branch CI verdict.

**One status rule.** Every ticket status in the snapshot comes from the ledger module's `ticketStandings`: a ticket is shipped once any line shipped it, else its latest line's status. That covers the halted and rejected items of the attention queue, the ticket counts, both shipped lists, the shift board and the cycle rows; a shift's view applies the same rule to that shift's lines.

**One verdict rule.** A shipped commit's verdict is the one the cycle's 24-hour report rendered (`fixtures/enterprise-day.json`, the answers `enterprise:verdicts` gives), when the report has a rendered answer. Otherwise it comes from the collector's run read under the same rule: the commit's own newest run, else the oldest later run whose head contains the commit and which rendered `success` or `failure`, a cancelled run rendering none. `running` means a later run containing the commit is still in progress.

**The capture's push is read where it happens.** `parseCaptureLog` reads `transcripts-capture.log` for the newest `pushed <commit>` line and any newer round that did not push. The heartbeat carries `lastPush`, and the branch history is the fallback.

**The view.** The top strip ends in a `Do next` line: the attention queue's first item with its next action and evidence link. The floor carries the scheduler's clock. Between cycles it counts down to the announced slot, inside a ring that fills from the newest cycle start. While a cycle runs it names the step and shows the progress through the steps. Under the floor, a cycle matrix has one row per cycle and one column per step. Each cell's colour gives the step's state, and a failed cell prints its exit code. Beside the matrix, the shift board draws each ticket's track, queued → working → certified → review → integration → ship, lit up to its stage and marked where an unshipped ticket stopped. The panel's shipped list is per ticket. At phone width the `Do next` line follows the mode badge, the clock sits under the floor, the matrix scrolls inside its panel, and the shell's seat counts wrap instead of widening the page. Running cells and the current stage pulse unless the viewer asks for reduced motion.

## Alternatives considered

**Page Branch CI further on every tick.** The collector reads GitHub unauthenticated. Its one listing every two minutes already spends half the hourly limit. The cycle report pages once per cycle, and its rendered answers never change, so the collector reuses them.

**Bump the snapshot schema.** A new schema would make the deployed deck refuse the new collector's snapshot, and the new deck refuse the old one, until both were replaced. Optional fields let the deck and the relay's loop update in either order.

**Per-row step chips.** Ten step names on every row did not fit a legible width. The matrix names each step once, in its column header.

## Consequences

The operator reads each cycle's steps, the next slot's countdown, each department's stage and each shipped ticket's verdict from one page, and the verdicts agree with `enterprise:verdicts`. A shift that ended but whose record the checkout has not fetched yet is read from its scratch run's closing `result` line. The scratch shift's evidence names its run log by label, since no public page holds it.

## Verification

`pnpm exec vitest run scripts/enterprise-ops.spec.ts` covers the scheduler exits, the capture log, the program ledger, the review verdict, the cycle timeline with a running, a recorded, a refused and a scheduler-failed cycle, the running, the recorded and the unpushed shift, the verdict rule with a cancelled run, the report's answer and a later run in progress, and the capture's push. `pnpm exec vitest run apps/command-deck/tests/ops.spec.ts` covers the countdown, the ring's progress and the shift track.
