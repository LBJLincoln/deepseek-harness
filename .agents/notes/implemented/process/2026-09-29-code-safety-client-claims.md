# Agent Note: Code-safety and data-handling claims a client's reviewers can check

Status: implemented

English | [中文](2026-09-29-code-safety-client-claims.zh.md)

## Problem

The texts a Fortune 500 client's security, legal and finance teams read about the code-safety program stated more than the records hold. The demonstration runbook said that "the customer's code stays on the machine that runs the review" and that "every session records its data-use terms". Neither holds: every department runs through the operator's Claude Code login, so each file a department reads goes to Anthropic's model API; recorded reviews, the live transcript capture, the mirror relay and the published deck put the code a review quotes in public places; and none of the 114 committed code-safety session logs carries `dataUse/terms`. The "evaluation only" the runbook attributed to the subscription's terms is the purpose the bench composition pins on its own sessions, not a term of the model provider.

## Decision

**One page states the data flow.** [`docs/client/data-handling.md`](../../../../docs/client/data-handling.md), with its Chinese pair, is the one home for where a reviewed codebase and its records go: nine movements of data in the order they happen, each with its source file; the terms that govern each destination, and what the repository does not record about them (no copy of the account's terms, no data processing agreement, no zero-data-retention arrangement); the harness's own data-use terms and why the bench's `eu-west` and 90-day labels do not describe a public repository; what a client engagement needs before any client code is read; and the decisions still open for the operator. The runbook's "What may not be claimed" now forbids claiming that the code stays on the review machine or that it is not used for training, and links the page; the root README, the code-safety records' README and the command deck's README link it where they describe records or fixtures that quote reviewed code. The client briefing already stated the same flow, and its claims register forbids the phrase "never leaves", so its builder and data are unchanged.

## Alternatives considered

**Correcting the runbook sentence in place, with no separate page.** A single corrected sentence cannot hold nine destinations, their terms and the engagement requirements, and the same facts are needed by the READMEs and the briefing; one page linked from each keeps one home per fact.

**Stating Anthropic's retention and training terms for the subscription.** The repository holds no copy of the account's terms and this change could consult no source outside the repository, so the page says what the repository records and names confirming the terms as an open decision rather than asserting them.

## Consequences

**A reader can check every data-handling statement.** Each row of the data flow names the file that shows it, and the one quantitative claim, 0 of 114 code-safety session logs carrying terms, is a `git grep` away.

**The page names work the change did not do.** No overlay serves the departments from an API organisation, the code-safety composition pins no terms, `record-run.mjs` writes only under `data/code-safety/`, and the operator's e-mail address remains in clear in 15 files of eight records committed before the recorder masked e-mail addresses. The page lists each as a requirement or an open decision instead of implying it is done.

## Verification

- `git grep -l 'dataUse/terms' -- 'data/code-safety/*/sessions/*.jsonl'` lists no file, and `git ls-files 'data/code-safety/*/sessions/*.jsonl'` lists 114.
- `pnpm run verify-translation-pairing` passes with the new pair and the re-recorded runbook, root README, code-safety README and command deck README pairs.
- `pnpm run doc-sync` passes.
