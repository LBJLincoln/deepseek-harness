---
name: standard-sampling
description: Use when authoring a completion standard with standard_author — choosing which inputs to record as cases from a reference program, how to weight them, which channels and normalizers a case should compare, and when the sample is complete enough to freeze.
---

# Sampling a reference into weighted cases

A standard is what a task means, written down before anyone implements it. Every case you record is one sentence of that meaning; every case you leave out is behaviour nobody is measured on. Sample the reference the way a careful user would exercise the program, not the way a test suite covers lines.

## Read the task before running anything

The task statement is the contract. Read it and list the outcomes it promises — each documented flag, each sub-command, each stated error, each format it says it produces. That list is what the sample must cover; the reference is how you learn what each outcome actually looks like.

A behaviour the reference has but the task never promises is not part of the standard. Recording it makes the task harder than it was stated, and the implementer has no way to know it was asked for.

## Cover, in this order

1. **One case per outcome sentence.** Every sentence of the task that promises a result gets at least one case. This is the floor, not the target.
2. **Documented flags and sub-commands.** Each one, at least once, on its own. Then the combinations the task says are meaningful.
3. **Boundary inputs.** Empty input, one element, the largest the task mentions, whitespace, characters that need no quoting but read oddly.
4. **Error paths.** Every failure the task names: missing arguments, unreadable input, values out of range. Record what the reference reports and the code it exits with, because "fails cleanly" is a behaviour a candidate can get wrong in both directions.

Probe with the shell first when you are unsure what the reference does. Record a case only once you know what it should mean.

## Weight by what a user would miss

Weight is not difficulty and not effort. It is how much of the task is lost when this case fails.

- The behaviour the task exists for carries the most weight.
- A documented flag that changes the result carries more than one that only changes formatting.
- An error path carries real weight: a program that crashes instead of reporting is broken, not merely incomplete.
- A near-duplicate of a case you already recorded carries little; prefer recording fewer, more distinct cases over splitting one behaviour across many.

Weights are whole numbers and only their ratios matter. Start with a small scale — 1 for a detail, 3 for a documented behaviour, 5 or more for the core — and use `weigh` to correct one once the whole sample is visible.

## Choose channels deliberately

- `stdout` for what the program is asked to produce.
- `exit` whenever the task says anything about success or failure. Pair it with `stderr` for an error case.
- `stderr` only when the task promises something on it. A program that is allowed to log freely should not be measured on its logs.
- `tree` when the task is about files the program writes; it compares the directory you name in `treeScope`, which is emptied before each case.

Every normalizer widens what counts as correct, so add one only for a difference the task genuinely does not care about — `crlf` for line endings, `iso8601-timestamps` for a printed clock, `json-canonical` when the task promises JSON rather than exact bytes. A case recorded without normalizers measures exact bytes, which is the honest default.

## When a case is refused

`record_case` runs the reference twice and refuses inputs whose result changes between runs. That refusal is information: the behaviour you tried to pin is not a property of the program. Either narrow the case — normalize the part that varies, or compare a channel that does not — or drop it and record the stable behaviour beside it. Never work around it by recording a weaker case that no longer measures what the task promised.

## Freeze once, deliberately

Nothing counts until `freeze`. Before freezing, read your case list back against the task statement and confirm every outcome sentence has a case and that the weights say what you mean. Frozen cases are what the implementer's work is measured by, and a standard that missed a documented behaviour will certify a program that does not have it.

State each check's `outcome` as what the task must establish, never as how to establish it: the implementer is shown that sentence when its work fails, and a sentence that describes your reference tells it what to copy instead of what to achieve.
