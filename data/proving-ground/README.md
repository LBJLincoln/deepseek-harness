# Proving Ground runs

English | [中文](README.zh.md)

Records of real Proving Ground runs: the district's certified measurements of one implementer on registered environments, kept exactly as the harness folded and exported them. A run directory is the output of one fleet plan: the cell session logs, the exported session facts, the curator-gated trajectory export, the observatory snapshot and page, the driver's report, and a manifest with every file's digest. Nothing in a run directory is edited after the run; the table below is read from those files.

## Layout

```
data/proving-ground/
  <date>-<implementer>-run-<n>/
    manifest.json        repository head, composition, implementer, session ids, per-file bytes and SHA-256
    result.json          the driver's report: fleet report, delegation records, export reports, observatory document
    facts.jsonl          scorekeeper facts, one per cell session
    trajectories.jsonl   curator-gated trajectory export, one per exported session
    observatory.json     the observatory snapshot the page was rendered from
    observatory.html     the rendered observatory page
    sessions/            the cell session logs, one JSONL file per cell, named by session id
```

## Running one

A run is a Loader-booted composition under `examples/headless-agent/tests/fixtures/` driven from an empty directory outside the repository; the driver creates the session store there and writes the exports next to it. The first run used the composition below, with the host's own Claude Code installation and account as the implementer of every cell:

```sh
mkdir -p /tmp/proving-ground-run && cd /tmp/proving-ground-run
REPO=/path/to/deepseek-harness
TSX_TSCONFIG_PATH=$REPO/tsconfig.json node --import $REPO/node_modules/tsx/dist/esm/index.mjs $REPO/examples/headless-agent/tests/fixtures/village-claude-implementer/driver.ts $REPO/examples/headless-agent/tests/fixtures/village-claude-implementer/cordis.yml > stdout.jsonl
```

Then record it, which copies the exports, every session log, and the driver's result into a new run directory, writes its `manifest.json` with the repository head, the composition, the implementers read from the run stamps, and every file's digest, and refuses to overwrite a recorded run; add a row below afterwards:

```sh
node data/proving-ground/tools/record-run.mjs /tmp/proving-ground-run 2026-09-06-claude-code-run-2 --composition examples/headless-agent/tests/fixtures/village-live/cordis.yml
```

A live district (`examples/headless-agent/tests/fixtures/village-live/`) is recorded the same way from the directory its driver runs in, one slot per run directory: the shift ledger session lands beside the cell sessions and `result.json` holds the driver's status.

## What a row proves

A delegated cell's certificate proves that the runner authored the standard before any work started, restored the immutable paths from the fixture over the tree the external agent left, found the check-owned set unchanged, and ran the checks itself. It proves nothing about how the work was done: the external agent's prompts, tool calls, and reasoning stay in its own product, so the cell session holds the stamp, the standard, the delegation records, the runs, and the certificate, and no assistant turn. The exported trajectory therefore carries no step. It is a measurement, not training data, and the `implementer` field on the stamp is what a curated export filters on. The [external implementer note](../../.agents/notes/proposed/architecture/2026-09-06-external-implementer.md) owns these rules.

## Runs

