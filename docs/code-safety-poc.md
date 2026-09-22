# Code-safety proof of concept: the demo runbook

English | [中文](code-safety-poc.zh.md)

This tutorial takes an operator from a clean checkout to a live demonstration in which the harness reviews an application's source code for security defects, verifies every finding against the code, and shows the work on the command deck. It is written for the demonstration to a prospective customer; the sections at the end state what may be claimed and what may not.

## What the demonstration shows

1. **The enterprise.** The command deck's first view is the roster: 147 seat definitions grouped by division, each derived from a source in this repository that the roster file names. The headline counts the seats defined and the seats a recorded session occupied; an occupied seat is drawn bright, a seat no recorded session occupied is drawn dim and says `defined, never run`, and the routes legend counts the sessions each route actually served, so a route seats are defined for and no session used reads as never run. The roster is not the organisation: the organisation of record is the Record tab beside it, every recorded program run with its departments, their certificates, the integration's verdict and who signed each transition when.
2. **A review of the customer's application.** A code-safety review is a [program](../packages/improvement/program/README.md): security departments, each in its own git worktree and its own session, read the target repository, run the static scanner and the dependency audit, and write findings with a file, a line, and the exact text at that line — six specialist departments by default, or seven with an optional generalist that reads the whole application in one pass for what a subject-scoped read can miss. An integration department merges the branches, writes the report with a French executive summary first, and runs the committed verifier.
3. **Verification, not trust.** The verifier is committed before any department runs and no department can change it. It checks that every finding's file exists in the target, that the line is inside the file, that the quoted snippet matches the code at that line, that the identifiers are well formed, and that the report cites every finding and states the same counts the findings file holds. A finding that fails verification is removed and listed as unverified; the certificate says what passed.
4. **The record.** Every session log, the findings, the report and the verifier's output are written under the run directory, and a recorded run lives under [`data/code-safety/`](../data/code-safety/README.md). The ground-truth list for the demo target ([`nodegoat.ground-truth.json`](../data/code-safety/targets/nodegoat.ground-truth.json), eighteen known issues pinned to lines) lets the recall of a run be counted rather than asserted.

## Before the demonstration (thirty minutes, once)

```sh
git clone https://github.com/LBJLincoln/deepseek-harness.git && cd deepseek-harness
git checkout claude/coding-agent-harness-u9l4gt
pnpm install
pnpm run build:lib:host            # the program drivers run built lib/; about five minutes
pnpm run code-safety -- --keyless  # ten-second self-test of the program on its bundled sample; no login needed
claude --version                   # the departments run on your Claude Code login
python3 -m venv ~/semgrep-venv && ~/semgrep-venv/bin/pip install semgrep
ln -sf ~/semgrep-venv/bin/semgrep /usr/local/bin/semgrep   # or add the venv's bin to PATH
git clone --depth 1 https://github.com/OWASP/NodeGoat.git ~/targets/NodeGoat
```

The first `pnpm install` on a new machine needs the network, and it prints two `Failed to create bin` warnings for the example demo binaries, which exist only after the build; both are expected. `--keyless` runs the scripted composition over the fixture's own eight-file sample target and refuses any other target, so it proves the program's plumbing without a login and says nothing about your repository. On a fresh clone of this branch these steps took under five minutes on the machine that built this, excluding the first install's downloads, and `pnpm run poc` served `LIVE` about ninety seconds after it was started, most of it the deck's first build.

The recorded run on NodeGoat ([`data/code-safety/2026-09-19-nodegoat/`](../data/code-safety/2026-09-19-nodegoat/SAFETY-REPORT.md)) is the shape of what the demonstration produces: seven of seven departments certified, 42 verified findings (5 critical, 17 high, 13 medium, 5 low, 2 info) in 1,301 s on the middle model, examiner exit 0, and 14 of the 18 known issues found ([the reading](../data/code-safety/README.md)); a second run on dvja, a Java Struts 2 application, released 40 verified findings (9 critical) in 1,414 s with 13 of its 14 documented issues found; a rehearsal on the machine that built this, started through the feed exactly as the deck's button does it, released 38 verified findings on the same NodeGoat revision in 1,225 s with the same 14 of 18 ([the second record](../data/code-safety/2026-09-19-nodegoat-2/SAFETY-REPORT.md)). Then rehearse once, end to end, on NodeGoat: start the feed and the deck, start a review from the deck, wait for the certificate, open the report. A rehearsal takes about the length of the review itself (fifteen to thirty minutes on the middle model). Keep the recorded run's report open in another tab as the fallback.

## Running the demonstration

Two terminals. The first command builds the deck, starts the feed, waits until it answers, then serves the deck's production build; the second starts the review, unless you start it from the deck's Safety view.

```sh
pnpm run poc                       # the feed (port 4711) and the production deck (http://localhost:3000); one Ctrl-C stops both
pnpm run code-safety -- ~/targets/NodeGoat --model sonnet   # or start the review from the deck's Safety view
```

Before the client walks in, press `O` on the Enterprise view for the cold open, or `P` for the tour, which plays it first. If the deck stutters on the demonstration laptop, open it as `http://localhost:3000/?quality=medium` (or `low`) after the rehearsal; unpinned, the deck steps its own quality down and never back up past the tier it reached.

