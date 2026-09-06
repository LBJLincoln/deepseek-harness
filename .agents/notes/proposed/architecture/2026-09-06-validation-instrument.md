# Agent Note: The validation instrument, weighted cases behind the wall

Status: proposed

English | [中文](2026-09-06-validation-instrument.zh.md)

## Problem

The strongest public evidence about large software tasks supports one mechanism: an executable standard of completion derived from the outcome before implementation starts, measured by a validator the implementer cannot see, with failures clustered by root cause before anything crosses to the implementer. The verification seam in this repository has the roles and, since the read-barrier slices, the enforcement of the wall, but not the instrument. A `StandardCheck` is one shell instruction with a binary verdict: it carries no case body, so a check cannot weight what it measures, cannot sample the input space of a program, and cannot compare a candidate's behaviour against a reference channel by channel. The runner's `evidenceOf` forwards the bounded `stdout` and `stderr` tails of a failed check into the directive the implementer reads, so the raw output of a hidden case crosses the wall that the read barrier holds shut on the filesystem side. Nothing derives a standard from an oracle; validators author checks by hand in fixtures. And a certificate is all or nothing, so an implementer that reached ninety percent of a program's behaviour and one that reached ten percent produce the same `outcome: 0` in the trajectory export and the same empty cell on the scoreboard, which hides exactly the progress a large task is made of. The [competitive baselines note](2026-09-06-competitive-baselines.md) records the evidence; this note designs the instrument.

## Proposal

Four additions to `dsh-verification`, `dsh-environment-runner`, and `dsh-environments`, each deterministic, each recorded in the session log, none changing what a certificate means: a certificate still requires every case of every active check to pass.

### Cases on checks

`StandardCheck` gains an optional `cases` reference: `{ count, weightTotal, sha256 }`. The case bodies live beside the check script under the validator's reservation, in `checks/<checkId>/cases.jsonl`, one `CheckCase` per line: `{ id, weight, input: { argv, stdin?, files? }, expected: { exitCode?, stdoutSha256?, stderrSha256?, treeSha256? }, comparator: { channels, normalizers } }`. `channels` is a non-empty subset of `exit | stdout | stderr | tree`; `normalizers` is an ordered list of ids from a closed set the verification package owns and documents (`crlf`, `trailing-whitespace`, `blank-lines`, `iso8601-timestamps`, `temp-paths`, `json-canonical`), each a pure function over bytes with a unit fixture proving idempotence; an unknown id or a case whose expected channel has no digest fails at authoring, before any run depends on it. The log carries the reference, the reservation carries the body, the tamper digest of slice 6 covers `cases.jsonl`, and the `checksSha256` of the environment definition covers the cases of a registered environment, so the decontamination key changes when a case does. A check without `cases` behaves exactly as today. `Config.maxCases` bounds one standard's cases the way `maxChecks` bounds its checks.

### Four-channel execution and the parity record

For a check with cases the runner spawns the candidate once per case through the resolved shell and sandbox policy, in the workspace, with the case's `argv`, `stdin`, and staged `files`, and captures the exit code, the `stdout` bytes, the `stderr` bytes, and the digest of the work-tree delta under the check's declared `treeScope`. Each configured channel is normalized, digested, and compared with the expected digest; a case passes only when every configured channel matches. `CheckResult` gains `cases: { passed, total, weightPassed, weightTotal, failed }`, where `failed` lists case ids up to a bounded count, and `verification/run` gains `parity: { weightPassed, weightTotal }` summed over the run's checks. `recordRun` derives the check status from its cases (`pass` only when every case passed) and keeps the existing rule that a certificate follows only a run whose every check passed; `parity` never certifies. The scorekeeper's facts gain `parity` from the last recorded run, the scoreboard shows `resolved` (certificate) and `parity` (weighted pass rate of the last run) as two columns that are never merged or ranked together, and the trajectory record gains `parity` beside `outcome`, documented as an auxiliary signal for shaped rewards that never replaces the certificate-based `outcome`.

