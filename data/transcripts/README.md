# Process transcripts

English | [中文](README.zh.md)

Complete transcripts of the agent sessions that build this repository, kept in the repository they build. Each build directory holds the raw Claude Code session tree as collected from the operator's machine and a compact dataset derived from it. They exist so that nothing about how this harness was made is lost: every prompt, tool call, and report is here to be mined for process patterns, failure taxonomies, and environment synthesis.

## Layout

```
data/transcripts/
  LOSSES.md, LOSSES.zh.md             what the container resets erased, and what survived where
  tools/
    collect-claude-code-session.mjs   snapshot one live Claude Code session into <build>/raw/
    capture-live.mjs                  append what is new in every live transcript source to live/
    live-chunks.mjs                   read live/: run manifests, capture state, files reassembled from chunks
    secret-patterns.mjs               the credential and e-mail patterns and the redaction every publishing tool applies
    transcripts-to-dataset.mjs        derive agents.jsonl, messages.jsonl, stats.json, and the README pair from a raw tree or live/
  live/
    runs/<date>/<time>.json           one manifest per capture run: every chunk it wrote
    <source>/<date>/<file>/e<epoch>/<date>/<seq>.<ext>.gz
                                      one immutable chunk: whole lines of one source file, redacted
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
node data/transcripts/tools/collect-claude-code-session.mjs --out data/transcripts/2026-09-06-build/raw --redact email
node data/transcripts/tools/transcripts-to-dataset.mjs data/transcripts/2026-09-06-build/raw data/transcripts/2026-09-06-build
pnpm run verify-translation-pairing --write data/transcripts/2026-09-06-build/README.md
```

