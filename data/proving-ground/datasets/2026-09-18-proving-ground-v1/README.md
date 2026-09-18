# 2026-09-18-proving-ground-v1

English | [中文](README.zh.md)

Every recorded Proving Ground trajectory folded into one file a trainer reads: the 750 trajectories the 29 records under [`data/proving-ground/`](../../README.md) carry, filtered to the 521 that measure the harness's own model route. [`tools/build-dataset.mjs`](../../tools/build-dataset.mjs) writes it from those records and nothing else; the records themselves are never edited, and nothing in this directory is written by hand.

## Files

| File | What it holds |
|---|---|
| `train.jsonl` | 521 trajectories, ordered by record name then trajectory id |
| `heldout.jsonl` | The held-out environments' trajectories in the same format; always written, and empty unless the build is given `--include-held-out` |
| `manifest.json` | Name, build time, repository head, tool version, every source record with its manifest digest, the counts, the distributions of the written set, the token totals, and each written file's SHA-256 |

The two JSONL files are larger than this repository commits, so only `manifest.json` and this README pair are checked in; rebuild the rest with the command below and compare against the digests the manifest records. `train.jsonl` is 41 222 996 bytes at `f357ef8939b8a3296749d06969ab02aaf9db977ea0fc9bdea0af15c48aea3826`, and `heldout.jsonl` is empty, at the SHA-256 of no bytes.

Each line is the `dsh-trajectory/1` record [`@deepseek-ai/dsh-trajectories`](../../../../packages/improvement/trajectories/README.md) exported — `id`, `source`, `environment`, `config`, `system`, `tools`, `messages`, `steps`, `reward`, `parity`, `provenance` — with one field added:

```json
{ "dataset": { "record": "2026-09-08-bench-h1-harness-loop-t5", "tier": 5, "domain": "parsing", "arm": "fleet", "reward": { "value": 1, "basis": "certificate" } } }
```

`tier` and `domain` come from the environment's `task.json` under `examples/headless-agent/tests/fixtures/proving-ground-bench/environments/`; an environment absent from that catalog — a smoke task, a live-district task, or a session no runner stamped — gets `null` for both, which in this build is the 106 unstamped sessions. `arm` is the stamp group's role suffix (`baseline`, `candidate`), `fleet` for a fleet batch, and `-` for a session in no group.

## Reward

`reward.value` is the exported `reward.outcome` and `reward.basis` says what decided it. A certificate is the only basis that can carry a positive value: the verifier ran the standard the runner authored before the work started, and `1` means a certificate covers the current standard revision. The same basis carries `0` for a goal that had a standard and never earned one — a measured failure. `none` means the log holds no goal, so nothing was measured and the value is `null`. `tamper` means the last recorded run found the check-owned files changed, which voids the measurement whatever else the log says; such a trajectory never reaches either file.

This corpus carries two of the four bases: 367 rows at `1` and 48 at `0`, both on a certificate, and 106 at `null` on `none`. The 106 unmeasured rows are the sessions no runner stamped — 77 shift-ledger sessions with no model turn at all, and 29 child sessions that cells of the `2026-09-08-bench-e5-drop-candidate-t5` fleet spawned, each naming its parent in `source.parentSession` and carrying its own turns under no stamp. No row carries `tamper` or `uncertified-completion`.

`parity`, present on 240 rows, is the weighted pass rate of the last recorded run. It is an auxiliary signal only: a pass rate rewards a candidate that overfits the failing cases it was shown, so the certificate remains the reward.

## What is excluded

| Excluded | Rows | Why |
|---|---|---|
| Delegated cells | 203 | Their stamp names an implementer other than `route`, so an out-of-band coding agent did the work and the harness session holds the stamp, the standard, the delegation records and the certificate, but no model turn of its own. `--include-delegated` writes them anyway. |
| Duplicates | 26 | The same session exported by two records, or by one record once per slot. The first by record order wins. |
| Held-out environments | 0 | An environment reserved for evaluation never reaches `train.jsonl`, and without `--include-held-out` it reaches no file at all. The curator already withheld them upstream: `2026-09-08-bench-held-out-sonnet-all` ran eight held-out environments and exported an empty `trajectories.jsonl`, so no held-out trajectory exists in the corpus to withhold twice. |
| Tampered runs | 0 | A voided measurement is excluded unconditionally; there is no flag for it. |

## Counts

521 rows over 29 records: `route` is the implementer of all of them, on `claude-code/sonnet` (267), `claude-code/opus` (82), `claude-code/haiku` (66), and no route for the 106 unstamped sessions. By arm, 182 baseline, 116 candidate, 117 fleet, and 106 in no group. By tier, 240 at 5, 144 at 3, 18 at 4, 13 at 2, and 106 untiered. By domain, 149 data-structures-algorithms, 122 parsing, 48 state-machines, 48 systems, 32 text, 16 invariants, and 106 with none. The written trajectories report 11 212 842 output tokens, 37 606 uncached input, 123 640 519 cache-read and 54 853 114 cache-write, over the 6 966 of 6 967 steps that reported usage at all. `manifest.json` holds the per-environment and per-ladder distributions as well.

## Building it

```sh
node data/proving-ground/tools/build-dataset.mjs 2026-09-18-proving-ground-v1
node data/proving-ground/tools/build-dataset.mjs 2026-09-18-proving-ground-v1 --check
```

The build refuses to write anything while any trajectory carries a credential-shaped string or an address at a real mail domain, printing the record, the trajectory, the field, a digest of the match and an excerpt with the match replaced. There is no accept flag: a recorded run is never edited, so a hit is a record to re-export. This corpus produces no hit. The scan reads the credential patterns from [`collect-claude-code-session.mjs`](../../../transcripts/tools/collect-claude-code-session.mjs) and exempts addresses at the documentation domains RFC 2606 and RFC 6761 reserve and at the one-to-three-letter domains the URI and query-string environments feed their parsers; a real mailbox at a domain that short would pass.

`--check` rebuilds in memory, compares the digests and the counts with `manifest.json`, and exits 1 on any difference. It tolerates the two JSONL files being absent, which is how an uncommitted dataset stays verifiable.

## Data-use terms

The terms are the ones the sessions were pinned with at creation, read from their logs and from the compositions that produced them, not chosen here. Every session names client `daliesk-lab`, residency `eu-west`, 90-day retention and redaction profile `village-v1`, under one of three agreements: `proving-ground-bench` admits `evaluation` alone, and `village-live` and `village-claude-implementer` admit `delivery` and `evaluation`.

No agreement in this corpus admits `training`. Under [`@deepseek-ai/dsh-data-use`](../../../../packages/governance/data-use/README.md) a pin may narrow purposes and may never widen them, and [`@deepseek-ai/dsh-curator`](../../../../packages/governance/curator/README.md) withholds every session whose terms do not admit an export's purpose. This fold is therefore an evaluation record, not RLVR material: as [`data/README.md`](../../../README.md) states, nothing under `data/` is training data for the Daliesk model, whose corpus comes from certified runs on routes whose terms allow it. A training set built with this tool needs sessions pinned with `training` at creation.
