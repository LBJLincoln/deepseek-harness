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

The harness measures itself on the Proving Ground: a bench of 40 small environments across three domains, its hardest tier validated on hidden cases the implementer never sees, run as frozen paired experiments with bootstrap intervals. [data/proving-ground/dashboard.html](data/proving-ground/dashboard.html) is the one page folded from every recorded run: the verdict of each paired comparison with its interval, the models on the sealed tier, the certification matrix, the timeline, and the training-corpus fold. The [results note](.agents/notes/proposed/architecture/2026-09-08-hypothesis-program-results.md) states what those runs proved and refuted, and [data/proving-ground/improvement-log.md](data/proving-ground/improvement-log.md) is the ledger of the loop itself: one row per improvement iteration, from the change proposed to the decision the verdict earned it.

![The Proving Ground dashboard: the records, cells, and certificates counted, and the paired verdicts with their bootstrap intervals](data/proving-ground/dashboard.png)

After `pnpm run build`, list the checked-in plans, run one frozen paired experiment from them, or run one task through the harness on your own Claude Code login with no API key:

```sh
pnpm run bench -- plans
pnpm run bench -- experiment e3-attempts-t5
pnpm dsh --profile claude-code "Create hello.txt containing the single line hello."
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
