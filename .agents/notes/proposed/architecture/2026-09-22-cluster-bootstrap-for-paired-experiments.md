# Agent Note: A cluster bootstrap for paired experiments

Status: proposed

English | [中文](2026-09-22-cluster-bootstrap-for-paired-experiments.zh.md)

## Problem

[The experiments service](../../../../packages/improvement/experiments/README.md) reported the overall interval of a paired certificate-rate delta by resampling the paired deltas inside each environment and never resampling the environments themselves. At two repetitions, an environment whose two paired deltas agree contributes no variance to that interval. When one environment flips both of its repetitions and the arms agree on every other environment, every resample reproduces the observed delta and the interval has no width, however little evidence it rests on.

The 2026-09-21 E7 pair is that case. [`2026-09-21-bench-e7-attempts-5-t5`](../../../../data/proving-ground/2026-09-21-bench-e7-attempts-5-t5/result.json) certified 12 of 16 cells on the three-attempt baseline and 14 of 16 on the five-attempt candidate: `code:conf-canon` failed on both baseline repetitions and certified on both candidate repetitions, and the arms agreed on both repetitions of the other seven environments. The result stated a delta of +0.125 with the interval [0.125, 0.125] and the verdict `promote`, and the bench loop's fixed rule wrote `adopt-candidate` on line 7 of [the loop ledger](../../../../data/proving-ground/loop/ledger.jsonl). The two earlier E7 pairs of the same plan read +0.0625 (14 against 15 of 16) and −0.0625 (15 against 14), and the three pooled read 41 against 43 of 48, +0.042, below the plan's `minimumDelta` of 0.05. The three-attempt baseline arm certified 14, 15, and 12 of 16 across those three pairs, and the same route at three attempts certified 14 and 13 of 16 in the two tier-5 baseline fleets on ledger lines 5 and 8, so one configuration's run-to-run variation spans three flips, not one.

An interval that resamples inside environments alone also answers a narrower question than the verdict asks. The bench samples tasks, and a promotion claims the candidate is better over tasks of that kind; an effect that lives in one of eight environments is exactly the uncertainty the environment draw carries, and the within-environment resample cannot see it.

## Proposal

**The overall interval is a two-stage cluster bootstrap.** Each resample draws the environments that hold a paired delta, with replacement and as many as there are; then, within each drawn environment, as many of its paired deltas as it holds, with replacement. The resample's statistic is the sum of the drawn deltas over their count, the ratio the point estimate uses, so an environment weighs by its paired count and an environment with no pair contributes nothing. The interval is the percentile interval of the resampled statistics at the configured confidence level. Each environment's own interval keeps resampling its paired deltas alone, from the same generator and in the same draw order as before, so every per-environment interval already on record replays unchanged.

**The draws stay deterministic.** The overall pass draws from one mulberry32 generator seeded with the 32-bit FNV-1a hash of the plan digest alone, and takes the environments in code-unit order of their ids, so the interval does not depend on the order a plan lists its environments in; each environment's own pass keeps its generator seeded with `<digest>:<environmentId>`. The same frozen plan over the same certificates replays to the same intervals in any process.

**A result names its statistic.** `ExperimentResult.statistic` is `paired-cluster-bootstrap/1` on every result the fold writes. A stored result that names none was read by `paired-bootstrap/0`, the within-environment method, and `readStatistic` reads it that way and refuses a name the package does not define. The statistic is not digested: the digest freezes the plan and seeds the draws, and a re-read is the same frozen plan under another statistic. The `bench loop` ledger line carries the `statistic` of the record it read, as an added field; the loop's fixed decision rule does not change, and the dashboard's Loop section shows the statistic beside the interval, reading a line written before the field as `paired-bootstrap/0`.

**A verdict needs a minimum of discordant pairs.** Only a paired repetition whose arms disagree on the certificate moves the delta. `minimumDiscordantPairs` is a validated `Config` field, a non-negative integer with default 2, frozen into the thresholds and the plan digest, which takes the plan format from 7 to 8. With fewer discordant pairs than the minimum the verdict is `inconclusive` whatever the interval says, because one flipped certificate erases a delta that rests on one disagreement. The result states `discordantPairs` and `verdictBasis` — `interval`, `no-pairs`, or `too-few-discordant-pairs` — so a stored result says why it is `inconclusive`. `0` disables the minimum for a deployment that promotes ties on purpose, such as a non-inferiority reading with a negative `minimumDelta`.

