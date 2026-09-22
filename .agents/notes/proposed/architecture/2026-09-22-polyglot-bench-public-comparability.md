# Agent Note: A public suite the Proving Ground's numbers can be compared against

Status: proposed

English | [中文](2026-09-22-polyglot-bench-public-comparability.zh.md)

## Problem

Every environment the Proving Ground registers is an in-house, zero-dependency JavaScript program: the 44 tasks of the [proving-ground bench](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/cordis.yml). Its readings are careful — sealed cells, audited hidden cases, frozen pairs — but every one of them is a reading on tasks this repository wrote, in one language, so no number the harness reports can be set beside a number anyone else has published. A certification rate of 14 of 16 on sealed tier 5 says how a route does on this repository's tasks; it says nothing a reader outside the repository can check, and nothing about C++, Go, Python, or Rust.

## Proposal

Register the Exercism exercises of the [aider polyglot benchmark](https://github.com/Aider-AI/polyglot-benchmark) as a second bench fixture, [`examples/headless-agent/tests/fixtures/polyglot-bench/`](../../../../examples/headless-agent/tests/fixtures/polyglot-bench/README.md), and run it on the in-house bench's own composition. Aider publishes per-model scores on this suite under its own scaffold, so a record of this fixture can quote a published figure beside its own, apart from it and dated.

### Pin by revision, never vendor

The exercises are Exercism content under Exercism's licences, and the benchmark repository is the authority on which 225 exercises the suite holds. The fixture therefore holds no exercise. Its registrar reads the checkout `POLYGLOT_BENCH_DIR` names and refuses one at any other revision than [`admission.json`](../../../../examples/headless-agent/tests/fixtures/polyglot-bench/admission.json) records, and one with modified, untracked, or ignored files under the registered tracks, since the staged fixture copies whatever an exercise directory holds. The admission record is the one home of the pin: moving it means running admission against the new revision and writing its outcome.

### Admission decides membership

An exercise registers only when admission showed, on this host, that its stubs fail the track's test command and its reference solution passes it, both in a sealed cell with the network removed. Admission and registration share one TypeScript exercise model, [`polyglot.ts`](../../../../examples/headless-agent/tests/fixtures/polyglot-bench/polyglot.ts), so admission measures the staged fixture, the command, and the reference mapping registration uses rather than a restatement of them. Four tracks run offline in a cell: C++, Go, Python, and Rust. JavaScript needs `jest` installed into `node_modules` and Java needs Gradle, so those two tracks register nothing. Refusals are recorded with what admission observed: an exercise whose stub already passes (Exercism's refactoring exercises ship working code; one Go exercise asks for a test suite, so its command runs no test), and an exercise whose reference cannot pass offline on this host (Boost for two C++ exercises; crates.io crates for eight Rust ones, three declared by the exercise's own manifest and five by the reference solution's).

### What staging changes about an exercise

A staged fixture is the exercise directory byte for byte, with three exceptions. `.docs` is dropped because its text is the prompt; `.approaches` and `.articles` are dropped because they carry worked solutions. `.meta` is kept whole as the task reference, which the runner removes from every workspace and stages for the validator alone, since it holds the reference solution. And the C++ `CMakeLists.txt` line that names the exercise after the directory it is built in names it outright, because a cell's workspace is named after the cell. With a read barrier composed, the registrar denies the checkout and its staging directory to every implementer.

### The command a cell runs

Each track has one command, which is both the check and the sentence the prompt ends with. A sealed cell binds `/` read-only, gives each command a private `/tmp`, and lets it write only the workspace, which decides three of the four: Go keeps its build cache in `/tmp` and may fetch nothing, Cargo runs `--offline`, and CMake rebuilds its build directory from scratch. The Rust and C++ suites switch on the tests they gate behind `#[ignore]` and `EXERCISM_RUN_ALL_TESTS`, as the tracks' own runners and aider's harness do.

### One stack for both suites

