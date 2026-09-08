---
name: spec-corners
description: Use when a task is judged on cases you never see — read the specification for its corners, write your own probe cases before the suite, and when a validator reports failures by channel, reread the sentence that governs that channel instead of guessing.
---

# Reading a specification for the cases you will not be shown

A hidden validator draws its cases from the specification's edges. The visible test suite covers the main path; the corners are where a program passes its own tests and fails certification.

## Enumerate the corners before writing code

For every input the specification names, list its boundary values and decide the output for each from the text, not from intuition:

- **Emptiness**: empty input, empty line, empty field, zero items, a collection with one item.
- **Size**: the largest value the specification admits, and one past it when the text says what happens then.
- **Order**: ties in a sort (stable or specified tiebreak), duplicate keys (first wins, last wins, or an error), input order preserved or not.
- **Text**: leading and trailing whitespace, internal runs of spaces, case sensitivity, Unicode versus ASCII when the text distinguishes them, `\r\n` line endings.
- **Numbers**: negative zero, leading zeros, plus signs, fractional parts where integers are expected, overflow past the safe integer range, rounding mode (half up, half even, truncation) when the text shows a rounded example.
- **Errors**: each error class the text names, its channel, its exit code, and its exact message; what happens on the first error when several are present (stop at the first, report all, or report the last).
- **Interaction**: options that combine, options that conflict, an option given twice.

Write these down as probe inputs with expected outputs derived from the text. Where the text is silent, choose the conservative reading (reject rather than guess, preserve rather than transform) and keep the choice in one place so it can change.

## Run your probes before the suite

Run each probe by hand and compare all three channels against your derived expectation. A probe that disagrees with your expectation is either a defect or a misreading; resolve it by rereading the specification, not by adjusting the expectation to the output.

## When a validator reports failures

A report that says "N of M cases failed; mismatching channels: stderr" locates the defect precisely:

- **stderr mismatches** mean the error path: wording, channel, or a diagnostic printed on the success path. Reread every sentence about errors and messages.
- **stdout mismatches with matching exit codes** mean formatting or ordering: trailing newline, separator, field order, rounding, sort stability.
- **exit-code mismatches** mean a boundary was classified on the wrong side: an input you rejected that is legal, or one you accepted that is not.
- **all cases failing** means the program's contract is wrong at the root: the wrong output shape, reading arguments where stdin was specified, or a crash before output.

Fix the reading, add the probe, run the suite, and stop when both agree. Do not widen the program to accept more inputs than the specification names; a hidden case may assert the rejection.