**Recorded pairs are re-read offline, never rewritten.** A record's `result.json` states per-environment rates, not which repetitions certified, and rates cannot tell `{0, 0}` from `{+1, −1}` when both arms certify once. [`reread-driver.ts`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/reread-driver.ts) therefore rebuilds every repetition's paired outcome from the record's `facts.jsonl`, keyed by stamp group, environment, and repetition, and refuses the rebuild unless it reproduces every recorded cell: its pair count, both arms' certificates, and its interval redrawn under the record's own digest. It reads one record under that record's digest, pools several records of one plan and one set of arms per environment under a digest derived from their names and digests, and writes a fold under `data/proving-ground/folds/` without overwriting a file. Every E7 record passes the rebuild check.

### The re-read numbers

| Reading | Statistic | Baseline | Candidate | Delta | Discordant pairs | Interval | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-21 pair, as recorded | `paired-bootstrap/0` | 12 of 16 | 14 of 16 | +0.125 | 2 | [+0.125, +0.125] | `promote` |
| [2026-09-21 pair, re-read](../../../../data/proving-ground/folds/2026-09-22-e7-attempts-5-t5-3-cluster-reread.json) | `paired-cluster-bootstrap/1` | 12 of 16 | 14 of 16 | +0.125 | 2 | [0, +0.375] | `inconclusive` on the interval |
| 2026-09-19 first pair, as recorded | `paired-bootstrap/0` | 14 of 16 | 15 of 16 | +0.0625 | 3 | [−0.125, +0.25] | `inconclusive` |
| 2026-09-19 second pair, as recorded | `paired-bootstrap/0` | 15 of 16 | 14 of 16 | −0.0625 | 1 | [−0.125, 0] | `inconclusive` |
| [Three E7 pairs, pooled](../../../../data/proving-ground/folds/2026-09-22-e7-pooled-three-pairs-cluster.json) | `paired-cluster-bootstrap/1` | 41 of 48 | 43 of 48 | +0.042 | 6 | [−0.083, +0.1875] | `inconclusive` on the interval |

Re-read, the 2026-09-21 pair is `inconclusive`: about a third of the cluster resamples leave `code:conf-canon` out, which puts the lower bound at zero, and its two discordant pairs meet the default minimum, so the interval alone decides. Pooled with the two earlier pairs, the delta is below the plan's minimum and the interval contains zero. The first 2026-09-19 pair froze under plan format 6, before the preset field entered the digest, so its digest differs from the other two while its arms, environments, caps, and thresholds are identical.

### The 2026-09-21 `adopt-candidate`

The `adopt-candidate` on ledger line 7 is an artifact of `paired-bootstrap/0`: the same certificates read under the cluster bootstrap are `inconclusive`, and the pooled reading of the plan is too. The ledger line stands as written, because the ledger is append-only and machine-written; its reading names no statistic, which reads as `paired-bootstrap/0`. The corrected reading goes into [the improvement log](../../../../data/proving-ground/improvement-log.md), whose rows are written by hand, not into the ledger. `adopt-candidate` is a decision, not an edit, so no composition carried the five-attempt arm and nothing needs reverting.

### Specs whose expectations change

The service spec that promoted a comparison resting on one paired repetition expects `inconclusive` with `too-few-discordant-pairs`, because one disagreement is the evidence the minimum exists to withhold a verdict on; the same spec shows that `minimumDiscordantPairs: 1` restores the promotion. The statistics spec no longer asserts that a single environment's interval equals the overall one: the two passes draw from different generators, so they agree in distribution rather than draw for draw, and the spec pins instead that the overall pass is seeded by the digest alone. The identical-arm, defaults, and end-to-end specs restate five thresholds, and the experiment-presets snapshot records the new digest and fields. The loop spec that resolved the next record name of a 2026-09-19 plan read the live records directory, where the loop's second E7 record of that day already holds the name it expected, so it resolves against a past loop night whose records no longer change.

## Alternatives considered

