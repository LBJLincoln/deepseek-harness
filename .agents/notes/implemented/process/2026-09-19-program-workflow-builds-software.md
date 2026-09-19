# Agent Note: The program workflow builds software

Status: implemented

English | [中文](2026-09-19-program-workflow-builds-software.zh.md)

## Problem

The program workflow had been run once end to end, and what it delivered was a document. The [self-assessment run](../../../../data/proving-ground/README.md) of 2026-09-08 staffed one department on the Claude Code route, had it write `assessment.md`, and certified it with a committed structural verifier. Every claim the workflow makes — a department is certified over a commit, a branch is merged only while it still points at the certified revision, an integration certificate over the merged head is what a release rests on — was therefore exercised against a single file whose examiner counted sections and citations.

Delivering software is the case the workflow exists for, and it had never been run. A program that builds a program is also where the workflow's own rules stop being ceremony: several departments write files that have to compose, the merge is the first moment the parts meet, and the verifier is a test suite that either runs the result or does not.

## Decision

[`examples/headless-agent/tests/fixtures/program-csv-tools/`](../../../../examples/headless-agent/tests/fixtures/program-csv-tools/README.md) is a program whose deliverable is `csv-tools`, a zero-dependency Node.js command line with three subcommands: `stats`, `filter` and `join`. Three departments each own one subcommand; the first also owns the shared RFC 4180 reader and writer, and `filter` and `join` depend on it. The repository the program delivers into is the fixture's `seed/`, committed and tagged `base` by the driver: `SPEC.md` — the quoting rules, the header handling, the empty and malformed input behaviour, the exit codes and the stdout/stderr discipline — plus `bin/csv-tools.js`, `package.json` and a `node:test` suite under `test/`. Every source file of the released tree is written by a department.

Each department is certified against the part of the committed suite that covers its own modules, plus `test ! -e node_modules`. The integration runs the whole suite over the merged head, followed by two gates: `test -z "$(git status --porcelain)"` and the same no-dependencies rule, so the commit-or-refuse rule reaches the certificate rather than only the program's refusal to measure a dirty worktree. The ledger already records the revision and the `HEAD^{tree}` each department certificate covers, and the e2e reads all three out of it.

The composition is the self-assessment's, with the same budget, persistence, checkpoint and program entries and one addition: the read barrier. That run's integration session was unconfined, found the department's worktree and rewrote sentences of the certified file. Here the program denies the integration session the whole worktrees root for the length of its run.

`cordis.yml` is keyless — the departments run on a `cli-mock` route whose scripted turns read `SPEC.md`, write the modules committed under `scripted/src/` and commit them — and `overlays/claude-code.cordis.yml` is the same file with that route disabled and the operator's Claude Code installation in its place. `implementer` stays `route` in both, and the route is not part of the spec digest, so the two runs are one program id over one set of goals. `examples/headless-agent/tests/program-csv-tools.e2e.ts` runs the keyless half in the e2e lane; the fixture's README pair carries the launch command, the artefacts and the `record-run.mjs` invocation for the real one.

### The base revision shapes the software

Every department worktree is cut from `baseRevision`, so a department never sees another department's files. That is what decides the layout: `src/filter.js` and `src/join.js` import nothing and restate the specification's number rule, `bin/csv-tools.js` is seed-owned and is the one place the reader and a subcommand meet, and every subcommand module takes and returns a table. The end-to-end suite `test/cli.test.js` consequently passes on the merged head and on no department branch, which is what makes the integration certificate the release rather than a formality over three already-passing branches.

The dependency edges therefore order the work rather than feeding it: `filter` and `join` start only once the department that owns the reader holds a certificate, because a merged head composed with an uncertified reader is not worth integrating.

## Alternatives considered

**Put the parser in the seed and give each department one subcommand.** Every department would then be independent by construction and the dependency edges would be decorative. It also hands the departments the hardest part of the deliverable, which is the part a program most wants measured.

**Cut a dependent department's worktree from its dependency's branch.** Modules could then import each other directly. The program creates every worktree from `baseRevision`, and changing that would mean a department's certificate covers work another department did, and the integration merge would no longer be the first time the parts meet. The rule stayed; the software was shaped around it.

**Have the scripted implementer emit the module bodies as strings inside the adapter.** The delivered code would then not be reviewable, lintable or runnable as code. It lives under `scripted/src/` as real files that the fixture's own checks execute, and the adapter writes those bytes through the `write` tool, so the department session carries exactly what the branch does.

**Have the scripted implementer copy the files with `cp`.** Shorter, and the transcript would record a copy instead of the source — a department session that shows nothing of what was delivered is the failure mode the external-implementer route already has, and there is no reason to reproduce it on the route that does not.

**Extend `fixtures/program/` instead of adding a fixture.** That fixture answers the ledger, the reconciliation across a kill switch and the barrier refusal; giving it a real deliverable would make one fixture answer two questions and make both slower to read.

**Make the deliverable a change to this repository.** The base revision would be the harness, the checks would be the repository's own gates, and a failing run would not distinguish the workflow from the gates. A small standalone deliverable keeps the workflow the only variable; the repository is the case to try once this one has a recorded verdict.

**Add a snapshot scenario for the program's transcript.** The only text this workflow puts in front of a model is the goal objective and the validator's directive; the e2e asserts the directive verbatim from the durable log and the objectives are committed in the driver. The driver prints one JSON report rather than a session-event stream, so a snapshot would need a second output mode for coverage the e2e already has.

## Consequences

The workflow now has a case whose verdict is a program that runs: the keyless e2e releases the program in about five seconds and then executes each of the three subcommands from the integration worktree. It also pins the two rules that a document deliverable barely exercised — the `join` department leaves its first attempt uncommitted on purpose, earns `the worktree carries work that no commit on this branch carries`, and certifies the attempt that commits; and the three certified revisions and trees in the ledger are asserted to differ from the merged head.

What the keyless run does not prove is what a model can build. It proves that the spec freezes, that the departments are staffed, budgeted and certified over committed trees, that the branches merge, and that the committed verifier decides the release. The real run on the Claude Code route is what answers the other half, and until it is recorded under `data/proving-ground/` this fixture is a wiring proof.

`SPEC.md` and the suite are committed in this repository, so a model that has seen the repository has seen the examiner. The real run therefore measures the workflow rather than the novelty of the task, and a held-out deliverable is what a capability claim would need.

Because a clean merge passes the integration standard outright, the integration session is given no turn, refuses no read, and the run's denial list is empty while `program/integration` still records the directory that was denied. The e2e asserts both, so the empty list stays an explained companion rather than an absent one.
