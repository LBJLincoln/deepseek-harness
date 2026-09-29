# Data handling: where a reviewed codebase and its records go

English | [中文](data-handling.zh.md)

This page states where the code of a reviewed application and the records of the work go when the Daliesk code-safety program and the enterprise shifts run as this repository composes them, which terms govern each destination, and what a client engagement needs before any client code is read. It is the one home for these facts: the [demonstration runbook](../code-safety-poc.md), the [code-safety records](../../data/code-safety/README.md) and the [client briefing](https://lbjlincoln.github.io/deepseek-harness/briefing/) link here. Each statement names the file it rests on.

## In short

- **Code leaves the review machine.** Every department runs through the operator's own Claude Code login, so every model request, with the text of every file a department reads, goes to Anthropic's model API under that account's terms.
- **The records are published.** A recorded review commits its session logs, which quote the code the departments read, its findings, which quote the exact line of each, and its report to this repository, whose visibility on GitHub is public; the live capture pushes the Claude Code transcripts of the departments to the same repository every five minutes.
- **No agreement covers a client's data today.** No data processing agreement, no zero-data-retention arrangement and no data-use terms apply to a code-safety session: 0 of the 114 committed code-safety session logs carry `dataUse/terms`.
- **No client code has been reviewed.** The records under [`data/code-safety/`](../../data/code-safety/README.md) review OWASP NodeGoat and Damn Vulnerable Java Application (dvja), two public, intentionally vulnerable training applications, and this repository's own code.

## The data flow of one review

A review runs on one machine, the review machine, under `pnpm run code-safety` with the [`claude-code` overlay](../../examples/headless-agent/tests/fixtures/program-code-safety/overlays/claude-code.cordis.yml), the only real route the [code-safety program](../../examples/headless-agent/tests/fixtures/program-code-safety/README.md) composes. The rows are in the order the data moves.

| # | What moves | Where it goes | When | Source |
| --- | --- | --- | --- | --- |
| 1 | The target tree, read-only | The departments' sessions on the review machine | Throughout the review | [program README](../../examples/headless-agent/tests/fixtures/program-code-safety/README.md) |
| 2 | Every model request: the conversation, including the full text of each file or line range a department reads, the scanner's hits and the audit's output | Anthropic's model API, through the Claude Code installation the operator has authenticated, under the operator's account | Every turn of every department and of the integration | [`dsh-llm-claude-code`](../../packages/llm/llm-claude-code/README.md); all 114 committed code-safety session logs name the provider `claude-code` |
| 3 | The target's resolved dependency graph (package names and versions) | The npm registry, through `npm audit --json` | When the dependencies department finds a lockfile | [dependencies preset](../../examples/headless-agent/tests/fixtures/program-code-safety/presets/dependencies/agent.cordis.yml) |
| 4 | A request for the `p/owasp-top-ten` rule pack, with usage metrics off (`--metrics off`) | The Semgrep registry | When each department first runs the scanner | [program README](../../examples/headless-agent/tests/fixtures/program-code-safety/README.md) |
| 5 | Session logs, findings with the exact text at each cited line, the report | The run directory on the review machine | During the review | [`data/code-safety/README.md`](../../data/code-safety/README.md) |
| 6 | Claude Code's own transcripts of the department sessions, credential shapes and e-mail addresses masked, the rest as written | This repository on GitHub, public, every five minutes | While [`scripts/transcripts-capture.sh`](../../scripts/transcripts-capture.sh) runs | [`data/transcripts/README.md`](../../data/transcripts/README.md) |
| 7 | A recorded review: every session log, the findings, the report, the examiner's output; key material and e-mail addresses replaced | This repository on GitHub, public, under `data/code-safety/<record>/` | When the operator runs `record-run.mjs` and pushes | [`record-run.mjs`](../../data/code-safety/tools/record-run.mjs) |
| 8 | The review's findings, each with its source line, and its report | The mirror relay on a Supabase project, whose feed serves every read without authentication and allows every origin | While [`pusher.mjs`](../../apps/command-deck/mirror/README.md) runs | [mirror README](../../apps/command-deck/mirror/README.md) |
| 9 | The deck's review fixtures under `public/fixtures/safety/` (findings with source lines, reports) | GitHub Pages, public | On every push of the branch that changes `apps/command-deck/` | [`deck-pages.yml`](../../.github/workflows/deck-pages.yml), [deck README](../../apps/command-deck/README.md) |

The enterprise shifts follow rows 2 and 6, and publish as row 7 does: shift, reviewer and intake sessions run through the same login, and each shift commits its session logs to the same repository ([the briefing's data](../../apps/command-deck/public/fixtures/briefing-claims.md)).

## The terms that govern each destination

| Destination | Terms | What this repository records |
| --- | --- | --- |
| Anthropic's model API | The operator's Claude Code account and its terms of service | No copy of those terms, no data processing agreement and no zero-data-retention arrangement. What the account's terms say about retention and training is read from the account's own agreement, not from this repository. |
| This repository and GitHub Pages | Public | Visibility `public`, read from GitHub's API by the [briefing builder](../../scripts/enterprise-briefing.ts) into [`briefing.json`](../../apps/command-deck/public/fixtures/briefing.json). Anyone can read and clone it. Deleting a file does not remove it from git history. |
| The mirror relay | Public reads | The pusher's token guards writes only; `GET /safety/:id` answers anyone ([mirror README](../../apps/command-deck/mirror/README.md)). |
| The npm and Semgrep registries | Each registry's own terms | Nothing beyond the commands in rows 3 and 4. |

The harness's own data-use terms, [`dsh-data-use`](../../packages/governance/data-use/README.md), pin a client, an agreement, purposes, a residency, a retention and a redaction profile on each session of a composition that includes the plugin. The code-safety program does not include it, so no code-safety session carries terms, and neither does any shift or intake session ([the briefing's data](../../apps/command-deck/public/fixtures/briefing-claims.md)). The bench sessions that do carry terms pin `purposes: [evaluation]`, `residency: eu-west` and `retentionDays: 90` ([bench composition](../../examples/headless-agent/tests/fixtures/proving-ground-bench/cordis.yml)): labels the harness writes into the log, which the [curator](../../packages/governance/curator/README.md) reads to decide what a dataset export may include. They are not the model provider's terms, and the plugin cannot check that the residency is where a transcript actually lives; these transcripts live in a public repository whose history keeps them.

The operator's personal e-mail address appears in clear 67 times in 15 files of eight committed code-safety records, all committed before [`record-run.mjs`](../../data/code-safety/tools/record-run.mjs) masked e-mail addresses; the older live transcript chunks carry it too ([`data/transcripts/README.md`](../../data/transcripts/README.md)).

## What a client engagement requires

Before any client code is read:

1. **A model route under a data processing agreement.** An Anthropic API organisation for the engagement, under a data processing agreement with zero data retention, serves the departments through that organisation's API key in place of the operator's login. [`dsh-llm-pi-ai`](../../packages/llm/llm-pi-ai/README.md) serves an `anthropic` route from `ANTHROPIC_API_KEY`; the code-safety program composes no overlay for it yet. The model chosen must be one the zero-retention arrangement covers: the two models Anthropic released on 1 September 2026 carry a 30-day minimum retention and are not available under zero data retention ([knowledge pack](../../data/knowledge/2026-09-fortnight/skills/frontier-and-api-shifts-2026w36/SKILL.md)).
2. **Records outside this repository.** A client's review is written to a private store for that client, never under `data/code-safety/`: `record-run.mjs` writes only there. The deck's fixtures are not snapshotted from a client review, the mirror pusher does not run, and the live capture does not read the engagement's sessions.
3. **Data-use terms on every session.** The code-safety composition includes `dsh-data-use` with the client's own terms, with a retention that the store holding the records honours.
4. **Registry calls agreed.** The client decides whether `npm audit` may send its dependency graph to the public npm registry and whether the scanner may fetch registry rule packs, or names mirrors for both.

## Decisions still open for the operator

- **Public history.** Purge the transcripts, the code-safety session logs and the operator's e-mail address from the public history, or make the repository private, before the repository is shown to a client.
- **The relay.** Keep the pusher off while no private feed exists, and rotate the relay's token.
- **The live capture.** Point it at a private destination before it reads any session that holds client material.
- **The agreement.** Sign the API organisation's data processing agreement and zero-retention arrangement, and confirm which terms the operator's own Claude Code account is under today.
