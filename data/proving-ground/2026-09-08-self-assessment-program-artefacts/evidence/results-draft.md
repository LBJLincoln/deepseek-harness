# Agent Note: What the hypothesis program measured on the operator's subscription

Status: proposed

English | [中文](2026-09-08-hypothesis-program-results.zh.md)

## Problem

The hypothesis program ([slate](../architecture/2026-09-07-hypothesis-program.md)) promised that every experiment would end with a verdict and an interval recorded under `data/proving-ground/`, and that a refutation would be recorded with the same care as a confirmation. Two days of runs on the operator's Claude Code subscription produced TODO records and TODO folds; nothing summarizes them, so a reader who wants to know whether the harness loop beats the product's own loop, whether a smaller model is worse, whether the directive loop earns its attempts, or whether a knowledge pack changes anything has to read the proving-ground README end to end. This note is that summary, with the refutations first.

## Proposal

Read the records as follows, adopt the readings as the current state of knowledge about this harness on these tasks, and queue the slices the results demand rather than any change the results do not support.

### What was measured

| Experiment | Tier, cells | Arms | Certified | Delta, interval, verdict | What separates the arms |
| --- | --- | --- | --- | --- | --- |
| E2 harness loop vs product loop | 3, 36 | route vs delegated product, same model | 18 of 18 vs 18 of 18 | 0, [0, 0], inconclusive | wall time level (harness faster in 11 of 18 pairs, medians 164 vs 179 s); harness spend write-dominant (3,005,288 cache-write tokens over 200 queries) |
| E2 as two fleets | 2 and 4, 12 + 18 each | same | 30 of 30 vs 30 of 30 | fleets, not folded | harness faster on tier 2 (9 of 12 pairs), slower on tier 4 (6 of 18 pairs, 2,915 vs 2,292 s of cell time) |
| E2 on tier 5 | 5, 32 | same, audited tasks, seed 2 | TODO | TODO | TODO; the product arm ran uncapped (budget parity landed after) |
| E1 small vs middle | 3, 36 | sonnet vs haiku | 18 vs 18 | 0, [0, 0], inconclusive | small model 405 steps vs 182, 6,719 vs 3,807 s, 844,538 vs 358,054 output tokens |
| E1 middle vs large | 3, 36 | sonnet vs opus | 18 vs 18 | 0, [0, 0], inconclusive | large model 156 steps vs 208, 2,070 vs 3,948 s, 166,606 vs 367,172 output tokens |
| E1 on tier 5 | 5, 32 each | sonnet vs haiku; sonnet vs opus | TODO | TODO | TODO |
| E3 attempts, tier 3 | 3, 18 + 18 | three attempts vs one | 18 vs 18 | 0, [0, 0], fold says nothing | no cell used a second attempt |
| E3 attempts, tier 5 counterfactual | 5, 16 re-read | three vs one, from one run each | harness 11 vs 8; product 11 vs 11 | −0.1875, [−0.25, −0.125], reject for the cap; product 0 | the product loop's later attempts were a fresh child with the directive alone |
| E3 attempts, tier 5 paired | 5, 16 + 16 | three vs one, audited tasks, seed 2 | TODO | TODO | TODO |
| E4 knowledge pack | 3, 18 + 18 | 2026-q3 pack mounted vs none | 18 vs 18 | 0, [0, 0], null | the pack was never opened: no skill call in any cell |
| Roles matrix | one run each | implementer, validator, judge, program, bridge | five roles work on the route | not an experiment | the two-turn bound broke every role until the native-tool route |

### What was refuted

- **The harness loop loses to the product loop on the same model.** Refuted on tiers 2 to 4: 48 of 48 against 48 of 48, level wall time. Not supported either way on tier 5 until the parity rerun (TODO fill).
- **A smaller model is worse on these tasks.** Refuted on tier 3 for both pairs: certificates are level; the three models order by spend and steps, and on this route the largest is the cheapest because it takes the fewest steps and every step rewrites the prefix. Tier 5: TODO.
- **Attempts do not matter.** Refuted on tier 5 for the harness loop: three of eleven certificates came at the second attempt after a clustered directive, and a cap of one costs them, delta −0.1875. Confirmed as null on tier 3, where no second attempt was taken.
- **A knowledge pack helps by being present.** Refuted: a catalog the tasks do not call for is read and ignored, and it costs wall time (5,433 s against 3,959) whose cause one fleet cannot assign.

### What stayed inconclusive, and why

Tiers 2 to 4 are saturated on certificates for all three product models under both loops, so every comparison there is inconclusive by construction and the information lives in steps, wall time, and spend. Tier 5 separates (11 of 16 for both loops on the pre-audit tasks) but sixteen cells give an interval no narrower than ±0.19 for a real difference, and the two loops' later attempts were not the same instrument until the attempt ladder lands. The bench cannot promote anything yet; it can refute, and it did.

### Routing

