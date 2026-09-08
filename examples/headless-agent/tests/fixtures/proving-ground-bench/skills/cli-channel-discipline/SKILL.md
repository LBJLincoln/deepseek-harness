---
name: cli-channel-discipline
description: Use when implementing a command-line program whose stdout, stderr, and exit code are checked exactly — the channels, the exit codes, the trailing newline, and the flush before exit are part of the specification, not presentation.
---

# Channel discipline for a checked command-line program

A validator that compares a program's channels byte for byte accepts nothing the specification did not ask for. The rules below are the ones that decide most channel mismatches.

## Stdout is the answer and nothing else

- Write only the specified output to stdout. No progress lines, no debug prints, no banners, no trailing summary.
- End the output exactly as specified: one trailing newline when the specification prints lines, none when it prints a bare value. Do not add a blank line after the last line.
- Keep field order, separators, casing, and number formatting exactly as written. When the specification shows an example, reproduce its whitespace.
- Produce output in the specified order; when the order is unspecified and could vary, sort deterministically and say so in a comment.

## Stderr carries diagnostics, and only when asked

- Write errors to stderr, in the exact wording the specification gives, and nothing else to stderr on the success path.
- When the specification defines an error line format, the whole line matches: prefix, message, and newline.
- Do not print a stack trace or an unhandled-rejection dump; catch at the top level and print the specified message.

## Exit codes are asserted

- Exit 0 only on success. Use the specified non-zero code for each error class; when only "non-zero" is specified, use 1.
- Set `process.exitCode` and return, or flush before `process.exit()`: `process.exit()` can truncate stdout that is still buffered when it is a pipe. Prefer `process.stdout.write(text, () => process.exit(code))` when an immediate exit is required.
- An exception escaping `main` is a crash, not the specified error path; wrap the entry point.

## Input handling

- Read stdin to the end before parsing: accumulate chunks on `data`, parse on `end`. Empty stdin is a legal input and usually has a specified output.
- Accept `\n` and `\r\n` line endings unless the specification says otherwise; strip the trailing newline before splitting, and do not drop a legitimately empty last field.
- Parse argv without dependencies: iterate `process.argv.slice(2)`, treat `--flag=value` and `--flag value` if both are specified, and reject unknown flags on the specified channel with the specified code.

## Before you stop

Run the program once by hand on the smallest example in the specification and compare all three channels, then run the test suite. A passing suite with an extra line on stderr is still a failing program under an exact validator.
