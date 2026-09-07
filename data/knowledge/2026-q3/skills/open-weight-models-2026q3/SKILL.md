---
name: open-weight-models-2026q3
description: Use when choosing, sizing, or licensing an open-weight base model in the 20B to 200B class — the ~120B decision, mixture-of-experts economics, compression, and which licences a European lab can fine-tune and redistribute under — as published on Hugging Face and arXiv between June and September 2026, with sources.
---

# Open-weight models in the 20B to 200B class, June to September 2026

No new 100B to 130B open-weight coding model appeared in the window. What appeared is better evidence for the decision: the one clean Apache-2.0 checkpoint in that class was fine-tuned into a code agent and redistributed by its own author, a licensed 120B-to-75B compression published its cost in benchmark points, and one frontier vendor withdrew a permissive licence between versions.

## What changed

- **The 119B candidate and its precedent.** Mistral-Small-4-119B-2603 (<https://huggingface.co/mistralai/Mistral-Small-4-119B-2603>; Apache-2.0; 119B total, 6.5B active, 128 experts with 4 active, 256k context; NVFP4 checkpoint updated 2026-09-07) is European and says in its card that it suits customisation and fine-tuning. Leanstral-1.5-119B-A6B (<https://huggingface.co/mistralai/Leanstral-1.5-119B-A6B>, 2026-07-01, Apache-2.0) is that base fine-tuned into a code agent and republished under the same licence, with community requantisations within a week.
- **The licensed alternative and its compression.** NVIDIA-Nemotron-3-Super-120B-A12B (<https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16>; 120B/12B active; 1M context; datasets, recipe, and RL environments published; SWE-Bench with OpenHands 60.47) ships under NVIDIA's own open model licence, not Apache-2.0. Nemotron-Labs-3-Puzzle-75B-A9B (<https://huggingface.co/nvidia/NVIDIA-Nemotron-Labs-3-Puzzle-75B-A9B-BF16>, 2026-07-06, OpenMDW-1.1) compresses it to 75.3B/9.3B for 56.9 against 59.5 SWE-Bench points, about twice the server throughput, and single-H100 1M-token concurrency from 1 to 8.
- **Licences move.** GLM-5.2 (<https://huggingface.co/zai-org/GLM-5.2>, 2026-06-16) is MIT; GLM-5.3 (2026-08-25, same base, gains from post-training only) is under a bespoke licence while GLM-5.3-Flash stays MIT. A permissive frontier licence is conditional and version-scoped.
- **Small mixture-of-experts coding models as recipes.** KAT-Coder-V2.5-Dev (Apache-2.0, 35B/3B, SWE-bench Verified 69.40, Terminal-Bench 2.1 41.02) documents its RL recipe. Ornith-1.5-35B-A3B (<https://huggingface.co/ornith-ai/Ornith-1.5-35B-A3B>, MIT, quantised siblings 2026-08-18) reports Terminal-Bench 2.1 of 67.8 and 68.5 and SWE-bench Verified 79 at 3B active and describes jointly optimising task generation, scaffold construction, and rollouts. K2-Horizon-MoVA-36B-A4B (<https://huggingface.co/IFM/K2-Horizon-MoVA-36B-A4B>, 2026-09-01, Apache-2.0, 512k context) promises intermediate checkpoints, data, and code, with its pre-training corpus partly public as TxT360-v2 (CC-BY-4.0). Qwen-AgentWorld-35B-A3B (<https://huggingface.co/Qwen/Qwen-AgentWorld-35B-A3B>, 2026-06-22, Apache-2.0) is a world model over seven agent domains.
- **The open frontier baseline.** Kimi K3 (<https://arxiv.org/abs/2607.24653>, v2 2026-08-07; 2.8T total, 104B active; weights released; Terminal-Bench 2.1 88.3) trains in a white-box environment that randomises the harness across Kimi Code, Claude Code, Codex, OpenClaw, and Hermes to avoid overfitting one tool schema.
- **Sizing rule.** Post-Training Science for SFT (<https://arxiv.org/abs/2609.01244>): a mixture-of-experts model fine-tunes like a dense model at the geometric mean of its active and total parameters; for 119B/6.5B that is about 28B of dense-equivalent tuning.

## What Daliesk adopts

1. Mistral-Small-4-119B-2603 is the leading candidate for the ~120B base: European provenance, Apache-2.0 on base and derivative, 6.5B active parameters, and a worked fine-tune-and-republish precedent. The decision itself stays with the lab lead.
2. A compression stage is a line in the goal-3 plan from the start, with the Puzzle ratio (about 2.6 SWE-bench points for roughly twice the throughput) as the reference cost.
3. Every candidate's licence is pinned by version in the model lineage record; a licence change is a supply-chain event, not a footnote.
4. The training-data summary follows the K2-Horizon and Nemotron pattern: corpora published or described as datasets with licences, generated from the data-use ledger.

## Using the references

`references/items.md` lists every corpus item this theme selects, with date, evidence level, and URL. Benchmark numbers are the cards' own reports unless the item says otherwise; cite the URL when a claim rests on an item.