The slate's E5 and E6 (the handoff tax, the downshift, k attempts against routing) wait on the attempt ladder ([task](#) TODO note link). Meanwhile the three single-model arms at tier 5, seed 2, allow an offline reading of a router that restarts a cell on the next model after a miss: TODO table (oracle, cascades cheap-first and strong-first, each against fixed sonnet, in output tokens, cache-write tokens, steps, seconds). On tier 3 the same reading is trivial and still instructive: every cascade that starts on the small model costs what the small model costs (844,538 output tokens for 18 cells), the strong-first cascade costs what the large model costs (166,606), and the oracle saves 8 percent over the large model alone. A per-turn router in the style of Fugu is not tested by any of this and is not proposed.

### Spend

Every harness-loop step on this route opens a fresh product session and writes its prefix to the cache again: 4,778,361 cache-write tokens for sixteen tier-5 cells against 745,264 cache-read. The session-continuity slice resumes one product session per harness session; its effect is measured on a tier-3 fleet after it lands (TODO numbers). The product loop's spend is read-dominant and its misses ran up to 3,459 s and 5.60 USD each because the composition's caps bound only the harness's own steps; the budget-parity slice applies the cell's caps to a delegated attempt (TODO landed commit).

## Alternatives considered

- **Report the certificate rates as a leaderboard.** Rejected: the observatory ranks only from experiment verdicts, and every verdict on record is inconclusive or a refutation; a leaderboard would rank noise.
- **Raise the repetitions until an interval excludes zero.** Rejected for now: at two cells at a time a tier-5 experiment of 32 cells takes three hours, and the reading that the two loops are level on tiers 2 to 4 would not change with more cells; the money goes to tier 5 and the ladder.
- **Import a public benchmark before drawing any conclusion.** Deferred as the slate says; the readings above are about this harness on this bench, and say so.

## Acceptance criteria

- Every row of the table above points at a record or fold under `data/proving-ground/` with sessions on disk.
- The results section of the slate note links here, and the observatory shows no ranking from these runs.
- The attempt ladder, the tier-5 parity rerun, and the held-out estimate each add a row here when they land.

## Risks

- Sixteen cells per arm on tier 5 is a small sample; the counterfactual intervals understate run-to-run variance and are labelled so.
- The tasks are authored in-house; the audit fixed three specification corners after both loops missed them, and a later audit may find more.
- The product envelope around every route query is model-visible and not in the log; both arms carry it, so comparisons hold and absolute costs include it.

<!-- facts to fold in (2026-09-08 06:30 UTC)
- Leak: every harness-loop run had 1-5 cells cd to the run dir; census per record (naming another cell / plan-log / wrote outside): e2-t5 5/5/1 (sheet-eval rep0 worked inside rep1's workspace); h1-harness-t5 7 escaped, 5 same-env, 2 wrote outside; e1-haiku-t3 3; e1-opus-t3 5; e3-baseline 1; e3-attempts1 4; e4 3; h1-t4 3; h1-t2 1 (cp of the sibling's csv.js); e2-t3 1. Product-loop cells: 0. Fix: sealed-cell slice (#83): barrier denies the parent, workspace granted; bwrap/landlock; escapes counted.
- Rate limit: subscription session limit hit ~04:10 UTC, reset 05:30: killed two opus agents, both E1 t5 experiments (20/22 cells each), two product cells of E2 t5 (uri-resolve), the district driver (04:33). Relaunches at 05:46.
- E2 t5 recorded (18th): 12/16 vs 11/16, delta -0.0625 [-0.125, 0] inconclusive; product recovered one at attempt 2; product faster 10/16, 7,554 vs 10,221 s; $13.23 reported; route 802,872 out, 626,621 read, 2,927,150 write.
- Parity merged b3da945f7 (runner requires a budget policy for delegated implementers; experiments refuse arms under different caps; budget-deadline stop reason). Continuity merged e623bc257 (per-session default; README probe: 69,212 cache-read vs 14,606 written over ten steps; e2e green 06:20).
- Craft skills arm pushed e7d0a209c (H4 with a relevant catalog), plan h4-craft-sonnet-t5 seed 2; held-out plan seed 3 over 8 held-out envs.
- Reruns under the seal, in order: E1 haiku/opus t5 (seed 2), E3 pair t5, H4 craft fold t5, continuity spend on a t3 fleet vs record 15, held-out last. District restart after the seal.
-->

<!-- facts to fold in (2026-09-08 09:25 UTC)
- Seal merged c97653829: barrier denies the cell's parent with the workspace granted (bwrap/Landlock/Seatbelt precedence), runner registers dirname(workspace), escapesDenied fact/row, census tool, bench + district confined; sealed-cell e2e under real bwrap.
- Claim gap (#85): route-only overlay (isolation process) fails every certificate with VERIFICATION_ISOLATION_UNPROVEN because the Claude Code route's own CLI spawn counts as unenforced subprocess; route arms run on the base composition (confined, claim none). Overlay comment corrected 38356ef50.
- Latent defect found by the seal (fixed 5d4135c65): reserved cased-check scripts held only the command, so under a barrier every case ran without argv (136 of 140 cases failed with the usage error on build-schedule); the bench had run inline (no barrier) before, so earlier records are unaffected; fixture cover queued (#86).
- Three E1 t5 launches lost today: rate limit (04:10), sibling layout (05:46), claim/argv (08:48, 09:03). Fourth launch after the diag cell certifies.
-->
