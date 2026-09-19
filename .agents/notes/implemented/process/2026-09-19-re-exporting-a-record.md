# Agent Note: Re-exporting a recorded run

Status: implemented

English | [中文](2026-09-19-re-exporting-a-record.zh.md)

## Problem

A record under [`data/proving-ground/`](../../../../data/proving-ground/README.md) keeps `trajectories.jsonl` exactly as the run's driver exported it, and nothing in a recorded run is edited afterwards. That rule had no procedure for a record whose projection has since changed. When `foldTrajectory` began writing [`terms`](../architecture/2026-09-19-trajectories-carry-data-use-terms.md) and the format tag became `dsh-trajectory/2`, `2026-09-19-bench-h1-openrouter-smoke-t2` had already been written by the older build: two `dsh-trajectory/1` lines stating no terms, although both session logs in the same record carry `dataUse/terms` admitting `training`. `build-dataset.mjs --purpose training` withheld them for stating no terms, and the dataset tool's own doctrine — a credential hit is "a record to re-export, not a finding to wave through" — named a procedure nothing implemented.

## Decision

[`data/proving-ground/tools/reexport-trajectories.mjs`](../../../../data/proving-ground/tools/reexport-trajectories.mjs) re-folds one record's own session logs and rewrites that record's export. It takes the record directory and an optional `--check`.

**The fold is the exporter's.** The tool reads each `sessions/<id>.jsonl` with `scanLog`, the decoder [`JsonlSessionPersistence`](../../../../packages/session/session-persistence-jsonl/README.md) itself uses, and passes the header and events to `foldTrajectory`. The logs hold packed chunk rows, so a line parser written for this tool would read a different session than the exporter does. It reproduces `ctx.trajectories.export({ sink })` with no further options, the request every Proving Ground driver makes: a session whose stamp is held out is withheld, and no district filter applies because the bench composition configures none. Run against a record the current build exported, the tool reproduces that file byte for byte; that equality is what proves the two folds are one.

**It applies no redaction.** [`@deepseek-ai/dsh-curator`](../../../../packages/governance/curator/README.md) redacts under a profile and attaches a `curation` block, but no record under `data/proving-ground/` was written through `ctx.curator.export()`: the fleet and experiment drivers call the exporter directly, and their lines carry no `curation` block. Redacting on re-export would write a record no run ever produced.

**A re-export is a newer projection of the same sessions, never a different corpus.** The tool refuses to run when the record holds no `sessions/`, when it holds no `trajectories.jsonl` to replace, when a session the previous export named has no log, and when the re-fold would drop or add a trajectory. The admitted session-id set must equal the previous export's, and the refusal names the ids on either side of the difference.

**Line order is the previous export's**, each re-folded trajectory matched to its position by session id. The exporter writes in the order session persistence lists, which a record does not carry, so the committed file is the only statement of that order; a re-export changes what each line says and never where it sits.

**The manifest keeps the history.** The tool rewrites `trajectories.jsonl` and, in `manifest.json`, that file's `bytes` and `sha256` plus one appended `reexports` entry: `at`, `tool`, `toolVersion`, `head`, the `format` written, and `before`/`after` digests and line counts. Entries append; an earlier one is never overwritten, so a record states every projection it has been through. Everything else is untouched — `result.json`, `facts.jsonl`, `observatory.json`, `observatory.html`, and every session log stay byte-identical.

**`--check` is the read-only form.** It re-folds in memory, writes nothing, and exits 1 when the committed file is not what the tool would write or when the manifest's recorded digest disagrees with the file beside it, printing the format tags, the `terms` counts, the line counts and the digests on both sides. It exits 1 for every record carrying `dsh-trajectory/1` lines, because every one of them would gain the current format tag and its sessions' terms.

**It runs under tsx.** The fold is TypeScript source and `scanLog` is in no built `lib/`, so the tool re-executes itself once with tsx's ESM loader when that loader is not registered, and reaches the packages through dynamic `import()` because a static import would resolve before the re-execution could happen. `node data/proving-ground/tools/reexport-trajectories.mjs <record>` is therefore the whole invocation, as for every other tool in that directory.

