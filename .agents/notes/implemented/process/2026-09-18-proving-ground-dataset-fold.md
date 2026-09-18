# Agent Note: Folding recorded Proving Ground runs into one dataset

Status: implemented

English | [中文](2026-09-18-proving-ground-dataset-fold.zh.md)

## Problem

Thirty-odd run directories under `data/proving-ground/` each carry a `trajectories.jsonl` the curator exported, and nothing folded them into a single corpus. Anyone wanting one wrote an ad-hoc script, which is where the three decisions that matter get made silently: whether a held-out environment leaks into training material, whether a delegated cell with no model turn of its own is counted as a trajectory, and whether a credential or a real mailbox rides along into a file meant to be copied out of the repository.

## Decision

[`data/proving-ground/tools/build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs) reads every record directory holding `trajectories.jsonl` and writes `data/proving-ground/datasets/<name>/`: `train.jsonl`, `heldout.jsonl`, and a `manifest.json` carrying the source records with their manifest digests, the counts, the distributions of the written set, the token totals, and each written file's SHA-256. It is a data tool on Node built-ins, like the three tools beside it, and it imports `armOf` from `summarize-run.mjs` so the arm vocabulary has one home.

Each written line is the exported `dsh-trajectory/1` record plus a `dataset` field — `record`, `tier`, `domain`, `arm`, and `reward` as `{ value, basis }` — where the tier and domain come from the bench environment catalog and an environment absent from it gets `null`. The order is record name, then trajectory id, and the first occurrence of an id wins, so the same session exported by two records lands once.

Held-out environments never reach `train.jsonl`. Without `--include-held-out` they reach no file at all, and the manifest counts what was withheld: the empty `heldout.jsonl` is written either way so the directory states the withholding rather than hiding it. Delegated cells — a stamp whose `implementer` is not `route` — carry no model turn of their own, so they are excluded unless `--include-delegated` and counted in the manifest either way. A `tamper` basis voids the measurement, so those are excluded with no flag at all. `--check` rebuilds in memory and compares the digests and counts with the recorded manifest, tolerating absent JSONL files so a dataset too large to commit stays verifiable.

## The redaction refusal

Before anything is written, every string of every trajectory is scanned with the credential patterns [`collect-claude-code-session.mjs`](../../../../data/transcripts/tools/collect-claude-code-session.mjs) owns, plus an address pattern. A hit refuses the build and prints the record, the trajectory, the field, a digest of the match, and an excerpt with the match replaced. There is no accept flag: a recorded run is never edited, so a hit names a record to re-export, and the digest-plus-excerpt report never reprints the match.

The address pattern needs a line that a regular expression cannot draw on its own, because the corpus's URI, query-string, and URL-template environments feed their parsers a hundred and seventy-five stand-in addresses. An address is a hit only when its mail domain is neither reserved by RFC 2606 or RFC 6761 nor a one-to-three-letter label — the shape every fixture in the corpus uses and no operator mailbox does. A real mailbox at a domain that short passes the scan; the tool's own comment and the dataset README both say so, because a bounded check that states its bound is worth more than one that pretends to be complete.

## Alternatives considered

**A blanket address pattern with no exemptions.** It refuses on every build of this corpus, because `x@y.com` and `pass@example.com` in a URI parser's test data are indistinguishable from a mailbox by shape alone. A check that can never pass is not a check; it is a tool that does not run.

**An `--accept-hit <sha256>` flag, as the transcript collector has.** The collector snapshots a session whose placeholders a human reviews once. A dataset is rebuilt from records that are frozen by policy, so an accepted hit would be re-accepted forever on every rebuild and the flag would become the way past the check rather than a review of it. Re-exporting the record is the only fix that removes the string.

**Redacting the hit instead of refusing.** The curator already applies a redaction profile at export, so a string that survived into a record is a gap in that profile. Masking it here would fix the copy and leave the record and the profile wrong.

**Treating an unstamped session as delegated.** Sessions with no `environment/run` stamp — shift ledgers and the child sessions a cell spawned — have no implementer at all. The stamp's own contract reads an absent implementer as the route, which `summarize-run.mjs` already does, so the two tools agree rather than inventing a third rule.

## Consequences

The first dataset, [`2026-09-18-proving-ground-v1`](../../../../data/proving-ground/datasets/2026-09-18-proving-ground-v1/README.md), writes 521 of 750 trajectories and finds no credential and no mailbox. Its `train.jsonl` is larger than this repository commits, so the directory carries the manifest and its README pair and the JSONL is rebuilt on demand — which is what made `--check` tolerate absent files.

The fold also made the corpus state its own terms: every session in it is pinned under `dataUse/terms` that admit `evaluation`, or `delivery` and `evaluation`, and none admits `training`. The dataset is therefore an evaluation record, and an RLVR corpus needs sessions pinned with `training` at creation. The tool does not read those terms — the curator enforces them at export — so a build over a future district that admits training produces the same files under different terms, and the README of each dataset states which.
