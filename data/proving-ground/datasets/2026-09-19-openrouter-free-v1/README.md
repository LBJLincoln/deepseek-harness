# 2026-09-19-openrouter-free-v1

English | [中文](README.zh.md)

The first Proving Ground dataset built for `training`: the 4 trajectories whose own data-use terms admit that purpose, out of the 834 the 34 records under [`data/proving-ground/`](../../README.md) carry. [`tools/build-dataset.mjs`](../../tools/build-dataset.mjs) writes it from those records and nothing else; the records themselves are never edited, and nothing in this directory is written by hand.

Every admitted line comes from the two 2026-09-19 fleets on the `with-openrouter` overlay, the one route whose agreement admits training. Two of the four lines only became admissible when [`tools/reexport-trajectories.mjs`](../../tools/reexport-trajectories.mjs) re-folded `2026-09-19-bench-h1-openrouter-smoke-t2`: that record was exported by a build that predated the `terms` field, so its lines stated no terms and were withheld although its sessions were pinned under the same agreement as the rest.

## Files

| File | What it holds |
|---|---|
| `train.jsonl` | 4 trajectories, ordered by record name then trajectory id |
| `heldout.jsonl` | The held-out environments' trajectories in the same format; always written, and empty unless the build is given `--include-held-out` |
| `manifest.json` | Name, build time, repository head, tool version, the purpose it was filtered for, every source record with its manifest digest, the counts, the distributions of the written set, the token totals, and each written file's SHA-256 |

Only `manifest.json` and this README pair are checked in, as for [the evaluation fold](../2026-09-18-proving-ground-v1/README.md); rebuild the rest with the command below and compare against the digests the manifest records. `train.jsonl` is 1 251 247 bytes at `df3c99702a45690a1ab0ecb91ff6ba3ce9787f3815f094aa349f64f312a5729c`, and `heldout.jsonl` is empty, at the SHA-256 of no bytes.

Each line is a record [`@deepseek-ai/dsh-trajectories`](../../../../packages/improvement/trajectories/README.md) exported, `dsh-trajectory/2` throughout — `id`, `source`, `terms`, `environment`, `config`, `system`, `tools`, `messages`, `steps`, `reward`, `provenance` — with one field added:

```json
{ "dataset": { "record": "2026-09-19-bench-h1-fleet-openrouter-nex-smoke-t2", "tier": 2, "domain": "parsing", "arm": "fleet", "reward": { "value": 1, "basis": "certificate" } } }
```

`tier` and `domain` come from the environment's `task.json` under `examples/headless-agent/tests/fixtures/proving-ground-bench/environments/`; every line here is stamped with a catalogued environment, so neither is `null` in this build. `arm` is the stamp group's role suffix (`baseline`, `candidate`), `fleet` for a fleet batch, and `-` for a session in no group; all four lines are fleet cells.

## Reward

`reward.value` is the exported `reward.outcome` and `reward.basis` says what decided it. A certificate is the only basis that can carry a positive value: the verifier ran the standard the runner authored before the work started, and `1` means a certificate covers the current standard revision. The same basis carries `0` for a goal that had a standard and never earned one — a measured failure. `none` means the log holds no goal, so nothing was measured and the value is `null`. `tamper` means the last recorded run found the check-owned files changed, which voids the measurement whatever else the log says; such a trajectory never reaches either file.

Both bases here are `certificate`: 2 rows at `1`, the `nex-agi/nex-n2.5-pro:free` cells that certified at their first attempt, and 2 at `0`, the `deepseek/deepseek-v4-flash-0731:free` cells that spent three attempts each and never wrote a file. No row carries `none`, `tamper`, or `uncertified-completion`, and no row carries `parity`, because no run of these four cells measured cases.

## What the filter withheld

| Withheld | Rows | Why |
|---|---|---|
| Terms that do not admit `training` | 804 | Every record produced on the operator's Claude Code subscription, under agreements that admit `evaluation` and `delivery` only, plus the `dsh-trajectory/1` lines that state no terms at all. |
| Duplicates | 26 | The same session exported by two records, or by one record once per slot. The first by record order wins. |
| Delegated cells | 0 | No cell of either source fleet was delegated; both ran on the harness's own loop. |
| Held-out environments | 0 | An environment reserved for evaluation never reaches `train.jsonl`, and without `--include-held-out` it reaches no file at all. Neither source fleet ran one. |
| Tampered runs | 0 | A voided measurement is excluded unconditionally; there is no flag for it. |

The 804 withheld by terms are what the purpose gate is for, and they are not a defect to repair: a record's terms are the ones its session was pinned with at creation and may never be widened afterwards. One record in that count was a defect, and is no longer: `2026-09-19-bench-h1-openrouter-smoke-t2` was exported before `foldTrajectory` wrote `terms`, so its two lines were withheld for stating no terms while their session logs carried `dataUse/terms` admitting `training`. Re-exporting the record put the terms its sessions always had onto the lines. What remains withheld remains withheld on its own terms, and the two partial records of the same route — `2026-09-19-bench-h2-openrouter-free-t2-partial` and `2026-09-19-bench-h1-openrouter-deepseek-t2-partial` — contribute nothing either way: their drivers were stopped before they exported, so those records hold session logs and no `trajectories.jsonl`, and a re-export replaces an export rather than creating one.

## Counts

4 rows over 2 of the 34 records: `route` is the implementer of both fleets, on `openrouter/nex-agi/nex-n2.5-pro:free` (2) and `openrouter/deepseek/deepseek-v4-flash-0731:free` (2), each model's ladder naming itself alone. All four are fleet cells at tier 2, two on `code:glob-match` (domain `parsing`) and two on `code:path-normalize` (domain `systems`). The written trajectories report 162 911 output tokens, 930 808 uncached input and 2 818 401 cache-read, and no cache write, over all 121 of their 121 steps. `manifest.json` holds the per-environment and per-ladder distributions as well.

## Building it

```sh
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training
node data/proving-ground/tools/build-dataset.mjs 2026-09-19-openrouter-free-v1 --purpose training --check
```

`--check` does not read the purpose the manifest records: it rebuilds from the flags it is given, so the check must repeat `--purpose training` or it compares an unfiltered rebuild against this manifest and reports drift on every digest and on the counts.

The build refuses to write anything while any trajectory carries a credential-shaped string or an address at a real mail domain, printing the record, the trajectory, the field, a digest of the match and an excerpt with the match replaced. There is no accept flag: a recorded run is never edited, so a hit is a record to re-export, which [`tools/reexport-trajectories.mjs`](../../tools/reexport-trajectories.mjs) does from the record's own session logs. This corpus produces no hit.

## Data-use terms

All four sessions were pinned at creation under agreement `proving-ground-openrouter-free`, which admits `training` and `evaluation`, with client `daliesk-lab`, residency `eu-west`, 90-day retention and redaction profile `village-v1`. The record carries the agreement and the purposes only; retention, residency, and the client stay in the session log, because no admission decision reads them.

Under [`@deepseek-ai/dsh-data-use`](../../../../packages/governance/data-use/README.md) a pin may narrow purposes and may never widen them, and [`@deepseek-ai/dsh-curator`](../../../../packages/governance/curator/README.md) withholds every session whose terms do not admit an export's purpose. This fold is therefore the first RLVR-admissible corpus this repository holds, and it is four cells wide: two certified, two measured failures. As [`data/README.md`](../../../README.md) states, the Daliesk model's corpus comes from certified runs on routes whose terms allow it, and this dataset grows only as more such runs are recorded.
