---
name: routing-and-handoffs-2026w36
description: Use when deciding whether and how to route work among several models inside an agent loop — per-turn orchestrators such as Sakana Fugu, cheap-to-strong escalation and its measured tax, downshift, static tables against learned routers, and cache-aware pricing of a switch — as published between late July and September 7, 2026, with sources and the hypotheses they license.
---

# Routing among models, handoffs, and the cost of a switch, late July to September 2026

Routing became a measured question this summer, and the measurements point one way: a switch between models is expensive in context, most of the routing gap is task type, and any routing win smaller than the re-execution flip rate is noise. A per-turn orchestrator can beat every single model on the hardest suites, and the one that does is closed and unavailable in the EU.

## What changed

- **Sakana Fugu, the "multi router".** The Sakana Fugu Technical Report (<https://arxiv.org/abs/2606.21228>, launched 2026-06-22) productises TRINITY (<https://arxiv.org/abs/2512.04695>) and the Conductor (<https://arxiv.org/abs/2512.04388>). Fugu reads one hidden state through a lightweight selection head and dispatches each turn to one worker model without decoding orchestrator text, trained by supervised fitting to measured worker rewards and then by evolution strategies on real Claude Code, Codex, and OpenCode trajectories under a turn budget; Fugu-Ultra is a 7B conductor emitting whole workflows of up to five steps with agent isolation inside a workflow and shared memory across workflows. Reported: SWE-Bench Pro 73.7 against 69.2 for the best single worker, Terminal Bench 2.1 82.1. On Terminal Bench it alternates two vendors' models within one trajectory, calling the stronger one at critical debugging points. Closed weights, unavailable in the EU and EEA, sold by subscription or tokens; the public repository (<https://github.com/SakanaAI/fugu>, updated 2026-08-24, no licence) is an installer that puts Fugu behind Claude Code and Codex. The one in-window research item, fugu-gemma4 (<https://sakana.ai/fugu-gemma4/>, 2026-08-10), retrains the conductor on an Apache-2.0 base with comparable results, which is the sovereignty argument a European lab can make with open weights.
- **The handoff tax.** The Handoff Tax (<https://arxiv.org/abs/2608.24358>, 2026-08-25): on all 500 SWE-bench Verified instances, 58,000 runs, escalating mid-trajectory with the full transcript recovers less than half of the cheap-to-strong gap and costs 4.0 to 6.1 times the cheap model, more than starting strong; dropping the cheap transcript improves escalation, and preserving the strong transcript is what makes downshift work.
- **Most of the gap is task type.** (<https://arxiv.org/abs/2608.23023>, 2026-08-25): 5.37 percent of model-question cells flip on identical re-execution at temperature 0; a static task-type table fitted once recovers 21 of 29 oracle items at less than half the cost of the best single model.
- **Per-step and mid-generation routing.** ProgRouter (<https://arxiv.org/abs/2608.25992>) routes on progress signals under a cost budget; TACIT-Switch (<https://arxiv.org/abs/2608.27911>) fires a permanent handoff from cumulative trajectory risk; Bayesian Self-Escalation (<https://arxiv.org/abs/2608.24087>) aborts doomed generations and reaches near post-hoc routing quality at junior-only compute; RLCascadeRouter (<https://arxiv.org/abs/2608.15817>) treats stop-or-escalate as a decision problem; Pandora's Router (<https://arxiv.org/abs/2608.20316>) prices the cost of deciding. LLMRouter and xRouteBench (<https://arxiv.org/abs/2608.06867>) find learned routers beat the strongest fixed model by 14.6 percent relative, rankings reverse under tighter budgets, and multi-turn routing does not consistently beat single-turn. T2MO (<https://arxiv.org/abs/2608.08528>) gives the rule to price routing per completed task, not per token.
- **The cache decides.** Factory's production numbers (<https://factory.ai/news/model-routing-belongs-in-the-harness>, 2026-08-24): routing cut aggregate cost 58 percent at matched quality, while uncached routing costs 2.12 to 2.37 times an all-frontier baseline past turn 60 and cache-aware routing 0.19 to 0.28 times. CacheRouter (<https://arxiv.org/abs/2608.22708>) shows progressive tool disclosure and prompt caching in tension and isolates a stable core to reach 90 to 95 percent cache hit rates. Vendors already switch models per subagent or per agent.

## What Daliesk adopts

1. The flip rate first: a calibration experiment with the same route on both arms, three repetitions, before any routing claim; an effect below the measured floor is reported as unresolved.
2. Routing granularity is the attempt, with the transcript interface as an explicit arm: keep or drop, worktree and certificate always preserved; the downshift arm, strong tier first then cheap with the transcript kept, is the one the sources favour.
3. A static model-per-department table is the baseline every learned router must beat by more than the flip rate.
4. Every switch is priced against the prefix cache it invalidates, and every routing decision is a logged session event so a paired-seed replay can reconstruct it.
5. k attempts on one tier against cross-tier routing at a matched budget is an arm, not an assumption.
6. Fugu is a baseline to measure against and an argument for open weights, not a component: closed, and not available where the lab's clients are.

## Using the references

`references/items.md` lists every corpus item this theme selects, with date, evidence level, and URL. Benchmark numbers are the papers' and vendors' own reports; cite the URL when a claim rests on an item.
