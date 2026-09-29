# Daliesk: executive summary

English | [中文](daliesk-executive-summary.zh.md)

Figures as of 29 September 2026, 00:15 UTC, generated from [`briefing.json`](../../apps/command-deck/public/fixtures/briefing.json) by `pnpm run enterprise:briefing -- --summary`; the [briefing page](https://lbjlincoln.github.io/deepseek-harness/briefing/) names the source file and the computation of each.

Daliesk is a pilot: an organisation of AI agents that changes a codebase through a ticket queue. Each ticket is implemented in its own worktree, passes its acceptance checks, is approved by a reviewer that sees only the diff and the check output, and is pushed as one commit to the development branch, with every step recorded in the repository. The 2 tickets shipped so far came from shifts the operator started; the scheduler has started 2 cycles, which shipped 0. This summary states only what the records support.

## Key figures

| Measure | Value | Source |
| --- | --- | --- |
| Tickets shipped: by units the operator started / by cycles the scheduler started | 2 / 0 | [ledger.jsonl](../../data/enterprise/ledger.jsonl) |
| Cycles run / started by the scheduler | 3 / 2 | [captured scheduler log](../../data/transcripts/live/enterprise-cycles) |
| Shipped commits with a Branch CI run on the exact commit | 0 of 2 | [Branch CI](https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml) |
| Branch CI runs completed / successful | 60 / 7 | [Branch CI](https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml) |
| Seats defined (divisions) / occupied by a recorded deliverable | 147 (10) / 47 | [roster.json](../../data/enterprise/roster.json) |
| Model tokens and time per shipped ticket (mean of 2) | 761,584 tokens, 462 s | [ledger.jsonl](../../data/enterprise/ledger.jsonl) |
| Proving Ground frozen paired experiments / decisive | 22 / 3 | [data/proving-ground](../../data/proving-ground/README.md) |
| Security review recall, NodeGoat: documented issues found per review, of 18, over 12 reviews (a finding within three lines of the issue) | 13 to 18 | [data/code-safety](../../data/code-safety/README.md) |
| Recall of defects planted in this repository's own code (within three lines) | 6 of 8, 95% interval 0.41–0.93 | [seeded-recall.json](../../data/code-safety/2026-09-28-dsh-self-review/seeded-recall.json) |

## The pilot, unit by unit

| Unit | Started | Started by | Attempted | Shipped | Failed or halted | Lost | Branch CI | Model tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shift `171951-516d` | 28 September 2026, 17:19 UTC | operator | 2 | 0 | 0 | 2 | nothing shipped | unknown |
| shift `182951-78a6` | 28 September 2026, 18:29 UTC | operator | 2 | 2 (T-0012, T-0019) | 0 | 0 | exact commit: 0 of 2 run; containing run: failed | 1,523,167 |
| `cycle-20260928T201148Z` | 28 September 2026, 20:11 UTC | operator | unknown | 0 | 0 | unknown | nothing shipped | unknown |
| `cycle-20260928T221301Z` | 28 September 2026, 22:13 UTC | scheduler | 2 | 0 | 2 (`doc-sync`) | 0 | nothing shipped | 633,783 |
| `cycle-20260929T001517Z` | 29 September 2026, 00:15 UTC | scheduler | unknown | 0 | 0 | unknown | nothing shipped | unknown |

## What the evidence shows

- **Shipped work.** 2 tickets shipped in shift 182951-78a6, started by the operator: T-0012 (`1d6a5d343`) and T-0019 (`cfe0a75f7`). Each passed all 6 of its checks and was approved by a reviewer that made no tool call. No Branch CI run tested any of these exact commits. The containing run of the push that carried them failed: the push introduced a failure of `translation pairing`, while `test:snapshot` and `web browser snapshot` already failed before the shift; the first fully successful run containing them finished 35 minutes after the push, at 19:40 UTC.
- **Unattended cycles.** The cycle `cycle-20260928T201148Z` left no record of its shift on the branch; [LOSSES.md](../../data/transcripts/LOSSES.md) states that the 22:07Z container reset erased it. No cycle the scheduler started has shipped a ticket yet.
- **Benchmark.** On 44 in-house environments, a larger model beat the middle one on tier 5 (16 against 13 of 16 cells, +0.19, interval [0.13, 0.25]); the harness loop and the product's own loop were level (15 against 14 of 16, inconclusive); cutting the attempts from three to one lowered certification (−0.38, interval [−0.56, −0.19]). No frozen pair has promoted a harness change.
- **Security review.** In the three-tier comparison on NodeGoat, a scanner, one model in one pass and the enterprise found 4 of 18, 15 of 18 and 13 of 18 documented issues, counting a finding within three lines of an issue. Checklists written from a diagnosis of the enterprise's misses on this application gave 18 and 18 in the two runs with them, against 14 and 15 without; whether they transfer to another codebase is untested. On dvja the review found 13 of 14.

## Data flow

- **Model requests.** The departments, reviewers and intake coordinators run through the operator's Claude Code login: every model request, with the contents of every file a department reads, goes to Anthropic's model API under that account.
- **Published records.** Shift records commit every session log, and the live capture commits the operator's and the departments' transcripts every five minutes, to this repository, whose visibility on GitHub is public.
- **What a client engagement needs.** Before any client code is read: an Anthropic API organisation under a data processing agreement with zero data retention, and a private repository for the records.

## Controls

- **Isolation.** Bench cells run in a sandbox (bubblewrap, then Landlock, on Linux); shift departments do not yet: each works unconfined in its own worktree of a scratch clone that cannot push.
- **Separation of duties.** The reviewer is a fresh session with no parent and an empty working directory that reads only the diff, the commit messages and the check output; the review sessions of shift 171951-516d still made 6 tool calls, after which the engine removed every tool from the reviewer, and those of shift 182951-78a6 made none. Code-safety findings are checked line by line by a committed examiner (exit 0 on 14 of 14 records).
- **Sign-off.** No person signs a change before it is pushed: the engine decides a shift's spec freeze and release itself. The sign-off events in 4 records were written by the engine as the program opened, at most 2 ms apart, under `enterprise-operator` and `enterprise-intake-operator` of the kind `human`. No record carries the engine's decisions yet.

## Limits and risks

- **Scale.** The pilot has shipped 2 tickets, with 39 open, over 3 shift records.
- **CI.** Of 60 completed Branch CI runs since 27 September 2026, 15:36 UTC, 7 succeeded; the newest run with a verdict passed.
- **Data-use terms.** 1,688 of 1,798 bench sessions pin data-use terms; code-safety sessions 0 of 114, shift sessions 0 of 15 and intake sessions 0 of 4.
- **One vendor.** Recorded sessions by provider route: claude-code 1,283, openrouter 29.

## Engagement

Meet the data-flow requirements above, with data-use terms naming the client, the agreement, the purposes, the residency and the retention pinned on every session; then a code-safety review of a codebase the client selects, each finding checked by the client's own engineers; then supervised shifts on an agreed queue, with a person signing each release; then decide on the measured record. The code-safety records on file review OWASP NodeGoat, Damn Vulnerable Java Application (dvja) and this repository's own code.
