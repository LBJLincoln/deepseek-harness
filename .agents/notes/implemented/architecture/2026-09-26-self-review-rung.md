# Agent Note: A self-review rung on the attempt ladder

Status: implemented

English | [中文](2026-09-26-self-review-rung.zh.md)

## Problem

[The hypothesis program's readings](../../proposed/architecture/2026-09-08-hypothesis-program-results.md) leave one harness mechanism with measured value on the proving-ground bench: verification density. The validator's clustered `<validation_failed>` directive loop certified 15 of 16 tier-5 cells over three attempts against 9 of 16 over one, while a fourth and fifth attempt, a knowledge pack, and three craft skills added no certificate. [The four-goals rethink](../../proposed/process/2026-09-22-four-goals-rethink.md) names the next levers as the ones that raise verification per token, a self-review turn before validation among them. The runner could not run one: an attempt was one implementer turn followed by one validation, the only text the runner sent after the task statement was a directive earned by a failed validation, and a per-attempt choice belongs on the ladder rung, which carried a route and a budget share and nothing else. An experiment comparing the mechanism on and off had no arm to name it on, no digest to tell the arms apart by, and no row to fold them into separately.

## Decision

`EnvironmentRunRung.selfReview?: boolean` asks for one self-review turn on that rung. When an attempt's implementer work ends normally — not after an attempt the cell's caps blocked or cut short — the runner hands the same implementer the fixed block below, waits for the turn to end, and only then digests the check-owned set, restores the fixture, and validates. A route implementer receives the block alone as the next user turn of the cell session; a delegated implementer receives `task.prompt`, a blank line, and the block as one more fresh child, through the shaping the validation follow-up uses. The block is a module constant in [`packages/improvement/environment-runner/src/index.ts`](../../../../packages/improvement/environment-runner/src/index.ts), pinned by [the runner README](../../../../packages/improvement/environment-runner/README.md#the-attempt-ladder), the attempt-ladder e2e, and the [`self-review-rung` headless snapshot](../../../../examples/headless-agent/tests/snapshots/self-review-rung/stream-json.expected.jsonl); it names no check, no case, and no expected output, so the hidden-case wall the clustered directive keeps holds.

```markdown
<self_review>
Before your work is validated: re-read the specification at the top of this task and check your implementation against every requirement and corner it states — exact output on stdout and stderr, exit codes, and edge inputs the visible tests may not cover. Run the visible tests once more. Fix anything that does not match the specification, then stop.
</self_review>
```

The review turn is part of the attempt: the attempt count and `maxAttempts` are unchanged, it runs on the rung's route, and it runs under the one bound the rung's `share` armed, so a reviewing rung cannot spend a second share. A route implementer's review steps are stopped by the budget policy's pre-step check like its work. A delegated review child is measured before it starts exactly as the implementing child was: an attempt-scoped breach found there skips the review and moves the run to the next rung, a breach of the cell's own caps skips it, validates the work, and ends the run, and the measurement that found the breach is the attempt's only one, so no breach is recorded twice.

The flag travels with the rung. `resolveLadder` stamps `selfReview: true` on the `EnvironmentRunStampRung` of a rung that asked for it and nothing on one that declined or omitted it; `decodeEnvironmentRun` reads the flag back and refuses a non-boolean; the delegation record of a review child carries `selfReview: true` beside `restatedTask: true`; the experiments digest takes it as the third fixed position of every rung tuple, `false` when absent, under plan format version 9; and the fleet leaderboard, the observatory page, and the scoreboard row key carry it, so two arms differing only in the review are two digests, two rows, and two labels (`route @share +review`).

## Alternatives considered

**A directive that carries the validator's channel diff.** More information per failed validation, but the information is what a hidden case expects: the clustered directive names channels, counts, and weights precisely because a byte of expected output would leak the case. A self-review turn raises verification without touching the wall, so it runs first; the channel diff stays constrained by the wall and is not built.

**Best-of-n with validator selection.** Several implementations per attempt with the validator keeping the certified one multiplies the cost of every cell by n, on a bench whose readings already rank the strong model alone as the cheapest route to a certificate. Deferred until a mechanism cheaper than n attempts has been read.

**A config-level toggle on the runner.** A deployment choice cannot vary per arm, and the two arms of one frozen pair run in one composition, so the digest could not tell them apart. The flag belongs on the rung, where the model and the share already are, so an experiment names it per attempt and freezes it.

**A second `implement` call per attempt, each arming its own bound.** Simpler than one bound over both turns, but a rung with `share: 0.5` could then spend a whole cell's caps across its work and its review, which the ladder's refusal of shares summing above one exists to prevent.

## Consequences

An experiment arm names `selfReview: true` on a rung and a frozen pair reads the mechanism on against off under the same caps; the stamped rung, the fleet label, and the scoreboard key keep the arms apart everywhere a row is folded. Every plan digest changes with the format version, so a digest frozen under the earlier format is refused as `EXPERIMENT_PLAN_NOT_FROZEN` until the plan is frozen again, and the `experiment-presets` snapshot carries the new digest. A reviewing attempt costs one more fixed user message and whatever steps answer it; on a delegated cell it is one more child run and one more delegation record per attempt. The review turn is not measured apart from its attempt: the run's `usage`, the attempt record, and the scoreboard count it inside the attempt, and only the session log separates its spend.

## Verification

[`packages/improvement/environment-runner/tests/environment-runner.spec.ts`](../../../../packages/improvement/environment-runner/tests/environment-runner.spec.ts) pins the stamping in `resolveLadder`, the route review turn between the work and the validation with none on a plain rung, the delegated review child's prompt and record, and the three skips — after a wall-deadline cut, after a spent rung share with one attempt-scoped breach, and after spent cell caps with the work validated and the run ended. [`tests/attempt-ladder.e2e.ts`](../../../../packages/improvement/environment-runner/tests/attempt-ladder.e2e.ts) runs a reviewing first rung through the real `attempt-ladder` composition and reads the review back as a logged user turn between the task and the directive. The [`self-review-rung` snapshot](../../../../examples/headless-agent/tests/snapshots/self-review-rung/stream-json.expected.jsonl) pins the whole transcript of a cell whose review turn corrects the work its validation then certifies. The environments, experiments, fleet, scorekeeper, and observatory specs pin the decoder, the digest, the label, the row key, and the sort key.
