# readme-rows: the program builds a tool for this repository

English | [中文](README.zh.md)

A [program](../../../../../packages/improvement/program/README.md) whose deliverable is a change to this repository: one department, on its own branch and session, writes `data/proving-ground/tools/readme-rows.mjs` — the tool that prints the `## Runs` rows of [`data/proving-ground/README.md`](../../../../../data/proving-ground/README.md) for one recorded run — and an integration certifies the merged head against rows committed before the department started. The [csv-tools program](../program-csv-tools/README.md) builds a standalone command line from a specification; this one points the workflow at the repository itself; its first real run is recorded under [`data/proving-ground/`](../../../../../data/proving-ground/README.md), and the [Agent Note](../../../../../.agents/notes/implemented/process/2026-09-27-program-builds-readme-rows.md) records what it proved and exposed.

## What it delivers

The `## Runs` table of `data/proving-ground/README.md` and its Chinese counterpart carries one row per environment of every recorded run — 12 to 62 rows per record, written by hand. `readme-rows.mjs` prints them from the record's own durable files (`manifest.json`, `result.json`, `facts.jsonl`):

```sh
node data/proving-ground/tools/readme-rows.mjs <record dir> --lang en|zh --implementer "<implementer column text>"
```

A fleet record prints one row per model and environment; a frozen-pair record prints one row per environment with `baseline vs candidate` cells. The Implementer column is hand-written prose per record, so it is passed in, with `{model}` standing for the row's model. [`seed/TASK.md`](seed/TASK.md) is the whole task statement and is what the department reads first.

The repository the program delivers into is `seed/`, committed and tagged `base` by the driver — or, for the real run, a clone of this repository prepared the same way: the task statement, `data/proving-ground/tools/summarize-run.mjs`, three records reduced to their durable files, and `data/proving-ground/README.md` and `README.zh.md` holding only those records' committed rows.

| Department | Delivers | Measured by |
| --- | --- | --- |
| `readme-rows` | `data/proving-ground/tools/readme-rows.mjs` and `readme-rows.test.mjs` | the test, five golden diffs, `test ! -e node_modules` |
| integration | nothing; it merges | the test and the five goldens again, then two gates |

The five goldens diff the tool's rows against the committed ones: `2026-09-26-bench-completion-hidden-pair` in both languages (a fleet of two models, so one row per model and environment), `2026-09-26-bench-completion-t6-haiku` in English (a fleet of 26 environments), and `2026-09-27-bench-e12-self-review-sonnet-t5t6` in both languages (a frozen pair, one row per environment). Each is one shell line — `diff <(node … readme-rows.mjs <record> --lang <lang> --implementer '<the record's column>') <(grep -F '| [<record>]' <README>)` — and passes exactly when `diff` prints nothing.

## What certifies a release

The three rules of the [csv-tools program](../program-csv-tools/README.md#what-certifies-a-release) hold here unchanged. The rows and the records are in the base commit and the department may not change them, so the examiner is committed before the work starts and re-run by the integration over the merged head; a department is measured only over a clean worktree, so an uncommitted tool is not delivered; and the ledger states the commit and `HEAD^{tree}` the certificate covers, which the integration merges only while the branch still points there. The integration session runs denied the program's whole worktrees root, and `program/integration` records what was denied.

What a route certificate proves is stated in the [program README](../../../../../packages/improvement/program/README.md#the-two-implementers): the program ran the goal's checks, through the shell executor, in the department worktree, on the tree the department committed, and recorded the run and the certificate in the department's own session. On the `route` implementer that session also holds every step the model took, so how the tool was written is in the record beside the certificate.

## The two compositions

[`cordis.yml`](cordis.yml) is the keyless half: the department runs on the `cli-mock` route registered by [`readme-rows-llm.ts`](readme-rows-llm.ts), which reads the task statement, writes the tool and the test committed under [`scripted/`](scripted/data/proving-ground/tools) and commits them with the two trailer lines the objective requires. It proves the wiring — the spec freezes, the department is staffed and certified over a committed tree, the branch merges and the committed rows decide the release — and nothing about what a model can build. The scripted files are also the reference solution: they pass every check of the spec, which is what shows the spec is satisfiable.

[`overlays/claude-code.cordis.yml`](overlays/claude-code.cordis.yml) is the real one: the same file with the scripted route disabled, the operator's Claude Code installation inserted and `sonnet` as the department's model. `implementer` stays `route`, so the program drives the department turn by turn and the department's own session holds every step it took. The route is not part of the spec digest, so both runs are the same program id over the same goal.

## Running it keyless

```sh
pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/program-readme-rows.e2e.ts
```

The e2e is [`examples/headless-agent/tests/program-readme-rows.e2e.ts`](../../program-readme-rows.e2e.ts). It boots this composition over a temporary repository minted from `seed/`, asserts the ledger, the department's certificate, caps and trailer lines, the integration's checks and gates, that every seed file is unchanged in the merged tree and that the merged tree is the seed plus exactly the two delivered files; then it runs the delivered tool from the integration worktree over each golden and compares its rows with the committed ones.

## Running it for real

The real run is the same driver on the overlay, over a clone of this repository, launched detached so it survives the shell it was started from. `$SCRATCHPAD` is any directory outside the repository. The clone is prepared the way the driver prepares `seed/` — the task statement committed at its head and that commit tagged `base` — because the department reads `TASK.md` first and the program cuts its worktree from the tag; the driver refuses a clone prepared otherwise.

```sh
REPO=/path/to/deepseek-harness
FIXTURE="$REPO/examples/headless-agent/tests/fixtures/program-readme-rows"
RUN="$SCRATCHPAD/2026-09-27-readme-rows-program"
mkdir -p "$RUN"
git clone --quiet --branch "$(git -C "$REPO" branch --show-current)" "$REPO" "$RUN/repo"
cp "$FIXTURE/seed/TASK.md" "$RUN/repo/TASK.md"
git -C "$RUN/repo" add TASK.md
git -C "$RUN/repo" commit -qm 'readme-rows: the task statement the program department reads'
git -C "$RUN/repo" tag base
cd "$RUN"
DSH_TEST_PROGRAM_REPO="$RUN/repo" \
DSH_TEST_SESSION_ROOT="$RUN/.sessions" \
TSX_TSCONFIG_PATH="$REPO/tsconfig.json" \
  setsid nohup node --import "$REPO/node_modules/tsx/dist/esm/index.mjs" \
    "$FIXTURE/driver.ts" "$FIXTURE/overlays/claude-code.cordis.yml" \
    > "$RUN/stdout.jsonl" 2> "$RUN/stderr.txt" &
