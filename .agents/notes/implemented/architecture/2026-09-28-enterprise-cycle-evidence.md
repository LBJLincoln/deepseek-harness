# Agent Note: Evidence of the enterprise's unattended cycles

Status: implemented

English | [中文](2026-09-28-enterprise-cycle-evidence.zh.md)

## Problem

`scripts/enterprise-scheduler.sh` runs `scripts/enterprise-cycle.sh` every two hours without an operator, and each cycle's output went only to a log file inside the container: the repository never saw it, and the container reset at 22:07Z on 2026-09-28 erased it. What the branch kept of a cycle was whatever its commits happened to carry — an intake record, a shift's record and lines, the functions' lines — with no statement of which steps ran, which failed, or whether the cycle finished, and no way to tell a cycle that did nothing from one that never ran. The operator must receive an honest, reproducible account of the enterprise's first 24 hours unattended, and every figure in it has to come from something committed.

## Decision

**Every cycle commits its own record.** After its last data step (`publish`) and before its final commit, the cycle runs `pnpm run enterprise:cycle-record`, which writes `data/enterprise/cycles/<cycle id>.json`, and the final commit includes it. The shell stays thin: `step()` appends `<name> <exit> <UTC time>` to a temporary file beside the cycle's lock, and the script captures `start` (HEAD when the cycle began, the revision whose cycle script ran), `pulled` (HEAD after the initial pull) and the remote-tracking tip after that pull. `scripts/enterprise-cycle-record.ts` builds the record from those and the checkout: every step in order, the ledger rows gained since `pulled` compared as a multiset (ticket lines by status, function lines by outcome, the shift ids of the ticket lines, unreadable rows), `firstFailure`, and `end`, the commit the record was built on. One validator, `cycleRecordProblems`, guards the write and every read. A record that cannot be written is the failed step `record`, and the push still runs, so the cycle's data never waits on its record.

**The final push is reported by the next cycle.** A record cannot contain the outcome of the push that delivers it. The next cycle's record names the newest earlier record in its checkout and whether the remote branch held it when the initial pull fetched (`previous.recordOnRemote`): `false` is exactly a final push that did not land, and the commit the checkout kept then travels with the next cycle's push.

**Cycles without a record are counted from git, and labelled.** A cycle before the record existed, one whose record failed, one a container reset cut short, or one that exited on the lock or a dirty checkout leaves at most its pushed commits, whose subjects carry the cycle id (`chore(enterprise): <cycle id> intake`, `chore(enterprise): <cycle id> functions, roster and deck`); readers count those as cycles seen only in git history, never as clean or failed.

## Alternatives considered

**Committing the cycle's log.** The log is the scheduler's redirect of every command's raw output: committing it would grow the tree with unreviewed text every two hours and still state no outcome a program can read. The record states the outcome; the log stays the local debugging aid.

**Building the record in the shell.** JSON written by bash cannot validate itself, and the cycle pulls the branch that may rewrite the script while it runs. One appended line per step and one command keep `main() {…}; main "$@"` short and put parsing and validation where tests reach them.

**Counting the cycle's lines by position or by time.** A position (the ledger's row count at the pull) breaks when a rebase reorders appended rows; a time filter is wrong because a function line's `at` is the deliverable's own time, and a CI verdict rendered before the cycle began is still this cycle's line. Comparing the rows before and after as a multiset counts exactly the rows the cycle's checkout gained.

**Checking the previous record against the remote at the end of the cycle.** By then this cycle's own pushes may have carried the previous cycle's unpushed commit, and the check would report a failed push as delivered.

## Consequences

The branch holds every cycle whose final push landed, with its steps, exit codes and the ledger lines it produced, and the next record says whether the previous one landed; the container-local log is no longer the only account of a cycle. The cost is one small JSON file and one `tsx` start per cycle. A cycle that dies before its record leaves only its commits, and readers label such a cycle instead of guessing its outcome.

## Verification

`scripts/enterprise-cycle-record.spec.ts` pins the step-file parsing, the record's counts over a ledger that gained ticket, function and torn rows, `firstFailure`, the validator's rejections, the reader's handling of misnamed and torn files, and `previous.recordOnRemote` against a temporary origin in its three states. One test runs the real `scripts/enterprise-cycle.sh` twice in a temporary clone with a stand-in `pnpm` whose roster step fails the first time: the first record lists the eight steps in order with `firstFailure: { step: "roster", exit: 1 }` and is committed in the final commit on the origin, whose parent is the record's `end`, and the second cycle's record finds it on the remote.
