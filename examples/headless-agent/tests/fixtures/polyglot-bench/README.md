# Polyglot bench

English | [中文](README.zh.md)

The Proving Ground's externally comparable suite: the Exercism exercises of the [aider polyglot benchmark](https://github.com/Aider-AI/polyglot-benchmark), whose per-model scores under aider's own scaffold are published on [aider's leaderboard](https://aider.chat/docs/leaderboards/). The exercises are Exercism content and are not in this repository: the registrar reads a checkout at the revision [`admission.json`](admission.json) records, `7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f`, and refuses any other. Every cell runs on the [proving-ground bench](../proving-ground-bench/cordis.yml)'s cell stack, caps, attempts, and Claude Code route, so one model's readings on the in-house bench and on this suite come from one composition. The [Agent Note](../../../../../.agents/notes/proposed/architecture/2026-09-22-polyglot-bench-public-comparability.md) owns the rationale.

## Running it

```sh
git clone https://github.com/Aider-AI/polyglot-benchmark ~/polyglot-benchmark
git -C ~/polyglot-benchmark checkout 7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f
export POLYGLOT_BENCH_DIR=~/polyglot-benchmark
pnpm run bench -- environments --fixture polyglot-bench
pnpm run bench -- fleet polyglot-smoke-sonnet --fixture polyglot-bench
pnpm run bench -- admit --fixture polyglot-bench
```

The checkout must be unchanged under the four registered tracks: the boot fails on modified, untracked, or ignored files there, which running an exercise's tests inside the checkout leaves behind. `admit` repeats admission and exits 1 when its outcome differs from the record; `admit --write` records a new outcome, which is how the pinned revision moves. A run is recorded like any bench run, with `--composition examples/headless-agent/tests/fixtures/polyglot-bench/cordis.yml`.

## What registers

Four tracks run their tests offline in a sealed cell: C++, Go, Python, and Rust. JavaScript's suites need `jest` installed into `node_modules` and Java's need Gradle, neither of which a cell can fetch, so those two tracks register nothing. Each admitted exercise is one environment of kind `bench`, id `polyglot:<track>:<exercise>`, with `detail.language` naming the track and no tier or domain. Its one check runs the track's command in the workspace root, and the prompt ends by naming that command:

| Track | Command |
| --- | --- |
| `cpp` | `rm -rf build && cmake -S . -B build -DEXERCISM_RUN_ALL_TESTS=1 && cmake --build build` |
| `go` | `GOCACHE=/tmp/go-build GOPROXY=off GOTOOLCHAIN=local go test -count=1 ./...` |
| `python` | `python3 -m pytest -q` |
| `rust` | `cargo test --offline -- --include-ignored` |

A sealed cell binds `/` read-only, gives each command a private `/tmp`, and lets it write only the workspace, so Go keeps its build cache in `/tmp`, nothing fetches, and a C++ build directory the implementer configured never decides the build. The Rust suites mark every test but the first `#[ignore]` and the C++ suites compile every test but the first only under `EXERCISM_RUN_ALL_TESTS`; both switches are on, as in aider's harness.

The registrar stages each exercise into a directory it owns for as long as it is loaded. The staged fixture is the exercise directory without `.docs`, whose text is the prompt, and without `.approaches` and `.articles`, which carry worked solutions; `.meta` stays whole as the task reference, which the runner removes from every workspace and stages for the validator alone, because it holds the reference solution `.meta/example.*`. One line changes: a C++ `CMakeLists.txt` names its exercise after the directory it is built in, which in a cell is the cell's own, so the staged copy names the exercise outright. With a read barrier composed, the checkout and the staging directory are denied to every implementer.

The implementer changes the track's solution files, as `.meta/config.json` lists them, except `Cargo.toml` and `CMakeLists.txt`, which stay fixed as they do in aider's harness. Every other file in the workspace is immutable: the runner restores it before each validation and voids an attempt that changed it. The prompt is the exercise's `.docs/introduction.md` when there is one, `.docs/instructions.md`, and `.docs/instructions.append.md` when there is one, which is the text aider's harness sends, followed by one sentence naming the files to change and the command; `.docs/hints.md` is not sent.

In each track the admitted exercises are ranked by a seeded SHA-256 of their ids and the first fifth is held out. An exercise's rank depends on its own id alone, so admitting or refusing another exercise moves at most the boundary of the split.

## Admission

[`admit.ts`](admit.ts) stages every exercise of the four tracks as the registrar does, runs the track's command in a sealed cell over the stubs, then again with the reference files copied over the stubs they replace, and admits the exercise only when the first run fails and the second passes. Its cell is the fleet's with the network removed, which shows that no admitted test needs one. It shares [`polyglot.ts`](polyglot.ts) with the registrar, so it measures the fixture, the command, and the reference mapping that registration uses. [`admission.json`](admission.json) records the outcome, the revision it ran against, and the toolchain versions it ran under; the registrar registers the admitted exercises and fails the boot when the checkout holds an exercise the record does not classify.

| Track | Exercises | Admitted | Held out | Refused |
| --- | --- | --- | --- | --- |
| C++ | 26 | 24 | 5 | 2 |
| Go | 39 | 36 | 7 | 3 |
| Python | 34 | 34 | 7 | 0 |
| Rust | 30 | 22 | 4 | 8 |

The refusals fall under five causes. The first two are properties of the exercises and hold on any host: aider's leaderboard counts those three exercises, and a model that leaves the working code alone passes the refactoring ones. The third is a property of this host. The last two come from the cell being offline: three Rust exercises declare a crates.io dependency their tests cannot build without, and five Rust reference solutions depend on crates their own `.meta/Cargo-example.toml` declares, so nothing shows those five passable offline, although an implementer may pass them with the standard library alone.

| Cause | Refused |
| --- | --- |
| The stub already passes: a refactoring exercise that ships working code | `polyglot:go:ledger`, `polyglot:go:markdown` |
| The stub already passes: the exercise asks for a test suite, so its command runs no test | `polyglot:go:counter` |
| The reference needs Boost `date_time`, whose headers this host lacks | `polyglot:cpp:gigasecond`, `polyglot:cpp:meetup` |
| The exercise's `Cargo.toml` declares a crates.io crate, which an offline cell cannot fetch | `polyglot:rust:gigasecond`, `polyglot:rust:grep`, `polyglot:rust:simple-cipher` |
| The reference depends on crates its own `.meta/Cargo-example.toml` declares | `polyglot:rust:alphametics`, `polyglot:rust:decimal`, `polyglot:rust:pig-latin`, `polyglot:rust:poker`, `polyglot:rust:robot-name` |

## Plans

| Plan | Cells | Exercises |
| --- | --- | --- |
| [`polyglot-smoke-sonnet`](plans/polyglot-smoke-sonnet.json) | 8 | the first two open exercises of each track in rank order |
| [`polyglot-core-sonnet`](plans/polyglot-core-sonnet.json) | 40 | the first ten open exercises of each track in rank order |

Both run the Claude Code route's `sonnet` once per exercise, seed 1, district `bench-polyglot`, and every smoke exercise is also a core exercise. [`overlays/with-openrouter.cordis.yml`](overlays/with-openrouter.cordis.yml) adds the in-house bench's OpenRouter route under this fixture's evaluation-only terms, and [`overlays/registry-only.cordis.yml`](overlays/registry-only.cordis.yml) is the keyless registry view `environments` boots.

## Reading a number beside aider's

A certification rate here and a pass rate on aider's leaderboard are two measurements, and a record states them apart.

- **Scaffold.** Aider sends the instructions and the stub files and gives the model two tries, the second with the test output. Here the agent works in the workspace with the harness's own tools, reads the test files, runs the command as often as its caps allow, and has three attempts, each ended by a validation; a record's attempt counts show how many certified within two.
- **Population.** Aider's figure covers 225 exercises in six languages. Here four tracks register, less the refused exercises, and a plan draws only open ones. Exercism's refactoring exercises ship working code: on aider's leaderboard any model that leaves them working scores them, and here they are refused.
- **Model.** The route asks the Claude Code installation for its `sonnet` alias, and the session logs record that alias, not the model the installation serves under it.

## Known Limitations

- **A file the implementer adds reaches the checks.** The runner restores only the immutable paths, so a `conftest.py`, or a Go `TestMain` in a new test file, can change what the command runs. Nothing here defends against an implementer that games the harness; the session log is where such a run shows.
- **The cells keep the network.** The sandbox governs file effects only. Admission shows that no admitted test needs the network and the commands fetch nothing, but an implementer's own command could.
- **Admission is a property of the host.** The record names the toolchains it ran under; a host with Boost headers or a crates.io mirror would admit exercises this one refuses, and records its own outcome.
- **The registrar needs `git`.** It reads the checkout's revision and changes through `git rev-parse` and `git status`.