The collector handles a credential- or e-mail-shaped string one of three ways: `--accept-hit <sha256>` keeps a reviewed placeholder verbatim, `--redact <pattern>` (a `SECRET_PATTERNS` name, e.g. `openrouter-key`, or `email` for the operator's address the context reminders carry) masks the match as `[REDACTED-<PATTERN>]` so a real credential the operator's own message carried can be preserved with the secret removed, and anything else refuses the write — a refused run prints every unhandled match with both flags to pass. After writing, the tree is re-scanned and any match that is not an accepted placeholder removes the tree and fails, so a redaction miss can never ship a secret or an address; the accepted digests and the `redactions` block are recorded in `manifest.json`. It splits files above 40 MiB at line boundaries so no blob exceeds GitHub's per-file ceiling, records every file's digest, and leaves an unchanged tree untouched, so it runs repeatedly during a build without churn. Commit the raw tree, the regenerated dataset, and the re-recorded pairing together.

## Live capture

The container the sessions run in is reset without notice, and a reset erases every file the pushed branch does not hold. [`scripts/transcripts-capture.sh`](../../scripts/transcripts-capture.sh) therefore runs `tools/capture-live.mjs` every `TRANSCRIPTS_CAPTURE_MINUTES` (default 5) and pushes what it wrote, so a reset loses at most one interval. The default sources are every Claude Code project directory under `~/.claude/projects` (the operator's session, its subagents and tool results, and the sessions of departments, reviewers, intake coordinators and bench cells), the `.sessions` directories and run logs of the enterprise's in-flight shifts and intakes under `/tmp/dsh-enterprise`, the cycle and scheduler logs in `/home/user/enterprise-cycles`, `/tmp/nightly-loop.log`, and the logs under the bench's `.proving-ground/runs`; `--source` replaces the list.

Each run appends only what is new since the last run as immutable gzip chunks under `live/`, and writes one manifest, `live/runs/<date>/<time>.json`, listing per chunk its source path, epoch and sequence number, byte and line range, the SHA-256 of the stored bytes and of the source prefix it ends, its redactions, and the capture time. The capture state is read from those manifests alone, so a fresh clone after a reset resumes where the last pushed run stopped. A chunk holds whole lines; a last line without a newline waits until the file has not changed for `--settle-seconds`. A file that no longer starts with the bytes already captured, such as a session log the server restored from its last compaction, begins a new epoch at byte 0, and the chunks of earlier epochs stay untouched. New bytes above `--max-file-bytes` per file and run, and files past `--max-run-bytes`, are deferred to the next run with a log line naming them.

The patterns are the collector's: both tools import [`tools/secret-patterns.mjs`](tools/secret-patterns.mjs), as do the dataset tool, the intake admission ([`scripts/enterprise-intake-admission.ts`](../../scripts/enterprise-intake-admission.ts)), the bench preflight ([`preflight.mjs`](../proving-ground/tools/preflight.mjs)), the code-safety recorder ([`record-run.mjs`](../code-safety/tools/record-run.mjs)) and the enterprise shift's record ([`shift.ts`](../../examples/headless-agent/tests/fixtures/enterprise-shift/shift.ts)). They cover credentials (Anthropic, OpenRouter and OpenAI-style keys, GitHub tokens including `github_pat_`, Hugging Face `hf_` tokens, E2B `e2b_` keys, AWS access key ids and the unprefixed 40-character secret next to one or after `aws_secret_access_key` / `SecretAccessKey`, Slack tokens, PEM private keys, `Bearer` values) and personal data (`email`, masked as `[REDACTED-EMAIL]`). Phone numbers are not detected: over the 588 MiB of the 2026-09-06 raw tree and the live chunks, the international and North American phone shapes matched only a Twitter-snowflake epoch constant, number tables and line-number lists, and no phone number. A live chunk is never refused, because refusing it would lose the transcript: every match is masked as `[REDACTED-<PATTERN>]` and counted in the chunk's and the run's `redactions`, a digest a collected build accepted as a placeholder (its `acceptedHits`) stays verbatim, and a PEM private-key block in a plain-text log is masked even when a chunk boundary splits it. The masked chunk is scanned again, and any remaining unaccepted match stops the run before its manifest is written, so the loop commits nothing from it.

The loop runs from a dedicated worktree under a single-instance lock, commits `data/transcripts/live/` alone as `chore(transcripts): live capture <UTC stamp>` with `ENTERPRISE_COMMIT_TRAILERS` appended when set, and pushes by fetch, `git pull --rebase` and push, retrying after 2, 4, 8 and 16 seconds; a commit that did not reach the remote goes with the next round. Each round holds the push lock every writer of machine commits to the branch takes (`ENTERPRISE_PUSH_LOCK`, default `/tmp/dsh-push.lock`, shared with the [enterprise shift engine and cycle](../enterprise/README.md)) around its pull, capture, commit and push; a round that does not take it within `TRANSCRIPTS_CAPTURE_LOCK_WAIT` seconds (default 10, at most 60) — a shift holds it for minutes while it recertifies before its push — logs that, skips the pull and the push, and still captures and commits on the local tip, which the next round that takes the lock pushes. Its commit and push pass `--no-verify`: the pre-push hook typechecks the whole workspace for about three minutes, longer than half the interval, and a capture commit holds only machine-written chunks and manifests that no hook checks, the reason the [enterprise shift engine](../../.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md) gives for its own data commits. Branch CI starts no run for a push that changes only transcript data. After a reset, start it again with the operator's trailers in `trailers`:

```sh
git -C /home/user/deepseek-harness worktree add /home/user/deepseek-harness/.claude/worktrees/transcripts-capture -B transcripts-capture origin/claude/coding-agent-harness-u9l4gt
cd /home/user/deepseek-harness/.claude/worktrees/transcripts-capture
ENTERPRISE_COMMIT_TRAILERS="$trailers" nohup setsid bash scripts/transcripts-capture.sh >> /home/user/enterprise-cycles/transcripts-capture.log 2>&1 < /dev/null &
node data/transcripts/tools/transcripts-to-dataset.mjs data/transcripts/live <out-dir> --session <session id>
```

The last command derives a dataset from the live chunks of one Claude Code session. [LOSSES.md](LOSSES.md) states what the container resets of 2026-09-28 erased before the live capture existed, and what survived.

## What the data is and is not

- The raw tree is verbatim: message text, tool inputs, tool results, token usage, and timing as Claude Code logged them. A credential- or e-mail-shaped string is refused unless its digest is accepted as a placeholder or its pattern is redacted, in which case only that match is masked; nothing else is rewritten. The committed raw trees of `2026-09-06-build` and `2026-09-28-postreset`, and the `2026-09-06-build` dataset's `messages.jsonl`, hold the operator's account e-mail verbatim where the harness's context reminders carried it; purging it from the public history is the operator's decision.
- The live chunks are the source bytes with every credential shape and e-mail address masked, except the accepted placeholders; the manifests count every mask per pattern. The chunks of the runs before `live/runs/2026-09-29/2026-09-29T00-18-03.407Z.json` were masked for credentials only and hold e-mail addresses, the operator's among them, verbatim.
- The dataset drops tool result bodies and masks credential-shaped strings and e-mail addresses; each build's generated README states its counts and data-quality notes.
- These transcripts are Claude outputs. Under Anthropic's usage policy they may not be used to train or fine-tune a competing model; keep them for analysis, process mining, failure taxonomies, and environment synthesis with invented entities. The RLVR corpus for the Daliesk model comes from the harness's own certified runs on routes whose terms allow it, through the [data-use terms](../../packages/governance/data-use/README.md) and the [curator](../../packages/governance/curator/README.md).

## Builds

| Directory | Session | Transcripts | Messages | Span |
| --- | --- | --- | --- | --- |
| [2026-09-06-build](2026-09-06-build/README.md) | `f53f80cc-1f77-5d02-a862-99d59ffabdce` | 1 orchestrator + 71 subagents | 32,148 | 2026-08-29 to 2026-09-06 |
| [2026-09-28-postreset](2026-09-28-postreset/README.md) | `f53f80cc-1f77-5d02-a862-99d59ffabdce` | 1 orchestrator (from its 2026-09-28T20:15Z restore boundary) + 5 subagents | see its README | 2026-09-28, after the 22:07Z container reset |

The 2026-09-06 build is the session that designed and landed the improvement seam: environments, the runner, fleet, shifts, experiments, scorekeeper, observatory, program, trajectories, the read barrier, the validation instrument, the blind judge, governance, and the curator, together with the Village and competitive-baseline studies. Its raw tree supersedes the two-part archive delivered to the operator the same day: that archive's transcripts are prefixes of the files here, and its overflow captures are the `tool-results/` entries.
