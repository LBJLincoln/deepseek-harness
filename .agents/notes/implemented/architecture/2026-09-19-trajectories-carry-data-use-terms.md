# Agent Note: The trajectory record carries the session's data-use terms

Status: implemented

English | [中文](2026-09-19-trajectories-carry-data-use-terms.zh.md)

## Problem

[`@deepseek-ai/dsh-data-use`](../../../../packages/governance/data-use/README.md) pins `dataUse/terms` to every session at creation, and [`@deepseek-ai/dsh-curator`](../../../../packages/governance/curator/README.md) reads those terms out of the session log to decide what one export may carry. The exported record itself said nothing about them, so the terms existed only where the logs did. A trainer, a leaderboard, or the offline fold in [`data/proving-ground/tools/build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs) holds `trajectories.jsonl` and no session store, and could not tell an evaluation-only transcript from one its agreement admits to a training corpus. The dataset builder accordingly had no notion of purpose at all: it filtered held-out environments, delegated cells, tampered runs and duplicates, and would have folded a client transcript into `train.jsonl` beside a bench cell.

## Decision

`foldTrajectory` reads the session's terms through the same [`termsOf`](../../../../packages/governance/data-use/README.md) fold the curator uses and writes them onto the record as `terms`: `agreementId` and `purposes`, and nothing else. One fold owns the rule "the newest `dataUse/terms` in the log is the one that counts", so the field a consumer filters on and the gate the curator enforces cannot disagree.

Only the two fields an admission decision reads are carried. The curator admits a session when `terms.purposes` includes the export's purpose and for no other reason, so retention, residency, and the redaction profile would be payload nobody checks, and `clientId` is the one field the data-use README asks readers to hash rather than show. Residency still reaches a curated line through the `curation` block, where the curator puts it for a sink that partitions by region.

**An absent `terms` admits no purpose.** A session whose log carries no `dataUse/terms` yields a record with the field absent — not `null`, not an empty list — and a consumer filtering by purpose withholds it. A purpose nobody recorded is never assumed, which is the rule the curator already applies to an unpinned session.

**The format tag is `dsh-trajectory/2`.** Absence is load-bearing, and it only carries the statement above when the producer is known to write the field whenever the log holds it. A `dsh-trajectory/1` record states nothing about data use at all; a `dsh-trajectory/2` record without `terms` states that the session had none. Both are withheld under every purpose filter, but only the second says why, and a governance decision made from silence needs to know which silence it is reading. The pre-release stance takes the bump over a compatibility shim and updates every reader in the same change.

The curator's redaction walk lists `terms` among the subtrees it never rewrites, beside `environment`, `steps`, `parity`, and `provenance`. The walk otherwise redacts every string it reaches, so a deployment rule could rewrite the agreement or a purpose and corrupt exactly the values the export was gated on.

`build-dataset.mjs` gains `--purpose <delivery|training|evaluation>`, which keeps a trajectory only when its `terms` admit that purpose and counts the rest as `withheldTerms`, named after the existing `withheldHeldOut`. The gate runs before every other classification, so a record the dataset may not carry reaches no file and no distribution. The manifest records the purpose under `options`, and the count is always present so a manifest states the withholding rather than hiding it. Without `--purpose` the build is unchanged: the same lines, the same digests, the same distributions, and `withheldTerms` at zero.

## Alternatives considered

**Reading `dataUse/terms` by name inside the fold, as `presetOf` reads `agent-preset/selected`.** That precedent exists to keep the projection free of a dependency it needs nothing else from. Here the rule itself is the point: the newest pin wins, and a second implementation of that scan could drift from the one the curator enforces, which is the exact disagreement — a record claiming a purpose the gate refuses — this change exists to prevent.

**Carrying the whole `DataUseTerms` payload.** Retention, residency, and the redaction profile are obligations on whoever holds the transcript, not inputs to an admission decision, and `clientId` is the field the data-use README asks cards to hash. Copying all six fields onto every line would put a client identifier into every corpus for the sake of a decision that reads two of them.

**Keeping `dsh-trajectory/1` and treating the field as additive.** Every existing reader would keep working, and the blast radius would be a few lines instead of a dozen documents. It fails on the one thing the field is for: a mixed corpus would hold records whose missing `terms` means "the session had none" beside records whose missing `terms` means "the exporter did not look", and a purpose filter could not tell a governed withholding from an unknown one.

**Filtering by purpose in the curator alone and leaving the record silent.** The curator already does this, and it is not enough: `trajectories.jsonl` files are copied out of run directories and folded offline by a tool with no session store to re-read. A record that cannot restate its own terms forces every downstream consumer to trust the provenance of the file it was handed.

**Defaulting an absent `terms` to the deployment's configured terms at fold time.** It would make the existing corpus filterable and is precisely the assumption the data-use pin exists to forbid: the terms a session ran under are the ones its log states, and a session that states none states none.

**A `--purposes a,b` list or a `--no-purpose-filter` opt-out.** One dataset serves one purpose, and a list would raise the question of whether it means all or any of them. Omitting the flag is already the unfiltered build, so an opt-out would be a second spelling of the default.

## Consequences

Every trajectory recorded under `data/proving-ground/` is `dsh-trajectory/1` and carries no terms, so `--purpose training` withholds all of them. That is the correct reading of a corpus produced entirely on the operator's Claude Code subscription, whose agreements admit `evaluation` and `delivery` and never `training`. The RLVR corpus therefore starts empty and fills only from sessions a composition pinned with `training` at creation.

`@deepseek-ai/dsh-trajectories` depends on `@deepseek-ai/dsh-data-use`, its one dependency on a governance package. `improvement` already depends on `governance` through `program` and `signoff`, and the alternative was a second copy of the terms rule inside the fold.

A `--check` against a manifest recorded without `withheldTerms` reports drift on `counts`, because the rebuild carries the field and the recorded counts do not. A dataset is rebuilt from records that are frozen by policy, so this is the ordinary consequence of a manifest field and not a migration: the next build of a name records the new counts.
