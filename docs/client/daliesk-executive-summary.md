# Daliesk: executive summary

English | [中文](daliesk-executive-summary.zh.md)

Figures as of 29 September 2026, 13:41 UTC, generated from [`briefing.json`](../../apps/command-deck/public/fixtures/briefing.json) by `pnpm run enterprise:briefing -- --summary`; the [briefing page](https://lbjlincoln.github.io/deepseek-harness/briefing/) names the source file and the computation of each.

Daliesk is a pilot: an organisation of AI agents that changes a codebase through a ticket queue. Each ticket is implemented in its own worktree, passes its acceptance checks, is approved by a reviewer that sees only the diff and the check output, and is pushed as one commit to the development branch, with every step recorded in the repository. Of the 7 tickets shipped so far, 2 came from shifts the operator started, 4 from cycles the scheduler started and 1 from units whose starter the records do not state. Shift 101309-c95c, started by the scheduler's cycle-20260929T101300Z, shipped T-0020 and T-0021; its push was completed by the supervisor, and their ledger lines are marked `recordedBy: supervisor`. The scheduler has started 7 cycles. This summary states only what the records support.

## Key figures

| Measure | Value | Source |
| --- | --- | --- |
| Tickets shipped: by units the operator started / by cycles the scheduler started / by units whose starter is not recorded | 2 / 4 / 1 | [ledger.jsonl](../../data/enterprise/ledger.jsonl) |
| Cycles run / started by the scheduler | 9 / 7 | [captured scheduler log](../../data/transcripts/live/enterprise-cycles) |
| Shipped commits with a Branch CI run on the exact commit | 0 of 7 | [Branch CI](https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml) |
| Branch CI runs completed / successful | 126 / 19 | [Branch CI](https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml) |
| Seats defined (divisions) / occupied by a recorded deliverable | 147 (10) / 58 | [roster.json](../../data/enterprise/roster.json) |
| Model tokens and time per shipped ticket (mean of 7) | 537,933 tokens, 1,248 s | [ledger.jsonl](../../data/enterprise/ledger.jsonl) |
| Proving Ground frozen paired experiments / decisive | 22 / 3 | [data/proving-ground](../../data/proving-ground/README.md) |
| Security review recall, NodeGoat: documented issues found per review, of 18 (a finding within three lines of the issue) | 13 to 15 over the 10 reviews without the diagnosed checklists; 18 and 18 over the 2 with them (in-sample) | [data/code-safety](../../data/code-safety/README.md) |
| Recall of defects planted in this repository's own code (within three lines) | 6 of 8, 95% interval 0.41–0.93 | [seeded-recall.json](../../data/code-safety/2026-09-28-dsh-self-review/seeded-recall.json) |

## The pilot, unit by unit

| Unit | Started | Started by | Attempted | Shipped | Failed or halted | Lost | Branch CI | Model tokens |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| shift `171951-516d` | 28 September 2026, 17:19 UTC | operator | 2 | 0 | 2 (the assembly failed after approval; rejected by review) | 0 | nothing shipped | unknown |
| shift `182951-78a6` | 28 September 2026, 18:29 UTC | operator | 2 | 2 (T-0012, T-0019) | 0 | 0 | exact commit: 0 of 2 run; verdict: failed | 1,523,167 |
| `cycle-20260928T201148Z` | 28 September 2026, 20:11 UTC | operator | 2 | 0 | 2 (abandoned in the container reset) | 0 | nothing shipped | unknown |
| `cycle-20260928T221301Z` | 28 September 2026, 22:13 UTC | scheduler | 2 | 0 | 2 (no certificate after 3 rounds, `doc-sync` failing) | 0 | nothing shipped | 633,783 |
| `cycle-20260929T001517Z` | 29 September 2026, 00:15 UTC | unknown | 2 | 1 (T-0007) | 1 (the session budget ran out) | 0 | exact commit: 0 of 1 run; verdict: failed | 584,273 |
| `cycle-20260929T021318Z` | 29 September 2026, 02:13 UTC | scheduler | 2 | 0 | 2 (the workspace install failed before any model ran) | 0 | nothing shipped | 0 |
| `cycle-20260929T041300Z` | 29 September 2026, 04:13 UTC | scheduler | 2 | 0 | 2 (the workspace install failed before any model ran) | 0 | nothing shipped | 0 |
| `cycle-20260929T061300Z` | 29 September 2026, 06:13 UTC | scheduler | 2 | 0 | 2 (the workspace install failed before any model ran) | 0 | nothing shipped | 0 |
| `cycle-20260929T081300Z` | 29 September 2026, 08:13 UTC | scheduler | 2 | 0 | 2 (the session budget ran out, `coverage` failing; the acceptance checks failed over the assembled tree) | 0 | nothing shipped | 765,135 |
| `cycle-20260929T101300Z` | 29 September 2026, 10:13 UTC | scheduler | 2 | 2 (T-0020, T-0021) | 0 | 0 | exact commit: 0 of 2 run; verdict: passed | 315,418 |
| `cycle-20260929T121300Z` | 29 September 2026, 12:13 UTC | scheduler | 2 | 2 (T-0040, T-0003) | 0 | 0 | exact commit: 0 of 2 run; verdict: none yet | 1,588,444 |

## What the evidence shows

- **Shipped work.** 7 tickets shipped in shifts 182951-78a6, 001527-881f, 101309-c95c and 121310-3eae, started by the operator, unknown and scheduler: T-0012 (`1d6a5d343`), T-0019 (`cfe0a75f7`), T-0007 (`cba8e4682`), T-0020 (`b157e0908`), T-0021 (`a54154ce7`), T-0003 (`e086cb101`) and T-0040 (`ba3973e84`). Each passed all of its checks (6, 7, 9 and 10 per ticket) and was approved by a reviewer that made no tool call. No Branch CI run tested any of these exact commits. By the first Branch CI run containing each commit that reached a verdict (a run a later push cancelled has none; the rule of `pnpm run enterprise:verdicts`), 2 passed (T-0020 and T-0021), 3 failed (T-0012, T-0019 and T-0007) and 2 have no verdict yet (T-0003 and T-0040).
- **Unattended cycles.** The 22:07Z container reset erased the session logs of the shift of `cycle-20260928T201148Z` ([LOSSES.md](../../data/transcripts/LOSSES.md)); its tickets T-0001 and T-0005 were recorded as abandoned after the fact. Cycles the scheduler started shipped 4 tickets (T-0020, T-0021, T-0040 and T-0003), T-0020 and T-0021 with the push completed by the supervisor. T-0040 and T-0003 reached the branch with no operator or supervisor step.
- **Benchmark.** On 44 in-house environments, a larger model beat the middle one on tier 5 (16 against 13 of 16 cells, +0.19, interval [0.13, 0.25]); the harness loop and the product's own loop were level (15 against 14 of 16, inconclusive); cutting the attempts from three to one lowered certification (−0.38, interval [−0.56, −0.19]). No frozen pair has promoted a harness change.
- **Security review.** In the three-tier comparison on one NodeGoat revision, one run each, a scanner, one model in one pass and the enterprise record `2026-09-21-nodegoat-3` found 4 of 18, 15 of 18 and 13 of 18 documented issues, counting a finding within three lines of an issue; the single pass's findings are not line-verified and its run-to-run spread is not measured. Checklists written from a diagnosis of the enterprise's misses on this application gave 18 and 18 in the two runs with them, against 14 and 15 without; that reading is in-sample, and whether they transfer to another codebase is untested. On dvja the review found 13 of 14.

## Data flow

- **Model requests.** The departments, reviewers and intake coordinators run through the operator's Claude Code login: every model request, with the contents of every file a department reads, goes to Anthropic's model API under that account.
- **Published records.** Shift records commit every session log, and the live capture commits the operator's and the departments' transcripts every five minutes, to this repository, whose visibility on GitHub is public.
- **What a client engagement needs.** Before any client code is read: an Anthropic API organisation under a data processing agreement with zero data retention, and a private repository for the records.
- **The full statement.** [Data handling](data-handling.md) names every destination, the terms of each and the operator's open decisions.

## Controls

- **Isolation.** Shift departments, reviewers, intake and code-safety reviews run unconfined, as the host user: each department works in its own worktree of a scratch clone that cannot push, which stops a mistaken push but is not a sandbox, and nothing yet limits their network or the host files and credentials they can read. Only the bench cells run in a sandbox (bubblewrap, then Landlock, on Linux).
- **Separation of duties.** The reviewer is a fresh session with no parent and an empty working directory that reads only the diff, the commit messages and the check output; the review sessions of shift 171951-516d still made 6 tool calls, after which the engine removed every tool from the reviewer, and those of shift 182951-78a6, 001527-881f, 081308-24b5, 101309-c95c and 121310-3eae made none. Code-safety findings are checked line by line by a committed examiner (exit 0 on 14 of 14 records).
- **Sign-off.** No person signs a change before it is pushed: the engine decides a shift's spec freeze and release itself. The sign-off events in 5 records were written by the engine as the program opened, at most 2 ms apart, under `enterprise-operator` and `enterprise-intake-operator` of the kind `human`. 6 records carry the engine's decisions under the machine principal `daliesk-enterprise-shift`.

## Limits and risks

- **Scale.** The pilot has shipped 7 tickets, with 34 open, over 10 shift records.
- **CI.** Of 126 completed Branch CI runs since 27 September 2026, 15:36 UTC, 19 succeeded; the newest run with a verdict failed.
- **Data-use terms.** 1,688 of 1,798 bench sessions pin data-use terms; code-safety sessions 0 of 114, shift sessions 0 of 35 and intake sessions 0 of 4.
- **One vendor.** Recorded sessions by provider route: claude-code 1,283, openrouter 29.

## Engagement

Meet the data-flow requirements above, with data-use terms naming the client, the agreement, the purposes, the residency and the retention pinned on every session; then a code-safety review of a codebase the client selects, each finding checked by the client's own engineers; then supervised shifts on an agreed queue, with a person signing each release; then decide on the measured record. The code-safety records on file review OWASP NodeGoat, Damn Vulnerable Java Application (dvja) and this repository's own code.