**Keep the within-environment bootstrap and raise `minimumDelta`.** A zero-width interval clears any minimum below its point, so a higher minimum only moves the threshold the artifact must clear; it also blocks a real effect spread thinly across many environments. The defect is the width, not the threshold.

**Run more repetitions per environment.** An environment whose repetitions all agree still contributes no width at any repetition count, and the verdict generalizes over environments; more environments, not more repetitions of the same ones, narrow the interval honestly.

**An exact test on the discordant pairs.** McNemar's exact test on paired binary outcomes uses only the discordant pairs, and at two discordant pairs in one direction its two-sided p-value is 0.5, so it would also have withheld the promotion. It is rejected as the statistic because the verdict rule compares an effect size with `minimumDelta`, which a p-value does not provide; the discordant-pair minimum keeps its insight that concordant pairs carry no information about the difference.

**A hierarchical model with a prior per environment.** A beta-binomial model calibrates better at small counts, but it needs priors, which would become deployment tunables beside the thresholds, and either a sampler dependency or an approximation whose draws are no longer the digest-seeded resample a verdict replays from. The cluster bootstrap fixes the defect with the generator and the replay obligation the package already has.

**Resample the environments alone.** A one-stage cluster bootstrap treats each environment's observed mean as fixed, which drops the repetition noise inside an environment such as `code:sheet-eval` with paired deltas `{−1, +1}`. The second stage keeps both sources of variation.

**Rebuild the pairs from `result.json` alone.** The recorded rates fix each arm's certificate count per environment but not which repetitions certified, so a cell where both arms certified once is either two concordant pairs or two opposite discordant pairs; `facts.jsonl` holds every session's repetition and certificate, and the recorded per-environment intervals verify the rebuild.

**Digest the statistic.** Freezing the statistic into the digest would mint a new experiment identity for every statistic version and give a re-read of a recorded pair a digest none of its sessions carry. The result names its statistic instead; the discordant-pair minimum is digested because it decides what is promotable.

**Correct the record or the ledger in place.** Records and ledger lines are the history the improvement log reads, and rewriting one would make every earlier reading unreplayable. A re-read is a new fold beside the record.

## Acceptance criteria

- Every result `foldExperiment` writes carries `statistic: 'paired-cluster-bootstrap/1'`, `discordantPairs`, and `verdictBasis`, and its thresholds carry `minimumDiscordantPairs`; the schema refuses a fractional or negative value and defaults it to 2, and the plan digest freezes it under plan format 8.
- One environment flipping both repetitions beside agreeing ones reads a positive-width interval with a lower bound of zero and `inconclusive`, and fewer discordant pairs than the minimum reads `inconclusive` with `too-few-discordant-pairs` where the interval alone would promote; unit specs pin both, and the cluster draws replay exactly under one digest and in any stratum order.
- `readStatistic` reads a result without the field as `paired-bootstrap/0` and refuses an unknown name; the `bench loop` ledger line carries `statistic`, and `decideIteration` is unchanged.
- The two folds above exist, and no record or ledger line changed.

## Risks

**Eight environments are few clusters.** The cluster bootstrap's resampled distribution over a handful of environments is coarse, and a percentile interval over few clusters still under-covers, so a nominal 95% interval is wider than before but not exactly 95%. `minimumDelta` and `minimumDiscordantPairs` remain the defences.

**Verdicts move.** A comparison that promoted under `paired-bootstrap/0` can read `inconclusive` under the cluster bootstrap, as the 2026-09-21 pair does; a reader of a stored result checks `statistic` before comparing it with a newer one.

**Every digest changes.** Plan format 8 freezes every plan to a new digest, so a caller that froze a plan under format 7 is refused with `EXPERIMENT_PLAN_NOT_FROZEN` and its arms run under new stamp groups.

**The rebuild trusts the facts export.** A record without `facts.jsonl`, or whose facts disagree with its cells, cannot be re-read; the driver refuses rather than guessing.

**A pooled reading spans heads.** The three E7 pairs ran on three repository heads; pooling them assumes the harness changes between those heads left both arms' behavior unchanged, which the identical arms, caps, and thresholds support but do not prove.

**The default minimum is a heuristic.** Two discordant pairs is the smallest count at which one flipped certificate cannot erase the delta on its own; a deployment that runs more repetitions can raise it.
