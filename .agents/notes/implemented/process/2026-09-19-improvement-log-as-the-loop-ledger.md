# Agent Note: The improvement log as the loop's ledger

Status: implemented

English | [中文](2026-09-19-improvement-log-as-the-loop-ledger.zh.md)

## Problem

One of this repository's four objectives is a harness that improves itself by evidence: propose a change, run it as a frozen paired experiment on the Proving Ground bench, read the verdict, keep or reject the change. Every piece of that exists and the loop has closed nineteen times, but no file holds the loop. The readings live in [the results note](../../proposed/architecture/2026-09-08-hypothesis-program-results.md), organized by what was refuted rather than by what was decided; the runs live as thirty-two record directories and twelve folds under `data/proving-ground/`, each with its own paragraph in that README; the verdicts live again on the dashboard, as cards. None of the three says which decision each verdict earned, which defaults moved because of it, or what is still done by hand, so a reader who wants to judge whether the harness improves itself by evidence has to reconstruct the loop from three views that were each built for something else.

## Decision

[`data/proving-ground/improvement-log.md`](../../../../data/proving-ground/improvement-log.md), with its Chinese counterpart, is the ledger: one row per improvement iteration, in the order the iterations ran, with six columns — the date, the proposed change and the mechanism it exercises, the experiment or record that tested it (linking the record directory's manifest and the fold file where one exists), the paired reading as the note and the fold state it, the decision taken for the harness with its reason and cost, and what moved in the defaults. Nineteen rows cover E2/H1 at tiers 3 and 5, the four E1 model-tier comparisons, the four attempt-cap readings, E4, H4, the three E5 readings, E6, and E7, which is running.

A paragraph above the table states the promotion rule as the code enforces it: the plan is digested before any cell runs, two arms that would resolve to different caps are refused, and `promote` requires the bootstrap interval's lower bound to exceed the plan's `minimumDelta`. Cost is stated as what it is — reported beside the verdict, weighed by the reader, not part of the rule — because [the experiments README](../../../../packages/improvement/experiments/README.md#statistics-and-verdict) makes the verdict a function of the interval alone. A section below the table, "What the loop still lacks", names the four parts that are not automatic: the proposal is authored outside the harness, runs are launched by hand through `pnpm run bench`, a kept change is applied by editing the composition, and every run so far is on one provider's models.

The ledger is linked from where a reader already stands: the layout block and the tools paragraph of [`data/proving-ground/README.md`](../../../../data/proving-ground/README.md), the proving-ground bullet of [`data/README.md`](../../../../data/README.md), the Proving Ground section of the root README, and the dashboard's own notes, which `data/proving-ground/tools/build-dashboard.mjs` builds into the committed page.

Authored documents that sit directly in `data/proving-ground/` are in the bilingual pairing corpus, which `isTranslationScopeFile` in [`scripts/translation-pairing.ts`](../../../../scripts/translation-pairing.ts) decides. The pattern stops at the first path segment: everything below that directory is a recorded run, a fold, or a dataset, which is never edited after the run and never translated.

## Alternatives considered

- **Generate the ledger from the records and the folds.** Rejected: three of the six columns are not in any file the tools read. A record states its arms, certificates, and spend; nothing on disk states what change the arms were chosen to test, what the harness decided afterwards, or which default moved, and the two rows whose readings disagree need a sentence rather than a field. A generator would produce the two columns the dashboard already shows and leave the ledger's actual subject to a hand-maintained sidecar, which is the same file with a worse provenance story.
- **Put the rows in the results note instead.** Rejected: that note is a proposal that reads the program's findings, organized as refuted / supported / inconclusive, and it ends in slices it demands. A ledger of decisions ordered by time is a different document with a different reader, and folding it in would make the note the only home for two incompatible orderings. The ledger cites the note for every reading instead.
- **Extend the dashboard with a decision column.** Rejected: the dashboard is folded from the records and folds alone, which is what lets it be rebuilt from the data at any commit. A decision and its reason are neither, so carrying them there would put hand-written prose inside a generated page, and the page is HTML that a pull request cannot review line by line.
- **Keep the ledger English-only.** Rejected: it is documentation about this repository's own operation sitting beside a paired README, and the pairing contract admits no per-file rollout list. Widening the scope predicate to the directory's authored documents is smaller than an exclusion entry and keeps the pair gated.

## Consequences

- The loop is readable as a loop: nineteen rows say what was proposed, what tested it, what came back, and what was done, and the four gaps below the table say what a person still supplies. Every number in the table is traceable to the record, the fold, or the note it came from, and no row states a figure that is not in one of them.
- The ledger is maintained by hand, so an iteration that runs without gaining a row leaves the loop's own record incomplete. The rule that keeps it honest is the same one the records README already carries: a run is recorded, then a row is added.
- `verify-translation-pairing` now discovers `data/proving-ground/*.md`, so any future authored document in that directory must merge as a complete pair. The record directories, the folds, and the datasets below it stay outside the corpus.
- The promotion rule is now stated in one place against the code that enforces it. The ledger says plainly that no frozen pair has yet promoted a harness change, and that the one harness mechanism with a promotion-level reading has it from an offline fold that the frozen rerun did not replicate.