The composition repeats the in-house bench's cell stack, caps, attempts, and Claude Code route, so one model's two readings come from one stack. The terms are evaluation only under their own agreement id, and the OpenRouter overlay keeps them: a suite that exists to be compared with published scores stops measuring a model that was trained on its transcripts.

### Reading a number beside aider's

A record states its certification rate per track and, apart from it, the leaderboard figure for the closest published model with the date it was fetched. The two differ in scaffold (aider sends the instructions and the stub files and gives the model two tries, the second with the test output; this harness's agent reads the tests, runs the command as often as its caps allow, and has three validated attempts), in population (four tracks, less refusals and the held-out fifth), and in the model behind the product alias, which a record names only as the alias.

## Alternatives considered

**Vendor the exercises as the in-house bench vendors its tasks.** Rejected: the content is Exercism's, and a vendored copy would decide on its own which exercises the suite holds. A pinned checkout keeps the benchmark repository the authority and makes the revision checkable.

**Run aider's scaffold instead of the harness's loop.** Rejected: the harness would no longer be measuring itself, and aider's own number for aider's scaffold is already published. The fixture measures the harness's loop on a public suite and quotes aider's figure apart.

**Register JavaScript and Java through dependencies installed into the cell.** Rejected for this fixture: it needs network or a pre-provisioned `node_modules` and Gradle cache in every cell, which is the offline property admission establishes. A track added that way needs its own admission evidence.

**Use each exercise directory of the checkout as the fixture, with `.meta` as the reference.** Rejected: `.approaches` and `.articles` would reach the workspace with worked solutions in them, and the C++ exercises cannot build in a directory named after a cell.

**Keep the upstream `CMakeLists.txt` and build from a copy named after the exercise.** Rejected: the check would work, but an implementer running the track's usual build in its own workspace would hit a failure that says nothing about the exercise.

**Write admission as plain Node, like the in-house bench's `admit.mjs`.** Rejected: it would restate the staging rules, the reference mapping, and the commands in a second module, and admission would stop proving what registration registers.

**Keep the test files out of the workspace, as aider keeps them out of the chat.** Rejected: the runner's checks run in the workspace, and the in-house bench's contract is visible tests beside a sealed validator. The difference is stated beside every number instead.

**Pin the revision in the composition.** Rejected: the admission record would still have to name the revision it ran against, and two homes for one pin drift.

## Acceptance criteria

- Over a checkout at the pinned revision, `pnpm run bench -- environments --fixture polyglot-bench` registers exactly the admitted ids of `admission.json`, a fifth of each track held out; over any other revision, a changed checkout, or no checkout, the boot fails and names why.
- `pnpm run bench -- admit --fixture polyglot-bench` reproduces the recorded admitted and refused ids on this host.
- A fleet of the smoke plan is recorded under `data/proving-ground/` with its certificates per track, and its README paragraph quotes the leaderboard figure apart from the record's own, dated.
- The fixture's unit specs and keyless e2e pass, and `pnpm run bench` runs this fixture's plans through `--fixture` without a second copy of the script.

## Risks

- **Contamination.** The exercises and their solutions are public, and a model may have read them in training; a high rate may measure recall as much as work. Aider's figures carry the same exposure.
- **The comparison is not like for like.** Scaffold, attempts, test visibility, population, toolchain versions, and the concrete model behind the alias all differ; a reader who drops the qualifiers reads the two numbers as one measurement.
- **A file the implementer adds reaches the checks.** The runner restores only the immutable paths, so a `conftest.py` or a Go `TestMain` in a new test file can change what the command runs. Nothing here defends against an implementer gaming the harness; the session log is where such a run shows.
- **Admission is a property of the host.** Another host's toolchains may admit a different set; the record names the toolchains it ran under, and a host with Boost or a crates.io mirror would record its own.
- **The cells keep the network.** The sandbox governs file effects only: admission shows that no admitted test needs the network and the commands fetch nothing, but an implementer's own command could.
