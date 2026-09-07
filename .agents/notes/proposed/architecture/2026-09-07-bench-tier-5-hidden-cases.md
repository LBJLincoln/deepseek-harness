# Agent Note: A bench tier whose verdict comes from cases the implementer never sees

Status: proposed

English | [中文](2026-09-07-bench-tier-5-hidden-cases.zh.md)

## Problem

The Proving Ground bench held thirty zero-dependency JavaScript program tasks across tiers 2 to 4, each verified by a test suite that ships inside the task directory. The Claude Code product loop certified 48 of 48 non-held-out cells across all three tiers in one attempt each, between 58 and 406 seconds per cell. A bench that every cell of one implementer passes on the first attempt orders nothing: it cannot separate two implementers, cannot show that a change helped, and cannot price a cell's difficulty.

The reason is structural, not a matter of writing harder tasks in the same form. The implementer can read `test/*.test.js` before writing a line, so the task it actually faces is "make these assertions pass", not "implement this specification". Every assertion the suite does not make is behaviour the implementer is free to get wrong, and a suite large enough to close that gap is a suite that hands over the answer. Enlarging the visible suite trades one failure for the other.

## Proposal

Add tier 5, whose main check is differential against a hidden reference on cases the implementer never sees, and populate it with ten tasks. The verification seam already carries what this needs — `AuthoredCheck` may name `cases: CheckCasesRef` with `caseBodies: CheckCase[]`, the runner appends each case's `argv` to the check's `run` and feeds its `stdin`, digests the compared channels, and the failed-validation directive tells the implementer only how many cases failed and which channels mismatched. Tier 5 uses that seam rather than adding a second one.

### Where the cases live

A tier-5 `task.json` check gains an optional `"cases": "reference/cases.json"` field. The path must sit under `reference/`, which the runner strips from every workspace overlay and copies under the validator's barrier, so a file named there is unreachable from the implementer's workspace by construction rather than by convention. `register-environments.ts` reads that file at registration, digests each case's `stdout` and `stderr` with `caseChannelDigest(…, ['crlf'])`, and hands the check `cases: checkCasesRef(bodies)` alongside `caseBodies: bodies`. Only the reference reaches the session log; the bodies stay in the validator's reservation.

The file is a plain array so it stays readable and regenerable:

```json
[{ "id": "corner-001", "weight": 3, "argv": ["normalize"], "stdin": "…\n",
   "exitCode": 0, "stdout": "…\n", "stderr": "", "channels": ["exit", "stdout", "stderr"] }]
```

The registrar fails the boot on a malformed file, a duplicate case id, a non-positive weight, an `argv` word that would need shell quoting, a channel outside `exit`, `stdout` and `stderr`, a `stderr` channel with no expected text, and a `cases` path that leaves `reference/`. Every one of those is self-contained in the file, so it fails at load.

### What a tier-5 task is

Each task is a command, `src/cli.js`, driven by arguments and standard input and judged on its exit code and its two streams. The argument words carry only modes and small integers because the runner appends them to the check's `run` verbatim; everything with structure travels on standard input, which has no quoting rules. Beside the command sits a visible suite of twelve to twenty assertions covering the main paths only, a hidden `reference/src/` solution, a `reference/generate-cases.mjs` that runs that solution over a fixed corpus to produce `reference/cases.json`, and a `src/` stub that fails the visible suite.

The corpus is deterministic in both halves: hand-written corner cases at weight 3, and combinations drawn from a seeded linear congruential stream at weight 1. Rerunning a generator rewrites the same bytes, so a case file is a build product of its reference and can be regenerated after a specification change rather than hand-maintained.

The rule that keeps this fair is that every hidden case must be arguable from the prompt. A case the prompt does not predict is a trap, not a measurement, and the fix is to state the corner or drop the case. The prompt suffix says so from the other side: a task carrying hidden cases tells the implementer that a validator runs held-back inputs and compares byte for byte, and that the written specification, not the visible suite, is what to implement. Tasks without hidden cases do not carry that sentence, because for them it would be false.

### Admission

`admit.mjs` gains the two conditions a case file must meet. Every case must reproduce against `reference/src/`, which proves the file describes the reference it claims to describe. At least one case must mismatch against the pre-state, which proves the file measures something the visible suite does not already reach: a case set the stub satisfies in full is a case set that certifies a program nobody wrote. Admission prints the case count per admitted task.

### The ten tasks

| Task | Domain | Held out | Hidden cases |
|---|---|---|---|
| `uri-resolve` | parsing | no | 150 |
| `glob-brace` | parsing | yes | 170 |
| `conf-canon` | parsing | no | 150 |
| `build-schedule` | data-structures-algorithms | no | 140 |
| `ranked-choice` | data-structures-algorithms | no | 170 |
| `sheet-eval` | data-structures-algorithms | no | 150 |
| `lex-states` | state-machines | no | 160 |
| `rate-limit-sim` | systems | no | 150 |
| `diff3-merge` | text | no | 160 |
| `wrap-justify` | text | yes | 160 |

