# Agent Note: What the four goals mean as measurable claims, and the shortage under all of them

Status: proposed

English | [中文](2026-09-22-four-goals-rethink.zh.md)

## Problem

[The objectives note of 2026-09-19](2026-09-19-objectives-step-back.md) stated where the four goals stand. On 2026-09-22 four read-only audits mapped the tree at `c0efe64a3` against each goal, package by package and record by record, and found the standings overstated and the instrument weaker than its documentation. This note replaces that note's standings and its order of work; it does not replace [the four goal workflows](../architecture/2026-09-05-four-goal-workflows.md), which remain the target design.

What the audits established, each fact with its place in the tree:

- **The harness that was measured is not the harness that ships.** Every harness-loop cell on record ran an eight-tool build (`bash`, `read`, `write`, `edit`, three job tools, `skill`) under a two-sentence persona ([bench `cordis.yml`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/cordis.yml)); none of the shipped coding plugins (compaction, grep and glob, the editor, todo, subagents, workflows, plan mode, LSP, Code Mode, the repeat-call reminder) has a measured effect on coding. 1,137 of 1,157 stamped cells ran one vendor's models through the operator's Claude Code login; the native DeepSeek adapter has zero bench cells; the harness route ran at `effort: medium` while the product loop set none, so the "harness equals product loop" reading carries a confound. Nothing adapts to a model: no per-model prompt, tool surface, edit format, or text tool-call fallback, and the one open-weight failure on record (a model that never wrote a file) was filed as "not the harness's to fix" — which is exactly the case goal 1 is about.
- **The instrument false-promotes.** The paired bootstrap in [`dsh-experiments`](../../../../packages/improvement/experiments/README.md) resamples paired results within each environment and never resamples environments; with two repetitions an environment whose results agree contributes no variance. The only `adopt-candidate` the loop has ever written ([ledger line 7](../../../../data/proving-ground/loop/ledger.jsonl), 2026-09-21, E7 five attempts against three) is 12 of 16 against 14 of 16 with the interval `[0.125, 0.125]`: one environment flipped both repetitions and every other cell was identical, so the interval collapsed to a point. Pooled over the three E7 pairs the reading is 41 of 48 against 43 of 48, +0.042, under the plan's `minimumDelta`. The one earlier `reject` in a harness mechanism's favour (E3, three attempts against one, −0.375 on 2026-09-08) did not replicate (−0.0625 on 09-19 and on 09-21), and the same configuration scores anywhere from 12 to 15 of 16 across twelve recorded fleets, so the documented noise floor of one flip understates it. The 09-19 note's "attempts matter (+0.375)" is superseded.
- **The enterprise is a projection.** The 147 seats in [`data/enterprise/roster.json`](../../../../data/enterprise/README.md) point at two unit-test stub presets and at routes (`deepseek-official`, `codex`) that no recorded session ever used; replaying the feed's mapping over every session file lights 16 seats and sends 541 sessions to a fallback seat. The one piece of software the departments built ([csv-tools](../../../../data/proving-ground/2026-09-19-csv-tools-program/manifest.json), 447 lines, 51 tests, serial departments) was never committed; no program has a reviewer; every release signature is written by the driver over a placeholder digest before the work starts; `ci.yml` has never run on this branch and it has no pull request. On the code-safety comparison one model pass finds 15 of 18 known issues where the six-department program finds 13 ([the record](../../../../data/code-safety/comparisons/2026-09-22-nodegoat/README.md)), and the loop's first iteration on that gap is one run each side inside the program's own 13-to-14 range.
- **The corpus is 22 trajectories, uncurated.** Of 1,044 committed trajectory lines, 22 carry terms that admit training (all tier 2, six environments, four free models whose licences were not read); 0 carry a `curation` block because both bench drivers call the raw exporter, while three documents say the export is curator-gated; 71 of the 99 reward-0 trajectories are budget breaches that a trainer cannot tell from failures; the shipped redaction rules miss PEM, AWS, GitHub and Slack material, and two records committed a target's private key body verbatim (redacted in `d277281c9`, and the recorder now redacts before it digests).

