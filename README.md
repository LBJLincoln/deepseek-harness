# DeepSeek Harness

English | [中文](README.zh.md)

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

To run from a repository checkout:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## Proving Ground

The harness measures itself on the Proving Ground: a bench of 44 environments across six domains — forty single-file programs and a four-task pilot tier of multi-file repositories — its two hardest tiers validated on hidden cases the implementer never sees, run as frozen paired experiments with bootstrap intervals. [data/proving-ground/dashboard.html](data/proving-ground/dashboard.html) is the one page folded from every recorded run: the verdict of each paired comparison with its interval, the models on the sealed tier, the certification matrix, the timeline, and the training-corpus fold. The [results note](.agents/notes/proposed/architecture/2026-09-08-hypothesis-program-results.md) states what those runs proved and refuted, and [data/proving-ground/improvement-log.md](data/proving-ground/improvement-log.md) is the ledger of the loop itself: one row per improvement iteration, from the change proposed to the decision the verdict earned it. The bench runs on the operator's own Claude Code login and, through the `with-openrouter` overlay, on free open-weight models: three of them certified 16 of 18 tier-2 cells on 2026-09-19, and `pnpm run bench -- loop` recorded its first five iterations without a hand on them, two of them replications of frozen pairs.

![The Proving Ground dashboard: the records, cells, and certificates counted, and the paired verdicts with their bootstrap intervals](data/proving-ground/dashboard.png)

After `pnpm run build`, list the checked-in plans, run one frozen paired experiment from them, or run one task through the harness on your own Claude Code login with no API key:

```sh
pnpm run bench -- plans
pnpm run bench -- experiment e3-attempts-t5
pnpm dsh --profile claude-code "Create hello.txt containing the single line hello."
```

## Code safety

The same program workflow reviews an application's source for security defects: six departments read the target in parallel, each in its own worktree and session, run the static scanner and the dependency audit, and write findings with a file, a line and the exact text at that line; an integration merges them into a report with a French executive summary first, and a committed examiner refuses any finding whose cited line does not hold. The first real run, on OWASP NodeGoat, certified all seven departments and released 42 verified findings in 1,301 s, 14 of the target's 18 documented issues among them ([the record](data/code-safety/README.md)). The [command deck](apps/command-deck/README.md) shows the 147 defined agents, the process, and the findings on the target's code, live from the [feed](data/enterprise/README.md) or replayed from fixtures; [the runbook](docs/code-safety-poc.md) is the demonstration script.

```sh
pnpm run code-safety -- /path/to/target --model sonnet   # a review on your Claude Code login
pnpm run feed                                            # roster, runs and live events on :4711
pnpm run deck                                            # the command deck on :3000
```

## Community and support

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