### The difficulty gate

Each task was run once against the product loop in a copy of its directory with `reference/` removed, non-interactively with edits accepted and `node` allowed, under an eight-minute limit, and what the loop left behind was then scored against the visible suite and the hidden cases. The gate is not a certificate: it is the evidence that the tier separates anything at all. Two rounds ran: the first over all ten, the second over the six that had passed every hidden case, after their corpora gained corner cases for the specification points those tasks turn on. Every task's row below reports its shipped corpus, and [SUMMARY.md](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/SUMMARY.md) carries the per-task detail.

Four of the ten failed at least one hidden case and seven passed their visible suite. Only `lex-states` failed while its visible suite passed, at 158 of 160 cases, which is the shape the tier exists to produce; `glob-brace`, `conf-canon` and `sheet-eval` each ran out of the eight-minute budget with nothing runnable in place, which is a difficulty signal of a blunter kind. The six re-run tasks — `uri-resolve`, `build-schedule`, `ranked-choice`, `rate-limit-sim`, `diff3-merge` and `wrap-justify` — scored every hidden case in both rounds, in 201 to 417 seconds, so the added corners moved nothing for this implementer. Against this loop the tier separates on how much specification a task carries, not yet on how sharp its corners are.

## Alternatives considered

**Enlarge the visible suites.** The straightforward reading of "48 of 48" is that the tasks are too easy, and the cheap answer is more assertions. It fails on its own terms: a suite complete enough to pin the behaviour is a suite that states the behaviour, and the implementer reads it before writing anything. The measurement stays "can you satisfy what you were shown".

**Hold back a second visible suite and run it after.** A withheld `test/hidden/*.test.js` copied in by the validator needs no new mechanism. It leaks more than it measures: the failure report would carry assertion text, so a retry hands the implementer the withheld specification one message at a time, and the tier degrades to the visible-suite tier after one attempt. The cased-check directive reports counts and channel names only, which is what makes retries survivable.

**Compare against the reference at run time instead of shipping digests.** Running `reference/src/` beside the candidate on freshly drawn inputs would need no case file. It puts the reference in the runner's process during a scored run, gives up the digest binding that makes a case file auditable, and makes a cell's verdict depend on what was drawn that day, so two runs of the same plan are no longer comparable. Frozen cases keep a plan reproducible.

**A property-based checker instead of cases.** Invariants over generated inputs catch classes of error a fixed corpus misses. They also require an oracle for every property, which for these tasks is the reference again, and they report a counterexample, which is the leak the withheld-suite alternative already fails on.

**Put the case bodies in `task.json`.** One file per task is simpler to read. It would sit in the implementer's workspace, so the whole tier would be visible; `reference/` is the only directory the runner already removes.

## Acceptance criteria

- The registry equals the task files at forty tasks, and every tier-5 registration carries exactly one cased check whose `cases.count` is at least 80, asserted through `registry-driver.ts` in `proving-ground-bench.e2e.ts`.
- `admit.mjs` exits 0 over all forty tasks: every pre-state fails its own suite, every reference passes it, every hidden case reproduces against the reference, and at least one mismatches against the pre-state.
- Every generator rewrites its case file byte for byte on a rerun, so a case file is reproducible from its reference.
- At least four of the ten tasks fail at least one hidden case on a single product-loop attempt, while the visible suite passes on at least six.

## Risks

**The gate measures one implementer on one day.** The tier separates the product loop as it stands; a stronger loop, or a longer budget, may certify every cell again and put the bench back where it started. The answer then is more corners in the specifications, not a longer suite, and the case files are regenerable for exactly that.

**A case that the prompt does not predict is a trap.** The corpus is large enough that an unstated corner can hide in it, and the implementer sees only a count, so a trap is expensive to diagnose. Admission cannot catch this: it proves the reference agrees with the cases, not that the prompt does. Only reading the prompt against the case list catches it, and that reading has to be redone whenever either changes.

**The reference is the specification's only executable copy.** A hidden case is right because the reference is right. A defect in a reference becomes a hidden requirement that no visible test contradicts, and the implementer has no way to argue with it.

**An eight-minute limit conflates two failures.** A cell that ran out of budget and a cell that finished something wrong both score as a hidden-case failure, and the two mean different things about the task. The recorded results keep the exit status so the two can be told apart, but the acceptance rule does not distinguish them.

**Four references fall short of the 250-line floor** the authoring specification sets for a tier-5 solution: `ranked-choice` at 170, `diff3-merge` at 187, `wrap-justify` at 191, and `rate-limit-sim` at 230. Their specification surface is what the tier trades on, and padding the code would not add any, but the shortfall is a signal that those four have less depth than the other six.
