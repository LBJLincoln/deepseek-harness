# Decisions from the June to September 2026 knowledge sweep

English | [中文](2026-09-07-q3-knowledge-sweep-decisions.zh.md)

Status: proposed. The evidence lives in the [2026-q3 knowledge pack](../../../../data/knowledge/2026-q3/manifest.json); this note records what the lab decided from it and which slices it queues. One home per fact: numbers and URLs stay in the pack's theme skills and corpus.

## How the sweep was run

Three research agents, one per source (GitHub, Hugging Face, arXiv), each under the same brief: the state of the art between 2026-06-01 and 2026-09-07 as it bears on the four goals, primary sources first, every number with its URL, evidence graded primary, secondary, or claim. Their briefings and items were merged by `data/knowledge/tools/build-pack.mjs` into one corpus, deduplicated by URL, and distributed over eight theme skills; the pack is served to agents through the filesystem skill provider as described in the [knowledge packs note](2026-09-07-knowledge-packs.md). A fourth agent compared ruflo with this harness from a shallow clone; that result is the [ruflo comparison note](2026-09-07-ruflo-comparison.md).

## Decisions

### Goal 1, the harness

1. A dual-era MCP face on the tool bridge (`dsh-mcp-tool-server`): the 2026-07-28 stateless revision beside the current one.
2. Cache-correct accounting in `dsh-scorekeeper`: raw input, cache reads, and effective input as separate facts; every cost comparison between compositions uses effective input, and tokens per certified run, no-action turns, and a failure-category vector become first-class facts.
3. Pre-flight route validation at plan freeze in `dsh-fleet` and `dsh-shifts`.
4. Model-agnosticism remains the product argument; the operator's Claude Code installation is one route among several, and the fleet cell is named harness times model times runtime.

### Goal 2, software creation

5. A Harbor adapter so the harness runs unmodified under external leaderboards, and one Terminal-Bench Challenge through `dsh-program` as the external validity check for certified partial progress.
6. Reward provenance labels: a certificate-decided reward is one tier, a judge verdict another, never blended.

### Goal 3, the model

7. The leading base candidate is Mistral-Small-4-119B-2603 (Apache-2.0, 119B total, 6.5B active, European), with Leanstral-1.5-119B-A6B as the fine-tune-and-republish precedent; a compression stage is planned from the start; the decision itself is the lab lead's and stays open in the task list.
8. The LLM route is the token-capture boundary: harness-native runs on a route the trainer serves produce policy tokens; runs delegated to an external implementer are measurements and never training rows, enforced by the stamp's `implementer` field at export.
9. Training defaults: the verifier owns the sign of every advantage and any shaping term only scales it; LoRA at 1e-3 with rank 64 sized as a dense model at the geometric mean of active and total parameters; the published penalty vocabulary for parallel-call collapse as the first shaping set.
10. The curator's next redaction profile is a typed-slot boundary with format-preserving synthetic secrets, accepted only against planted credentials; answer mining (git history, reflog, blame, network retrieval) becomes a tamper pattern with a public recall set as its acceptance test.
11. A second export sink in the Hub-detectable trace format, private by default, under the same data-use terms.
12. Compaction becomes an experiment variable now and a trained seam later.

### Goal 4, the improvement loop

13. Gold-patch validation on a restored fixture is a precondition of registry admission and of any certificate, with survival rates published per imported set; an adapter admits Harbor task trees.
14. A behaviour monitor's verdict is a logged tamper verdict refreshed from the current policy's rollouts, with honeypot paths so part of it is deterministic.
15. Experiments report a held-out reliability estimate and a difficulty-conditional breakdown beside the paired interval; the promotion verdict adopts the preserve-and-extend rule (net gain positive and regression bounded on every cell).
16. Reconstruction of environments from the lab's own certified runs, never exporting held-out material.
17. From ruflo: a signed witness over the composition manifest; reporting rules in the observatory's render path; the fate of a shift's output on its ledger with a trailing use rate.
18. Event-driven wake for shifts, as a logged ledger event.

### Governance and commercial

19. The EU AI Act artefacts are generated from the composition manifest, the data-use terms, the sign-off records, and the training-run record with cumulative compute; the release is shaped as an AI bill of materials with the fields the field's own documentation lacks; a per-jurisdiction duty table joins each client contract's technical annex; the runner's certificate export becomes signable, as the answer to third-party signed evidence.
20. A base model's licence is pinned by version in the lineage record; a licence change is a supply-chain event.

## What the sweep changed in the roadmap

The Village note's rollout keeps its order; items 2, 4, 5, 9, 10, 13, 14, 15, and 17 above become named slices in it, and the base-model task carries decision 7 as its recommendation. Two findings bound the plan rather than extend it: harness choice moves cost far more than pass rate, so no leaderboard row is published without cost; and the agent main effect is a small share of variance on open agent-trace benchmarks, so a claimed delta needs a held-out reliability estimate, not paired seeds alone.

## Open

- The base-model decision (Mistral-Small-4-119B-2603 against the licensed alternatives) and the hardware scenario it implies.
- Whether the harness's own RL runs use an external trainer's endpoint (TRL, prime-rl) or a route served in-house; the token-capture boundary is the same either way.
- Staffing the review of district output: certificates raise the quality of what a shift produces and do not land it.
