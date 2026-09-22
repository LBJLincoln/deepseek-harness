# Agent Note: Where the four objectives stand, what blocks each, and the order of work

Status: proposed

English | [中文](2026-09-19-objectives-step-back.zh.md)

Superseded for standings and the order of work by [the four-goals rethink of 2026-09-22](2026-09-22-four-goals-rethink.md); the readings below are kept as they stood.

## Problem

The project has four objectives: a harness that makes any model the best agentic coder it can be, agentic software creation through that harness, a roughly 120B open-weight model trained by RLVR on the harness's certified runs, and a loop in which the harness improves itself by evidence. Two weeks of building produced the instrument (a 40-environment bench with validator-held cases, sealed cells, frozen paired experiments with bootstrap verdicts, a runner with attempt ladders and budget shares, a program workflow, a trajectory exporter and dataset builder, terms gating, a dashboard) and 32 recorded runs, 920 cells, and 844 certificates ([data/proving-ground](../../../../data/proving-ground/README.md)). What nobody has written down is how far each objective actually is from "partly done", which facts block it, and what order the remaining work should take. Without that, effort keeps flowing to whatever is nearest.

## Proposal

State the standing of each objective from the records, name the blocker, and take the work in the order below.

### Objective 1: the best harness for any model

Standing: the instrument exists and discriminates at tier 5 only; the harness has not yet shown a certificate win over the product's own loop, and every one of the 32 records ran one provider's models through the operator's Claude Code login. The paired readings in [the results note](../architecture/2026-09-08-hypothesis-program-results.md) are: the harness loop equals the product loop on certificates at tiers 3 and 5 (0 and −0.0625, both inside the one-flip noise floor) while being faster in 15 of 16 sealed pairs and 3.4 times cheaper in billed tokens; the largest model certifies every sealed tier-5 cell; attempts matter (three against one, +0.375); knowledge packs, craft skills, model cascades, and a dropped transcript add no certificates, and the cascade with a bounded cheap rung (E6) recovers the certificates the unbounded one lost at twice the cost. The bench below tier 5 is saturated by every model, and tier 5 is saturated by the largest one.

Blockers: one provider; a top tier the largest model saturates; a noise floor of one to two flips at sixteen pairs.

Next: run the bench on a second model family the moment a key exists (the open-weight overlay below); add a tier the largest model does not saturate (multi-file tasks with a repository and a spec, hidden cases held by the validator, the same admission and fairness audit as tier 5); test mechanisms with a stated hypothesis of effect on the middle model at tier 5, one per frozen pair (E7, five attempts against three, is running; then a self-review rung before validation and a directive that carries the validator's channel diff); run two seeds per experiment so a reading has thirty-two pairs.

### Objective 2: agentic software creation through the harness

Standing: the program workflow (departments in worktrees, integration, committed verifier, commit-or-refuse) has run once for real, producing an assessment document, never a piece of software.

Next: the `csv-tools` program (three departments, a spec, a `node:test` verifier) prepared today and run on the route after E7; then a program that builds a plugin for this repository under its own gates, which is the dogfooding case the objective actually means.

### Objective 3: the open-weight model trained by RLVR

Standing: the pipeline exists and was exercised as a dry run: 750 trajectories in the `dsh-trajectory/1` format, 521 on the harness route, in [the v1 dataset fold](../../../../data/proving-ground/datasets/2026-09-18-proving-ground-v1/README.md), with rewards from certificates and parity. Not one of them may train the Daliesk model: all ran on the operator's Claude Code login, and the [data-use terms](../../../../packages/governance/data-use/README.md) admit into the training corpus only sessions pinned with terms that allow it, which only a route on an open-weight model can carry. The corpus that matters is therefore empty, and no training compute is attached to this repository.

Blockers, in order: a key for an open-weight route (`DEEPSEEK_API_KEY` for [`dsh-llm-deepseek`](../../../../packages/llm/llm-deepseek/README.md), or a gateway key through [`dsh-llm-pi-ai`](../../../../packages/llm/llm-pi-ai/README.md)); the base-model decision, still open; compute for the RLVR run itself.

Next, without a key: the `with-deepseek` and gateway overlays with their plans, so the bench runs on an open model one environment variable after the key arrives, and the corpus fills from those runs alone; the training recipe as a proposed note (certified trajectories as the SFT warm-up, the validator as the RLVR reward over the same environments, held-out environments as the only reported number). With a key: the tier-2 fleet first, then the tier-3 frozen pair against the middle product model, recorded like every other run.

### Objective 4: the self-improvement loop

Standing: every piece exists and has run (frozen pairs, the verdict rule, composition manifests, the program workflow), but each iteration was proposed by a person, launched by hand through `pnpm run bench`, and applied by editing a composition. The iterations are legible only across a note, thirty-two records, and ten folds.

Next: the improvement log under `data/proving-ground/` as the ledger of every iteration with its verdict and decision (today), then the propose step inside the harness (a department reads the ledger and the bench's misses and writes a candidate overlay and plan), scheduled launches through the shift driver, and promotion through the composition manifest rather than a hand edit.

### Order of work

Today: E7 recorded; the open-weight overlays, plans, and keyless refusal; the improvement log; the `csv-tools` program run and recorded; the dashboard and this note updated. Next: the tier above tier 5; the self-review rung as a frozen pair; the propose step. Needed from the operator: a key for an open-weight route in the environment, a decision on training compute, and the base model.

## Alternatives considered

- Keep running experiments on the one provider until an effect appears. Rejected: the top tier is saturated by the largest model, and no trajectory from that provider can train the model, so the runs would answer neither objective 1 nor 3.
- Build the next bench tier before the open-weight route. Deferred: the tier matters most once a second model family runs, and the route is one variable away while the tier is days of authoring and audit.
- Call the harness state of the art now. Rejected: on the recorded evidence it equals the product loop on certificates, on one provider, and is cheaper; that is a cost result, not a capability result.

## Acceptance criteria

- One run on an open-weight route recorded under `data/proving-ground/` with terms that admit training, and the corpus fold counting at least one admitted trajectory.
- The `csv-tools` program certified by its verifier and recorded as a program record.
- The improvement log carrying E7's verdict and decision.
- The next bench tier admitted with the fairness audit, and one frozen pair on it.

## Risks

- The shared subscription's rate limits and the container's restarts (two on 2026-09-18) can cut a run; the partial-record path keeps what ran.
- Sixteen-pair readings invite over-reading; the note's noise-floor rule stands.
- A dataset that mixes provider-of-record trajectories into training would breach the terms; the curator withholds them, and the fold's manifest names every source record so a reader can check.
