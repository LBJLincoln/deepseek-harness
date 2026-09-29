# Client briefing: claims register

Every sentence of the Command Deck's client briefing (`/briefing`), rendered from `briefing.json` with its committed records as of 2026-09-29T00:15:25.000Z, with the source notes it cites; then every note with its computation and what it read. A sentence with no note of its own takes the notes of its paragraph or of the heading above it, as the Cited column states; `none` marks a sentence no note sources, such as a lead, a requirement or a statement of method, and no such sentence states a number. `pnpm run enterprise:briefing` writes this file with `briefing.json` and fails when the page holds a forbidden phrase or a sentence that states a number with no note.

## Claims

| # | Section | Sentence | Notes | Cited |
| --- | --- | --- | --- | --- |
| 1 | Cover | A pilot of an organisation of AI agents that changes a codebase through a ticket queue. | C.1 | paragraph |
| 2 | Cover | Each change is made in its own working copy, must pass the ticket’s own acceptance checks, is approved by a separate reviewer that reads the change but not the session that made it, and is pushed to the development branch as one attributable commit; continuous integration then runs on the branch. | C.1 | paragraph |
| 3 | Cover | Every step is recorded in the repository. | C.1 | sentence |
| 4 | Cover | Executive review: information, security and finance | none | none |
| 5 | Cover | LBJLincoln/deepseek-harness, branch claude/coding-agent-harness-u9l4gt | none | none |
| 6 | Cover | Every figure is computed from committed records or read from GitHub and carries a numbered source; what the records do not show is marked unknown | none | none |
| 7 | Where the pilot stands | What the pilot has delivered so far, counted only from recorded deliverables. | none | none |
| 8 | Where the pilot stands | Tickets shipped · 2 · 2 from work the operator started | 1.1, 1.2 | sentence |
| 9 | Where the pilot stands | Shipped by scheduled cycles · 0 · from the 2 cycles the scheduler started | 1.3, 1.4 | sentence |
| 10 | Where the pilot stands | Cycles run · 3 · since 28 Sep 2026, 20:11 UTC | 1.5 | sentence |
| 11 | Where the pilot stands | Shipped commits CI tested alone · 0 of 2 · a Branch CI run on the exact commit | 1.6 | sentence |
| 12 | Where the pilot stands | Seats occupied · 47 · of 147 defined, by a recorded deliverable | 1.7, 1.8 | sentence |
| 13 | Where the pilot stands | Tickets open · 39 · in the queue | 1.9 | sentence |
| 14 | Where the pilot stands | A cycle script and a scheduler that starts it are in place. | 1.10 | sentence |
| 15 | Where the pilot stands | Every two hours, at 13 minutes past an even UTC hour, the scheduler starts one cycle: intake refills the queue when fewer than 8 tickets are open, a shift works the next 2 open tickets, the divisions that need no ticket run their functions on the new branch tip, and the roster, the deck and this briefing are regenerated. | 1.10 | paragraph |
| 16 | Where the pilot stands | The operator can also start a shift or a cycle by hand. | 1.10 | paragraph |
| 17 | Where the pilot stands | This is a pilot. | 1.11, 1.3 | paragraph |
| 18 | Where the pilot stands | The 2 tickets shipped so far came from shift 182951-78a6, started by the operator. | 1.11 | sentence |
| 19 | Where the pilot stands | The scheduler has started 2 cycles, which shipped 0. | 1.3 | sentence |
| 20 | Where the pilot stands | Of these, cycle-20260928T221301Z, started 28 Sep 2026, 22:13 UTC, worked 2 tickets and shipped 0: T-0001 and T-0022 were halted (no certificate after 3 rounds), with the doc-sync check failing; cycle-20260929T001517Z, started 29 Sep 2026, 00:15 UTC, has no record of its shift on the branch yet. | 1.11, 1.3 | paragraph |
| 21 | Where the pilot stands | Section 3 sets out every unit of work. | 1.11, 1.3 | paragraph |
| 22 | The operating model | Every seat is a role grounded in a real part of this repository. | 2.1 | sentence |
| 23 | The operating model | A person owns the queue policy, the schedule and the branch; the agents work inside those limits. | 2.2 | sentence |
| 24 | The operating model | A seat is a defined role: a package steward, a verification gate, a CI judge, a review department. | 2.2 | paragraph |
| 25 | The operating model | It counts as occupied only when a recorded deliverable names it — a session, a ledger line, a CI verdict — and never by its definition alone. | 2.2 | paragraph |
| 26 | The operating model | The tags show how each division receives work. | 2.2 | sentence |
| 27 | The operating model | Operator · a person · Owns the queue policy, the schedule and the branch · Starts shifts and cycles by hand; the scheduler starts the rest | 2.1 | heading |
| 28 | The operating model | The cycle · every two hours · Intake → shift → functions → roster and deck · Started by the scheduler at 13 minutes past every even UTC hour, or by the operator | 2.1 | heading |
| 29 | The operating model | Harness Core · Stewards the product API spine: session, prompt assembly, tools, agent, the agent loop, LLM routing, and subagent delegation. · 24 seats · Tickets | 2.1 | heading |
| 30 | The operating model | Proving Ground · Operates the harness against real bench scenarios recorded under examples/headless-agent/tests. · 12 seats · Bench runs | 2.1 | heading |
| 31 | The operating model | Verification · Runs the verify-* scripts that gate changed source before it ships. · 14 seats · Cycle function: gates | 2.1 | heading |
| 32 | The operating model | Judging · Decides pass or fail at each named CI gate. · 11 seats · Cycle function: CI verdicts | 2.1 | heading |
| 33 | The operating model | Curation & Data · Curates the Agent Note corpus and fixture datasets, and keeps score of usage for the observatory. · 8 seats · Cycle function: scoreboard · Tickets | 2.1 | heading |
| 34 | The operating model | Program Departments · Coordinates cross-cutting package groups as departments of one program. · 10 seats · Intake · Tickets | 2.1 | heading |
| 35 | The operating model | Code Safety · Reviews target repositories for secrets, injection, access, data, dependency, and platform risk, per language. · 43 seats · Reviews on request | 2.1 | heading |
| 36 | The operating model | Knowledge · Keeps the repository's reusable skills current and discoverable. · 11 seats · Tickets | 2.1 | heading |
| 37 | The operating model | Governance · Owns process standards: labels, stacking, dependencies, vendoring, licensing, and translation pairing. · 8 seats · Tickets | 2.1 | heading |
| 38 | The operating model | Observatory · Watches session telemetry, token spend, and query surfaces across runs. · 6 seats · Cycle function: telemetry | 2.1 | heading |
| 39 | The operating model | Each step is performed by a different actor and leaves its own record, so the path of any change can be read back from the repository. | 2.3 | heading |
| 40 | The operating model | Continuous integration runs after the push; it reports on the branch and does not gate the change. | 2.3 | heading |
| 41 | The operating model | Intake · Program Departments coordinators · Propose tickets for their package groups when fewer than 8 are open; admission files only tickets whose checks fail on the branch tip. · data/​enterprise/​intake/​<run>/​ | 2.3 | heading |
| 42 | The operating model | Queue · The ticket file · Names the seat, the paths the change may touch, the acceptance commands and the budget. · data/​enterprise/​tickets/​T-nnnn.json | 2.3 | heading |
| 43 | The operating model | Shift · The seat’s department · Implements the ticket in its own worktree of a fresh clone of the branch. · Session log per department | 2.3 | heading |
| 44 | The operating model | Acceptance · The engine · Runs the ticket’s commands and its own checks: committed, inside scope, clean whitespace, documentation pairing. · Ledger line: checks | 2.3 | heading |
| 45 | The operating model | Blind review · An independent session · No parent and an empty directory, and no tools since the second shift; reads the diff, the commit messages and the check output, then approves or rejects. · Review session log; ledger: review | 2.3 | heading |
| 46 | The operating model | Assembly · The engine · Squashes each approved ticket into one commit on the base, checks the tree against the certified merge, and re-runs the acceptance. · Commit naming shift, ticket, seat, sessions | 2.3 | heading |
| 47 | The operating model | Push, then CI · The engine, then GitHub · One fast-forward push of the commits with the ledger lines; Branch CI then runs its static, coverage and snapshot lanes on the pushed tip, after the change is on the branch. · Shift record; GitHub Actions run | 2.3 | heading |
| 48 | The operating model | Functions · Verification, Judging, Observatory, Curation · Run the gates on the new tip, read the CI verdicts, fold telemetry and the scoreboard; the roster and this briefing are regenerated. · Ledger function lines | 2.3 | heading |
| 49 | The pilot record | Every unit of work so far, what it shipped, and what continuous integration said about it. | none | none |
| 50 | The pilot record | A unit is one run of the cycle script, or one shift the operator started outside any cycle. | 3.1 | heading |
| 51 | The pilot record | The note on each “started by” gives its evidence: the cycle’s own record when it states its starter, else the scheduler’s own log as the live capture keeps it, or when the scripts reached the branch. | 3.1 | heading |
| 52 | The pilot record | “Lost” counts tickets a shift took on that no ledger line records. | 3.1 | heading |
| 53 | The pilot record | Shift 28 Sep 2026, 17:19 UTC · 171951-516d \| Operator \| 2 \| 0 \| 0 \| 2 \| nothing shipped \| unknown | 3.2 | sentence |
| 54 | The pilot record | Shift 28 Sep 2026, 18:29 UTC · 182951-78a6 \| Operator \| 2 \| 2: T-0012 and T-0019 \| 0 \| 0 \| Exact commit: no run on either of 2 · Containing run: ✕ failed \| 1,523,167 | 3.3 | sentence |
| 55 | The pilot record | Cycle 28 Sep 2026, 20:11 UTC · cycle-20260928T201148Z · No end on the branch \| Operator \| unknown \| 0 \| 0 \| unknown \| nothing shipped \| unknown | 3.4 | sentence |
| 56 | The pilot record | Cycle 28 Sep 2026, 22:13 UTC · cycle-20260928T221301Z \| Scheduler \| 2 \| 0 \| 2: T-0001 and T-0022; doc-sync failed \| 0 \| nothing shipped \| 633,783 | 3.5 | sentence |
| 57 | The pilot record | Cycle 29 Sep 2026, 00:15 UTC · cycle-20260929T001517Z · No end on the branch yet \| Scheduler \| unknown \| 0 \| 0 \| unknown \| nothing shipped \| unknown | 3.6 | sentence |
| 58 | The pilot record | cycle-20260928T201148Z: no record of its shift and no line from it is on the branch, so what it attempted and lost is unknown; the account of the container reset that erased the shift is on the branch. | 3.7 | sentence |
| 59 | The pilot record | Shift 171951-516d: its record names 2 tickets and the ledger holds no line for 2 of them: the shift stopped before writing its ledger lines, and its record was written afterwards. | 3.8 | sentence |
| 60 | The pilot record | T-0012 Drop the test-only supportedProtocols root export from dsh-llm-pi-ai \| Llm Pi Ai Steward \| 6 of 6 passed \| approve, no tool calls \| 1d6a5d343 \| 1,047,317 \| 9 min 7 s | 3.9 | heading |
| 61 | The pilot record | T-0019 Drop the test-only STRUCTURED_OUTPUT_INSTRUCTION root export from the in-process driver \| Subagent In Process Driver Steward \| 6 of 6 passed \| approve, no tool calls \| cfe0a75f7 \| 475,850 \| 6 min 16 s | 3.9 | heading |
| 62 | The pilot record | Exact commit. | 3.10 | heading |
| 63 | The pilot record | No Branch CI run tested 1d6a5d343 or cfe0a75f7 on its own. | 3.10 | heading |
| 64 | The pilot record | Containing run. | 3.10 | heading |
| 65 | The pilot record | Run 36469749793 on 52c56001d, the push that carried them, started 28 Sep 2026, 19:05 UTC: ✕ failed. | 3.10 | heading |
| 66 | The pilot record | ✓ · coverage · passed | 3.10 | heading |
| 67 | The pilot record | ✕ · snapshots and artifacts · failed | 3.10 | heading |
| 68 | The pilot record | test:snapshot · already failing before the shift | 3.10 | heading |
| 69 | The pilot record | web browser snapshot · already failing before the shift | 3.10 | heading |
| 70 | The pilot record | ✕ · static · failed | 3.10 | heading |
| 71 | The pilot record | translation pairing · introduced by this push | 3.10 | heading |
| 72 | The pilot record | The introduced failure came from the first shipped ticket: its department edited a documentation pair without re-recording the pair’s consistency record. | 3.11 | paragraph |
| 73 | The pilot record | The engine now runs that check before a change can be approved. | 3.11 | sentence |
| 74 | The pilot record | The first fully successful run containing them, on 2f7ba31d7, finished at 19:40 UTC, 35 min 14 s after the push. | 3.10 | heading |
| 75 | The pilot record | Branch CI runs the static, coverage and snapshot lanes on every push to the development branch. | 3.13 | paragraph |
| 76 | The pilot record | Of 60 completed runs since 27 Sep 2026, 15:36 UTC, 7 passed, 24 failed and 29 were cancelled by a later push before a verdict. | 3.13 | sentence |
| 77 | The pilot record | The newest run with a verdict finished at 29 Sep 2026, 01:46 UTC and passed. | 3.13 | paragraph |
| 78 | The pilot record | 47 of 147 seats are occupied by a recorded deliverable, and 39 delivered in the 24 hours to 29 Sep 2026, 00:14 UTC. | 3.15 | paragraph |
| 79 | The pilot record | Governance has no occupied seat yet. | 3.15 | paragraph |
| 80 | The pilot record | Ten seats are vacant by construction: five CI judges whose lanes this fork does not run and five observers whose backends nothing here composes. | 3.15 | sentence |
| 81 | Measured quality | How well the harness and the code-safety program perform, measured against tasks and targets whose answers are known. | none | none |
| 82 | Measured quality | The harness is measured on 44 task environments across 6 domains; the two hardest tiers are judged on hidden cases the implementer never sees. | 4.1, 4.2 | sentence |
| 83 | Measured quality | A frozen paired experiment runs the same cells under two arms that differ in one field and reads the difference with a bootstrap interval; its verdict is promote or reject only when the interval clears the plan’s thresholds. | 4.1, 4.2, 4.3, 4.4 | paragraph |
| 84 | Measured quality | 22 frozen pairs are on record, and 3 reached a decisive verdict. | 4.3, 4.4 | sentence |
| 85 | Measured quality | The model matters most. | 4.5 | heading |
| 86 | Measured quality | On tier 5 a larger model certified 16 of 16 cells against 13 for the middle model (+0.19, interval [0.13, 0.25], promote); a smaller one certified 1 against 14 (−0.81, interval [−0.88, −0.75], reject). | 4.5 | heading |
| 87 | Measured quality | The harness loop and the product’s own loop are level on results. | 4.5 | heading |
| 88 | Measured quality | 15 against 14 of 16 sealed tier-5 cells (−0.06, interval [−0.13, 0.00], inconclusive); 40 against 40 of 40 on the public polyglot suite. | 4.5 | heading |
| 89 | Measured quality | Retrying helps, by less than the first reading. | 4.5 | heading |
| 90 | Measured quality | Three attempts against one read −0.38, interval [−0.56, −0.19], reject in the first pair; the 2 replications read −0.06, interval [−0.13, 0.00], inconclusive and −0.06, interval [−0.19, 0.06], inconclusive. | 4.5 | heading |
| 91 | Measured quality | No harness mechanism has been promoted. | 4.5 | heading |
| 92 | Measured quality | The largest mechanism reading, a self-review turn before validation, is +0.17, interval [−0.04, 0.38], inconclusive. | 4.5 | heading |
| 93 | Measured quality | The instrument’s resolution. | 4.6 | paragraph |
| 94 | Measured quality | A repeat of the same 16 cells differs by about one cell, so one pair of 16 cannot resolve an effect smaller than about 0.19. | 4.6 | sentence |
| 95 | Measured quality | The code-safety program reviews a codebase in six departments — secrets, injection, access, data, dependencies and platform — and a committed examiner rejects any finding whose cited line does not hold. | 4.7 | paragraph |
| 96 | Measured quality | Recall is read against targets whose defects are documented: OWASP NodeGoat, with 18 issues, and Damn Vulnerable Java Application (dvja), with 14. | 4.7 | paragraph |
| 97 | Measured quality | A documented issue counts as found when a finding cites its file within three lines of the issue’s lines. | 4.7 | sentence |
| 98 | Measured quality | On this small application one model in one pass found 15 of 18 documented issues, more than the enterprise’s 13; the scanner found 4. | 4.9 | paragraph |
| 99 | Measured quality | The enterprise released 47 findings, each checked by the examiner at the line it cites, with a record of how every finding was reached; the single pass released 23, none checked. | 4.9 | sentence |
| 100 | Measured quality | 12 reviews of the same revision found between 13 and 18 of 18 documented issues, each within three lines. | 4.10 | heading |
| 101 | Measured quality | A generalist department added nothing. | 4.10 | heading |
| 102 | Measured quality | Checklists written from a diagnosis of the enterprise’s misses on this application found 18 and 18 in their two runs against 14 and 15 without them; whether they transfer to another codebase is untested. | 4.10 | heading |
| 103 | Measured quality | On Damn Vulnerable Java Application (dvja) the review found 13 of 14. | 4.10 | heading |
| 104 | Measured quality | With no ground truth for a client’s code, recall is read by planting defects in a copy without telling the review. | 4.12 | paragraph |
| 105 | Measured quality | On this repository’s own packages the review caught 6 of 8 planted defects within three lines, 95% interval 0.41 to 0.93. | 4.12 | paragraph |
| 106 | Measured quality | Three of the planted sites carried no reachable defect; on the five that did, it caught five. | 4.12 | sentence |
| 107 | Data handling, governance and audit | Where a client’s code and the records of the work go, the controls on what an agent can read, run and ship, and the record that makes each action attributable. | none | none |
| 108 | Data handling, governance and audit | A shift runs on one review machine. | 5.1 | sentence |
| 109 | Data handling, governance and audit | Four movements of data cross its edge; the arrows point the way the data moves. | 5.1 | paragraph |
| 110 | Data handling, governance and audit | A scratch clone of the branch, one worktree per department · cloned at the start of each shift · GitHub: the development branch | 5.1 | sentence |
| 111 | Data handling, governance and audit | Department, reviewer and intake sessions · every model request: the conversation, with the contents of each file a department reads · Anthropic’s model API, under the operator’s Claude Code login | 5.2 | sentence |
| 112 | Data handling, governance and audit | Shift records: every session log · committed and pushed at the end of each shift · GitHub: this repository, public | 5.3 | sentence |
| 113 | Data handling, governance and audit | Claude Code transcripts of the operator and of every department · pushed every 5 minutes; credential-shaped strings masked, the rest as written · GitHub: this repository, public | 5.4 | sentence |
| 114 | Data handling, governance and audit | The repository’s visibility on GitHub is public. | 5.5 | sentence |
| 115 | Data handling, governance and audit | A client’s code read by a department therefore reaches Anthropic’s model API under the operator’s Claude Code login, and the session logs and transcripts that hold it are published with the repository. | 5.5 | paragraph |
| 116 | Data handling, governance and audit | An Anthropic API organisation for the engagement, under a data processing agreement with zero data retention, in place of the operator’s login. | none | none |
| 117 | Data handling, governance and audit | The records, session logs and transcripts of the engagement kept in a private repository, and the live capture pointed at it. | none | none |
| 118 | Data handling, governance and audit | Data-use terms naming the client, the agreement, the purposes, the residency and the retention pinned on every session. | 5.6 | sentence |
| 119 | Data handling, governance and audit | Execution isolation \| The harness’s sandbox confines commands at the operating system: bubblewrap, then Landlock on Linux; Seatbelt on macOS; a restricted token on Windows. | 5.7, 5.8, 5.9 | paragraph |
| 120 | Data handling, governance and audit | An unusable sandbox stops the command instead of running it unconfined. \| Every bench cell has run sealed since 8 Sep 2026, 09:25 UTC: only the cell’s workspace is visible to it. | 5.7, 5.8 | sentence |
| 121 | Data handling, governance and audit | Shift departments do not yet run under it: each works in its own worktree of a scratch clone whose push address is unreachable, and the product’s permission list names the commands it may run. | 5.9 | sentence |
| 122 | Data handling, governance and audit | Least privilege on reads \| The read barrier denies implementing and judging sessions the directories the validator owns, enforced where the filesystem capability opens a path. \| Reads refused on the code-safety records: 0. | 5.10, 5.11 | sentence |
| 123 | Data handling, governance and audit | Separation of duties \| The reviewer of a change is a separate session with no parent and an empty directory, and has had no tools since the second shift; it sees the diff, the commit messages and the check output, not the implementer’s work. \| Shift 171951-516d: 2 reviews, 6 tool calls; Shift 182951-78a6: 2 reviews, 0 tool calls. | 5.12, 5.13 | sentence |
| 124 | Data handling, governance and audit | Independent verification \| A committed examiner re-reads every code-safety finding at the line it cites and fails the release if the text is not there. \| Records whose examiner passed: 14 of 14. | 5.14, 5.15 | sentence |
| 125 | Data handling, governance and audit | Sign-off \| A shift and an intake each record a spec freeze and a release. | 5.16, 5.17 | paragraph |
| 126 | Data handling, governance and audit | A person’s sign-off would carry the principal, the SHA-256 of what was signed and the evidence, unauthenticated; unattended runs record both as decisions of the engine, under a machine principal, and no person approves a release. \| 8 sign-off events in 4 records were written by the engine as the program opened, at most 2 ms apart, under “enterprise-operator” and “enterprise-intake-operator” with the kind “human”: machine decisions labelled as a person’s. | 5.16 | sentence |
| 127 | Data handling, governance and audit | No record carries the engine’s decisions yet. | 5.16, 5.17 | paragraph |
| 128 | Data handling, governance and audit | No person signs a change before it is pushed. | 5.17 | sentence |
| 129 | Data handling, governance and audit | Data use and retention \| A session pins its terms when it is created — client, agreement, purposes, residency, retention, redaction profile — and later terms may only narrow them. | 5.6, 5.18 | paragraph |
| 130 | Data handling, governance and audit | Exports are refused without a redaction profile. \| 1,688 of 1,798 bench sessions pin terms; code-safety 0 of 114, shifts 0 of 15, intake 0 of 4. | 5.6, 5.18 | sentence |
| 131 | Data handling, governance and audit | Secrets in records \| Key material a review reads out of a target is replaced before its record is committed; shift records cut credential-shaped strings and count them, and the live capture masks them. \| Code-safety records with redactions: 14; strings cut from shift records: 0. | 5.19, 5.20, 5.21 | sentence |
| 132 | Data handling, governance and audit | Audit trail \| The ledger is appended and never rewritten; each shift record keeps every session log with each file’s SHA-256; each commit names its shift, ticket, seat, program and sessions. | 5.22, 5.23, 5.24 | paragraph |
| 133 | Data handling, governance and audit | Anything that reaches a model is reconstructable from the session log. \| Ledger lines: 63; session logs in committed records: 1,912. | 5.22, 5.23, 5.24 | sentence |
| 134 | Economics | What a shipped change costs in model tokens and time, as the records state it. | 6.1 | paragraph |
| 135 | Economics | The records carry no currency. | 6.1 | sentence |
| 136 | Economics | Tokens per shipped ticket · 761,584 · mean of 2, department and review | 6.2 | sentence |
| 137 | Economics | Agent time per ticket · 7.7 min · mean of 2, department and review | 6.3 | sentence |
| 138 | Economics | Shift, clone to push · 34.6 min · mean of 1 shift that shipped | 6.4 | sentence |
| 139 | Economics | Security review time · 20.4–28.8 min · per review, over 14 reviews | 6.5 | sentence |
| 140 | Economics | T-0012 \| 1,047,317 \| 9 min 7 s | 6.6 | heading |
| 141 | Economics | T-0019 \| 475,850 \| 6 min 16 s | 6.6 | heading |
| 142 | Economics | Price per change is not recorded. | 6.1 | paragraph |
| 143 | Economics | Unknown: every shift ran on a flat-rate subscription route, so a per-ticket price would be an estimate, and this briefing states none. | 6.1 | sentence |
| 144 | Economics | A single model pass is cheaper and faster, and unchecked. | 6.7 | paragraph |
| 145 | Economics | On the same application one pass took 113 s and cost $0.36 by its own accounting; the enterprise took 22 min 36 s on the subscription and had every finding checked at its cited line. | 6.7 | sentence |
| 146 | Economics | Scale is not yet established. | 6.6 | paragraph |
| 147 | Economics | These means rest on 2 shipped tickets; a cost model for a client queue needs a pilot measured the same way. | 6.6 | sentence |
| 148 | Limits and risks | What the evidence does not show, and the risks a client should weigh. | none | none |
| 149 | Limits and risks | A pilot, not yet unattended delivery. | 7.1, 7.2, 7.3 | paragraph |
| 150 | Limits and risks | 2 tickets have shipped (“Drop the test-only supportedProtocols root export from dsh-llm-pi-ai” and “Drop the test-only STRUCTURED_OUTPUT_INSTRUCTION root export from the in-process driver”), all from work the operator started. | 7.1 | sentence |
| 151 | Limits and risks | The cycles the scheduler started have shipped 0, and a container reset erased the shift of cycle-20260928T201148Z before it recorded anything. | 7.2, 7.3 | sentence |
| 152 | Limits and risks | Shift work is not yet sandboxed. | 7.4 | paragraph |
| 153 | Limits and risks | A department runs its commands unconfined in a worktree of a scratch clone that cannot push; the sandbox and the sealed workspace are in use on the bench only. | 7.4 | sentence |
| 154 | Limits and risks | Continuous integration has only lately turned green. | 7.5, 7.6 | paragraph |
| 155 | Limits and risks | The newest Branch CI run with a verdict passed; 7 of 60 completed Branch CI runs passed. | 7.5 | sentence |
| 156 | Limits and risks | No run tested a shipped commit on its own (0 of 2), and the containing run of the push that carried them failed. | 7.6 | sentence |
| 157 | Limits and risks | A client’s code would leave the machine. | 7.7 | paragraph |
| 158 | Limits and risks | Every model request, with the files a department reads, goes to Anthropic under the operator’s Claude Code login, and the session logs and transcripts are published with a public repository. | 7.7 | sentence |
| 159 | Limits and risks | The requirements in section 5 come first. | 7.7 | paragraph |
| 160 | Limits and risks | No person signs. | 7.8 | paragraph |
| 161 | Limits and risks | The engine decides each shift’s spec freeze and release itself, and no person approves a change before it is pushed; the 4 records that hold sign-off events label the engine’s decisions with a principal of the kind “human”. | 7.8 | sentence |
| 162 | Limits and risks | Data-use terms are not yet pinned on delivery work. | 7.9 | paragraph |
| 163 | Limits and risks | Sessions that pin terms: code-safety 0 of 114, shift 0 of 15, intake 0 of 4. | 7.9 | sentence |
| 164 | Limits and risks | One vendor. | 7.10 | paragraph |
| 165 | Limits and risks | 98% of the recorded sessions that made a model request ran on one route, claude-code (1,283 of 1,312); a route’s usage limit halts a shift. | 7.10 | sentence |
| 166 | Limits and risks | The benchmark is narrow. | 7.11, 7.12 | paragraph |
| 167 | Limits and risks | The tasks are written in-house; the harness measured runs an eight-tool build rather than the full shipped composition; and no harness change has been promoted by a frozen pair. | 7.11, 7.12 | sentence |
| 168 | Limits and risks | Security recall is read on training applications. | 7.13 | paragraph |
| 169 | Limits and risks | The documented-defect targets are public, intentionally vulnerable applications; the checklist gain may not transfer; the review of this repository’s own code confirmed none of its findings and missed a defect its triage found. | 7.13 | sentence |
| 170 | Limits and risks | A developer preview. | 7.14 | paragraph |
| 171 | Limits and risks | The harness underneath is in developer preview and will change incompatibly. | 7.14 | sentence |
| 172 | Roadmap and engagement | The work that closes the limits above, and a proposed way to start with a client. | none | none |
| 173 | Roadmap and engagement | Data handling before any client work. | 8.1 | paragraph |
| 174 | Roadmap and engagement | Serve the departments from an Anthropic API organisation under a data processing agreement with zero data retention, keep the records in a private repository, and pin data-use terms on every session. | 8.1 | sentence |
| 175 | Roadmap and engagement | Sign-off and isolation. | 8.2 | paragraph |
| 176 | Roadmap and engagement | Have a person sign each release after the certificate, under a principal the engine does not configure; run shift departments under the sandbox the bench already uses. | 8.2 | sentence |
| 177 | Roadmap and engagement | Unattended delivery, measured. | 8.3 | paragraph |
| 178 | Roadmap and engagement | Clear the doc-sync check that halted the scheduled cycles’ tickets and keep Branch CI green, then count what cycles ship without an operator, in the table of section 3. | 8.3 | sentence |
| 179 | Roadmap and engagement | Evidence that others can check. | 8.2 | paragraph |
| 180 | Roadmap and engagement | Measure on public suites and on private tasks no model has seen, with more cells per arm, before promoting any harness change. | 8.2 | sentence |
| 181 | Roadmap and engagement | More than one model vendor. | 8.2 | paragraph |
| 182 | Roadmap and engagement | Run the same cells on more routes, so a result is not one vendor’s. | 8.2 | sentence |
| 183 | Roadmap and engagement | Full CI coverage. | 8.4 | paragraph |
| 184 | Roadmap and engagement | Compose the Windows and primary lanes this fork lacks, so the vacant judge seats rule on real runs. | 8.4 | sentence |
| 185 | Roadmap and engagement | Data handling, terms and scope | none | none |
| 186 | Roadmap and engagement | An Anthropic API organisation for the engagement under a data processing agreement with zero data retention; a private repository for the records; the data-use terms each session will pin; and the people who sign. | 8.1 | sentence |
| 187 | Roadmap and engagement | A code-safety review of a codebase the client selects | none | none |
| 188 | Roadmap and engagement | Six departments, each finding checked at the line it cites, the report with executive summaries in French and English; recall read by planting defects in a copy. | 8.5 | sentence |
| 189 | Roadmap and engagement | On the reference application one review took up to 28.8 min. | 8.6 | sentence |
| 190 | Roadmap and engagement | Supervised shifts on an agreed queue | none | none |
| 191 | Roadmap and engagement | Tickets under the client’s own acceptance commands, a person signing each release, measured as this briefing measures: checks, reviews, CI verdicts, tokens and time per ticket. | 8.7 | sentence |
| 192 | Roadmap and engagement | Decision | none | none |
| 193 | Roadmap and engagement | Continue, widen or stop on the measured record, not on this document. | none | none |
| 194 | Inputs and verification | Every figure above was computed by pnpm run enterprise:briefing from these inputs. | A.1 | sentence |
| 195 | Inputs and verification | For a directory, the digest covers the list of every file read under it with that file’s own SHA-256. | A.1 | paragraph |
| 196 | Inputs and verification | data/code-safety \| 143 \| 57,279,997 \| e8c8a775e9bae5e6 | A.1 | heading |
| 197 | Inputs and verification | data/code-safety/comparisons/2026-09-22-nodegoat \| 4 \| 27,740 \| 5fcb648fac65808a | A.1 | heading |
| 198 | Inputs and verification | data/code-safety/targets \| 2 \| 13,389 \| 887633e5b05335fd | A.1 | heading |
| 199 | Inputs and verification | data/enterprise/intake \| 8 \| 991,311 \| 60e68f0dcaf2e981 | A.1 | heading |
| 200 | Inputs and verification | data/enterprise/ledger.jsonl \| 1 \| 26,349 \| 89734c4ee7750c42 | A.1 | heading |
| 201 | Inputs and verification | data/enterprise/roster.json \| 1 \| 124,368 \| 9c29093b83d494d1 | A.1 | heading |
| 202 | Inputs and verification | data/enterprise/shifts \| 21 \| 2,349,252 \| 1674658e179c9e86 | A.1 | heading |
| 203 | Inputs and verification | data/enterprise/tickets \| 41 \| 126,589 \| 682350c1c548aba1 | A.1 | heading |
| 204 | Inputs and verification | data/proving-ground \| 1,821 \| 262,478,081 \| c14058044e036c5a | A.1 | heading |
| 205 | Inputs and verification | data/proving-ground/folds \| 14 \| 61,768 \| 1bcb94a44d402448 | A.1 | heading |
| 206 | Inputs and verification | data/transcripts/live/enterprise-cycles \| 7 \| 20,855 \| 8e671623e4bd5186 | A.1 | heading |
| 207 | Inputs and verification | examples/headless-agent/tests/fixtures/proving-ground-bench/environments \| 44 \| 171,312 \| 085622d1978d280e | A.1 | heading |
| 208 | Inputs and verification | Open its source note: it names the paths read and the computation. | none | none |
| 209 | Inputs and verification | Open the path on the branch; the Proving Ground and code-safety records carry their own manifests with each file’s SHA-256. | none | none |
| 210 | Inputs and verification | Rebuild with pnpm run enterprise:briefing on a checkout of the branch and compare apps/command-deck/public/fixtures/briefing.json. | none | none |
| 211 | Inputs and verification | Read the claims register, briefing-claims.md: every sentence of this page with the notes it cites. | A.2 | sentence |

