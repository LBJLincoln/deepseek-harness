---
name: context-and-kv-cache-2026q3
description: Use when reasoning about context cost in an agent — prompt caching and cache-correct accounting, skill loading strategies, memory substrates, compaction as a trained policy, prefix-aware serving — and about how this harness serves knowledge as skills, as published between June and September 2026, with sources.
---

# Context management, prompt caching, memory, and skills, June to September 2026

Cache reads dominate multi-turn input, so any comparison of how knowledge reaches a model is wrong unless it prices cached tokens correctly. The window supplied that accounting, a serving-side counterpart, a clean result on memory substrates, and proof that compaction is a capability lever.

## What changed

- **Caching-correct skill loading.** Skill Blocks (<https://arxiv.org/abs/2608.14943>, 2026-08-14, Microsoft) finds cache reads are 74 to 94 percent of raw multi-turn input and that there is no universal winner: on a small single-turn skill, hybrid stubs cut input 27.4 percent while aggressively prompted on-demand loading raised it 48.4 percent; on large multi-turn skills, block and hybrid loading cut effective input 62.5 and 52.8 percent on one benchmark and 73.0 and 66.6 percent on another. One arm had raw input above the full-context baseline but effective input 14.8 percent below it: pricing cache reads at face value inverts rankings.
- **Prefix-aware serving.** TOPAS (<https://arxiv.org/abs/2608.25523>, 2026-08-26) shows alternating agent prefixes halve the running batch and take 1.8 to 1.9 times the makespan of grouping them; scheduling prefix residency with admission cuts mean and p99 completion by up to 39.8 and 49.4 percent. vLLM 0.28 (2026-08-26) added KV offloading and dynamic speculative decoding compatible with full CUDA graphs.
- **Memory substrates.** Harness the Memory (<https://arxiv.org/abs/2608.15008>, 2026-08-15) evaluates 11 methods across 3 backbones and 4 benchmarks: graph substrates lead dialogue QA but are Pareto-dominated on agentic tasks and cost 10 to 100 times more per query; retrieval depth helps QA and hurts sequential decisions.
- **Compaction as a policy.** CompactionRL (<https://arxiv.org/abs/2607.05378>, 2026-07-06): holding the execution agent fixed and swapping only the summariser moves SWE-bench Verified from 49.0 to 55.5; trained compaction lifts a 106B/30B model by 7.0 points. Prime Agent (<https://arxiv.org/abs/2608.23552>, 2026-08-24) organises state into four levels (weights, active context, persistent REPL and subagents, disk-backed history, memories, skills, prompts) with compaction rewriting the active level and agentic garbage collection managing the third.
- **Cost as the hidden variable.** The Scaffold Effect (<https://arxiv.org/abs/2607.22585>): harness choice moves tokens per solved task by up to 41.9 times at 0 to 8 points of pass-rate difference.

## How this harness serves knowledge, and why

A knowledge pack reaches a model through the skill seam: the catalog is one durable message appended after the reusable prompt prefix, with each theme reduced to its name and a capped description; a body is loaded only when the model calls the `skill` tool and then lives in retained tool history; the tables behind it load on demand through the resource guidance; a change to the pack appends a replacement catalog instead of rewriting earlier history, so the cached prefix survives edits; and the skill's digest stays off the model-visible surface so the prefix does not move on every edit. That is the token and cache economy the papers above measure. It is the mechanism, not the reason: the reason knowledge is a plugin is that a loaded skill is a content-addressed, scoped, logged component whose effect a paired experiment can attribute.

## What Daliesk adopts

1. Cache-correct accounting in the scorekeeper: raw input, cache reads, and effective input are separate facts, and every cost comparison between compositions uses effective input.
2. A knowledge pack's cost is measured, never assumed: a paired experiment with and without the pack on the same cells, reported in effective input and certified rate.
3. Prefix-stable ordering is a composition rule: standing sections first, catalogs after, per-turn material last; a change that moves the prefix is a change to review.
4. Compaction is an experiment variable now and a trained seam later, with CompactionRL's loss normalisation and cross-trajectory credit as the reference design.
5. No graph memory substrate for agentic tasks without a paired result that pays for its 10 to 100 times query cost.

## Using the references

`references/items.md` lists every corpus item this theme selects, with date, evidence level, and URL. Cite the URL when a claim rests on an item.
