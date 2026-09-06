# Process transcripts

English | [中文](README.zh.md)

Complete transcripts of the agent sessions that build this repository, kept in the repository they build. Each build directory holds the raw Claude Code session tree as collected from the operator's machine and a compact dataset derived from it. They exist so that nothing about how this harness was made is lost: every prompt, tool call, and report is here to be mined for process patterns, failure taxonomies, and environment synthesis.

## Layout

```
data/transcripts/
  tools/
    collect-claude-code-session.mjs   snapshot one live Claude Code session into <build>/raw/
    transcripts-to-dataset.mjs        derive agents.jsonl, messages.jsonl, stats.json, and the README pair from a raw tree
  <date>-<label>/
    README.md, README.zh.md           generated provenance of that build: session id, repository head, counts
    agents.jsonl                      one record per transcript
    messages.jsonl                    one record per conversational message
    stats.json                        corpus totals and the subagent duration distribution
    raw/
      manifest.json                   session id, source directory, repository head, per-file bytes and SHA-256
      orchestrator-session.jsonl      the orchestrating session, as line-split parts above 40 MiB
      subagents/                      one JSONL transcript and one descriptor per background agent
      tool-results/                   tool output the session saved to disk when it overflowed a result
```

## Collecting a build

Run from the repository root inside the session being collected, or name the session and its project directory with `--session` and `--projects-dir`:

```sh
node data/transcripts/tools/collect-claude-code-session.mjs --out data/transcripts/2026-09-06-build/raw
node data/transcripts/tools/transcripts-to-dataset.mjs data/transcripts/2026-09-06-build/raw data/transcripts/2026-09-06-build
pnpm run verify-translation-pairing --write data/transcripts/2026-09-06-build/README.md
```

The collector refuses to write while any credential-shaped string in the sources lacks an `--accept-hit <sha256>` naming the reviewed match; a refused run prints every match with the flag to pass, and the accepted digests are recorded in `manifest.json`. It splits files above 40 MiB at line boundaries so no blob exceeds GitHub's per-file ceiling, records every file's digest, and leaves an unchanged tree untouched, so it runs repeatedly during a build without churn. Commit the raw tree, the regenerated dataset, and the re-recorded pairing together.

## What the data is and is not

- The raw tree is verbatim: message text, tool inputs, tool results, token usage, and timing as Claude Code logged them, including the operator's account e-mail where the harness's context reminders carried it. Credential-shaped strings are refused, never rewritten.
- The dataset drops tool result bodies and masks credential-shaped strings; each build's generated README states its counts and data-quality notes.
- These transcripts are Claude outputs. Under Anthropic's usage policy they may not be used to train or fine-tune a competing model; keep them for analysis, process mining, failure taxonomies, and environment synthesis with invented entities. The RLVR corpus for the Daliesk model comes from the harness's own certified runs on routes whose terms allow it, through the [data-use terms](../../packages/governance/data-use/README.md) and the [curator](../../packages/governance/curator/README.md).

## Builds

| Directory | Session | Transcripts | Messages | Span |
| --- | --- | --- | --- | --- |
| [2026-09-06-build](2026-09-06-build/README.md) | `f53f80cc-1f77-5d02-a862-99d59ffabdce` | 1 orchestrator + 71 subagents | 32,148 | 2026-08-29 to 2026-09-06 |

The 2026-09-06 build is the session that designed and landed the improvement seam: environments, the runner, fleet, shifts, experiments, scorekeeper, observatory, program, trajectories, the read barrier, the validation instrument, the blind judge, governance, and the curator, together with the Village and competitive-baseline studies. Its raw tree supersedes the two-part archive delivered to the operator the same day: that archive's transcripts are prefixes of the files here, and its overflow captures are the `tool-results/` entries.
