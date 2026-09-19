# 2026-09-19-openrouter-free-v1

English | [中文](README.zh.md)

The first dataset built under a purpose filter: every recorded Proving Ground trajectory whose data-use terms admit `training`, which on the day of the build is the 2 trajectories of [`2026-09-19-bench-h1-fleet-openrouter-nex-smoke-t2`](../../README.md), the loop's first iteration on OpenRouter's free tier. [`tools/build-dataset.mjs`](../../tools/build-dataset.mjs) wrote it with `--purpose training`; the records themselves are never edited, and nothing in this directory is written by hand.

## Files

| File | What it holds |
|---|---|
| `train.jsonl` | 2 trajectories, ordered by record name then trajectory id |
| `heldout.jsonl` | Empty: no held-out environment ran under terms that admit training |
| `manifest.json` | Name, build time, repository head, tool version, the purpose filter, every source record with its manifest digest, the counts, the distributions of the written set, the token totals, and each written file's SHA-256 |

Only `manifest.json` and this README pair are checked in; rebuild the rest with the command below and compare against the digests the manifest records. `train.jsonl` is 636 472 bytes at `47122a0fcf78e871c5b89dce755aef9199d9a03d939376810940887c83b74e1c`, and `heldout.jsonl` is empty, at the SHA-256 of no bytes.

## What the filter withheld

The build saw 852 trajectories across every record and withheld 824 by terms, with 26 more dropped as duplicates. Every subscription record is pinned to evaluation only, so the filter withholds all of it by design. The other OpenRouter records of the day — the smoke fleet, the stopped first launch, the DeepSeek rerun, and the agentic fleet with its 16 certificates — were exported by a build that predates the trajectory record's `terms` field, so their `dsh-trajectory/1` lines state no purpose and are withheld, although every one of their sessions carries a `dataUse/terms` event naming `training`. A re-export of those records by the current tool admits them; until then this dataset is two certified trajectories of one model on two tier-2 tasks, a proof of the path rather than a corpus.

## Rebuild

```sh
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training
```
