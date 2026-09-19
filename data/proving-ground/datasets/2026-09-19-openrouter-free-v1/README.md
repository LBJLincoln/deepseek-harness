# 2026-09-19-openrouter-free-v1

English | [中文](README.zh.md)

The first dataset built under a purpose filter: every recorded Proving Ground trajectory whose data-use terms admit `training`, which after the day's re-exports is 22 trajectories from three records on OpenRouter's free tier — the smoke fleet, the loop's first iteration, and the agentic fleet ([README](../../README.md)) — 18 of them certified and 4 measured failures, on four free open-weight models over the six non-held-out tier-2 environments. [`tools/build-dataset.mjs`](../../tools/build-dataset.mjs) wrote it with `--purpose training`; the records themselves are never edited by hand, and nothing in this directory is written by hand.

## Files

| File | What it holds |
|---|---|
| `train.jsonl` | 22 trajectories, ordered by record name then trajectory id |
| `heldout.jsonl` | Empty: no held-out environment ran under terms that admit training |
| `manifest.json` | Name, build time, repository head, tool version, the purpose filter, every source record with its manifest digest, the counts, the distributions of the written set, the token totals, and each written file's SHA-256 |

Only `manifest.json` and this README pair are checked in; rebuild the rest with the command below and compare against the digests the manifest records. `train.jsonl` is 4 401 829 bytes at `44a78795f43792c40f32c243615b9cae2473023f679626983fd509360ee7b988`, and `heldout.jsonl` is empty, at the SHA-256 of no bytes.

## What the filter admitted and withheld

The build saw 852 trajectories across 35 exported records and withheld 804 by terms, with 26 more dropped as duplicates. Every subscription record is pinned to evaluation only, so the filter withholds all of it by design. Two of the three admitted records had been exported by a build that predates the trajectory record's `terms` field and were re-exported for it by [`tools/reexport-trajectories.mjs`](../../tools/reexport-trajectories.mjs), which re-folds a record's own session logs with the current fold and keeps both digests in the record's manifest; the route's two partial records hold session logs and no export, so a re-export has nothing in them to replace and nothing of theirs is admitted. The 22 lines are `nex-agi/nex-n2.5-pro:free` (8, all certified), `poolside/laguna-s-2.1:free` (6, all certified), `nvidia/nemotron-3-super-120b-a12b:free` (6, 4 certified), and `deepseek/deepseek-v4-flash-0731:free` (2, neither certified): a corpus of one tier and one afternoon, with every reward a certificate the runner issued or refused.

## Rebuild

```sh
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training --check
```

`--check` rebuilds from the flags it is given, so the purpose is repeated.
