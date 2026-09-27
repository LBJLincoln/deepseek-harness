# Agent Note: The program workflow builds readme-rows, a tool for this repository

Status: implemented

English | [中文](2026-09-27-program-builds-readme-rows.zh.md)

## Problem

The program workflow had built software twice, both times standalone: [csv-tools](2026-09-19-program-workflow-builds-software.md), a command line from a specification, and the code-safety report over a target tree. It had never delivered a change to this repository, and the csv-tools note deferred exactly that case: the repository is the one to try once a standalone deliverable has a recorded verdict. A change to the repository is the case the workflow exists for, and it is also the case where the harness's own conventions stop being a reading exercise: the deliverable lands in the tree that carries the gates, the records and the documentation it has to fit.

Independently, [`data/proving-ground/README.md`](../../../../data/proving-ground/README.md) and its Chinese counterpart carry one row per environment of every recorded run: 12 to 62 rows per record, each written by hand from numbers a person reads out of `summarize-run.mjs` and the facts, in two languages with different list forms (`1 each` and `各 1`, `a and b` and `a、b`, `… s vs … s` and `… s 对 … s`). The rows are mechanical, the input is durable, and the committed rows of any three records define the format exactly.

## Decision

[`examples/headless-agent/tests/fixtures/program-readme-rows/`](../../../../examples/headless-agent/tests/fixtures/program-readme-rows/README.md) is a program with one department, `readme-rows`, whose deliverable is `data/proving-ground/tools/readme-rows.mjs` — `node data/proving-ground/tools/readme-rows.mjs <record dir> --lang en|zh --implementer "<column text>"` prints the record's rows from `manifest.json`, `result.json` and `facts.jsonl` — and `readme-rows.test.mjs` beside it. The department reads `TASK.md` at the root of its worktree first, and is certified on its own test, on five golden checks, and on `test ! -e node_modules`. Each golden is one shell line, `diff <(node … readme-rows.mjs <record> --lang <lang> --implementer '<the record's column>') <(grep -F '| [<record>]' <README>)`: the English and Chinese rows of `2026-09-26-bench-completion-hidden-pair` (a fleet of two models, one row per model and environment), the English rows of `2026-09-26-bench-completion-t6-haiku` (a fleet of 26 environments), and both languages of `2026-09-27-bench-e12-self-review-sonnet-t5t6` (a frozen pair, one row per environment with `baseline vs candidate` cells). The integration repeats the test and the goldens over the merged head and gates `test -z "$(git status --porcelain)"` and the no-dependencies rule.

The committed rows are the examiner, not the test the department writes. The rows and the records are in the base commit, the department may not change them, and a certificate means the tool reproduced 50 committed rows byte for byte in two languages. The department's own test is required so the deliverable carries one, but it decides nothing the goldens do not.

The Implementer column is hand-written prose per record — `sealed, completion family`, `+review (a self-review turn before the validation)` — so it is passed in as `--implementer`, and `{model}` in it stands for the row's model, which is how a fleet of several models gets one row per model and environment from one column text. That placeholder is part of the command-line contract the checks pin, so `TASK.md` states it.

The seed mirrors the repository's layout. `seed/` holds `TASK.md`, `data/proving-ground/tools/summarize-run.mjs`, the three records reduced to `manifest.json`, `result.json`, `facts.jsonl` and `observatory.json`, and `data/proving-ground/README.md` and `README.zh.md` holding only those records' committed rows, copied verbatim. Because the paths are the repository's own, one spec runs unchanged over the minted seed and over a clone of this repository, and the keyless and the real run are one program id, as they are for csv-tools. The pairing gate would have read the seed's README pair as documentation; a directory exclusion of `seed/` is now a corpus boundary — nothing beneath it is read — where a file exclusion still rejects a `.zh.md` beside it ([the gate](../../../../docs/i18n/README.md#the-gate-verify-translation-pairing)).

The task statement is a file the department reads, as `SPEC.md` is for csv-tools, rather than only the objective paragraph delivered as a user turn: it carries the check commands themselves, so the department can run what it is measured by. For the real run the operator prepares the clone the way the driver prepares the seed — copies `seed/TASK.md` to the clone's root, commits it, tags that commit `base` — and the driver refuses a clone that carries no `TASK.md` at `base`. After the merged revision is merged into the branch, the repository root drops `TASK.md` again: the statement lives in the fixture's seed and in the frozen spec of the ledger, and a root-level task file of a finished program is neither.

The real run is the same driver on `overlays/claude-code.cordis.yml` — the scripted route disabled, the operator's Claude Code installation inserted, `sonnet` as the department's model — over a clone of this repository's branch. Its merged revision is fetched from the clone and merged with `git merge --no-ff`, so the department's commit and the integration's merge land as themselves, and the run is recorded under [`data/proving-ground/2026-09-27-readme-rows-program/`](../../../../data/proving-ground/README.md) with the ledger, the department log and the integration log.

The verification domain's `maxTextChars` and the program's `evidenceMaxChars` are 4096 here, against csv-tools' 2048 and 512: a failing golden's evidence is a `diff` over rows of a hundred and more characters, and that evidence is the only instruction the department gets between attempts, so the bound carries several rows of it whole. Budget and round cap are csv-tools': 2,000,000 tokens and 1,500 s per department session, three rounds.

## Alternatives considered

**Grep a README at the root of the worktree.** The seed could hold the golden rows as a root `README.md`, and the checks would read `README.md`. That spec cannot run over a clone of the repository, whose rows live in `data/proving-ground/README.md`, and two specs are two program ids. The seed mirrors the repository instead, and the checks read the path the tool exists for.

**Have the tool compose the Implementer column.** Only the model varies mechanically between the rows of one record; the rest — `sealed, completion family`, the description of a self-review rung — is prose a person writes once per record. A tool that composed it would carry every record's wording; a placeholder for the one mechanical part keeps the column the operator's.

**State the task in the objective alone.** The objective is one paragraph delivered as a user turn, and the department cannot re-read it; the statement with its seven check commands is a document. The cost is the prepared clone: `TASK.md` has to exist at `base`, which is one commit the operator makes before the run and drops after the merge.

**Keep `TASK.md` at the repository root after the merge.** It is a file with no pair and no reader once the program has released; the frozen spec in the ledger and the seed hold the same text.

**Rename the seed's golden files to keep them out of the pairing gate.** The tool's contract is the README pair's names, and the checks `grep` them; renamed goldens would make the seed a different repository from the one the tool serves. The gate learned the difference between a file it keeps single-language and a directory outside its corpus.

**Cherry-pick the department's commit onto the branch.** A cherry-pick rewrites the commit and loses the integration's merge, which is what the certificate names. Fetching the integration branch and merging it with `--no-ff` keeps the certified revision, the merged revision and the operator's merge as three distinct, verifiable commits.

**Run the department on the largest product model.** csv-tools ran on `opus`; this program asks whether the workflow delivers into the repository, not where the model's ceiling is, and the middle model is the bench's reference model.

**Add a snapshot scenario.** The only model-visible text this workflow authors is the objective and the validator's directive; the e2e asserts the certificate, the trailer lines and the delivered rows from the durable log and the merged tree, and the driver prints one JSON report rather than a session-event stream ([csv-tools note](2026-09-19-program-workflow-builds-software.md#alternatives-considered)).

## Consequences

The keyless e2e proves the wiring in about ten seconds: the spec freezes, the department is staffed, budgeted and certified over a committed tree whose commit ends with the two trailer lines, the branch merges, every seed file is unchanged in the merged tree, the merged tree is the seed plus exactly the two delivered files, and the delivered tool prints the 50 committed rows from the integration worktree. The scripted route replays the reference solution committed under `scripted/`, which is what shows the spec is satisfiable before a model is asked.

What the real run proves is what a route certificate proves ([program README](../../../../packages/improvement/program/README.md#the-two-implementers)): the program ran the checks through the shell executor, in the department worktree, on the tree the department committed, and recorded the run and the certificate in the department's own session, which on the `route` implementer also holds every step the model took. The department's transcript is in the record. The operator wrote the spec and the task statement, prepared the clone, merged the branch, wrote the record's paragraphs and ran the repository's gates after the merge; the department ran none of them, because its standard is the goldens, its test and the no-dependencies rule.

What it does not prove: nothing about a model's capability. The committed rows are in the repository the model was pointed at, the task is small, and it is one run. A department that had read `summarize-run.mjs` and the rows had everything it needed; the claim is that the workflow can take a task statement and committed expected output and return a commit that reproduces it, in a clone of this repository, under its own certificate.

The tool prints bench records only: a fleet or a frozen pair, from facts. A program record such as this run's own has no facts and its row stays hand-written, and a pair an arm never ran is refused rather than guessed.

The pairing gate's exclusions now mean two things: a file entry keeps that document single-language and rejects a translation beside it; a directory entry, with its trailing `/`, puts everything beneath it outside the corpus.

## Verification

- `pnpm exec vitest run --config vitest.e2e.config.ts examples/headless-agent/tests/program-readme-rows.e2e.ts` releases the program on the scripted route and checks the certificate, the trailers, the unchanged seed, the deliverable and the five goldens from the merged tree.
- `pnpm exec vitest run scripts/translation-pairing.spec.ts` proves a directory exclusion covers what lies beneath it and a file exclusion covers one document; `pnpm run verify-translation-pairing` runs the gate over the corpus with the seed excluded.
- `npx tsc --noEmit -p tsconfig.host.json`, `pnpm run lint`, `pnpm run verify-agent-note-format` and `pnpm run doc-sync` cover the fixture, the e2e and this note.
- The real run's certificate, attempts, steps, seconds and merged revision are stated in the record's paragraph of [`data/proving-ground/README.md`](../../../../data/proving-ground/README.md) and read back from `data/proving-ground/2026-09-27-readme-rows-program/`.