### The wall, closed on the way out

`describeFailures` stops forwarding output. A directive is built from clusters: failed cases are grouped by check, by the set of mismatching channels, and by exit-code class; each cluster becomes one line naming the check's validator-authored `outcome` text, the count and weight of its cases, and the channels that disagreed, never a case id's content, an expected digest, or a byte of `stdout` or `stderr`. The `verification/directive` event gains `clusters: [{ checkId, channels, count, weight }]` for the observatory; `detail` stays bounded by `evidenceMaxChars`. The raw evidence stays where it is, in the `verification/run` results of the log, readable through the session-query tools whose `session-log` authority the read barrier already denies to an implementer. A unit test feeds a failing case whose expected output is a sentinel string and asserts the sentinel appears in the run's evidence and nowhere in the directive, and the keyless snapshot pins the clustered directive text the implementer sees.

### Deriving the standard from a reference

A `recreation` environment kind declares `task.reference`: a directory under the fixture, copied beneath the barrier root at reservation time and listed as immutable, holding the reference program the validator may execute and the implementer may never read. A validator-role preset composes a `standard_author` tool carrying a new `standard-author` tool authority, which the mount audit and the per-agent guard deny to `implementer` sessions exactly as `session-log` is denied today. The tool offers three verbs: `record_case` runs the reference under the same four-channel capture and stores the expected digests for the given input, `weigh` sets a case weight, and `freeze` writes the cases file and authors or extends the standard through `ctx.completionStandards`. Behavioural sampling stays the validator agent's semantic work, bounded by `maxCases` and guided by a skill; the executor, the digests, and the wall are deterministic. `% resolved` (a certificate) and `parity` (the weighted pass rate) are reported as two metrics under their own names, following the distinction the ProgramBench authors draw.

### Deviations recorded while slices 1 and 2 landed

A definition carries case bodies on the check itself: `AuthoredCheck extends StandardCheck` with `caseBodies`, which `author()` and `extend()` validate against the `cases` reference and then drop, so the log keeps the reference alone and no second keyed map can name a check that does not exist. Registration hashes the bodies into `checksSha256` and validates nothing about them, because authorship is the operation that decides whether cases are usable.

The check script moved to `checks/<checkId>/run`, so `checks/<checkId>` can be the directory holding `cases.jsonl` beside it.

`CheckResult.cases.failed` carries a record per failed case — `{ id, weight, channels, exitClass }` — rather than a bare case id: the directive clusters by channels and exit-code class, and the run results are the only place those facts exist. The runner's `maxFailedCases` bounds the list; the tally still counts and weighs every failure.

The `tree` channel digests every regular file under `treeScope` as the case left it, and the runner empties that directory before each case of a check that declares one, which is what makes the digest a per-case delta.

`describeFailures` clusters a cased check and leaves a caseless check's evidence line as it was, so the wall closes exactly where cases exist; an environment closes it for a check by giving that check cases.

### Deviations recorded while slice 3 landed

The `dsh-trajectory/1` record carries `parity` at its top level beside `reward` rather than inside the reward group beside `outcome`: everything inside `reward` is what the certificate decided, and a weighted pass rate placed among those fields reads as part of the reward it must never become.

The scorekeeper fact and the exported field are both the parity of the last recorded run, absent when that run measured no cases, rather than the last parity any run of the session carried. `certified` and `attempts` already describe the last run, so a rate left over from a standard revision whose cased checks were relaxed away would publish two standards' measurements in one row. The scorekeeper's invariant companion recomputes the fact from the log's last `verification/run` and rejects a record that states another.

`ScoreboardRow.parity` is the mean of each session's `weightPassed / weightTotal` rather than the pooled ratio of the row's weights, so a session sampled by more cases does not weigh more than its siblings in the cell the row names.

## Alternatives considered

