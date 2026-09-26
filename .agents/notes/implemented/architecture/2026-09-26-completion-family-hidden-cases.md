# Agent Note: A completion child inherits its parent's hidden cases

Status: implemented

English | [中文](2026-09-26-completion-family-hidden-cases.zh.md)

## Problem

The completion factory (`examples/headless-agent/tests/fixtures/proving-ground-bench/tools/synthesize-completion-tasks.mjs`) turns the bench's 44 reference programs into 246 completion children and, by its original design, dropped every check a parent judges by held-back cases, so a child was judged on the visible suite alone whatever its parent's tier. The family therefore ranked nothing: on the six smoke tasks haiku and sonnet both certified 6 of 6, and on six of the hardest children (three of tier 6, three of tier 5) both certified 12 of 12, every cell at the first attempt (records `2026-09-23-bench-completion-smoke-sonnet`, `2026-09-23-bench-completion-smoke-haiku`, `2026-09-23-bench-completion-hard-pair`). Completing one stubbed function while the parent's own tests stay visible is far easier than the parent task, so the tier did not carry over and a tier-6 child was judged like a tier-2 one. A suite every model saturates cannot measure a harness or a base model, which is the one use goal 1 and goal 3 have for the family.

## Decision

A completion child carries every one of its parent's checks, hidden cases included, so it is judged the way its parent's tier is judged. The factory writes the parent's `checks` into `task.json` unfiltered (the parent's `reference/cases.json` was already copied into every child and simply never named by a check), and its prompt paragraph omits the sentence "This is a visible-test tier…" for a child whose parent holds back cases, because for that child the sentence is false. `register-completion-environments.ts` builds checks through the shared `authoredCheck` from `bench-cases.ts`, so a `cases` field is honored rather than dropped by a hand-built `{ id, outcome, run }`, and appends the same `HIDDEN_CASE_RULE` the curated registrar appends — exported from `register-environments.ts` rather than copied — whenever a child carries a cased check, which the tier-5 fairness audit made mandatory for any cased task. `admit.mjs` is unchanged: it already admits a cased task only when the stub fails at least one case and the reference passes every case, so a child whose function lies off every held-back path is refused instead of shipping with a check that could not fail.

## Alternatives considered

**Two families, visible and hidden.** A second output directory, registrar entry, and overlay would keep a visible-only corpus beside the discriminating one. Rejected: a child certified against held-back cases is better corpus, not worse, and the 163 children of tier-2 to tier-4 parents stay visible-only regardless, because those parents hold back nothing, so one family already carries both kinds.

**Demote a non-discriminating hidden check to visible-only instead of refusing the child.** Where the stub passes every hidden case the child is still a valid visible task. Not needed: the refusal is `admit.mjs`'s contract for the curated tiers, where a hidden check that cannot fail is an authoring defect, and it refused none of the 83 tier-5 and tier-6 children — every stubbed function lies on at least one held-back path. A per-child demotion in the factory's `--admit` step stays a small follow-up for a parent whose functions do not.

**Keep the family visible-only and rank models elsewhere.** Rejected: the completion family is the only private, uncontaminated, hundreds-strong suite the repository owns; leaving it non-discriminating leaves goal 1 with the saturated 44-task bench.

## Consequences

The 83 children of tier-5 and tier-6 parents are judged on their parents' held-back cases as well as the visible suite and carry the hidden-case rule in their prompts; all 83 are admitted, so `environments-completion/REFUSED.json` stays `[]`. The 163 children of tier-2 to tier-4 parents are byte-for-byte unchanged. Records made before this change stay distinguishable: every cell's `environment/run` stamp carries `checksSha256` and `promptSha256`, and the three pre-hidden completion records above carry the visible-only digests. The registrar's description no longer claims a visible-test tier. One asymmetry is left for its own slice: the curated registrar also appends `SHARED_RULES` (only `src/` changes, no `node_modules`, the `node --test` standard) and the completion registrar does not, because the completion paragraph forbids other edits in its own words and a second prompt change here would confound the discrimination reading.

## Verification

Regeneration with `--admit` over the 44 parents wrote 246 children and admitted all 246, refusing none: every tier-5 and tier-6 stub fails at least one of its parent's held-back cases and every reference passes them all; every stub passes `node --check` as before. The bench fixtures type-check on the host compiler face (`tsconfig.host.json`) with no error and lint clean. The discrimination check reruns the same six hard children both models aced visible-only, now with their hidden cases, on haiku and sonnet; its reading is added here from the record the `completion-hidden-pair` plan produces when that fleet lands.
