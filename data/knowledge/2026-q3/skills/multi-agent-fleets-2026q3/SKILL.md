---
name: multi-agent-fleets-2026q3
description: Use when designing or judging always-on multi-agent operation — agent villages, swarms, orchestration platforms such as ruflo, self-improving harnesses, multi-agent RL — and the failure modes their own records show, as published between June and September 2026, with sources and the ruflo comparison.
---

# Multi-agent fleets, villages, and self-improving harnesses, June to September 2026

The always-on category has public baselines now, and their own ledgers are the most useful evidence in the window: what a fleet produces is limited less by coordination than by verification and by the human capacity to land its output.

## What changed

- **A public village.** AI Village (<https://theaidigest.org/village>) has run more than 15 agents every weekday since 2025-04-01, eight hours a day, at about $10k a month, with every action public and the dataset on Hugging Face. Its memory design consolidates every 40 actions and rewrites memory shorter when context fills: lossy and unauditable, the failure the model-visible-equals-logged rule forbids.
- **Ruflo, from its code.** ruvnet/ruflo (<https://github.com/ruvnet/ruflo>, MIT, 71.2k stars, formerly claude-flow) is a meta-harness over Claude Code: its own instructions say Task-tool agents do the work and MCP tools never execute alone, so the vendor product owns the loop, the context, and the permissions while ruflo adds a queen coordinator with Raft, Byzantine, and gossip consensus over coordinator state, an embedding-indexed memory store consolidated by a model, 35 installable plugins, and about 309 MCP tools. Its dream-cycle ledger records 80 nightly research issues from 2026-05-25 to 08-13 producing 4 shipped (5 percent) and 75 never touched, then ten consecutive evaluated accepts whose pull requests sat unmerged. Its SWE-bench 84.8 percent claim has no harness, seed, model, or date in the tree, and its own ADR-171 states it has no SWE-bench oracle. Two of its mechanisms are worth taking: ADR-169, a binding standard for every published number, and signed per-platform witness manifests with a publish-blocking check. The full comparison is the [ruflo comparison note](https://github.com/lbjlincoln/deepseek-harness/blob/claude/coding-agent-harness-u9l4gt/.agents/notes/proposed/architecture/2026-09-07-ruflo-comparison.md).
- **Multi-agent RL as ordinary environments.** Prime Intellect's verifiers 0.3.0 and prime-rl 0.8.0 (<https://www.primeintellect.ai/blog/multi-agent-systems>, 2026-08-07) express judging, self-play, and user simulation as environments over `Agent.run` returning a `Trace` and `Env.run(task, agents)`, with hierarchical GRPO and role-conditioned advantages; their vocabulary makes an agent a harness times a model times a runtime policy, which is this harness's fleet cell under another name. Their Scaling Agentic RL post (2026-07-22) unified about 365,000 tasks behind one API with a validation ritual (a no-op must fail, the gold patch must pass with retries) and admits that grading inside the agent's sandbox is mitigation, not a guarantee.
- **Self-improving harnesses with results.** DarwinX (<https://arxiv.org/abs/2608.07545>, 2026-07-31) replaces single-lineage search with population selection under a preserve-and-extend contract (net gain positive, bounded regression) and an archive that recombines specialists: Terminal-Bench 2.1 from 75.5 to 83.2 percent with the model frozen, audit-clean WebArena passes from 43.5 to 93.0 percent. JIT-Agent (<https://arxiv.org/abs/2608.25593>, 2026-08-26) trains a 27B model to emit a task-specific harness. Ornith-1.5 (<https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B>, MIT) ships a model from a loop that jointly optimises tasks, scaffolds, and rollouts. Prime Agent (<https://arxiv.org/abs/2608.23552>) reports 7.6 out-of-loop experiments per 100 runs against 1.2 under a vendor harness.
- **Open-ended settings, measured.** SwarmWorld (<https://arxiv.org/abs/2608.26081>, 2026-08-26): shared worlds produce broader, more resilient technology portfolios than isolated best-of-N search, yet isolated search can still hold the strongest single artifact; a random removal of half the agents leaves 0.983 of artifacts connected, a targeted removal only 0.596. Deployment Decision Reliability (<https://arxiv.org/abs/2608.11323>) puts the agent main effect under 3 percent of variance on open agent-trace benchmarks.
- **Commercial always-on.** Amp's self-scheduling agents and event-driven Orbs (2026-07-21 and 23) shipped before this harness's shift driver had an external wake; worktree-per-agent is table stakes across products.

## What Daliesk adopts

1. Reporting rules in the observatory's render path: an unlabelled metric, an undisclosed best-of-N, or an aggregate hiding no-work passes is unpublishable by construction.
2. A signed witness over the composition manifest, per platform, verified before any release.
3. The fate of a shift's output on the ledger: what was certified, what was merged or used, and by whom, so a district that produces unused work is visible to the observatory.
4. The promotion verdict of an experiment adopts the preserve-and-extend rule: net gain positive and regression bounded on every cell, never net gain alone.
5. Reward provenance labels on every exported row: a certificate-decided reward is one tier, a judge verdict another, never blended into one number.
6. The fleet cell is named harness times model times runtime, and the trajectory record carries one model-call record per provider exchange, so traces interoperate with the open multi-agent RL stack.
7. The caution stays on the record: certificates raise the quality of a shift's output and do not create the capacity to land it; staffing the review of district output is a plan item, not an architecture item.

## Using the references

`references/items.md` lists every corpus item this theme selects, with date, evidence level, and URL. Operating claims from project READMEs are `claim` until a ledger or a run backs them; cite the URL when a claim rests on an item.
