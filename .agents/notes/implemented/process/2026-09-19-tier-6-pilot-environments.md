# Agent Note: A bench tier of multi-file repositories, piloted at four tasks

Status: implemented

English | [中文](2026-09-19-tier-6-pilot-environments.zh.md)

## Problem

The Proving Ground bench separated implementers at tier 5 and nowhere else, and it stopped separating them there too. The largest product model certified every sealed tier-5 cell at the first attempt in four independent sweeps, so a mechanism tested against it reads 0 with an interval of [0, 0] by construction, which is what the [downshift](../../../../data/proving-ground/README.md) and cascade-share experiments measured. [The objectives note](../../proposed/process/2026-09-19-objectives-step-back.md) names the top tier's saturation as one of three blockers on objective 1 and asks for a tier the largest model does not saturate.

Every one of the forty tasks below this change is one file under `src/` with a stub body, so the whole task is "write this program from its specification". Enlarging that specification is the only knob tier 5 has, and the tier-5 record shows where it ran out: against the product loop, the tier separated on how much specification a task carried, not on how sharp its corners were. What no admitted task asks for is the work that actually costs an agent time — reading a repository that already exists, finding which of its files a change touches, and leaving everything the repository already does exactly as it was.

## Decision

Tier 6 is four environments under `examples/headless-agent/tests/fixtures/proving-ground-bench/environments/`, in the same data-driven format the registrar loads, each a multi-file Node.js repository with no dependencies:

| Environment | Domain | Files under `src/` | Hidden cases |
|---|---|---|---|
| `code:task-runner` | systems | 4, reference 5 | 140 |
| `code:config-layers` | parsing | 4, reference 5 | 140 |
| `code:job-queue` | state-machines | 4, reference 5 | 160 |
| `code:md-render` | text | 4, reference 5 | 150 |

Each ships a `README.md` documenting what the repository already does and a `Known gaps` section naming what it does not, four files under `src/` (the reference adds a fifth), immutable input files under `data/` that a case names by path, and two `node:test` suites: the repository's own, which passes as shipped, and one for the specified change, which fails until it lands. `task.json` carries `tier: 6`, `heldOut: false`, `immutable` extended to `data` and `README.md`, and the three checks tier 5 uses, the third naming `reference/cases.json`. The prompt specifies a change spanning several files and states that everything the README documents stays as it is, so a candidate that rewrites the repository fails its own shipped suite.

The hidden corpora are generated the tier-5 way: `reference/generate-cases.mjs` runs `reference/src/` over hand-written corners at weight 3 and a seeded stream at weight 1, and each rerun rewrites the file byte for byte. They compare `exit`, `stdout` and `stderr`, and they reach the workspace's files through argument words naming paths under `data/` — a digest snapshot, an INI layer, a rate-limit policy, a link-definition file — which is the only file access the tier-5 case format allows, since a case supplies argv and standard input and compares three streams.

**The tier is unaudited, and says so where the tier-5 audit was recorded.** [SUMMARY.md](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/SUMMARY.md) now covers both cased tiers, states in its opening that only tier 5 has been audited, and closes its tier-6 section with what has not been done: no second implementer has failed these cases, no corpus has been read case by case against its prompt, and the product-loop difficulty gate tier 5 passed has not been run. Until that reading happens a tier-6 miss may be an unstated corner rather than an implementer's error, and a tier-6 certification rate is not comparable to a tier-5 one.

`plans/e8-sonnet-vs-opus-t6.json` is the frozen pair that would first measure the tier: the middle product model against the largest, tier 6, two repetitions, seed 2, on the same `bench-2026-09-08-sealed` policy version as every other sealed plan. It is checked in, listed in `plans/README.md` and its Chinese pair as `not recorded`, and has not run.

A tier-6 `README.md` is task content the measured implementer reads, beside the English `prompt` in its `task.json`, so translating it would change what the bench measures. `scripts/translation-pairing.manifest.json` therefore excludes the whole `environments/` directory from bilingual pairing, and [docs/i18n/README.md](../../../../docs/i18n/README.md) records why.

## Alternatives considered

**Write harder single-file tier-5 tasks.** The cheapest option, and the one the tier-5 note already anticipated: its own risk section says that if a stronger loop certifies every cell, the answer is more corners rather than a longer suite. It does not reach the gap here. The saturating model certified all ten tier-5 tasks at the first attempt including the four with the largest specifications, so more specification in the same form buys difficulty the same way and stops at the same place, and none of it asks for the work of reading an existing repository.

**Change the existing modes' output so the specified change touches them.** It would force cross-file work with fewer files. Rejected because the shipped suite is what makes the repository real: a task whose specification contradicts a test the workspace ships is a task that teaches the candidate to delete tests. Every tier-6 change is additive to what the README documents, and the repository's own suite is the guard that says so.

**Let a case compare the workspace tree after the run.** A `tree` channel would test a program that writes files, which is the obvious multi-file task. The verification seam has the channel, but no bench check declares the scope it needs, and adding one would put a new mechanism in the same change as a new tier. Reading files named by argv exercises the file dimension through the format that already exists.

**Ship the tier at ten tasks like tier 5.** Ten would give a sixteen-cell reading at two repetitions, which is the shape every recorded experiment has. Rejected for now because the fairness audit is the expensive half and it has not run on any of these: four tasks is what one audit pass can absorb, and a tier that turns out to be unfair at four is cheaper to fix than at ten. The plan's cell count is the price, and the note says so rather than hiding it.

**Mark the tier unaudited with a field in `task.json`.** A machine-readable `audited: false` would travel with the environment into every record. Rejected because nothing reads it: the registrar, the admission script and the drivers would all ignore it, so it would drift the first time an audit landed. The tier-5 audit is recorded in prose in `SUMMARY.md` and its own Agent Note, and tier 6 is marked unaudited in the same place, where the next reader of either tier is already looking.

## Consequences

The bench is 44 environments over six domains, and `pnpm run bench -- admit` runs four more references and 590 more hidden cases twice each, which is the bulk of the admission gate's added minutes. `proving-ground-bench.e2e.ts` no longer treats "has hidden cases" as "is tier 5": it asserts the cased tiers are exactly 5 and 6, that each cased task registers one cased check of at least 80 cases, and that tier 6 holds at least four tasks.

What the tier cannot yet tell anyone is whether it separates. It was admitted, not gated: the references pass every visible check and every hidden case, and the pre-states fail, which proves the corpora measure something the visible suites do not — it does not prove a strong model misses any of them. The first `e8` run is what would say, and the fairness audit is what makes a miss readable. Both are queued; neither has happened, and a tier-6 number read before them is a number about an unaudited instrument.

The `environments/` exclusion from bilingual pairing means a future English-only document anywhere under that directory passes the gate silently. That is the intended scope — the whole tree is task content — but it is wider than the four READMEs this change adds.