**Cases inside the `verification/standard` event.** Rejected: a recreation task carries hundreds of cases and the log is the record every replay reads; the reservation already holds the check bodies, the tamper digest already covers it, and the event carries the digest that binds the two.

**Raw output tails in directives.** The status quo, rejected: the tail of a hidden case's expected output is the case, and a wall that holds on the filesystem and leaks through the directive holds nothing.

**Parity as the reward.** Rejected: a weighted pass rate is gameable by an implementer that overfits the visible failures and abandons the rest; `outcome` stays the certificate, and `parity` is exported as an auxiliary signal that a training run may shape with but never optimize alone.

**A model as comparator.** Rejected: a comparison that two runs can decide differently cannot certify; normalizers are named pure functions, and a program whose output is nondeterministic under every normalizer is excluded from cases rather than judged.

**A binary check status forever.** Rejected: a check that passes 700 of 770 cases and one that passes none are different facts about the work, and the scoreboard, the trajectory export, and the validator's directive all need that difference.

## Acceptance criteria

- A `recreation-instrument` fixture registers an environment whose reference program lives under the barrier root; the validator preset authors a standard of weighted cases from it; the mock implementer's program passes some cases and fails others; the attempt's `verification/run` carries `parity` with the exact weights, each failing case is reported with its mismatching channels in the run results, and no certificate exists until a later attempt passes every case.
- The directive issued after a failing run names the checks' `outcome` texts, counts, weights, and channels and contains no byte of any case's expected output; a unit test proves it with a sentinel, and a keyless snapshot pins the text.
- Each normalizer has a fixture proving idempotence and its stated effect; an unknown normalizer id and a case with a configured channel but no digest are refused at authoring.
- The invariant companion rejects a run whose `parity.weightPassed` exceeds `weightTotal`, a result whose case counts disagree with the check's `cases` reference, and a certificate following a run with a failing case.
- `standard_author` is refused by the mount audit for an `implementer` preset and by the guard for a tool registered later; the census lists its authority.
- The scoreboard shows `resolved` and `parity` as separate columns and refuses to rank across them; the trajectory record carries `parity` beside `outcome` and the exporter's README states the rule.
- Changing one case changes the environment's `checksSha256`; the tamper fixture extended with a modified `cases.jsonl` yields `verdict: 'tampered'`.

## Rollout

1. Landed. Cases on checks: the `cases` reference, `CheckCase`, the normalizer set, `maxCases`, four-channel execution in the runner, `CheckResult.cases` and `verification/run.parity`, the invariant rules, catalogs regenerated.
2. Landed. The wall closed: clustered directives with `clusters` on `verification/directive`, the sentinel test, and the `instrument-cases` snapshot over a Loader-booted fixture.
3. Landed. Parity downstream: `SessionFactsOutcome.parity` and the `ScoreboardRow.parity` column, `parity` on the `dsh-trajectory/1` record, and the publication rule in the Village note.
4. The instrument: the `recreation` kind with `task.reference`, the `standard-author` authority, the `standard_author` tool, the validator preset, the sampling skill, the `recreation-instrument` fixture.
5. Suite admission: recreation environments admitted through the curator of the four-goal note with both metrics on the stamp.

## Risks

- **Nondeterministic programs.** A case whose reference output varies fails every candidate; authoring runs the reference twice and refuses a case whose channels differ between the two runs.
- **Cost.** Case-based validation multiplies check executions; the published evidence puts the system condition at about fourteen times the credits of a single agent, and the budget policy and the fleet's ceiling bound what a cell may spend.
- **Normalizer growth.** Every normalizer widens what counts as equal; the set is closed, documented, and extended only through this note's successor with a fixture per entry.
- **Log size.** Hundreds of case results per run enter the log; `failed` is bounded and the case bodies stay in the reservation.
- **Partial-credit gaming.** An implementer shown cluster counts can chase the visible clusters; held-out cases and the tamper digest keep the measurement honest, and `parity` never certifies.
