---
name: frontier-and-api-shifts-2026w36
description: Use when a decision depends on what the frontier vendors shipped or changed between August 24 and September 7, 2026 — new model releases and their prices, retention and licence terms, the Anthropic API change that breaks naive replay, vendor CLIs claiming composition manifests, and harness products converging on our seams — with sources.
---

# Frontier releases, API changes, and harness product moves, August 24 to September 7, 2026

Three frontier labs shipped within five days, one vendor changed its API in a way that a replay-based harness must handle explicitly, and several harness products shipped features that map onto seams this harness already has. The items below are the ones that change a routing input, a contract term, or a slice.

## What changed

- **Releases.** Anthropic released two models on 2026-09-01 (<https://www.anthropic.com/claude-fable-and-mythos-5-1>): `claude-fable-5-1` at $10 per million input and $50 per million output tokens, cache reads at $0.25, a 1M context by default and 128k maximum output, reporting 55.8 percent on Terminal-Bench 4.0 against 52.3 for the previous top tier; the second model reports 60.9 percent and is restricted to a partner programme. Both carry a 30-day minimum retention and are not available under zero data retention. OpenAI released GPT-6 Astra on 2026-09-03 (<https://openai.com/index/gpt-6-astra/>), also $10 and $50, with a Fast mode at twice the speed for twice the price, a chart claiming 64.6 percent on Terminal-Bench Science against 52.6 at about 31 percent lower cost, the first Critical cyber rating under its preparedness framework, and notably more empty chains of thought, which degrades chain-of-thought-only monitors; zero data retention is supported. Google released Gemini 3.8 Flash and a gated Flash Cyber on 2026-09-02 (<https://blog.google/innovation-and-ai/models-and-research/gemini-models/3-8-flash-and-3-8-flash-cyber/>) at $0.75 and $3.50 with a dated doubling after 2026-12-31. Alibaba's Qwen3.8-Flash-Next (<https://huggingface.co/Qwen/Qwen3.8-Flash-Next>, updated 2026-08-27) previews the Qwen4 architecture at 125B total and 6B active parameters plus a 51B n-gram embedding, 262k context extensible to 1M, under a bespoke community licence.
- **The API change.** Anthropic's release notes of 2026-09-01 (<https://platform.claude.com/docs/en/release-notes/api>): forced `tool_choice` values `any` and `tool` now return 400, and for accounts created after 2026-08-31 replaying a conversation after the system prompt, tools, or messages changed returns 400 unless the `thinking-binding-controls-2026-08-01` beta header and an explicit `prefix_mismatch_behavior` are set. OpenCode shipped an opt-out within a day. The same notes add two cache-preserving betas: per-message effort that survives an effort change without invalidating the prefix, and turn-scoped system messages with `clear_at: "next_user_message"`. The vendor's `ant apply` (<https://platform.claude.com/docs/en/cli-sdks-libraries/cli/apply>, 2026-09-03) declares agents, environments, skills, memory stores, and deployments in a repository with a lockfile: the composition-manifest vocabulary, claimed by a vendor.
- **Harness products.** OpenHands opened an ACP harness-parity epic on 2026-09-02 (<https://github.com/openhands/software-agent-sdk/issues/4820>) with a parity definition (registry record, pinned version, mirror, tests, live verification, no capability flag set on assumption) and merged Kimi Code and Pi as ACP children. Cursor added self-hosted machines on 2026-09-02 (<https://cursor.com/changelog>). Amp moved to proof-based output on its top tier on 2026-09-01 and added multi-repository projects on 2026-08-27 (<https://ampcode.com/news>). Cline v4.1.17 imports transcripts from Claude Code, Codex, and OpenCode (<https://github.com/cline/cline/releases>). Goose v1.48.0 added an `on_failure` block for pre-tool hooks (<https://github.com/block/goose/releases>).
- **Ownership.** NVIDIA agreed on 2026-09-03 to acquire Hugging Face for $12.93 billion (<https://blogs.nvidia.com/blog/nvidia-to-acquire-hugging-face/>); the openness commitments are a blog post, not a contract, and EU review has no stated timeline.

## What Daliesk adopts

1. Every LLM route that can reach the Anthropic API is audited for forced `tool_choice` and for replay after a prompt or tool change; the harness sets the thinking-binding header with an explicit, logged prefix-mismatch policy, because reconstructing a request from the session log after a preset changed is what the projection does.
2. Retention, zero-data-retention availability, licence, and dated price changes become routing and data-use inputs: a route carries them, and a client purpose can refuse a route on them.
3. The cache-preserving betas are adopted where a route serves that API: effort changes and turn-scoped system messages must not move the prefix.
4. A program may span several repositories; the worktree-per-department assumption is a recorded gap.
5. OpenHands' parity definition is the acceptance standard for the ACP subagent provider, and Kimi Code and Pi are its next catalogue entries.
6. The Hub is not neutral infrastructure for a 2027 release plan until the acquisition's terms are contractual; the release plan names a second host.

## Using the references

`references/items.md` lists every corpus item this theme selects, with date, evidence level, and URL. Vendor benchmark charts are the vendors' own claims; cite the URL when a claim rests on an item.
