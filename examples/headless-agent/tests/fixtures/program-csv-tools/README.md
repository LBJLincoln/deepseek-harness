# csv-tools: a program that builds software

English | [中文](README.zh.md)

A [program](../../../../../packages/improvement/program/README.md) whose deliverable is a working command line rather than a document: three departments, each on its own branch and session, build one subcommand of `csv-tools` against a written specification, and an integration certifies the merged head against a test suite committed before any of them started. The [self-assessment program](../../../../../data/proving-ground/README.md) of 2026-09-08 ran one department and produced Markdown; this fixture is the same workflow producing a program, and the [Agent Note](../../../../../.agents/notes/implemented/process/2026-09-19-program-workflow-builds-software.md) records why it is shaped this way.

## What it delivers

`csv-tools` is a zero-dependency Node.js command line with three subcommands: `stats` (per-column count, minimum, maximum and mean over numeric columns), `filter` (the rows whose named column matches an operator and a value) and `join` (the inner join of two files on a named column). [`seed/SPEC.md`](seed/SPEC.md) is the whole specification — the quoting rules, the header handling, the empty and malformed input behaviour, the exit codes and the stdout/stderr discipline — and it is what each department reads first.

The repository the program delivers into is `seed/`, committed and tagged `base` by the driver: the specification, `bin/csv-tools.js`, `package.json` and `test/`. Nothing else is there, so every source file of the released tree was written by a department.

| Department | Delivers | Measured by |
| --- | --- | --- |
| `stats` | `src/csv.js` (the shared RFC 4180 reader and writer) and `src/stats.js` | `node --test test/csv.test.js test/stats.test.js` |
| `filter` | `src/filter.js` | `node --test test/filter.test.js` |
| `join` | `src/join.js` | `node --test test/join.test.js` |
| integration | nothing; it merges | `node --test test/*.test.js`, then two gates |

`filter` and `join` depend on `stats`, so neither starts before the department that owns the reader holds a certificate. Every worktree is cut from the base revision, though, so a department never sees another department's files: `src/filter.js` and `src/join.js` import nothing, `bin/csv-tools.js` is the one place the reader and a subcommand meet, and `test/cli.test.js` — the suite that drives the real command line — therefore passes on the merged head and on no department branch. That is what makes the integration certificate the release.

## What certifies a release

Three rules, none of them new here, decide what the program may claim.

- **The committed verifier.** `test/` is in the base commit and no department may change it; the integration re-runs all of it over the merged head. The e2e checks the merged tree's `SPEC.md`, `bin/csv-tools.js` and `test/cli.test.js` byte for byte against `seed/`, so a department that edited its own examiner would fail that assertion rather than pass the suite.
- **Commit or refuse.** A department is never measured over a worktree carrying work no commit carries. The scripted `join` department leaves its first attempt uncommitted on purpose: the program spends that round, issues `the worktree carries work that no commit on this branch carries`, and certifies the attempt that commits. The integration carries the same rule into its own certificate as `gate-1`, `test -z "$(git status --porcelain)"`.
- **The tree digest.** Each `program/goal { status: certified }` record states the commit and the `HEAD^{tree}` its certificate covers, and the integration merges a branch only while that branch still points at the recorded commit. The e2e reads the three certified revisions and trees out of the ledger and asserts they differ from the merged head.

The integration session runs denied the program's whole worktrees root, so it cannot read a department worktree while it works; `program/integration` records what was denied either way. The self-assessment run had no barrier composed, and its integration session edited the department's certified file — that is the defect this composition closes.

## The two compositions

[`cordis.yml`](cordis.yml) is the keyless half: the departments run on the `cli-mock` route registered by [`csv-tools-llm.ts`](csv-tools-llm.ts), which reads the specification, writes the modules committed under [`scripted/`](scripted/src) and commits them. It proves the wiring — that the spec freezes, the departments are staffed and certified over committed trees, the branches merge and the committed verifier decides the release — and nothing about what a model can build.

[`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) is the real one: the same file with the scripted route disabled, the operator's Claude Code installation inserted and `opus` as the departments' model. `implementer` stays `route`, so the program drives each department turn by turn and the department's own session holds every step it took. The route is not part of the spec digest, so both runs are the same program id over the same goals.

## Running it keyless

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/program-csv-tools.e2e.ts
```

The e2e is [`examples/headless-agent/tests/program-csv-tools.e2e.ts`](../../program-csv-tools.e2e.ts). It boots this composition over a temporary repository, asserts the ledger, the per-department certificates and caps, the directive the `join` department earned, the integration's three passing checks and the exact file list of the released tree, and then runs each of the three subcommands from the integration worktree.

## Running it for real

The real run is the same driver on the overlay, launched detached so it survives the shell it was started from. `$SCRATCHPAD` is any directory outside the repository; the driver creates the repository, the session store and its own output under the run directory.

```sh
REPO=/path/to/deepseek-harness
FIXTURE="$REPO/examples/headless-agent/tests/fixtures/program-csv-tools"
RUN="$SCRATCHPAD/2026-09-19-csv-tools-program"
mkdir -p "$RUN" && cd "$RUN"
DSH_TEST_PROGRAM_REPO="$RUN/repo" \
DSH_TEST_SESSION_ROOT="$RUN/.sessions" \
TSX_TSCONFIG_PATH="$REPO/tsconfig.json" \
  setsid nohup node --import "$REPO/node_modules/tsx/dist/esm/index.mjs" \
    "$FIXTURE/driver.ts" "$FIXTURE/overlays/claude-code.cordis.yml" \
    > "$RUN/stdout.jsonl" 2> "$RUN/stderr.txt" &
```

It needs the `claude` CLI installed and logged in, and no `DEEPSEEK_API_KEY`. While it runs, `$RUN/.sessions/` fills with one log per session — the ledger, the three departments and the integration — and the driver writes its single result line to `stdout.jsonl` when the program ends.

What the run leaves behind, with every session log at `$RUN/.sessions/<workspace-slug>/<session id>/session.jsonl` and the integration's key percent-escaped in its id:

| Artefact | Where | What it is |
| --- | --- | --- |
| the ledger | the `program-<digest>` session | `program/start`, one `program/goal` per status change, `program/integration`, `program/end`, and both signatures |
| the department logs | the `program-<digest>-{stats,filter,join}` sessions | every step the model took, the standard, the runs, the directives and the certificate |
| the verifier output | the `verification/run` events of `program-<digest>-~0040integration` | each check's verdict and its bounded evidence |
| the integrated tree | `$RUN/repo/program-<digest>/@integration` | the released worktree; `git -C "$RUN/repo" ls-tree -r --name-only <mergedRevision>` lists what it carries |
| the driver's report | `$RUN/stdout.jsonl` | the report, the ledgers, the member sessions, the barrier refusals and the released file list |

Record it under `data/proving-ground/` the way every other run is recorded, from the repository:

```sh
node data/proving-ground/tools/record-run.mjs "$RUN" 2026-09-19-csv-tools-program \
  --composition examples/headless-agent/tests/fixtures/program-csv-tools/overlays/claude-code.cordis.yml
```

That copies `stdout.jsonl` into `result.json`, copies every session log under `sessions/<session id>.jsonl`, and writes `manifest.json` with the repository head, the composition, the elapsed time folded from the logs and every file's SHA-256. It refuses to overwrite an existing record. Add a row to [the run table](../../../../../data/proving-ground/README.md) afterwards, and keep whatever the run exposed — a failed integration, a department that ran out of rounds — beside it rather than rerunning until it looks clean.
