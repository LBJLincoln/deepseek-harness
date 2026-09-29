# Daliesk

English | [中文](README.zh.md)

Daliesk is a pilot organisation of AI agents that changes a codebase through a ticket queue, has a separate reviewer session approve each change before it ships (the same model as the departments, given the diff and the check output but not the session that made the change), and records every step in this repository. [Command deck](https://lbjlincoln.github.io/deepseek-harness/) · [briefing](https://lbjlincoln.github.io/deepseek-harness/briefing/) · [executive summary](docs/client/daliesk-executive-summary.md) · [data handling](docs/client/data-handling.md)

**Provenance.** This repository, [LBJLincoln/deepseek-harness](https://github.com/LBJLincoln/deepseek-harness), is a fork of [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), the open-source agent harness DeepSeek AI develops. The GitHub account LBJLincoln operates Daliesk on that harness: the enterprise, the command deck, the Proving Ground and the code-safety review were written in this fork, on the branch `claude/coding-agent-harness-u9l4gt`, and DeepSeek AI has not built, reviewed or endorsed them. The harness keeps its own name, its `@deepseek-ai/dsh-*` packages and its [MIT licence](LICENSE).

## What the records show

This page carries no figure of its own, so it cannot fall behind the records. The figures live where they are regenerated from them: the [command deck](https://lbjlincoln.github.io/deepseek-harness/) after every cycle, the [client briefing](https://lbjlincoln.github.io/deepseek-harness/briefing/) with a numbered source for each figure, and the [executive summary](docs/client/daliesk-executive-summary.md) generated from the briefing. `pnpm run enterprise:report -- --since <time>` recomputes them from [`ledger.jsonl`](data/enterprise/ledger.jsonl), the shift and cycle records, git and Branch CI, and [the roster's README](data/enterprise/README.md#occupancy) states the counting rules.

**Which models ran.** Every enterprise ticket line records `Claude Code sonnet` or no model at all, and every intake and code-safety review ran on Claude Code. Of the 1,912 sessions recorded under `data/proving-ground` and `data/code-safety`, 1,283 ran on Claude Code, 29 ran free open-weight models through OpenRouter on the Proving Ground's tier 2 (DeepSeek V4 Flash, Nex N2.5 Pro, Nemotron 3 Super, Laguna S 2.1 and Qwen 3.8), and 600 made no model request. The roster defines 74 seats for the DeepSeek API route and 25 for Codex; no recorded session has run on either.

## DeepSeek Harness

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the Web UI, served at `http://127.0.0.1:3080` by default. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a checkout of this fork, which carries the Proving Ground, code-safety and enterprise commands below (the upstream harness alone is at `https://github.com/deepseek-ai/deepseek-harness.git`):

```sh
git clone --branch claude/coding-agent-harness-u9l4gt https://github.com/LBJLincoln/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## Proving Ground

The harness measures itself on the Proving Ground: a bench of 44 environments across six domains — forty single-file programs and a four-task pilot tier of multi-file repositories — its two hardest tiers validated on hidden cases the implementer never sees, run as frozen paired experiments with bootstrap intervals. [data/proving-ground/dashboard.html](data/proving-ground/dashboard.html) is the one page folded from every recorded run: the verdict of each paired comparison with its interval, the models on the sealed tier, the certification matrix, the timeline, and the training-corpus fold. The [results note](.agents/notes/proposed/architecture/2026-09-08-hypothesis-program-results.md) states what those runs proved and refuted, and [data/proving-ground/improvement-log.md](data/proving-ground/improvement-log.md) is the ledger of the loop itself: one row per improvement iteration, from the change proposed to the decision the verdict earned it. The bench runs Claude Haiku, Sonnet and Opus on one Claude Code login and, through the `with-openrouter` overlay, free open-weight models on tier 2 only. What the records show, as the dashboard folded them from the 67 records on 2026-09-29:

- **Capability.** Pooled over every model and loop that ran it, sealed tier 5 certified 624 of 733 cells, 85.1 % with a 95 % Wilson interval of 82.4 % to 87.5 %; sealed tier 6 certified 41 of 64, 51.8 % to 74.7 %. District cells, which certify a village of trivial tasks, and suites without a tier are kept out of every tier.
- **Paired verdicts.** Of 23 frozen paired experiments, 4 were decisive, all on tier 5: Haiku certified fewer cells than Sonnet (1 against 14 of 16), Opus more (16 against 13 of 16), one attempt fewer than three (9 against 15 of 16), and five attempts more than three (14 against 12 of 16), a verdict the [improvement log](data/proving-ground/improvement-log.md) sets aside as an artifact of the statistic. The other 19 were not decisive: their intervals include zero.
- **Harness against product.** Claude Code's own loop against the harness loop, both on Sonnet, over 4 frozen pairs: 85 against 83 of 90 cells certified by the harness loop and by Claude Code, no decisive verdict. The harness is not shown to certify more tasks than the product it wraps.
- **The improvement loop.** `pnpm run bench -- loop` ran 16 iterations unattended from 2026-09-19 to 2026-09-28: 6 frozen pairs, of which 1 was decisive, and 10 single-arm runs, 9 of them the unchanged nightly baseline. No change it tested has been adopted.

![The Proving Ground dashboard: the certification rate by tier with its Wilson interval, what the paired comparisons show, and every paired verdict with its interval](data/proving-ground/dashboard.png)

After `pnpm run build`, list the checked-in plans, run one frozen paired experiment from them, or run one task through the harness on your own Claude Code login with no API key:

```sh
pnpm run bench -- plans
pnpm run bench -- experiment e3-attempts-t5
pnpm dsh --profile claude-code "Create hello.txt containing the single line hello."
```

## Code safety

The same program workflow reviews an application's source for security defects: six departments read the target in parallel, each in its own worktree and session, run the static scanner and the dependency audit, and write findings with a file, a line and the exact text at that line; an integration merges them into a report with a French executive summary first, and a committed examiner refuses any finding whose cited line does not hold. A finding the examiner passed is **line-verified**: the quoted text is at the cited line of the cited file, which does not show that the finding is a real or exploitable defect. Recall counts a documented issue as found when a finding cites its file within three lines of the issue. Twelve reviews of OWASP NodeGoat, an intentionally vulnerable training application with 18 documented issues, certified every department each time: the ten without the diagnosed checklists found 13 to 15 of the 18 (mean 14.0) and released 38 to 57 line-verified findings in 1,225 to 1,636 s; the two with them found 18 of 18, an in-sample reading because those checklists were written from this target's misses, and released 70 and 49 findings in 1,730 and 1,559 s. One review of dvja, a Java Struts 2 training application, found 13 of its 14 documented issues. Two NodeGoat reviews three hours apart matched 38 of the first run's 42 findings with a second-run finding within three lines of the same file, 31 of them with the same CWE. On a seeded copy of this repository's own code the review caught 6 of 8 planted defects within three lines, 95% interval [0.409, 0.929]; its triage found the other 4 findings to be false positives and a defect the review missed ([the records](data/code-safety/README.md)). The [command deck](apps/command-deck/README.md) shows the 147 seat definitions with what their recorded deliverables show, the process, and the findings on the target's code, live from the [feed](data/enterprise/README.md) or replayed from fixtures; [the runbook](docs/code-safety-poc.md) is the demonstration script, and [data handling](docs/client/data-handling.md) states where a reviewed codebase and its records go: to Anthropic's model API under the operator's Claude Code login, and into this public repository when a review is recorded.

```sh
pnpm run code-safety -- /path/to/target --model sonnet   # a review on your Claude Code login
pnpm run poc                                             # the feed on :4711 and the production deck on :3000
```

## Community and support

These are the upstream DeepSeek Harness project's channels, for the harness itself; Daliesk, the enterprise, the deck and the records in this fork are discussed on [this fork's repository](https://github.com/LBJLincoln/deepseek-harness).

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
