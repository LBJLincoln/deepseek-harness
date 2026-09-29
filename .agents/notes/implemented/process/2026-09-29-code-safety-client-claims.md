# Agent Note: Code-safety and data-handling claims a client's reviewers can check

Status: implemented

English | [中文](2026-09-29-code-safety-client-claims.zh.md)

## Problem

The texts a Fortune 500 client's security, legal and finance teams read about the code-safety program stated more than the records hold. The demonstration runbook said that "the customer's code stays on the machine that runs the review" and that "every session records its data-use terms". Neither holds: every department runs through the operator's Claude Code login, so each file a department reads goes to Anthropic's model API; recorded reviews, the live transcript capture, the mirror relay and the published deck put the code a review quotes in public places; and none of the 114 committed code-safety session logs carries `dataUse/terms`. The "evaluation only" the runbook attributed to the subscription's terms is the purpose the bench composition pins on its own sessions, not a term of the model provider.

The code-safety figures overstated in the same way. "Verified findings" read as confirmed defects, while the examiner only checks that the quoted text is at the cited line, and the one triaged review found its four `confirmed` non-canary findings false. The front page said a second review matched the first "at the same lines" where the record says within three lines. The comparison priced the single pass at $0.36 and the enterprise as "subscription", called the enterprise's 47 findings "real" and "more than double the attack surface" with 15 of them untriaged, called the single pass non-deterministic after one run, and claimed an advantage at a scale no record reaches. The 18 of 18 readings came from checklists written from the same target's misses, with no label saying so, and the runbook's clock and finding counts described an older program.

## Decision

**One page states the data flow.** [`docs/client/data-handling.md`](../../../../docs/client/data-handling.md), with its Chinese pair, is the one home for where a reviewed codebase and its records go: nine movements of data in the order they happen, each with its source file; the terms that govern each destination, and what the repository does not record about them (no copy of the account's terms, no data processing agreement, no zero-data-retention arrangement); the harness's own data-use terms and why the bench's `eu-west` and 90-day labels do not describe a public repository; what a client engagement needs before any client code is read; and the decisions still open for the operator. The runbook's "What may not be claimed" now forbids claiming that the code stays on the review machine or that it is not used for training, and links the page; the root README, the code-safety records' README and the command deck's README link it where they describe records or fixtures that quote reviewed code. The client briefing already stated the same flow, and its claims register forbids the phrase "never leaves", so its page and data are unchanged; the executive summary [`enterprise-briefing-summary.ts`](../../../../scripts/enterprise-briefing-summary.ts) renders from the same data links the page.

**Every client-facing recall figure states its denominator, its matching rule and its sample.** The root README, the runbook, the code-safety records' README, the comparison README and the executive summary say "line-verified" and define it in one sentence; count a documented issue as found only within three lines of it; give NodeGoat recall as 13 to 15 of 18 over the ten reviews without the diagnosed checklists and 18 of 18 over the two with them, labelled in-sample; state the run-to-run overlap as measured (38 of the first run's 42 findings within three lines of the same file, 31 with the same CWE); and carry the seeded reading's 95% interval, [0.409, 0.929], wherever its 6 of 8 appears. The runbook expects what the program on this branch produced: 49 to 70 findings in twenty-five to thirty minutes.

**The comparison states each tier's conditions and drops what no record supports.** Every tier is one run, and the table says so; the single pass is described with its read-only tools and generic prompt; its $0.36 is labelled as Claude Code's own accounting, and the enterprise tier states its 12,367,319 tokens, which [`assemble-comparison.mjs`](../../../../data/code-safety/tools/assemble-comparison.mjs) now sums from the record's `usage` chunks, because the records hold no dollar price for the subscription route. "Real findings", "more than double", "non-deterministic" and "pulls ahead at scale" are gone; the 15 findings beyond the ground truth are called untriaged candidates, and scale is stated as untested. [`iterations.json`](../../../../data/code-safety/comparisons/2026-09-22-nodegoat/iterations.json) labels the tuned iterations in-sample, the band the untuned runs read is corrected from 12-to-15 to 13-to-15, and the deck's comparison fixture is copied from the reassembled record by the step [`snapshot-fixtures.ts`](../../../../apps/command-deck/scripts/snapshot-fixtures.ts) runs.

## Alternatives considered

**Correcting the runbook sentence in place, with no separate page.** A single corrected sentence cannot hold nine destinations, their terms and the engagement requirements, and the same facts are needed by the READMEs and the briefing; one page linked from each keeps one home per fact.

**Stating Anthropic's retention and training terms for the subscription.** The repository holds no copy of the account's terms and this change could consult no source outside the repository, so the page says what the repository records and names confirming the terms as an open decision rather than asserting them.

**A dollar price for the enterprise tier.** Pricing 12,367,319 tokens needs a price list, and the repository holds none for the subscription route; a price taken from outside the records would be the one figure in the comparison nobody could check. The tokens are the measured quantity, and the table says no dollar price was recorded.

**Editing the deck's components.** The Benchmark panel's hard-coded sentences ("every finding verified", "non-deterministic", "repeatable") belong to the deck's own owners; this change corrects the data those components read, the tier names and descriptions included, and leaves the component text to them.

## Consequences

**A reader can check every data-handling statement.** Each row of the data flow names the file that shows it, and the one quantitative claim, 0 of 114 code-safety session logs carrying terms, is a `git grep` away.

**The page names work the change did not do.** No overlay serves the departments from an API organisation, the code-safety composition pins no terms, `record-run.mjs` writes only under `data/code-safety/`, and the operator's e-mail address remains in clear in 15 files of eight records committed before the recorder masked e-mail addresses. The page lists each as a requirement or an open decision instead of implying it is done.

**The numbers a client reads are the ones the records give, with their conditions.** The headline no longer shows one run of each tier as if it were the program's result, and the favourable 18 of 18 appears only with the label that it was measured on the target the checklists were written from.

## Verification

- `git grep -l 'dataUse/terms' -- 'data/code-safety/*/sessions/*.jsonl'` lists no file, and `git ls-files 'data/code-safety/*/sessions/*.jsonl'` lists 114.
- `pnpm run verify-translation-pairing` passes with the new pair and the re-recorded runbook, root README, code-safety README and command deck README pairs.
- `node data/code-safety/tools/recall.mjs <record> data/code-safety/targets/nodegoat.ground-truth.json` over the twelve NodeGoat records reads 14, 14, 13, 13, 15, 14, 13, 15, 14 and 15 of 18 for the ten without the diagnosed checklists and 18 and 18 for `2026-09-27-nodegoat-9-misses-a` and `-11-misses-b`.
- `node data/code-safety/tools/assemble-comparison.mjs data/code-safety/targets/nodegoat.ground-truth.json data/code-safety/comparisons/2026-09-22-nodegoat` writes the enterprise tier's tokens as 380 input, 214,017 output, 11,413,217 cache read and 739,705 cache write, 12,367,319 in all.
- `pnpm exec vitest run scripts/enterprise-briefing.spec.ts scripts/enterprise-briefing-claims.spec.ts` passes, and the executive summary pair is the rendering of the committed `briefing.json`.
- `pnpm run doc-sync` passes.