Under all four sits one shortage: **verifiable tasks**. Forty-four hand-authored JavaScript command-line programs, saturated below tier 5 by every model and at tier 5 by the largest; sixteen cells that cannot read an effect under 0.19; 32 trainable environments that at group size 8 give 256 rollouts an epoch, one to two orders of magnitude under published RLVR runs; and nothing a reader can set beside a public number. Every instrument built in three weeks — fleet, experiments, scorekeeper, curator, program ledger, shifts, observatory, read barrier — waits on tasks. The second shortage is routes: one vendor, one login, seeds dropped by that route.

## Proposal

Restate each goal as a claim with the instrument that decides it, and put task supply first.

### Goal 1 — the harness that makes any model the best agentic coder

**Claim.** For a fixed model, the shipped composition certifies more tasks per unit cost than the model vendor's own scaffold and a minimal reference loop, on a public suite and on a private suite no model has seen, for at least three model families.

**Instrument.** Three suites, each a `bench` kind in the environment registry: the Aider polyglot benchmark (225 Exercism exercises in six languages, pinned at revision `7e0611e7`, a public leaderboard of the same tasks under aider's scaffold, toolchains present on this host for Python, Go, Rust and C++); the completion family synthesized from the bench's own reference programs (private, uncontaminated, hundreds of tasks); and, when disk allows, a SWE-bench Verified subset under Docker, which this host runs. The composition measured is the shipped one, not an eight-tool cut, and every arm declares its effort and its seed handling.

**Mechanism.** The readings say the harness's value is verification density — the validator loop, the seal, caps that hold — not knowledge presented to the model. The mechanisms to test are therefore the ones that raise verification per token: a directive that carries the validator's channel diff, a self-review rung before validation, best-of-n with validator selection, and per-model adaptation (a text tool-call fallback and an edit format for models that fail native calls). Each runs as a frozen pair with n sized by the corrected statistic, on a suite that separates.

### Goal 2 — agentic software creation through the harness

**Claim.** The enterprise ships software whose acceptance is certified by checks the implementers cannot read, with a ledger naming which agent did what; the repository's own changes are produced this way.

**Mechanism.** The deliverable of every program run is committed into its record beside the ledger, so a build exists as code and not only as tool-call arguments. A reviewer department reads the integration diff against the spec and returns a schema-validated verdict (W2 stage 9) that the integration gate consumes; the release signature is recorded after the certificate, by a principal the driver did not invent. The next harness slices are produced by programs under the repository's own gates, with department transcripts recorded under `data/`, so the organisation of record is the ledger rather than a roster of definitions; the roster shows only seats a recorded session has occupied. For the code-safety product: a whole-repository generalist department beside the six specialists, since breadth beat specialisation on the small application, tested as a pair with repetitions rather than one run; and, for a client's code with no ground truth, recall estimated by seeding a copy with known defect instances the review is not told about.

### Goal 3 — the open-weight model trained by RLVR

**Claim.** A roughly 120B open-weight model that, with this harness, certifies more held-out tasks than its base, trained by GRPO on the certificate reward over a prompt set of thousands of admitted environments.

**Mechanism.** [The recipe](../architecture/2026-09-19-rlvr-recipe-and-base-model.md) stands; its inputs do not exist yet. Environments come from the factory above, then from repository-derived tasks (this repository's own 712 spec files and 1,362 JSDoc-specified exported functions once the runner can hold a hidden test file), then from permissive public repositories under Docker. Rollouts come from an open-weight route: the free tier fills the corpus at about a thousand requests a day, a paid key is the multiplier, and the terms are pinned per route. The curator runs on the export path and the record carries a stop reason so truncation is masked rather than scored. The base-model table missed one candidate: NVIDIA Nemotron 3 Super 120B-A12B (open weights in BF16, published post-training data, agentic results in the class of the recommended model, free on the route today, under a licence still to be read); the decision is reopened between it and Qwen3.5-122B-A10B. Compute stays external; the recipe's estimate of one to four hours an epoch on 16 to 64 H200 stands.

### Goal 4 — the self-improvement loop

**Claim.** Every iteration is proposed from a diagnosis of recorded transcripts, tested as a frozen pair whose statistic is sound and whose n is sized to the effect, decided by rule, applied through the composition, and legible in one ledger.

**Mechanism.** The statistic first: a cluster bootstrap that resamples environments and their pairs, a discordant-pairs guard, pooling across replications, and a named statistic version on every result and ledger line. Then the missing stages, each a department over recorded logs with a schema-validated output: diagnosis (miss class and evidence sequence numbers, the manual gap list of the code-safety comparison being the prototype), proposal (a candidate overlay or skill and its plan, hashed before it runs), and application (an `adopt-candidate` writes the overlay into the composition through the manifest and opens a change under the gates; the next pair on the same plan reverts it). The queue never reruns a plan whose pooled reading is settled; it queues the pairs the diagnosis names. A knowledge edit made from one target's misses is read on another target before it counts.

### The order of work

1. The statistic, the curator on the export path with the stop reason, the polyglot bench with a first recorded run, and the completion-task factory — all four in flight on 2026-09-22.
2. The improvement log's missing rows and the corrected reading of the 09-21 promote; the redaction of every record (done in `d277281c9`).
3. Committed deliverables and a reviewer department for programs; the code-safety generalist pair; seeded-defect recall.
4. Repository-derived environments (hidden test files in the runner), a SWE-bench Verified subset under Docker, the diagnosis and proposal departments.
5. The base-model re-decision and the first training-purpose export of a fleet on an open-weight route.

Needed from the operator: a paid open-weight route (Qwen3.5-122B-A10B at $0.26 and $2.08 per million tokens in and out on OpenRouter; Nemotron 3 Super at $0.08 and $0.45; the free tier at a thousand requests a day otherwise), a decision on training compute, and a reading of the Nemotron licence.

## Alternatives considered

- **Keep building the instrument.** Rejected: fleet, experiments, scorekeeper, curator, program, shifts, and observatory exist; every reading they produce is bounded by 44 tasks and one route.
- **Author more tasks by hand.** Rejected: the 44 took two weeks and an audit; the factory and the public suites give hundreds in a day, and the public suite gives comparability that no in-house task can.
- **Adopt SWE-bench Verified alone.** Deferred to step 4: every model has seen it, its Docker images do not fit this host's disk allowance at full size, and it measures Python repository editing only; it complements the other two suites rather than replacing them.
- **Call the harness state of the art on the recorded evidence.** Rejected, as before: on certificates it equals the product loop on one vendor, and the one harness-favouring frozen verdict did not replicate.
- **Discard the 147-seat roster.** Rejected: the definitions are real; the correction is to light only seats a recorded session occupied and to stop presenting routes never used as the enterprise's routes.

## Acceptance criteria

- `dsh-experiments` names its statistic on every result; the 09-21 E7 pair re-read under it is not `promote`; a test covers the zero-variance case.
- A polyglot bench record under `data/proving-ground/` with per-language certified counts on the operator's route, and the leaderboard's number for the same model beside it with its date.
- A completion-task family admitted by `admit.mjs` with at least a hundred children, registered under the bench composition through an overlay.
- Both bench drivers export through the curator; a record made afterwards carries a `curation` block on every exported line; the trajectory record carries `stopReason` and the dataset builder masks non-`completed` rows.
- The improvement log carries the three 09-21 rows with the corrected reading, and its schedule paragraph describes the Routine that exists.
- One program record whose deliverable is committed beside its ledger and whose release signature postdates its certificate.

## Risks

- The subscription is one login shared by the nightly queue, the polyglot run, and the code-safety pairs; rate limits and container restarts cut runs, and the partial-record path keeps what ran.
- Public suites are in every model's training data; paired readings survive that, absolute numbers do not, and the note says so wherever a public number is quoted.
- A cluster bootstrap over 8 environments has wide intervals; the honest consequence is fewer verdicts, not narrower ones, until the suites grow.
- The Nemotron licence may not be an open-weight licence in the sense the recipe requires; the decision waits on the text.
