# Agent Note: Headline figures a client will not discount

Status: implemented

English | [中文](2026-09-29-headline-figures-and-daliesk-identity.zh.md)

## Problem

The first figures a client reads counted seats, not work. The deck's header, its cold open, its title card and the Enterprise panel stated seats defined, occupied and "active today" as bare counts, and the root README said the deck "shows the 147 defined agents". Of the 44 active seats in the roster stamped 2026-09-29 07:07 UTC, 22 are automated checks — a `verify-*` package script, a Branch CI verdict read from GitHub, a fold of recorded sessions — and 4 were active only through a ticket line whose shift stopped before any model ran; "today" was a fixed window that kept its label after it had ended. The Enterprise panel opened with routes that never ran and sessions no seat holds, and drew never-run seats in warning amber.

## Decision

**Every deliverable has a kind of work.** `scripts/enterprise-ledger.ts` classifies each deliverable (`workOf`): model-driven for an attributed session, a ticket line whose department or review ran a session, that shipped, or that records model tokens, and a function line outside the four check divisions (the code-safety `review`, the `intake`); an automated check for a function line of Verification, Judging, Observatory or Curation & Data; and halted before any model ran for any other ticket line. `seatWork` gives a seat the strongest kind among all its deliverables and among those inside the window. The roster carries `work` on every occupied seat and `counts.work.{occupied,active}`, each split summing to its count; `divisionSeats`, `enterprise.json` and the 24-hour report carry the split per division.

**The enterprise leads with what it delivered.** `enterprise.json` gains `outcomes`: tickets with a line inside the window that shipped a commit (a ticket a later shift worked again still counts once), tickets a model worked that shipped nothing, tickets halted before any model ran, the model-driven function runs per function, and the automated checks by outcome. The Enterprise panel's title, the cold open and the tour's title card state those outcomes with the window's end; the seats follow, split by work. Routes and unattributed sessions move into a collapsed Evidence audit below the divisions, and a seat with no deliverable reads `provisioned, no work assigned yet` in neutral grey.

**The header never shows a bare active count.** It shows seats defined, seats occupied, and the active seats of the window as model-driven, automated checks and (when any) halted, beside the roster's stamp and age, which names `data/enterprise/roster.json` as the source; a zero count is drawn in `--ink-3`. The live feed keeps the file's dated counts and adds `counts.running`, labelled "running now", where it used to report the seats running now under `active`.

**The first screens state the same split with its source.** The root README pair opens with the delivered outcomes and the seat split read from the roster stamped 2026-09-29 07:07 UTC, with the file each comes from; the enterprise README pair states how to read the counts, and the demonstration runbook pair tells the operator to say the split aloud and forbids claiming that every active seat is an agent.

## Alternatives considered

**Counting only model sessions as occupancy.** It would make the roster disagree with the ledger rule the deck, the functions runner and the reports share, and would hide the automated checks, which are real deliverables; splitting by kind keeps one rule and states what each seat did.

**Classifying seats by division.** A curation seat worked a ticket and a curation seat ran a fold; classifying the deliverable, not the division, reads each seat by what it did.

**Counting a ticket as shipped only when its newest line shipped it.** T-0007 shipped at 02:04 UTC and a later shift, started from a checkout that did not know it, halted on it at 04:14 UTC; the newest-line rule would report 2 shipped where the branch carries 3.

## Consequences

**Every seat figure is checkable.** Each count names its file, its stamp and its rule, and the three kinds sum to the total they split.

**Figures in the READMEs age.** The READMEs name the stamp they were read at; the deck shows the current roster with its age, and the next cycle's `pnpm run roster` and `pnpm run enterprise:publish` rewrite the data with the same fields.

**Shift and intake sessions still reach seats only through ledger lines.** The roster's session evidence reads `data/proving-ground` and `data/code-safety`; a ticket or intake line stands for its session log, so those seats count as model-driven without their sessions being attributed.

## Verification

- `pnpm run roster` prints "53 occupied (27 model-driven, 22 automated checks, 4 halted before any model ran), 44 active … (18 model-driven, 22 automated checks, 4 halted before any model ran)" over 141 ledger lines, and `enterprise.json`'s `outcomes` reads 3 shipped, 3 not shipped, 4 halted before any model ran, 7 of 7 review seats, 2 of 2 intake coordinators and 105 of 114 automated checks passed.
- `scripts/enterprise-ledger.spec.ts`, `scripts/enterprise-roster.spec.ts`, `scripts/enterprise-publish.spec.ts` and `scripts/harness-feed.spec.ts` cover the classification, the split counts, the outcomes and the live `running` count.
