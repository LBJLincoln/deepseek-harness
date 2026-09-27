# readme-rows: print the README rows of one recorded run

Deliver `data/proving-ground/tools/readme-rows.mjs` and its test `data/proving-ground/tools/readme-rows.test.mjs`, then commit both.

## What the tool does

`data/proving-ground/README.md` and `data/proving-ground/README.zh.md` carry a `## Runs` table with one row per environment of every recorded run: 12 to 62 rows per record, each written by hand until now. The tool prints those rows for one record, so a person no longer writes them:

```sh
node data/proving-ground/tools/readme-rows.mjs <record dir> --lang en|zh --implementer "<implementer column text>"
```

It reads only the record's own durable files and prints one Markdown table row per line to stdout: `manifest.json` (the run name and the repository head), `result.json` (a fleet run carries `report`; a frozen pair carries `result.arms`), and `facts.jsonl` (one fact per cell: `identity.environment` with `environmentId`, `model`, `repetition` and `group`, `outcome.certified` and `outcome.attempts`, `efficiency.wallMs`). `data/proving-ground/tools/summarize-run.mjs` already reads a record per cell; reuse what helps, for instance its exported `armOf`, which names a cell's arm from its group.

## The rows it must reproduce

The row format is defined by the committed rows of the three records under `data/proving-ground/`, and the tool must reproduce them byte for byte:

- `2026-09-26-bench-completion-hidden-pair` and `2026-09-26-bench-completion-t6-haiku` are fleet records: one row per model and environment, sorted by environment then model; the first nine characters of `manifest.json`'s `repository.head`; `X of N` (`X 之 N`) certified; the attempts; the wall seconds of the cell, rounded, as `… s`.
- `2026-09-27-bench-e12-self-review-sonnet-t5t6` is a frozen-pair record: one row per environment, each cell stating the baseline arm, then ` vs ` (` 对 `), then the candidate arm over its two repetitions in repetition order: `2 of 2 vs 2 of 2`, `1 each vs 1 each` (`各 1 对 各 1`), `265 and 202 s vs 372 and 429 s` (`265、202 s 对 372、429 s`).

The Implementer column is hand-written prose per record and is passed in as `--implementer`, printed verbatim, except that `{model}` in it is replaced by the row's model id: that is how a fleet of several models gets one row per model.

Your work is measured by these commands, run from the root of this worktree over a clean, committed tree; each must exit 0:

```sh
node --test data/proving-ground/tools/readme-rows.test.mjs
diff <(node data/proving-ground/tools/readme-rows.mjs data/proving-ground/2026-09-26-bench-completion-hidden-pair --lang en --implementer '`route` (harness loop on `claude-code`/`{model}`), sealed, completion family') <(grep -F '| [2026-09-26-bench-completion-hidden-pair]' data/proving-ground/README.md)
diff <(node data/proving-ground/tools/readme-rows.mjs data/proving-ground/2026-09-26-bench-completion-hidden-pair --lang zh --implementer '`route`（harness 循环，走 `claude-code`/`{model}`），密封，补全任务族') <(grep -F '| [2026-09-26-bench-completion-hidden-pair]' data/proving-ground/README.zh.md)
diff <(node data/proving-ground/tools/readme-rows.mjs data/proving-ground/2026-09-26-bench-completion-t6-haiku --lang en --implementer '`route` (harness loop on `claude-code`/`{model}`), sealed, completion family') <(grep -F '| [2026-09-26-bench-completion-t6-haiku]' data/proving-ground/README.md)
diff <(node data/proving-ground/tools/readme-rows.mjs data/proving-ground/2026-09-27-bench-e12-self-review-sonnet-t5t6 --lang en --implementer '`route`, `sonnet` on one rung vs `sonnet` on one rung `+review` (a self-review turn before the validation), sealed') <(grep -F '| [2026-09-27-bench-e12-self-review-sonnet-t5t6]' data/proving-ground/README.md)
diff <(node data/proving-ground/tools/readme-rows.mjs data/proving-ground/2026-09-27-bench-e12-self-review-sonnet-t5t6 --lang zh --implementer '`route`，`sonnet` 单级梯 对 `sonnet` 单级梯 `+review`（验证前的一个自审回合），密封') <(grep -F '| [2026-09-27-bench-e12-self-review-sonnet-t5t6]' data/proving-ground/README.zh.md)
test ! -e node_modules
```

## Rules

- Node built-ins only, under the Node that runs the checks. Install nothing: no `package.json`, no `node_modules`, no dependency of any kind.
- Write the test with `node:test` and `node:assert`. It must exercise the row forms on records it builds itself: a fleet of one repetition, a fleet of several repetitions, a frozen pair, both languages.
- Change nothing else: not the records, not the README pair, not `summarize-run.mjs`.
- Commit everything before you stop. Your work is measured over a clean worktree, and a file no commit carries is not delivered.
- End every commit message with exactly these two trailer lines:

```text
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HEXjzxR7CyMizem5kFAB4C
```
