# Agent Note: Headline figures, benchmark claims and a Daliesk identity a client will not discount

Status: implemented

English | [中文](2026-09-29-headline-figures-and-daliesk-identity.zh.md)

## Problem

The first figures a client reads counted seats, not work. The deck's header, its cold open, its title card and the Enterprise panel stated seats defined, occupied and "active today" as bare counts, and the root README said the deck "shows the 147 defined agents". Of the 44 active seats in the roster stamped 2026-09-29 07:07 UTC, 22 are automated checks — a `verify-*` package script, a Branch CI verdict read from GitHub, a fold of recorded sessions — and 4 were active only through a ticket line whose shift stopped before any model ran; "today" was a fixed window that kept its label after it had ended. The Enterprise panel opened with routes that never ran and sessions no seat holds, and drew never-run seats in warning amber.

The Proving Ground made the same mistake with its benchmark. The dashboard led with "1,645 cells run · 1,473 certificates", a pool of every tier, district cells certifying a village of trivial tasks and a mocked model among them, with no interval; it sorted the verdict cards so that three green PROMOTE cards led, none of them a change anyone adopted; its loop table wrapped every timestamp over four lines and its cards clipped their pills; and the root README cited the loop's "first five iterations" when it had run sixteen and adopted nothing.

The client could not tell who makes what. The repository's front page named DeepSeek AI as the developer and never named Daliesk, its clone command fetched the upstream repository, which lacks every command the fork added, and the deck's link preview promised "147 agents".

## Decision

**Every deliverable has a kind of work.** `scripts/enterprise-ledger.ts` classifies each deliverable (`workOf`): model-driven for an attributed session, a ticket line whose department or review ran a session, that shipped, or that records model tokens, and a function line outside the four check divisions (the code-safety `review`, the `intake`); an automated check for a function line of Verification, Judging, Observatory or Curation & Data; and halted before any model ran for any other ticket line. `seatWork` gives a seat the strongest kind among all its deliverables and among those inside the window. The roster carries `work` on every occupied seat and `counts.work.{occupied,active}`, each split summing to its count; `divisionSeats`, `enterprise.json` and the 24-hour report carry the split per division.

**The enterprise leads with what it delivered.** `enterprise.json` gains `outcomes`: tickets with a line inside the window that shipped a commit (a ticket a later shift worked again still counts once), tickets a model worked that shipped nothing, tickets halted before any model ran, the model-driven function runs per function, and the automated checks by outcome. The Enterprise panel's title, the cold open and the tour's title card state those outcomes with the window's end; the seats follow, split by work. Routes and unattributed sessions move into a collapsed Evidence audit below the divisions, and a seat with no deliverable reads `provisioned, no work assigned yet` in neutral grey.

**The header never shows a bare active count.** It shows seats defined, seats occupied, and the active seats of the window as model-driven, automated checks and (when any) halted, beside the roster's stamp and age, which names `data/enterprise/roster.json` as the source; a zero count is drawn in `--ink-3`. The live feed keeps the file's dated counts and adds `counts.running`, labelled "running now", where it used to report the seats running now under `active`.

**The benchmark leads with rates it can defend.** `data/proving-ground/tools/build-dashboard.mjs` computes a `headline`: the certification rate of every experiment, fleet and partial record's cells by tier and by whether the run was sealed, with its 95 % Wilson interval and the models and loops pooled in it, sealed tier 5 first; district cells and suites without a tier are counted apart. It counts the frozen pairs by whether their verdict was decisive (`promote` or `reject`), sums the four harness-against-product pairs arm by arm, and counts the loop's iterations by kind, by decisive verdict and by whether a change was applied, reading the improvement log's "Default changed" column. The page states those in words ("What the paired comparisons show"), sorts the verdict cards newest first, names each by the question it asked, labels a verdict "candidate better", "candidate worse" or "no clear difference" with decisive or not decisive, and tags a better candidate that changed no default "not adopted". The loop table reads dates as `19 Sep 11:49`, names each plan's question, and moves the plan id, queue, overlay and statistic into tooltips; the cards wrap long arm labels, and a single-arm run is drawn in neutral grey. The root README's Proving Ground section states the same figures with their models, cell counts, intervals and decisiveness, and the records README says its table holds the records a person recorded, the loop's eleven later ones being in the ledger and on the page. `--branch` names the branch the page links into, for a build in a worktree.