```

It needs the `claude` CLI installed and logged in, and no `DEEPSEEK_API_KEY`. While it runs, `$RUN/.sessions/` fills with one log per session — the ledger, the department and the integration — and the driver writes its single result line to `stdout.jsonl` when the program ends. On this route the product query runs in the department's own worktree, the directory its session was created with, and the product states that directory to its model; the harness names none in this composition's prompt ([the route's README](../../../../../packages/llm/llm-claude-code/README.md#how-a-request-is-rendered)).

What the run leaves behind, with every session log at `$RUN/.sessions/<workspace-slug>/<session id>/session.jsonl` and the integration's key percent-escaped in its id:

| Artefact | Where | What it is |
| --- | --- | --- |
| the ledger | the `program-<digest>` session | `program/start`, one `program/goal` per status change, `program/integration`, `program/end`, and both signatures |
| the department log | the `program-<digest>-readme-rows` session | every step the model took, the standard, the runs, the directives and the certificate |
| the verifier output | the `verification/run` events of `program-<digest>-~0040integration` | each check's verdict and its bounded evidence |
| the integrated tree | `$RUN/repo/program-<digest>/@integration` | the released worktree; `git -C "$RUN/repo" ls-tree -r --name-only <mergedRevision>` lists what it carries |
| the driver's report | `$RUN/stdout.jsonl` | the report, the ledger, the member sessions, the barrier refusals and the released file list |

The merged revision is a commit of the clone, so it lands in the repository by being fetched and merged, which keeps the department's commit its own; the operator's merge commit is what states that the program built it:

```sh
git fetch "$RUN/repo" 'program/<programId>/@integration'
git merge --no-ff FETCH_HEAD
```

Record the run under `data/proving-ground/` the way every other run is recorded, from the repository:

```sh
node data/proving-ground/tools/record-run.mjs "$RUN" 2026-09-27-readme-rows-program \
  --composition examples/headless-agent/tests/fixtures/program-readme-rows/overlays/claude-code.cordis.yml
```

That copies `stdout.jsonl` into `result.json`, copies every session log under `sessions/<session id>.jsonl`, and writes `manifest.json` with the repository head, the composition, the elapsed time folded from the logs and every file's SHA-256. It refuses to overwrite an existing record. Add the record's row and paragraph to [the run table](../../../../../data/proving-ground/README.md) afterwards, and keep whatever the run exposed — a failed golden, a department that ran out of rounds — beside it rather than rerunning until it looks clean.