| Run | Head | Implementer | Environment | Certified | Attempts | Elapsed |
| --- | --- | --- | --- | --- | --- | --- |
| [2026-09-06-claude-code-run-1](2026-09-06-claude-code-run-1/manifest.json) | `0f67c1759` | `claude-code` | `smoke:round-trip` | yes | 1 | 351 s for both cells |
| [2026-09-06-claude-code-run-1](2026-09-06-claude-code-run-1/manifest.json) | `0f67c1759` | `claude-code` | `smoke:unsatisfiable` | no | 2 | 351 s for both cells |
| [2026-09-06-claude-code-run-2](2026-09-06-claude-code-run-2/manifest.json) | `88f6a1f2e` | `claude-code` | `code:slugify` | yes | 1 | 54 s for the slot |
| [2026-09-06-claude-code-run-2](2026-09-06-claude-code-run-2/manifest.json) | `88f6a1f2e` | `claude-code` | `code:parse-duration` | yes | 1 | 54 s for the slot |
| [2026-09-06-claude-code-run-2](2026-09-06-claude-code-run-2/manifest.json) | `88f6a1f2e` | `claude-code` | `code:paginate-fix` | yes | 1 | 54 s for the slot |
| [2026-09-07-claude-code-live-night](2026-09-07-claude-code-live-night/manifest.json) | `88f6a1f2e` to `38dd04165` | `claude-code` | `code:slugify` | 22 of 22 | 1 each | 22 slots, 45 to 90 s each |
| [2026-09-07-claude-code-live-night](2026-09-07-claude-code-live-night/manifest.json) | `88f6a1f2e` to `38dd04165` | `claude-code` | `code:parse-duration` | 22 of 22 | 1 each | 22 slots, 45 to 90 s each |
| [2026-09-07-claude-code-live-night](2026-09-07-claude-code-live-night/manifest.json) | `88f6a1f2e` to `38dd04165` | `claude-code` | `code:paginate-fix` | 22 of 22 | 1 each | 22 slots, 45 to 90 s each |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code` (product loop) | `code:csv-codec` | 2 of 2 | 1 each | 162 and 166 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code` (product loop) | `code:glob-match` | 2 of 2 | 1 each | 318 and 406 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code` (product loop) | `code:interval-ops` | 2 of 2 | 1 each | 59 and 63 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code` (product loop) | `code:path-normalize` | 2 of 2 | 1 each | 94 and 100 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code` (product loop) | `code:stable-sort-by` | 2 of 2 | 1 each | 91 and 100 s |
| [2026-09-07-bench-h1-product-loop-t2](2026-09-07-bench-h1-product-loop-t2/manifest.json) | `1a8ca5025` | `claude-code` (product loop) | `code:table-format` | 2 of 2 | 1 each | 184 and 189 s |

The fourth record is the Proving Ground bench's first fleet (`examples/headless-agent/tests/fixtures/proving-ground-bench/`, thirty admitted program tasks): the product's own loop as the implementer of every cell, over the six tier-2 environments that are not held out, two repetitions each, seed 1, policy `bench-2026-09-07`, district `bench-h1`, two cells at a time, 984 s of wall time for the twelve cells. Every cell was certified in one attempt, so tier 2 is a ceiling for this implementer and the paired comparisons between the harness loop and the product loop run on tiers 3 and 4. The cells name the model `sonnet`; the product ran the installation's default model, which was measured as sonnet immediately before the run, because the delegation did not yet forward the cell's model to the child (the slice that forwards it and records the child's reported model is queued). The bench composition and tasks are those of commit `128e037bb`; the manifest records the head of the working tree at recording time.

The third record is the same district left running overnight: 22 slots on its thirty-minute cadence from 22:16 to 09:16 UTC, including the first slot the second record holds. The host restarted once; the slot due at 00:16 was not caught up, exactly as the shift driver's cadence rule states, and the relaunched process resumed the same ledger and cadence from 00:46 on the working tree of that moment, so the slots before the restart ran the tree at `88f6a1f2e` and the slots after it the tree at `38dd04165`, which the manifest records as the head. Every one of the 66 cells was certified in one attempt; the record holds all 22 shift ledgers, the 66 cell sessions, and the exports folded over them.

The second run is the live district's first slot after two defects the district itself exposed were fixed: a test check this Node rejected, and a runner that overlaid the whole fixture before validation and so discarded every edit to a fixture-supplied source file. Three program tasks, each with an immutable test suite, were implemented by the product in one attempt each and certified by the runner on the trees it left; the held-out task never entered the plan.

The first run is the first time an agent other than the harness itself was measured by the Proving Ground: two smoke environments at `isolation: none`, one child run per attempt recorded as `environment/delegation`, every delegation ending `completed`, facts exported for both sessions, both trajectories exported through the curator with one rewarded, and the observatory publishing both rows under the `claude-code` implementer with `runner` as the certificate executor of the certified one.
