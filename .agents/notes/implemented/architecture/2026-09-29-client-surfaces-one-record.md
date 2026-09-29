# Agent Note: Client surfaces read one record: halt causes, the verdicts rule, shifts known only from the ledger, and no operator sessions in a published snapshot

Status: implemented

English | [中文](2026-09-29-client-surfaces-one-record.zh.md)

## Problem

A client-readiness review of the briefing, the executive summary, the README and `/ops` found them disagreeing with each other and with `pnpm run enterprise:report` and `pnpm run enterprise:verdicts`. The briefing pasted each halted ledger line's `reason` verbatim, so three `pnpm install` failure logs with `/tmp` paths filled its first section. It read a Branch CI run that a later push cancelled as failed, so `T-0020` and `T-0021` read red while `T-0012`, `T-0019` and `T-0007` read eventually green, the reverse of the verdicts rule. The summary labelled every halt without a failed check as a review rejection and said the scheduler's cycles had shipped nothing while its key figures said two. The shift `201448-94fd`, lost in the 22:07Z container reset, has no record but two ledger lines the supervisor appended; the briefing ignored them and reported its cycle as unknown. The audit-trail control said the ledger was never rewritten, which commit `dae1babd0` contradicts. The README carried hand-kept figures from 07:07 UTC. `/ops` published the operator's own Claude Code sessions, with titles, commands and tokens, as enterprise agents, and counted every ledger line as a deliverable.

## Decision

- A failed ticket's cause is its `reason`'s opening clause, reworded for known engine clauses (`the workspace install failed before any model ran`, `the session budget ran out`, `rejected by review`, `abandoned in the container reset`); the rest stays in the ledger line the briefing cites. The summary labels each halt with that cause, in both languages.
- `ShipmentCi.verdict` answers for a shipped commit by the verdicts rule: the newest exact run that passed or failed, else the earliest containing run that did; a cancelled run reached no verdict. The briefing, its unit table and the summary show that verdict; a cancelled containing run reads `cancelled before a verdict`.
- A ledger ticket line whose shift has neither a record nor a start line stands for its shift, started at the UTC time its `HHMMSS-xxxx` id names, the latest such time at or before its first line; the cycle running then claims it.
- The briefing's first section counts tickets shipped with no human or supervisor step, lists each scheduled cycle on its own line, and dates the audit and review controls by the commits that introduced them.
- The README pair carries no figure; it links the regenerated surfaces.
- `enterprise-ops.ts` collects the operator's own agents only for a local run (`operatorAgents`); `--push` and `--fixture` never do. The throughput tile counts ledger entries by kind, and review rejections count inside the window from the ledger's lines. A ticket halted in two shifts is medium only when a department ran and left a report. The deck drops the scratch copy of a run whose committed record the feed also lists, so the default code-safety run is one whose event stream has events.

## Consequences

The executive summary, the briefing and the deck regenerate from these rules on every cycle. Figures a reader compares across surfaces come from one computation each.

## Verification

`scripts/enterprise-briefing.spec.ts` covers the inferred shift and the halt causes; `scripts/enterprise-ops.spec.ts` covers repeated halts without a department; `apps/command-deck/tests/feed.spec.ts` covers the run list and `apps/command-deck/tests/ops.spec.ts` the rejections in the window.