**One name, one line of positioning, and honest provenance.** Daliesk names the enterprise and every page a client opens; DeepSeek Harness names the harness underneath and keeps its `@deepseek-ai/dsh-*` packages. The root README pair opens with one sentence of positioning, the links to the deck, the briefing, the executive summary and the data-handling page, and a provenance paragraph: this repository is a fork of `deepseek-ai/deepseek-harness`, the GitHub account LBJLincoln operates Daliesk on it, and DeepSeek AI has not built, reviewed or endorsed the fork's additions. It states which model routes ran, points the clone at the fork's branch, and marks the community channels as the upstream project's; the upstream introduction, its developer-preview notice and the MIT licence stay as they were. The deck's metadata carries the same sentence and a Daliesk icon (`app/icon.svg`), its README pair is titled Daliesk Command Deck with the package name kept, and the dashboard's eyebrow reads "Daliesk · Proving Ground" and names one Claude Code login where it named the operator's subscription.

**The first screens state the same split with its source.** The root README pair opens with the delivered outcomes and the seat split read from the roster stamped 2026-09-29 07:07 UTC, with the file each comes from; the enterprise README pair states how to read the counts, and the demonstration runbook pair tells the operator to say the split aloud and forbids claiming that every active seat is an agent.

## Alternatives considered

**Counting only model sessions as occupancy.** It would make the roster disagree with the ledger rule the deck, the functions runner and the reports share, and would hide the automated checks, which are real deliverables; splitting by kind keeps one rule and states what each seat did.

**Classifying seats by division.** A curation seat worked a ticket and a curation seat ran a fold; classifying the deliverable, not the division, reads each seat by what it did.

**Excluding the pooled tiers and showing only per-model arms.** The "Models on sealed tier 5" panel already does that for the plain arms; a client first asks how often a task is solved at all, and the pooled rate with its interval and the models it pools answers that, while the per-model panel and the verdict cards answer which model.

**Counting a ticket as shipped only when its newest line shipped it.** T-0007 shipped at 02:04 UTC and a later shift, started from a checkout that did not know it, halted on it at 04:14 UTC; the newest-line rule would report 2 shipped where the branch carries 3.

## Consequences

**Every seat figure is checkable.** Each count names its file, its stamp and its rule, and the three kinds sum to the total they split.

**Figures in the READMEs age.** The READMEs name the stamp they were read at; the deck shows the current roster with its age, and the next cycle's `pnpm run roster` and `pnpm run enterprise:publish` rewrite the data with the same fields.

**Machine and operator commits still share one author.** `scripts/enterprise-cycle.sh` sets the cycle's committer, and distinct authors for cycle, engine and operator commits are left to the change that owns that script. The deck is still served from `lbjlincoln.github.io/deepseek-harness` and carries no preview image, because an absolute image URL needs a site origin the build does not carry.

**A benchmark figure ages with the records.** The README states the figures the dashboard folded on 2026-09-29; the nightly loop adds a record and a ledger line each night, and the page recomputes every figure when it is rebuilt.

**Shift and intake sessions still reach seats only through ledger lines.** The roster's session evidence reads `data/proving-ground` and `data/code-safety`; a ticket or intake line stands for its session log, so those seats count as model-driven without their sessions being attributed.

## Verification

- `pnpm run roster` prints "53 occupied (27 model-driven, 22 automated checks, 4 halted before any model ran), 44 active … (18 model-driven, 22 automated checks, 4 halted before any model ran)" over 141 ledger lines, and `enterprise.json`'s `outcomes` reads 3 shipped, 3 not shipped, 4 halted before any model ran, 7 of 7 review seats, 2 of 2 intake coordinators and 105 of 114 automated checks passed.
- `node data/proving-ground/tools/build-dashboard.mjs` prints "sealed tier 5 624 of 733, 95 % [82.4, 87.5]; 4 of 23 frozen pairs decisive; the loop 16 iterations, 0 adopted", and `dashboard.png` is the page at 1440×2400 in headless Chromium.
- `scripts/enterprise-ledger.spec.ts`, `scripts/enterprise-roster.spec.ts`, `scripts/enterprise-publish.spec.ts` and `scripts/harness-feed.spec.ts` cover the classification, the split counts, the outcomes and the live `running` count.
