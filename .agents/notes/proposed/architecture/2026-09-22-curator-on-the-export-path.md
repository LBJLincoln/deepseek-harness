# Agent Note: The curator on the bench's export path, the credential rules it lacked, and the stop reason a trainer masks by

Status: proposed

English | [中文](2026-09-22-curator-on-the-export-path.zh.md)

## Problem

The third objective is an RLVR corpus drawn from this harness's certified runs, admitted by each session's pinned data-use terms and redacted by [`dsh-curator`](../../../../packages/governance/curator/README.md) before it leaves the lab ([the RLVR recipe](2026-09-19-rlvr-recipe-and-base-model.md)). A read-only audit on 2026-09-22 found that none of the three conditions held on the path the corpus actually comes from.

**The curator was not on the export path.** [`fleet-driver.ts`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/fleet-driver.ts) and [`experiment-driver.ts`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/experiment-driver.ts), which every bench run and every nightly loop iteration goes through, called `ctx.trajectories.export()`: the exporter that reads no terms and redacts nothing. Of the 1,044 trajectory lines committed across the 42 records under [`data/proving-ground/`](../../../../data/proving-ground/README.md), none carries a `curation` block. The records' README said the opposite in three places — its opening and its layout called the file a "curator-gated trajectory export", and its account of the first run said both trajectories were "exported through the curator" — and [the dataset-fold note](../../implemented/process/2026-09-18-proving-ground-dataset-fold.md) describes every record as carrying "a `trajectories.jsonl` the curator exported". That note is not edited here; [the re-export note](../../implemented/process/2026-09-19-re-exporting-a-record.md) states the fact correctly: no record was written through `ctx.curator.export()`.

**The shipped redaction rules missed the credential formats a coding transcript carries.** The profile covered addresses, bearer headers, `sk-` keys, IPv4 addresses, and E.164 numbers, and nothing for a PEM private key body, an AWS access key, a GitHub or Slack token, or a JWT. A record committed on 2026-09-21 outside this corpus carries a target's PEM private key body verbatim, because no rule scanned for one.

**A truncated session scored as a failure.** A `dsh-trajectory/2` record had no field saying how its session stopped, so a session ended by a budget breach, an abort, or a provider error exported `reward.outcome: 0` exactly as one that ran to its end and failed. Folding the committed session logs with the stop-reason rules below, 71 of the 99 reward-0 trajectories on record ended on a budget breach and 4 on a provider error; 24 ran to their end. The RLVR recipe names the field a trainer needs — a rollout ended by a budget breach is masked rather than scored `0` — because without it every budget-ended rollout is a negative and the policy learns to finish early.

## Proposal

### The curator on the bench's export path