## Alternatives considered

**Re-running the driver on the run directory.** The run directory is gone once a run is recorded, and a fleet cannot be re-run without re-running the model: a second run measures a different afternoon. The session logs are the record's durable input, and a fold over them is deterministic, so re-folding is the only repeatable way to restate what a run produced.

**Editing the committed lines in place** — adding `terms`, bumping the tag. It is faster and it is the thing the corpus rule forbids: a hand-edited record is no longer what any build produced, and the next reader has no way to tell an edit from an export. A re-export names its tool and its head in the manifest; an edit names nothing.

**Leaving the records alone and teaching `build-dataset.mjs` to read the session logs for terms.** The dataset builder reads `trajectories.jsonl` files copied out of run directories and holds no session store, which is the reason the `terms` field exists on the record at all. Reaching back into `sessions/` for one field would put a second, partial fold in the tool that exists to consume the first.

**Applying the curator's redaction on re-export.** It would harden every record the tool touches, and it would silently change what the record says a run produced. The curated export is a different operation with a different manifest (`dsh-export-manifest/1`, a profile digest, rule hits); a record that never ran through it must not acquire its output by way of a maintenance tool.

**Overwriting the manifest's digest with no history.** The manifest would stay true and the record would lose the fact that it had been re-exported at all, which is exactly the fact a reader comparing this record with a contemporaneous one needs.

**Writing the tool as `.mts`, or as `.mjs` over the built `lib/`.** A `.mts` file under `data/` sits in no TypeScript program and in no lint override, so it would be the one source file in the repository that no static gate covers. The built `lib/` does not export `scanLog` at all, and a tool that requires `pnpm run build` before it can read a record mixes the artifact plane into a source-plane fold. Re-executing under tsx keeps the file `.mjs` like its neighbours and the fold on the source of record.

**Re-exporting every `dsh-trajectory/1` record in the corpus at once.** Thirty of them would be re-folded, and none of that changes what any dataset admits: their agreements admit `evaluation` and `delivery` and never `training`, so they are withheld under `--purpose training` either way. A bulk rewrite would restate thirty measurements to fix nothing, and `--check` already reports which records would change when a reason to change them appears.

## Consequences

`2026-09-19-bench-h1-openrouter-smoke-t2` now carries two `dsh-trajectory/2` lines with the terms its sessions were pinned with, and [`datasets/2026-09-19-openrouter-free-v1`](../../../../data/proving-ground/datasets/2026-09-19-openrouter-free-v1/README.md) admits four trajectories instead of two. Its manifest carries the first `reexports` entry in the corpus.

Every other record stays as its driver wrote it, so the corpus now holds two export formats at once. Across its 34 exported records `--check` reports three already current — the two `dsh-trajectory/2` records and `2026-09-08-bench-held-out-sonnet-all`, whose export is empty because every environment it ran is held out — thirty that would change, and one refusal: `2026-09-08-district-village-live` keeps 308 session logs against an 82-line export written by one slot of a running district, so a re-fold would add 226 trajectories and the tool declines to make that corpus. A reader of a single record can tell which format it is reading from the line's own `format` tag and from whether the manifest carries `reexports`; a reader folding many records at once gets the mixture, which is what the `terms` field was made to let a purpose filter survive.

A record's manifest is no longer written only by `record-run.mjs`. It stays append-only in the sense that matters — an earlier `reexports` entry and every other field are never rewritten — but `trajectories.jsonl` and its digest are now two facts a record can restate, and any future check over record digests reads the current entry rather than assuming one.

The tool has no test of its own: it is a `data/` maintenance tool like `record-run.mjs` and `build-dataset.mjs`, and its correctness claim is the byte-for-byte reproduction of a record the current build exported, which `--check` re-establishes on demand for every record in the corpus.
