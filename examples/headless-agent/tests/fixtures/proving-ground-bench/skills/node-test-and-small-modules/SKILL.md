---
name: node-test-and-small-modules
description: Use when implementing a zero-dependency Node.js program against a node:test suite under a time or token budget — read the suite first, keep modules small and split early, run the suite often, and stop when it passes.
---

# Working against a node:test suite inside a budget

A budgeted run ends when the wall clock or the token cap does, whatever state the program is in. The habits below keep a solution certifiable before either arrives.

## Read the suite before writing

- `test/*.test.js` is the contract: the exported names, the argument shapes, the error classes, and the exact strings it asserts. Read every file once before creating any module, and list the exports the suite imports.
- Note the runner invocation the task states (for example `node --test test/`) and use exactly that command; a suite that passes under a different command proves nothing.
- Note `assert/strict` versus loose assertions: `deepStrictEqual` distinguishes `undefined` from a missing key and `1` from `'1'`.

## Keep modules small and split early

- One module per concern, each under about two hundred lines. A single file that grows past that is the most common way a run overruns its budget: every edit rewrites a large body, every re-read spends the context, and one syntax error stops everything.
- Write the module skeleton (exports with minimal bodies) first, run the suite to see it load, then fill one export at a time, running the suite after each.
- Prefer plain data and small pure functions; avoid clever abstractions that need reading to verify.
- Write a file once with its full content rather than through many partial edits; when a file needs a fourth edit, rewrite it whole.

## Run early, run often, read the TAP output

- Run the suite as soon as anything imports; a failing import is cheaper to fix at line ten than at line four hundred.
- Read the TAP output from the first `not ok`: its `expected` and `actual` lines name the defect; the later failures are usually consequences.
- Run only the failing file while iterating (`node --test test/<file>.test.js`), then the whole suite once before stopping.

## Stop when it passes

- When the suite passes and the specification's corners are covered, stop. Extra refactoring, comments about the process, or defensive code for inputs the specification excludes spend budget and can break passing behavior.
- Do not print progress or leave debugging output in the program; a checked program's channels are part of its correctness.