Both bench drivers export through `ctx.curator.export({ purpose, sink, manifestPath: './export-manifest.json' })`, as [the curator's own e2e driver](../../../../examples/headless-agent/tests/fixtures/curator/driver.ts) does, and write the export manifest beside `trajectories.jsonl`. [`record-run.mjs`](../../../../data/proving-ground/tools/record-run.mjs) copies `export-manifest.json` into the record with the other exports, and the driver's `status.json` carries the curated report, manifest included.

The purpose comes from the composition. [`export-purpose.ts`](../../../../examples/headless-agent/tests/fixtures/proving-ground-bench/export-purpose.ts) reads the default terms the composition's `data-use` entry pins every cell session with and chooses `training` when they admit it and `evaluation` otherwise: the base composition, on the operator's subscription, admits `evaluation` alone, and the `with-openrouter` overlay admits `training`. Both drivers resolve it right after boot, so a composition whose terms admit neither is refused before the first cell spends anything. The profile is the curator's `defaultProfile`, `village-v1` in every bench composition, which is also the profile those terms name.

[`reexport-trajectories.mjs`](../../../../data/proving-ground/tools/reexport-trajectories.mjs) keeps the raw fold: it is the only way to restate the 42 existing records, none of which a curator wrote. It now refuses a record whose lines carry a `curation` block, in both modes, because re-folding such a record's session logs would drop the block and put back every string the profile replaced.

A keyless e2e runs both real drivers end to end over a new `mock-route` overlay, which composes the scripted route of the other keyless fixtures beside the base's product route: one cell of a fleet and both arms of an experiment, then the assertion that every line is curated, carries its stop reason, and is addressed by the manifest beside it.

The `village-live` and `village-claude-implementer` drivers, which recorded the corpus's first runs and its live district, still call the raw exporter; the records' README names them.

### The shipped rules

`shipped: true` now prepends eleven rules. Six are new and run first, so a key body or a token is replaced whole and counted under its own rule before a generic pattern could take part of it: `shipped:private-key`, `shipped:jwt`, `shipped:aws-access-key`, `shipped:aws-secret-key`, `shipped:github-token`, and `shipped:slack-token`. An OpenRouter key (`sk-or-v1-…`) was already covered by `shipped:api-key`, and a test now pins that.

The private-key rule replaces the body alone, so both armor lines stay and keep naming the key type, and it reads a body in the forms a transcript carries it: raw, with JSON-escaped line breaks, indented in a YAML block, with CRLF breaks, with a legacy `Proc-Type`/`DEK-Info` header, or as a PGP `PRIVATE KEY BLOCK`. A body whose END line a truncated tool output cut off is replaced while its lines still read as base64 or a legacy header. Two measurements shaped the pattern: an unbounded lookbehind cost four seconds on a 6 MB adversarial string, and an untempered scan for the END line made twenty thousand BEGIN lines without one take 57 seconds, because each rescanned the rest of the string. The lookbehind is bounded and the scan does not cross another BEGIN line, which brought the second case to 17 ms; a unit test pins it.

The RLVR recipe's risks name the IPv4 rule rewriting version strings shaped like a dotted quad. The rule already required every octet to be at most 255, and its word boundary already left a `v`-prefixed version such as `v1.2.3.4` alone. The false positive it did have was a quad inside a longer dotted run: `1.2.3.4.5` became `[redacted:ipv4].5`. Two lookarounds now keep a quad preceded by a digit and a dot or followed by a dot and a digit. A bare four-part version whose parts are all at most 255, such as .NET's `4.0.0.0`, remains indistinguishable from an address and is a documented limitation.

The manifest's `ruleHits` already counted replacements per rule and never carried matched text. It now carries `ruleRecords` beside it, the written records each rule fired in, which is what tells a rule matching text every environment shares from a credential in a few transcripts. The manifest format is `dsh-export-manifest/2`. `stopReason` joins the key names the redaction walk never rewrites, since it is a closed vocabulary a reader switches on.

### The stop reason

The record format is `dsh-trajectory/3`, and `stopReason` is always present. The bump follows [the terms note](../../implemented/architecture/2026-09-19-trajectories-carry-data-use-terms.md): the format tag states which fields a producer writes, so a `/3` record states how its session stopped while a `/1` or `/2` record states nothing about it, and a consumer masking cut-short sessions can tell the two apart from the line alone.

`foldTrajectoryStop(events)` reads the log in order. Each `turn/end` and each `environment/delegation` restates the reason: a turn-end kind verbatim, including a kind a plugin merges into `TurnEndReasonMap`, and a delegated attempt's subagent stop reason, with the runner's `budget-deadline` read as `budget`. A turn that ends `blocked` after a `budget/breach` is `budget`, and a breach of the session's own caps is `budget` at once, which is how a delegated cell whose budget ran out before its next attempt ends. A log ending inside an open turn is `interrupted`, and one that ended no unit of work is `none`. The fold reads `budget/breach` and `environment/delegation` by name, as it already reads `agent-preset/selected`, and fails on a payload value their owning packages never write.

Over the committed session logs the fold gives, for the 99 reward-0 trajectories, 71 `budget`, 4 `error`, and 24 `completed`; 17 certified trajectories also stopped on `budget`, which is why masking reads the outcome and not the stop reason alone.

[`build-dataset.mjs`](../../../../data/proving-ground/tools/build-dataset.mjs) masks a train-bound trajectory scored `0` whose stop reason is anything but `completed`: it reaches no file, and the manifest counts it under `maskedNegatives` and per reason under `maskedStopReasons`. A record whose format predates the field is masked as `(unstated)`, so on today's corpus all 84 train-bound negatives are masked until their records are re-exported; re-exporting one record, `2026-09-08-bench-h1-harness-loop-t5`, in a scratch build masked its four budget-ended cells and kept its one cell that ran to its end at 159 of 160 cases. `heldout.jsonl` keeps every negative, because an evaluation that ran out of budget did fail. The written set's stop reasons are a distribution of the manifest.

## Alternatives considered

**A plan field naming the export purpose.** The plan names routes and cells; the composition pins the terms every cell session carries, and the curator admits a session only by those terms. A plan asking for a purpose the terms do not admit would write an empty export, so a separate field could only disagree with the gate it feeds.

**Two exports per run, one per admitted purpose.** Under `with-openrouter` both exports would write the same lines and differ only in the manifest's `purpose`. A dataset build already filters by each line's own `terms`, so one export under the purpose the bench prefers serves both readers.

**Re-curating a curated record in `reexport-trajectories.mjs`.** The tool would need the composition's profile, including any deployment rules no manifest records, and a second implementation of the curator's walk. A curated record is restated by the curator; the tool's job is re-projecting the uncurated records the corpus already holds.

**Masking every row that did not stop `completed`, certified ones included.** A certificate states that the tree passes the standard however the session stopped, and 17 certified trajectories on record stopped on the budget. Masking them would discard positives the reward already proves.

**Reading an absent `stopReason` as `completed`.** It would keep today's negatives in every build and restore the defect for exactly the records the audit counted: 71 of their 99 zeros ended on the budget.

**Keeping `dsh-trajectory/2` and treating the field as additive.** A mixed corpus would then hold `/2` records with and without the field, and a consumer could tell an old exporter from a new one only by the field's presence, which is the reading the terms note rejected for the same reason.

**Typed imports of the budget and delegation events.** Importing the `SessionEventMap` merges would make the trajectories package peer-depend on the budget policy and on the environment runner with its agent, shell, and subagent dependencies, for two string fields; the fold already reads `agent-preset/selected` by name for the same reason.

**Replacing the whole PEM block, armor included, with one marker.** A literal replacement cannot splice the matched BEGIN line back, so the marker would lose the key type a reviewer reads to judge the record; matching the body alone keeps it.

**Moving the village drivers to the curator in the same change.** They have their own package e2e suites asserting the raw report, and no queued run uses them. They stay named in the records' README until a district run needs a curated export.

## Acceptance criteria

- Both bench drivers call `ctx.curator.export`, and the keyless e2e over the `mock-route` overlay passes: every exported line carries `curation.redactionApplied: true` and a `stopReason`, and `export-manifest.json` addresses exactly the file's bytes.
- The next record the bench writes carries curated lines on every row and `export-manifest.json`, whose `ruleHits` and `ruleRecords` list all eleven shipped rules.
- A record re-exported by `reexport-trajectories.mjs` carries `dsh-trajectory/3` lines, and a dataset built over it masks its budget-ended negatives under `maskedStopReasons.budget`.
- A curated record is refused by `reexport-trajectories.mjs` in both modes.
- A bench run on the `with-openrouter` overlay exports for `training` with `withheldByTerms: 0`.

## Risks

- **Composition-wide terms.** An overlay pins one set of terms for every session it creates, so a subscription arm run under `with-openrouter` would be pinned with training terms and exported for training. No checked-in plan mixes the routes; per-route terms would be the fix.
- **An empty negative set until re-export.** Every committed record predates the field, so every dataset built today masks all its train-bound negatives as `(unstated)`. Re-exporting the records restates them, and the re-export note's rule applies: each re-export appends a `reexports` entry.
- **Conservative misreadings.** A rung that claimed a share of the caps is measured again after its child returns, so a session-cap breach recorded then folds as `budget` even when no attempt remained, and a turn a plugin continued past an output ceiling folds as `max-tokens`. Both mask a zero that might have measured the work.
- **Over-redaction by the new rules.** A source file that spells a BEGIN line and a later END line loses the text between them, and a cut-off key takes the first word of the text line after it. `ruleRecords` is what shows a rule firing across records that hold no key.
- **Curated and raw lines in one corpus.** Datasets built after this change mix redacted and unredacted records; the builder's own credential scan still refuses a build that carries a credential-shaped string, whichever export wrote it.
- **Rules are regular expressions.** A credential in a format no rule covers is still exported, and `redactionApplied: true` states that a profile ran, not that a record is clean.