## Notes

| Note | Computation | Read from |
| --- | --- | --- |
| C.1 | The shift engine as its Agent Note and the enterprise README describe it: a worktree per ticket, the ticket’s acceptance checks, a separate reviewer given the diff, the commit messages and the check output, one commit per ticket pushed to the development branch, Branch CI on the pushed tip, and the record each step leaves. | `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md`, `data/enterprise/README.md` |
| 1.1 | Tickets whose newest ticket line names a shipped commit. | `data/enterprise/ledger.jsonl` |
| 1.2 | Tickets shipped by the ledger lines of the shifts the operator started, directly or through a cycle. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, `data/enterprise/shift-starts.jsonl`, `data/enterprise/cycles`, `data/transcripts/live/enterprise-cycles`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 1.3 | Tickets shipped by the ledger lines of the shifts of the cycles the scheduler started. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, `data/enterprise/shift-starts.jsonl`, `data/enterprise/cycles`, `data/transcripts/live/enterprise-cycles`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 1.4 | Cycles whose record states scheduler, or else that the captured scheduler log reports running, or the first to start at or after a slot it announced. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, `data/enterprise/shift-starts.jsonl`, `data/enterprise/cycles`, `data/transcripts/live/enterprise-cycles`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 1.5 | Runs of scripts/enterprise-cycle.sh the branch names, by a cycle commit's subject (git log), a ledger function line, a cycle record or a captured cycle log. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, `data/enterprise/shift-starts.jsonl`, `data/enterprise/cycles`, `data/transcripts/live/enterprise-cycles`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 1.6 | Shipped commits with a Branch CI run on exactly that commit, rather than on a later commit that contains it. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, <https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml> |
| 1.7 | counts.occupied: seats with at least one attributed recorded session or one ledger line naming them. | `data/enterprise/roster.json` |
| 1.8 | counts.defined: the seats the roster defines. | `data/enterprise/roster.json` |
| 1.9 | Tickets whose newest ledger line is neither shipped nor rejected, or that have no line. | `data/enterprise/tickets`, `data/enterprise/ledger.jsonl` |
| 1.10 | The cycle and the scheduler as their scripts document them: one cycle every 2 hours, at 13 minutes past every even UTC hour, or when the operator starts one; intake when fewer than 8 tickets are open; a shift over the next 2 open tickets. These are the scripts’ defaults. | `data/enterprise/README.md`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 1.11 | Every cycle the branch names and every shift record outside all of them; a cycle's shifts are those its record lists, or the shift records that start between its start and the next cycle's (and before its shift step ended, when its captured log states that step); per unit, the tickets its shift records name, the ledger lines of those shifts by status, the named tickets no line records, and the lines' tokens. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, `data/enterprise/shift-starts.jsonl`, `data/enterprise/cycles`, `data/transcripts/live/enterprise-cycles`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 2.1 | Per division: seats defined; seats with an attributed session or a ledger line; seats whose status is active. | `data/enterprise/roster.json` |
| 2.2 | How each division is engaged: the functions table and the cycle in the enterprise README, and the divisions that hold tickets in the queue README. | `data/enterprise/README.md`, `data/enterprise/tickets/README.md` |
| 2.3 | The shift engine as its Agent Note and the enterprise README describe it, step by step, with the record each step leaves. | `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md`, `data/enterprise/README.md`, `data/enterprise/tickets/README.md` |
| 3.1 | Every cycle the branch names and every shift record outside all of them; a cycle's shifts are those its record lists, or the shift records that start between its start and the next cycle's (and before its shift step ended, when its captured log states that step); per unit, the tickets its shift records name, the ledger lines of those shifts by status, the named tickets no line records, and the lines' tokens. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, `data/enterprise/shift-starts.jsonl`, `data/enterprise/cycles`, `data/transcripts/live/enterprise-cycles`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 3.2 | Started by: operator. It started before scripts/enterprise-cycle.sh reached the branch (2026-09-28T20:10:45.000Z); a shift outside a cycle is started by hand with pnpm run enterprise -- shift. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts/2026-09-28-171951-516d` |
| 3.3 | Started by: operator. It started before scripts/enterprise-cycle.sh reached the branch (2026-09-28T20:10:45.000Z); a shift outside a cycle is started by hand with pnpm run enterprise -- shift. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts/2026-09-28-182951-78a6` |
| 3.4 | Started by: operator. It started before scripts/enterprise-scheduler.sh reached the branch (2026-09-28T20:41:16.000Z), so the scheduler cannot have started it. | `data/enterprise/ledger.jsonl`, `data/transcripts/live/enterprise-cycles/2026-09-28/enterprise-cycles_scheduler.log-3a345e4a9b` |
| 3.5 | Started by: scheduler. The captured scheduler log reports running the cycle whose log it stamped 2026-09-28T22:13:00.000Z. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts/2026-09-28-221520-e979`, `data/transcripts/live/enterprise-cycles/2026-09-28/enterprise-cycles_cycle-20260928T221300Z.log-932c179ac5`, `data/transcripts/live/enterprise-cycles/2026-09-28/enterprise-cycles_scheduler.log-3a345e4a9b` |
| 3.6 | Started by: scheduler. The captured scheduler log announced the slot 2026-09-29T00:13:00.000Z, and this is the first cycle to start at or after it. | `data/enterprise/ledger.jsonl`, `data/transcripts/live/enterprise-cycles/2026-09-29/enterprise-cycles_cycle-20260929T001517Z.log-e8b966e567`, `data/transcripts/live/enterprise-cycles/2026-09-28/enterprise-cycles_scheduler.log-3a345e4a9b` |
| 3.7 | What the container resets of 2026-09-28 erased, stated from commits and files on the branch: the shift the 22:07Z reset interrupted, and why no line or record of it exists. | `data/transcripts/LOSSES.md` |
| 3.8 | Each shift record's result.json and manifest.json: the tickets worked, the tickets shipped, the start and the end, and the reason a partial record gives. | `data/enterprise/shifts` |
| 3.9 | The newest ticket line of every ticket whose line names a shipped commit, with the queue file's title, the seat's name, the shift record's base commit and the review session's tool calls. | `data/enterprise/ledger.jsonl`, `data/enterprise/tickets`, `data/enterprise/shifts`, `data/enterprise/roster.json` |
| 3.10 | The Branch CI runs of claude/coding-agent-harness-u9l4gt: the earliest run whose commit contains 1d6a5d343 (git merge-base --is-ancestor), the run on the shift's base commit, and the earliest successful run containing it; failed gates read from each failed job's log. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, <https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml> |
| 3.11 | The shift engine note: the first shipped commit edited a README pair without re-recording its pairing record; the queue policy’s documentation gate now runs that check in the department, the integration and the recertification. | `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md` |
| 3.12 | Every Branch CI run of claude/coding-agent-harness-u9l4gt, oldest first, with its conclusion. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, <https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml> |
| 3.13 | Completed Branch CI runs of claude/coding-agent-harness-u9l4gt. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, <https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml> |
| 3.14 | Per division: seats defined; seats with an attributed session or a ledger line; seats whose status is active. | `data/enterprise/roster.json` |
| 3.15 | The vacancy table: five judge seats whose CI lanes this fork does not run and five observer seats whose backends nothing here composes. | `data/enterprise/README.md`, `.agents/notes/implemented/architecture/2026-09-28-enterprise-functions-and-occupancy.md` |
| 4.1 | Environment directories carrying a task.json. | `examples/headless-agent/tests/fixtures/proving-ground-bench/environments` |
| 4.2 | Distinct domain fields of those task.json files. | `examples/headless-agent/tests/fixtures/proving-ground-bench/environments` |
| 4.3 | Records whose result.json carries a verdict, an interval and at least one paired cell. | `data/proving-ground` |
| 4.4 | Frozen pairs whose current verdict (a re-read fold's when one exists) is promote or reject. | `data/proving-ground` |
| 4.5 | Each frozen pair's result.json: delta, interval and verdict as recorded, certificates per arm as the sum of each cell's rate times its pairs, and a re-read fold's reading when one exists. | `data/proving-ground`, `data/proving-ground/folds` |
| 4.6 | The results note: two sealed runs of the same arm agree on 15 of 16 cells, so a paired delta of one cell in sixteen is inside one arm’s own variation, and sixteen cells give an interval no narrower than about ±0.19. | `.agents/notes/proposed/architecture/2026-09-08-hypothesis-program-results.md` |
| 4.7 | Each record's findings.json read against its target's ground truth: an issue is found when a finding cites its file within three lines of its range or of an alsoAt location. | `data/code-safety`, `data/code-safety/targets` |
| 4.8 | Each tier's findings read against the ground truth by the same three-line rule; the single model's cost and time from its own metadata; the enterprise tier's from its record's manifest. | `data/code-safety/comparisons/2026-09-22-nodegoat`, `data/code-safety/targets/nodegoat.ground-truth.json` |
| 4.9 | The comparison’s authored reading: the tiers, the gap list and the three improvement iterations with their decisions. | `data/code-safety/comparisons/2026-09-22-nodegoat/README.md` |
| 4.10 | NodeGoat records read against the 18-issue ground truth. | `data/code-safety`, `data/code-safety/targets/nodegoat.ground-truth.json` |
| 4.11 | The record's seeded-recall reading as seeded-recall.mjs wrote it: planted canaries caught by the three-line rule, with a Wilson 95% interval. | `data/code-safety/2026-09-28-dsh-self-review/seeded-recall.json` |
| 4.12 | The code-safety README: three of the eight planted sites wrap an already narrowed value and carry no reachable defect; on the five that do, the review caught five. | `data/code-safety/README.md` |
| 5.1 | A shift clones the development branch into a scratch directory, gives each department its own worktree of that clone, points the clone’s push address at an unreachable URL, and pushes once from it at the end. | `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md`, `data/enterprise/README.md` |
| 5.2 | The shift’s and the intake’s Claude Code overlays route every department, reviewer and coordinator through the operator’s own authenticated Claude Code installation; the route serves each model request as one query to it, whose prompt carries the conversation, tool results included. | `examples/headless-agent/tests/fixtures/enterprise-shift/overlays/claude-code.cordis.yml`, `examples/headless-agent/tests/fixtures/enterprise-intake/overlays/claude-code.cordis.yml`, `packages/llm/llm-claude-code/README.md` |
| 5.3 | A shift commits its record, result.json, manifest.json and every session log, with its ledger lines, and pushes it to the development branch. | `data/enterprise/README.md`, `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md` |
| 5.4 | The live capture appends what is new in every Claude Code project directory (the operator’s session and its subagents, and the sessions of departments, reviewers and intake coordinators), the shifts’ session directories and the cycle logs, masks credential-shaped strings, and pushes the result every 5 minutes. | `data/transcripts/README.md`, `scripts/transcripts-capture.sh` |
| 5.5 | The visibility field of GitHub's answer to GET /repos/LBJLincoln/deepseek-harness. | <https://github.com/LBJLincoln/deepseek-harness> |
| 5.6 | Data-use terms pinned to a session at creation (client, agreement, purposes, residency, retention, redaction profile); the curator refuses to export without a redaction profile and withholds sessions whose terms do not admit the purpose. | `packages/governance/data-use/README.md`, `packages/governance/curator/README.md` |
| 5.7 | The local sandbox provider: bubblewrap, then Landlock on Linux, Seatbelt on macOS, a restricted token on Windows; an unusable runner fails with SANDBOX_UNAVAILABLE rather than running unconfined. | `packages/sandbox/sandbox-local/README.md`, `packages/sandbox/sandbox-policy/README.md` |
| 5.8 | Since 2026-09-08 09:25 UTC every bench cell is sealed: an empty directory is mounted over the run directory with only the cell’s workspace bound back in. | `.agents/notes/proposed/architecture/2026-09-08-hypothesis-program-results.md`, `data/proving-ground/README.md` |
| 5.9 | The shift composition runs shell commands through the local bash provider, not the sandbox; each department works in its own worktree of a scratch clone and pushes through an origin whose push URL is unreachable; the Claude Code overlay states the edits and version-control commands a department may run without a prompt. | `examples/headless-agent/tests/fixtures/enterprise-shift/cordis.yml`, `examples/headless-agent/tests/fixtures/enterprise-shift/overlays/claude-code.cordis.yml`, `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md` |
| 5.10 | The read barrier: implementer and judge sessions are denied the validator-owned tree; the filesystem capability enforces the decision where it opens a path. | `packages/verification/read-barrier/README.md`, `packages/fs/fs-read-barrier/README.md` |
| 5.11 | The sum of denials, the reads the read barrier refused, over the manifest.json of every code-safety record. | `data/code-safety` |
| 5.12 | The shift’s reviewer: a fresh session with no parent and no seed, the judge preset, an empty working directory, and a history of the ticket and the evidence only; since the second shift every tool is restricted away from it. | `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md`, `packages/verification/judge/README.md` |
| 5.13 | Per shift: its review-*.jsonl session logs and the tool/call events they record. | `data/enterprise/shifts` |
| 5.14 | What a code-safety record proves: every released finding existed at the line it cites, in the locked tree, when the committed examiner ran over the merged head. | `data/code-safety/README.md`, `examples/headless-agent/tests/fixtures/program-code-safety/README.md` |
| 5.15 | Code-safety records whose manifest.json states verifier.exitCode 0: the committed examiner found every cited line as cited. | `data/code-safety` |
| 5.16 | The sign-off plugin records a person’s signature, with the principal, the artefact’s SHA-256 and the evidence, and never authenticates it; unattended shifts and intakes compose no sign-off plugin and record their spec freeze and release as decisions of a machine principal, with no human release gate. | `packages/governance/signoff/README.md`, `examples/headless-agent/tests/fixtures/enterprise-shift/README.md`, `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md` |
| 5.17 | Every signoff/recorded event in the shift and intake records' session logs, with its transition, principal id, declared kind and time, and every entry of the decisions their result.json states, with its transition, principal id and kind. | `data/enterprise/shifts`, `data/enterprise/intake` |
| 5.18 | Session logs under each family's sessions/ directories, and those carrying a dataUse/terms event. | `data/proving-ground`, `data/code-safety`, `data/enterprise/shifts`, `data/enterprise/intake` |
| 5.19 | Code-safety records replace private key material and example cloud keys before commit and list the files touched under redactions; a shift record cuts credential-shaped strings from its session logs and counts them; the live capture masks credential-shaped strings. | `data/code-safety/README.md`, `data/enterprise/README.md`, `data/transcripts/README.md` |
| 5.20 | Code-safety records whose manifest.json lists under redactions.files at least one file in which key material was replaced before commit. | `data/code-safety` |
| 5.21 | The sum of redacted, the credential-shaped strings cut from each shift record. | `data/enterprise/shifts` |
| 5.22 | The ledger is appended and never rewritten; a shift record holds result.json, manifest.json with every file’s SHA-256 and every session log; each ticket commit names the shift, ticket, seat, program and sessions; model-visible input is logged. | `data/enterprise/README.md`, `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md`, `AGENTS.md` |
| 5.23 | Lines the ledger reader accepted. | `data/enterprise/ledger.jsonl` |
| 5.24 | evidence.sessions: the session logs of the committed records the roster read. | `data/enterprise/roster.json` |
| 6.1 | Unknown: the ledger records tokens and seconds; the route is a flat-rate subscription and no record carries a price per ticket. Currency per shipped ticket. | `data/enterprise/ledger.jsonl` |
| 6.2 | Mean of the tokens field over the 2 shipped tickets' lines: department and review model tokens. | `data/enterprise/ledger.jsonl` |
| 6.3 | Mean of the seconds field over the 2 shipped tickets' lines: department and review time. | `data/enterprise/ledger.jsonl` |
| 6.4 | Mean of endedAt minus startedAt over the 1 shift records that shipped a ticket: from the clone to the push. | `data/enterprise/shifts/2026-09-28-182951-78a6/manifest.json` |
| 6.5 | The smallest elapsedSeconds over the manifest.json of every code-safety record. | `data/code-safety` |
| 6.6 | The tokens and seconds fields of each shipped ticket's line: the department's and the review's model tokens and time. | `data/enterprise/ledger.jsonl` |
| 6.7 | Each tier's findings read against the ground truth by the same three-line rule; the single model's cost and time from its own metadata; the enterprise tier's from its record's manifest. | `data/code-safety/comparisons/2026-09-22-nodegoat`, `data/code-safety/targets/nodegoat.ground-truth.json` |
| 7.1 | Tickets shipped by the ledger lines of the shifts the operator started, directly or through a cycle. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, `data/enterprise/shift-starts.jsonl`, `data/enterprise/cycles`, `data/transcripts/live/enterprise-cycles`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 7.2 | Tickets shipped by the ledger lines of the shifts of the cycles the scheduler started. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, `data/enterprise/shift-starts.jsonl`, `data/enterprise/cycles`, `data/transcripts/live/enterprise-cycles`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 7.3 | What the container resets of 2026-09-28 erased, stated from commits and files on the branch. | `data/transcripts/LOSSES.md` |
| 7.4 | The shift composition names the local bash and subprocess providers and no sandbox provider. | `examples/headless-agent/tests/fixtures/enterprise-shift/cordis.yml`, `examples/headless-agent/tests/fixtures/enterprise-shift/overlays/claude-code.cordis.yml` |
| 7.5 | Completed runs whose conclusion is success. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, <https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml> |
| 7.6 | Shipped commits with a Branch CI run on exactly that commit, rather than on a later commit that contains it. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, <https://github.com/LBJLincoln/deepseek-harness/actions/workflows/branch-ci.yml> |
| 7.7 | The departments’ route is the operator’s Claude Code installation, and the live capture publishes the operator’s and the departments’ transcripts to the branch. | `examples/headless-agent/tests/fixtures/enterprise-shift/overlays/claude-code.cordis.yml`, `packages/llm/llm-claude-code/README.md`, `data/transcripts/README.md` |
| 7.8 | Every signoff/recorded event in the shift and intake records' session logs, with its transition, principal id, declared kind and time, and every entry of the decisions their result.json states, with its transition, principal id and kind. | `data/enterprise/shifts`, `data/enterprise/intake` |
| 7.9 | Session logs under each family's sessions/ directories, and those carrying a dataUse/terms event. | `data/proving-ground`, `data/code-safety`, `data/enterprise/shifts`, `data/enterprise/intake` |
| 7.10 | evidence.routes: the recorded sessions of the committed records per provider route, attributed to a seat or not. | `data/enterprise/roster.json` |
| 7.11 | The four-goals note: every harness-loop cell on record ran an eight-tool build under a two-sentence persona, and the bench’s 44 tasks are hand-authored JavaScript programs, saturated below tier 5. | `.agents/notes/proposed/process/2026-09-22-four-goals-rethink.md` |
| 7.12 | The results note: the tasks are authored in-house; sixteen cells per arm; no frozen pair has promoted a harness change. | `.agents/notes/proposed/architecture/2026-09-08-hypothesis-program-results.md` |
| 7.13 | The comparison’s own caveat on the checklists, and the self-review’s triage: none of its findings confirmed, a Windows executable-search defect found by the triage and missed by the review. | `data/code-safety/comparisons/2026-09-22-nodegoat/README.md`, `data/code-safety/targets/README.md` |
| 7.14 | The repository README: DeepSeek Harness is in developer preview, with compatibility-breaking changes to come. | `README.md` |
| 8.1 | The dataUse/terms fields a session pins at creation: client, agreement, purposes, residency, retention and redaction profile. | `packages/governance/data-use/README.md` |
| 8.2 | The four-goals note’s proposal: task supply first (public suites, the completion family, a SWE-bench subset), more than one route, and a release signature recorded after the certificate by a principal the driver did not invent. | `.agents/notes/proposed/process/2026-09-22-four-goals-rethink.md` |
| 8.3 | Every cycle the branch names and every shift record outside all of them; a cycle's shifts are those its record lists, or the shift records that start between its start and the next cycle's (and before its shift step ended, when its captured log states that step); per unit, the tickets its shift records name, the ledger lines of those shifts by status, the named tickets no line records, and the lines' tokens. | `data/enterprise/ledger.jsonl`, `data/enterprise/shifts`, `data/enterprise/shift-starts.jsonl`, `data/enterprise/cycles`, `data/transcripts/live/enterprise-cycles`, `scripts/enterprise-cycle.sh`, `scripts/enterprise-scheduler.sh` |
| 8.4 | The vacancy table names what changes when a Windows runner, a primary pool, an OTLP collector or a session store is composed. | `data/enterprise/README.md` |
| 8.5 | Seeded-defect recall: plant known defects in a copy of a target without telling the review, and read the share it catches within three lines, with a Wilson interval. | `data/code-safety/README.md`, `data/code-safety/tools/seed-defects.mjs` |
| 8.6 | The largest elapsedSeconds over the manifest.json of every code-safety record. | `data/code-safety` |
| 8.7 | The ticket validator takes its queue policy as a parameter: this repository’s policy mandates its typecheck and coverage runs; the open policy mandates nothing beyond the ticket’s own checks. | `scripts/enterprise-tickets.ts`, `.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md` |
| A.1 | The inputs field of briefing.json: per input set, the files the builder read, their bytes, and the SHA-256 of the file or of the listing of the files under a directory. | `apps/command-deck/public/fixtures/briefing.json` |
| A.2 | The claims register the builder writes beside briefing.json: every sentence of this page with the notes it cites, rendered from the same data. | `apps/command-deck/public/fixtures/briefing-claims.md`, `scripts/enterprise-briefing-claims.ts` |
