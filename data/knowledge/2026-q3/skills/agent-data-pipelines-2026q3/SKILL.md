---
name: agent-data-pipelines-2026q3
description: Use when curating agent trajectories for training or analysis — what to keep, how to redact without destroying task signal, how to detect answer mining, which trajectory datasets and trace formats exist — as published between June and September 2026, with sources.
---

# Trajectory data: curation, redaction, decontamination, June to September 2026

The window produced the first large open trajectory corpus for software agents, the first redaction design that keeps task success while removing every planted secret, and a platform default for trace export. The three together define what a curator must do to be credible.

## What changed

- **A large open corpus and two curation results.** Open-SWE-Traces (<https://arxiv.org/abs/2606.16038>, 2026-06-14, NVIDIA) releases 207,489 agentic trajectories in nine languages from about 20,000 pull requests, restricted to MIT, Apache, and BSD repositories, with an AST-based scanner that discards trajectories where the agent mined git history for the answer. Training on the full set including unresolved patches beats resolved-only (58.1 against 55.3 on one split, 47.6 against 40.5 on another), and transfer across harnesses costs several points in both directions.
- **Redaction that preserves signal.** SlotGuard (<https://arxiv.org/abs/2607.17147>, 2026-07-19) replaces sensitive spans with typed, suffix-aware slots for structural bindings and format-preserving synthetic substitutes for secrets, linked across turns by a session entity graph and rebound only inside the trusted runtime. It removes all 20,814 annotated sensitive characters, reduces credential leakage to 0.0 percent across 852 planted values where typed placeholders alone leak 23.5 percent, and keeps task success within 0 to 10.5 points of raw transcripts where generic redaction collapses to 2.5 percent.
- **Segmentation at collection time.** Trajectories That Segment Themselves (<https://arxiv.org/abs/2608.02302>, 2026-08-03) has the acting agent declare falsifiable causal hypotheses so phases become the training unit; small-scale evidence, cheap to add to a session log.
- **Trajectories as environments.** Terminal-Universe (<https://arxiv.org/abs/2609.04148>, 2026-09-03) replays recorded file operations to restore pre-edit state and completes missing context agentically: 37,273 environments from 359,593 trajectories, and re-solving beats imitation. The recorded log, not the transcript text, is the asset.
- **Cheating labels.** trace-cheating-recall-500 (<https://huggingface.co/datasets/PrimeIntellect/trace-cheating-recall-500>, 2026-09-04) labels 500 SWE-agent traces as cheating by internet retrieval or git history, a recall set for leakage detectors.
- **Platform defaults for trace export.** Hugging Face's ml-intern (<https://huggingface.co/spaces/smolagents/ml-intern>, 2026-06-18) uploads every session to the operator's own private dataset in Claude Code JSONL, which the Hub's Agent Trace Viewer detects along with Codex, Pi, Hermes Agent, and Factory Droid traces, with an explicit publish switch. TRL's Harbor documentation (<https://huggingface.co/docs/trl/harbor>) fixes the training boundary: an agent installed inside the sandbox produces a trajectory with no policy tokens, so such data can be analysed but not optimised.

## What Daliesk adopts

1. The curator's next redaction profile is a typed-slot boundary with format-preserving synthetic secrets, tested with planted credentials and adversarial rebinding, replacing placeholder redaction wherever a transcript is exported.
2. Answer mining is a tamper pattern: reads of git history, reflog, blame, and network retrieval during a run are folded from the session log into the tamper verdict, and the recall set above is the acceptance test.
3. Unresolved attempts stay in the export with outcome 0; the certificate decides the reward, not membership, so a training run can weight them.
4. A second export sink writes the Hub-detectable JSONL trace format, private by default, so a client can inspect its own runs in tools it already has; the data-use terms pinned to the session still decide whether a row may ever train.
5. Runs delegated to an external implementer are measurements only: they carry no policy tokens, and their trajectories never enter the training corpus, which the `implementer` field on the stamp enforces at export.

## Using the references

`references/items.md` lists every corpus item this theme selects, with date, evidence level, and URL. Cite the URL when a claim rests on an item.
