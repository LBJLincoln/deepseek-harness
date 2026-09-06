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

Copy the exports, the session logs, and the last stdout line (as `result.json`) into a new run directory, write its `manifest.json`, and add a row below.

## What a row proves

A delegated cell's certificate proves that the runner authored the standard before any work started, restored the immutable paths from the fixture over the tree the external agent left, found the check-owned set unchanged, and ran the checks itself. It proves nothing about how the work was done: the external agent's prompts, tool calls, and reasoning stay in its own product, so the cell session holds the stamp, the standard, the delegation records, the runs, and the certificate, and no assistant turn. The exported trajectory therefore carries no step. It is a measurement, not training data, and the `implementer` field on the stamp is what a curated export filters on. The [external implementer note](../../.agents/notes/proposed/architecture/2026-09-06-external-implementer.md) owns these rules.

## Runs

| Run | Head | Implementer | Environment | Certified | Attempts | Elapsed |
| --- | --- | --- | --- | --- | --- | --- |
| [2026-09-06-claude-code-run-1](2026-09-06-claude-code-run-1/manifest.json) | `0f67c1759` | `claude-code` | `smoke:round-trip` | yes | 1 | 351 s for both cells |
| [2026-09-06-claude-code-run-1](2026-09-06-claude-code-run-1/manifest.json) | `0f67c1759` | `claude-code` | `smoke:unsatisfiable` | no | 2 | 351 s for both cells |

The first run is the first time an agent other than the harness itself was measured by the Proving Ground: two smoke environments at `isolation: none`, one child run per attempt recorded as `environment/delegation`, every delegation ending `completed`, facts exported for both sessions, both trajectories exported through the curator with one rewarded, and the observatory publishing both rows under the `claude-code` implementer with `runner` as the certificate executor of the certified one.
