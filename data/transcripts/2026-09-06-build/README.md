# Process transcript dataset

English | [中文](README.zh.md)

## What this is

This dataset is the process transcripts of an AI-assisted build of the DeepSeek Harness fork, produced by Claude Code sessions: one orchestrating session (`agents.jsonl` record with `kind: "orchestrator"`) plus 100 background subagent sessions it spawned (`kind: "subagent"`), covering every message, tool call, and token count either session logged.

- `agents.jsonl` - one record per transcript: timing, turn/tool-call counts and breakdown, token usage, prompt/response excerpts, commit shas mentioned in the final assistant message, and files touched via Edit/Write/MultiEdit.
- `messages.jsonl` - one record per conversational message across every transcript, in order, with per-message text, tool calls, and tool-result sizes.
- `stats.json` - corpus totals (transcripts, messages, tool calls by name, tokens by kind, wall time) and the distribution of subagent durations.

## What was removed

- **Tool result bodies.** `messages.jsonl` records only the character count of each tool result (`toolResultChars`), never its content; the raw tree next to this dataset keeps the bodies.
- **Secrets.** Any value shaped like a credential - an `sk-`, `ghp_`, or `AKIA`-prefixed token, a `Bearer ` header value, or any other 32-or-more character hex/base64-looking run - is replaced with `[REDACTED]` everywhere this dataset includes text: message text, prompt/response excerpts, and tool-call input excerpts.
- **Non-transcript files.** `subagents/` held 100 transcript-shaped files; 100 of them are genuine Claude Code JSONL subagent transcripts (every line parses as JSON and at least one line is a real user/assistant message). 0 were plain-text captures of other tool output, 0 were JSON without any conversation, and 0 were empty. None of these is represented in `agents.jsonl` or `messages.jsonl`.

## Data quality notes

- 0 of the 100 subagent transcript files were symlinks into a live Claude Code project directory rather than frozen copies; a subagent still running at export time shows more lines on a later re-run of `transcripts-to-dataset.mjs` than it did here.
- 2 subagent transcript(s) end mid-action: the last recorded line is a tool call with no accompanying text and no result, rather than a closing report - id(s): `a21b2acb7cbb3657d`, `ac1d0180b6ef3cf0a`. For these, `finalAssistantExcerpt` and `commitShasMentioned` reflect that the transcript stops there, not that the agent produced no final report.

## Provenance

- Build/session id: `f53f80cc-1f77-5d02-a862-99d59ffabdce`
- Raw transcripts: `data/transcripts/2026-09-06-build/raw`
- Export date: 2026-09-08
- Harness repo branch at export time: `claude/coding-agent-harness-u9l4gt`
- Harness repo HEAD commit at export time: `32a2cac6a4eba71dbd3945338923ad0a77f2d78d`

## Usage

These transcripts are Claude outputs. Under Anthropic's usage policy they may not be used to train or fine-tune a competing model; keep them for analysis, process mining, failure taxonomies, and environment synthesis with invented entities. The RLVR corpus for the Daliesk model comes from the harness's own certified runs on routes whose terms allow it.
