# Agent Note: The hypothesis program on the operator's subscription

Status: proposed

English | [中文](2026-09-07-hypothesis-program.zh.md)

## Problem

The harness has a Proving Ground, a fleet, a shift driver, an experiments service with frozen paired plans, and three ways to put a role on the operator's Claude Code subscription, and it has produced no measured result about its own quality: the live district certifies three trivial tasks on a cadence, which proves the plumbing survives restarts and proves nothing about capability, and no paired experiment has ever promoted or rejected a change. Meanwhile the field measured, in the last quarter, exactly the questions the harness exists to answer: harness choice moves tokens per solved task by up to 41.9 times at 0 to 8 points of pass rate; escalating from a cheap to a strong model mid-run recovers less than half the gap and costs more than starting strong; 5.37 percent of model-question cells flip on identical re-execution; a static task-type table recovers most of the routing oracle gap; and Sakana's Fugu dispatches a different worker model per turn inside one trajectory, closed-weight and unavailable in the EU. The question the lab lead put is the right one: with the subscription as the engine, which of these hold on our environments, and is the harness loop better than the product's own loop on the same model?

## Proposal

Run a fixed slate of hypotheses as frozen paired experiments on a bench of thirty zero-dependency program tasks in three domains and three tiers, six of them held out, with every arm on the operator's Claude Code installation. The bench lives at `examples/headless-agent/tests/fixtures/proving-ground-bench/`: a data-driven registrar over `environments/<task>/task.json`, a composition serving three product models under one provider through the LLM route, the product's own loop as an external implementer, drivers for an experiment plan, a fleet plan, and an offline paired fold of two fleet runs, and an admission script that proves every task's pre-state fails its own tests and its hidden reference passes them. Results are recorded under `data/proving-ground/` like every other run, and a refutation is recorded with the same care as a confirmation.

The slate, in the order it runs, each with its arms, its measurement, and what refutes it:

- **E0, calibration and the flip rate.** Both arms the same route on the same cells, three repetitions. Measures the within-route flip rate of certificates and the noise floor every later effect is read against. Any later effect below the floor is reported as unresolved, never as a win.
- **E1, model tiers.** Mid tier against top tier, and cheap against mid, on tiers 2 and 3 of the bench. Certified rate, attempts, tokens per certified task. Refuted for a tier if the interval includes zero.
- **E2, the harness loop against the product loop.** The same product model as implementer through the harness's own agent loop on the LLM route, against the product's own loop as the external implementer, on identical cells with the runner certifying both. This is the question "best harness" reduces to on one model; it becomes one frozen experiment once an arm can name its implementer, and until then two fleet plans folded offline.
- **E3, attempts.** One attempt against three with clustered directives, folded offline over two compositions. Measures what the directive loop adds per attempt and what it costs.
- **E4, the knowledge pack.** The cell agent with the 2026-q3 pack mounted as its only skill root against no pack, on the tasks whose domain the pack covers. Effective input, certified rate.
- **E5, the handoff tax and the downshift, from the fortnight's routing results.** Three arms once the runner can change model between attempts: start on the top tier; start on the cheap tier and escalate to the top tier on the second attempt with the transcript kept; the same with the transcript dropped and the worktree kept; and the downshift, top tier on the first attempt then the cheap tier with the transcript kept. Predictions from the sources: raw escalation recovers under half the gap and costs more than starting strong; dropping the cheap transcript beats keeping it; downshift retains most of the top tier's rate at a fraction of its cost.
- **E6, k attempts on one tier against routing across tiers.** At a matched token budget, repeated top-tier attempts selected by certificate against the best routing arm of E5.

Every arm runs at isolation none, because the external arm can serve no higher claim; every routing decision is a logged session event; and the held-out six never enter an experiment until a change is proposed for promotion.

## Slices the slate needs

1. An experiment arm names its implementer, so E2 is one frozen experiment (in flight).
2. An attempt ladder on the runner and the fleet plan: a model per attempt index with a `keep` or `drop` transcript interface, digested into the plan, so E5 and E6 are frozen experiments rather than offline folds ([note](2026-09-08-attempt-ladder.md)).
3. Cache-correct facts in the scorekeeper: raw input, cache reads, and effective input as separate facts, so E4 and every cost column are read correctly.
4. A held-out reliability estimate and a difficulty-conditional breakdown in the experiment result, so a promotion is not read from the training cells alone.

## Alternatives considered

- **Import a public benchmark first.** Deferred, not rejected: Terminal-Bench and SWE-bench task trees need container isolation this host does not provide, and their gold-validated cuts are the next import once a Harbor adapter exists. The bench's tasks are authored in-house so they run here now and discriminate at three tiers.
- **Compare against published leaderboards.** Rejected: a number produced by another validator on another fixture under another definition of passed compares scoreboards, not agents; every arm here is certified by the same runner on the same restored fixture.
- **Route per step inside the loop, Fugu-style, first.** Rejected as the first experiment: the handoff tax and the flip rate results say the per-attempt ladder with a controlled transcript interface is the cheaper and more informative test, and per-step routing is a later arm once the ladder has numbers.

## Acceptance criteria

- The bench admits thirty tasks with six held out, and the keyless smoke registers and admits them.
- E0 reports a flip rate and a noise floor, recorded under `data/proving-ground/` with sessions and exports.
- E1 to E4 each end with a verdict and an interval, recorded the same way, and the hypothesis program's results section names every refutation.
- E5 and E6 run as frozen experiments once the attempt ladder lands.

## Risks

- The subscription's rate limits pace the program: cells run two at a time and an experiment of forty cells takes hours, so the slate runs over days, not an afternoon.
- Authored tasks carry authoring errors; admission catches a pre-state that passes or a reference that fails, not a test that over-specifies the prompt, so a task with an anomalous zero rate across every arm is reviewed before its result counts.
- The product envelope around each LLM-route query is model-visible and not in our log; every arm on the route carries the same envelope, so the comparison holds, but the absolute cost per cell includes it.
- Isolation none means an arm could in principle read what it should not; the immutable digests and the tamper verdict on every run are the control, and any tampered run counts as a failure of its arm.