The order of the views:

1. **Enterprise** (`/`). Say what the graph is: definitions with evidence, not a marketing number; the bright seats are the ones recorded sessions occupied, the dim ones have never run, and a pulsing node is a session running now. Click a department seat to show the route it is defined for beside the routes its sessions ran on, its preset, skills and tools.
2. **Process** (`/process`). Show the six departments starting in parallel, the tool calls flowing (scanner, audit, reads), the first findings, then the verifier and the integration. Every pulse on the screen is an event in a session log on disk.
3. **Safety** (`/safety`). The target as a code city; findings as markers on the files that carry them; the findings table filtered by severity; one finding opened to its snippet, evidence, impact and fix; the certificate card; the report with the French summary first. Download `findings.json` and the report.
4. **The record.** Open the Enterprise view's Record tab on the review: its departments with their certificates, steps and tool calls, the integration's verdict, and the sign-off chain; open one department's session in the Workflow view, then its session log in the run directory. The customer sees that the review is reproducible and auditable, not a chat transcript. The chain marks a release signed before the integration certified; say what that means: the signature was recorded when the program opened, not after the work.

If the live review is slow or the subscription is rate-limited, switch the deck to the recorded NodeGoat run from the runs list and continue the narrative; say that it is a recording. If the feed itself stops answering, the deck falls back to replay within five seconds and shows the same recorded reviews and the same roster from its committed fixtures, under a `REPLAY` badge and an example-data notice; say that too. If the laptop itself fails, the same replay deck is published at <https://lbjlincoln.github.io/deepseek-harness/> by [`deck-pages.yml`](../.github/workflows/deck-pages.yml) and opens in any browser with WebGL 2, with no machine of ours behind it. That published page is live, not only replay, while the operator's container pushes to the mirror relay: the workflow bakes the relay <https://cnaxcqiuwibsswfjjpko.supabase.co/functions/v1/feed> in as the page's feed, and `?feed=` on the URL names another.

What to expect on the clock: `pnpm run poc` serves the deck only once the feed answers; started by hand, the feed goes first by a few seconds, because it folds every recorded session once at start (about a second on this repository) and the deck shows `LIVE` only when `GET /roster` answers within five seconds; a review started from the Safety view is listed at once under the id the feed returns, the panel says the review is running, and the code city shows the target with no markers until the departments release; the Enterprise and Process views attribute each department's events to its integrator seat and the integration to the program lead, and the departments' first tool calls appear within a minute; findings, the certificate and the report arrive together after the integration, twenty to twenty-five minutes into a NodeGoat-sized review on the middle model.

## What may be claimed

- The harness ran a multi-agent review of the application's source, and every finding in the report was mechanically verified to exist at the cited line of the cited file at the reviewed revision.
- The report states its coverage: the files read, the scanner rule sets used, the ecosystems audited, and what was not covered.
- The review is reproducible: the same target revision, composition and program specification give a run whose record can be compared with the first.
- On the demo target the run's recall against the eighteen known issues is the number the record shows, no more.

## What may not be claimed

- That the code is safe. The review finds instances of the defect classes it looks for in the files it reads; it does not prove the absence of defects, it is not a penetration test, and it does not execute the application.
- That the findings are complete or that severities are final. Severity follows a written rubric applied by a model and should be confirmed by the customer's security team; confidence levels (`confirmed`, `likely`, `possible`) are part of every finding for that reason.
- That any customer code or finding was used for training. Every session records its data-use terms, and the subscription route's terms admit evaluation only; the customer's code stays on the machine that runs the review.
- That 147 agents work, or that the routes the seats are defined for serve them. The 147 are definitions; only the seats the deck draws bright have recorded sessions behind them, and only the routes the legend counts sessions for have run one.

## What a funded proof of concept adds

Four to six weeks on the customer's own applications: their languages and frameworks added to the departments' skills and scanner rules; a seeded ground truth agreed with their security team so recall is measured on their code; the verifier extended to reproduce a finding where a test can (a request that reaches the sink, a dependency version lookup); the report format aligned with their risk register; the review scheduled on every merge through the same loop that runs this repository's own bench each night. [Seeded-defect recall](../data/code-safety/README.md#recall-without-a-ground-truth-seeded-defects) turns that agreed ground truth into a number before any negotiation is needed: `seed-defects.mjs` plants known instances of the departments' defect classes into a copy of the customer's own repository, and `seeded-recall.mjs` reads the review's recall against them off with a stated confidence interval.

## Reference

| Piece | Where |
| --- | --- |
| The program (departments, verifier, compositions, real run) | [`examples/headless-agent/tests/fixtures/program-code-safety/`](../examples/headless-agent/tests/fixtures/program-code-safety/README.md) |
| The security skills the departments read | [`data/knowledge/code-safety/`](../data/knowledge/code-safety/README.md) |
| The enterprise roster, its evidence, and the feed | [`data/enterprise/`](../data/enterprise/README.md), `scripts/roster-evidence.ts`, `scripts/harness-feed.ts` |
| The command deck | [`apps/command-deck/`](../apps/command-deck/README.md) |
| Recorded runs and the ground truth | [`data/code-safety/`](../data/code-safety/README.md) |
