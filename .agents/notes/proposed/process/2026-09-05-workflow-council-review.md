# Agent Note: Judge council review of the four workflows

Status: proposed

English | [中文](2026-09-05-workflow-council-review.zh.md)

## Problem

A workflow design authored and reviewed only by its own author asserts its own claims are sound: "the implementer never reads the standard," "isolation ≥ process," "cross-model judging," each stated as present-tense fact even where the repository documents the opposite — the verification package's README stated no read barrier existed, `EnvironmentRunRequest` carried no model or seed field, and `approval/decided` carried no decider identity. An LLM session under time and context pressure does not reliably catch its own overstatements, and [the verification, improvement, and oversight seams note](../architecture/2026-08-29-verification-improvement-oversight-seams.md) itself measured why: a same-lineage judge grading a verdict that affects its own stake mislabeled 74.4% of transcripts, against 3.3% when the outcome did not matter to it. A single self-review therefore both leaks semantic authority into stages the design calls deterministic and overstates what today's plugins actually enforce, in the same document a future implementer would build from.

[The four goal workflows](../architecture/2026-09-05-four-goal-workflows.md) needed an independent, repository-grounded check before they became a design record other engineers build against. This note records the council that produced that check: seven independent judge agents, each reading the repository through one lens, scoring the same four workflows, ranking gaps with file-level evidence, and proposing a materially different design where their lens found the original wanting.

## Proposal

The council reviewed one draft of the four workflows against the repository as it stood, through seven independent one-shot subagents, each briefed with a distinct lens, the draft, and a lens-specific reading list; every judge produced one report in a fixed format, and the design in [the four goal workflows](../architecture/2026-09-05-four-goal-workflows.md) is what its findings, taken together, produced.

### The judges

| Judge | Name | Lens | Key files read |
|---|---|---|---|
| J1 | Factory delivery judge | Long software tasks, spec-first, separated roles | `dsh-verification`, `dsh-fs`, `dsh-tool-session-query`, `dsh-goal`, and `dsh-environment-runner` READMEs; `VerificationCertificate` and `EnvironmentRunRequest` types; the subagent seam's child-agent approval code; `dsh-user-approval` and `dsh-agent-presets` READMEs |
| J2 | Sakana evolution judge | Darwin Gödel Machine, ShinkaEvolve, evaluator hacking | `dsh-environment-runner` and `dsh-trajectories` types; the environment registry's held-out filter; `dsh-components`'s id scheme; `dsh-agent-presets` types; the skills subsystem page; `tool-cordis`'s façade and API catalog; `dsh-agent-default-model`'s README; `docs/testing.md` |
| J3 | DeepSeek RL data judge | RLVR at scale, reward hacking, training economics | `dsh-trajectories` types and fold; `dsh-environment-runner` types; `dsh-verification` types; the compaction packages' region and tool-result-pruner code; `dsh-session-telemetry`'s README; the trajectory exporter's README; `dsh-llm`'s call-config |
| J4 | Hermes self-improvement judge | Skills as plugins, autonomy loops, self-modification safety | `dsh-tool-skill` and `dsh-skill-filesystem` READMEs; `dsh-agent-presets` and `dsh-trajectories` READMEs; the self-modification oversight note; `dsh-verification`'s README; `tool-cordis`'s curation code; `dsh-tools`'s guard README |
| J5 | Determinism judge | Authority, replayability, invariants | `dsh-verification`'s service and README; `tool-ralph`'s README; `dsh-environment-runner` types; the oversight note's subprocess constraints; `dsh-llm`'s `GenerateOptions`; `dsh-workflow` and `dsh-goal` READMEs; the subagent structured-output driver; a verification invariant companion |
| J6 | Alignment and governance judge | Disinterested judging, EU AI Act, audit trails | `dsh-verification`'s README and `dsh-command-verification`; the approval event types; `dsh-session-telemetry` and `dsh-trajectories` READMEs; `dsh-session-persistence`'s README; the E2B sandbox package; `dsh-llm-deepseek`; `dsh-tools`'s guard; the self-modification `cordis_run` description |
| J7 | Visualization judge | Legibility for a client CTO and for engineers | The workflow engine's live-only and durable event kinds; the subagent `structured_output` call convention; `CertificateIsolation`; the workflow README's budget vocabulary; `ui-workflow-run` and `ui-subagent` READMEs; `ui-trajectory`'s timing split; `StandardRef`, `GoalRef`, and `SubagentStartRequest` types |

### Report format

Every judge report follows one fixed structure, so the seven are comparable and a future automated run can validate against one schema: a `Verdict` table scoring every workflow the judge reviewed with a one-line rationale each; `Top gaps`, each tagged `blocking`, `major`, or `minor` and grounded in a named repository file, README line, or type definition; `Concrete improvements`, numbered, each naming the plugin or event it adds and the mechanically checkable gate that would catch a regression; one `Better solution` paragraph proposing a materially different design for the workflow the judge's lens covers most; `Answers` to the subset of the draft's seven closing questions assigned to that judge; `Missing metadata`, scoreboard fields the judge's review needs that the field list omitted, each with its type and D or S source; and `Risks`, naming what could go wrong with the judge's own recommendations, not only with the original draft.

### Scores

The council scored every workflow it reviewed from one (unusable) to ten (ready to build); the table below is the full 7×4 grid, one row per judge, before any averaging.

| Judge | W1 | W2 | W3 | W4 |
|---|---|---|---|---|
| J1 — Factory delivery judge | 5 | 4 | 6 | 5 |
| J2 — Sakana evolution judge | 5 | 6 | 5 | 4 |
| J3 — DeepSeek RL data judge | 6 | 6 | 4 | 5 |
| J4 — Hermes self-improvement judge | 7 | 6 | 6 | 4 |
| J5 — Determinism judge | 6 | 4 | 5 | 4 |
| J6 — Alignment and governance judge | 6 | 4 | 3 | 5 |
| J7 — Visualization judge | 7 | 7 | 5 | 5 |

J7 scored legibility specifically — whether a client CTO or an engineer could tell what each stage claims and who holds authority at each hand-off — rather than the design soundness the other six judges scored on their own lens; disagreement stays visible because no row is averaged into another.

### Top gaps per judge

Each judge ranked its gaps by severity; the top three per judge, most severe first, were:

- **J1 — Factory delivery judge.** Blocking: the read barrier was asserted while the verification README stated none existed and a log-reading tool could reach the standard. Blocking: no durable substrate for a goal DAG — one goal per session, no ledger, no merge queue, no resume. Blocking: the runner behind the fleet run and the validation stage did not exist; only types and an invariant companion did.
- **J2 — Sakana evolution judge.** Blocking: no durable environment-to-session-to-seed record, so nothing could be folded, decontaminated, or paired from the log. Blocking: component identity could not carry a mutation, so a patched tool schema kept its parent's id and lineage was unrecordable. Blocking: held-out verifiers were readable by the mutator through the self-modification façade.
- **J3 — DeepSeek RL data judge.** Blocking: no environment identity in the trajectory record, so groups, decontamination, and curriculum were impossible from the export. Blocking: the reward was computable by the policy, since checks ran in the implementer's own workspace. Major: truncation was scored as failure, and exported messages were the post-compaction surface rather than any step's real prompt.
- **J4 — Hermes self-improvement judge.** Blocking: knowledge had no version identity in the log — skill bodies were unversioned, and a generation was only an mtime and size stamp. Blocking: self-modification inside the loop could forge the reward, since a dynamic package can append counterfeit verification data. Major: nothing froze a proposal before its evaluation results were visible.
- **J5 — Determinism judge.** Blocking: failed check runs left no durable record, so attempts and flakiness were unreplayable. Blocking: environment attribution was not logged; the run report was an in-memory value only. Major: top-level structured output did not exist outside the in-process subagent driver.
- **J6 — Alignment and governance judge.** Blocking: certificates were agent-reported, since no executor ran the checks independently of the validator agent. Blocking: no attributable human — an approval carried an outcome and an anonymous id, no arguments, no principal. Blocking: the client-data path to training was unbuilt — no redaction rules, no consent record, no residency pin.
- **J7 — Visualization judge.** High: no durable edge payloads — only a child's structured-output call held a full hand-off, and the parent's own result view was a truncated projection. High: static and live views were conflated on one diagram with two different data sources. High: a worker's self-report and a certificate were drawn identically, though only one is defensible evidence.

### Better solutions

Each judge proposed one materially different design for the workflow its lens covers most:

- **J1 — certificate-first delivery.** Compile the signed spec into hidden standards before anything else — one per-goal standard plus one program-level integration standard, with validator-owned fixtures under a root the implementer cannot reach; run every goal as a fresh top-level session at host isolation, validated at each idle by the runner; make integration its own goal whose standard runs against the merged head, and bind the release to that certificate's tree hash; let non-command outcomes enter as human-attested checks so the review council stays advisory.
- **J2 — an archive-first harness Darwin Gödel Machine.** Treat the unit of evolution as a patch-layer bundle, not a PR: variants are data that mount without a build; parents are sampled from an archive that keeps every evaluated child, losers included; a novelty gate rejects near-duplicates before any evaluation spend; a staged ladder spends evaluation cheaply, killing below the parent before a full paired run; and promotion exports a search result from the archive rather than being the search step itself.
- **J3 — an environment-first, group-first factory.** Replace "harvest fleet sessions, then train" with a factory whose unit of data is a group of rollouts of one environment under one policy version, produced by the runner on demand; compute the reward on a pristine fixture plus the patch with hidden checks so the policy cannot reach what it is graded against; mask truncated, aborted, and errored rollouts rather than scoring them as failures; and join tokens to the harness's own records by session, turn, and step through a correlation header.
- **J4 — a two-speed loop over a content-addressed ledger.** Run a fast loop where agents write and refine skills inside their own department layer under a deterministic keep-or-retire scoreboard, nothing shared or exported; run a slow loop where frozen experiments and a human move a nominated candidate into the fleet; and keep every `id@digest` — including retired generations — in a ledger the composition manifest keeps honest, so replay can always tell which knowledge was in play.
- **J5 — ten mechanically checkable invariants and a build order by what they unlock.** State the spine as invariants a validator can check directly against the log — certified implies executed, the standard precedes the first mutating call, one environment stamp arrives before the first turn, held-out material is never exported, fan-out starts and ends balance, the fold agrees with the run report, a judge's route differs from the worker's, isolation claims carry matching evidence, a budget stop is durable, and a structured hand-off validates exactly once — then build the missing plugins in the order that unlocks the most invariants per line of code.
- **J6 — attributed decisions, pinned data-use terms, and a deny-capable monitor.** Record every human decision as an event naming the principal, the artefact hash, and the evidence they saw; pin data-use terms (agreement, purposes, residency, retention, redaction profile) to a session at creation and refuse export without them; give the tool guard a monitor that can deny a configured impact class by default rather than only flag it; and generate the Article 53 documentation from a signed model-lineage record rather than writing it by hand.
- **J7 — an artefact-lineage graph.** Draw nodes as durable records — a spec, a completion-standard revision, a certificate, a trajectory line, a dataset manifest, a model release — and edges as the sessions that produced one from another, with agents as edge labels rather than nodes; "follow one artefact" and "diff two runs" become native, and the volume that W3 and W4 produce reads as a Sankey diagram instead of a static poster.

### Revisions taken

The design in [the four goal workflows](../architecture/2026-09-05-four-goal-workflows.md) is the following revisions, each attributed to the judges that proposed it:

- **Two log-only events carry the whole design.** `environment/run` (the stamp before the first turn) and `verification/run` (every executed run, passing or failing, with argv, exit codes, output hashes, tree hash, derived isolation) turn the run report from an in-memory value into replayable evidence and give decontamination, groups, curriculum, and leaderboards something to hash. (J2, J3, J5, J6)
- **The read barrier is authority, not a promise.** A validator root the implementer's executor cannot read, monotonic tool guards, no log-reading tool in implementer presets, assets re-overlaid before each check run, and an invariant that rejects a certificate from a session that composed a log-reading tool. (J1, J4, J5, J6)
- **Reward is re-verified where the policy cannot reach.** Checks run on a pristine fixture plus the patch under host isolation with hidden checks; a write under check-owned paths is a tamper verdict with reward zero; truncation, abort, and error are masked, never scored as failure. (J3, J5)
- **Nothing semantic picks its own evaluation.** Proposals and mitigation plans are hashed before any cell runs; cells derive from diagnosis evidence and lineage by a deterministic rule; priority is a function of alert magnitude, recurrence, and cost; a diagnosis can open a dispute but never retire an environment. (J4, J5, J6)
- **Archive, parents, novelty, and a ladder.** W1 gained a parent sampler over an archive that keeps losers, a novelty gate before the static gates, a three-stage evaluation ladder, and a quarantined engineer that never sees held-out verifiers or the scored process. (J2, J4)
- **Every human gate is attributable.** `signoff/recorded` and a `decidedBy` on approvals name the principal, the artefact hash, and the evidence in view; deployment, spec freeze, security relaxations, data release, and model release are human gates; policy-only kinds may promote on the experiment alone. (J6)
- **Consent and redaction are events, filters, and profiles.** Data-use terms are pinned at session creation, export refuses sessions without the training purpose, a versioned redaction profile records rule hits, judge transcripts are dropped by default, and persistence gains tamper-evident hashing with per-client erasure. (J3, J6)
- **W3 is environment-first.** The RL unit is a group of rollouts of one environment under one policy version; fleet sessions feed a short SFT cold start, including validator and diagnostician role sessions, and the environment factory; the base model is pinned by measured pass@8 on the held-out suite. (J3, J4)
- **W4 runs at two speeds.** A fast tier where agents write and refine skills in their own layer with a tenant scope and a deterministic keep-or-retire board, and a slow tier of frozen experiments and attributable promotion over a content-addressed ledger the composition manifest keeps honest. (J2, J4)
- **Structured output for root agents is a plugin.** The structured-output runtime the in-process subagent driver already uses attaches to any preset's agent context, validated at the tool JSON boundary and replayable from the log, with both rejection paths; no unlogged provider response schema. (J5)
- **The atlas says what exists.** Every stage carries `implemented`, `partial`, or `proposed`; stages outside the session log are marked as such; worker reports are drawn as advisory, never as gates; leaderboards partition by isolation and held-out split. (J7)
- **Not taken, kept open.** The artefact-lineage graph view and whether validator and judge role sessions train the model are both recorded as decided later rather than fixed by the revision; judge transcripts stay excluded by default in the meantime. (J7, J4, J6)

## Alternatives considered

**One reviewer.** A single self-review, or a single second reviewer, reproduces the same-lineage mislabeling the oversight note measured — 74.4% against 3.3% — and catches at most one lens's blind spot; the four workflows span delivery, evolutionary search, RL data, self-improvement, determinism, governance, and legibility concerns that no one lens covers on its own. This is rejected because a design this wide needs a lens per concern, not one generalist pass.

**A single-model council.** Multiple reviewers on the same model and the same context window share its blind spots and whatever incentive it has to agree with the document's own framing; cross-model routing is exactly what the workflows themselves require of their own judges, so the process that judges them holds to the same rule. This is rejected because it would recommend a discipline it did not itself practice.

**Human-only review.** A person can read four workflows, forty-five schemas, and a scoreboard of over a hundred fields exhaustively, but not in the hours this review took, and not while citing a specific file and line for every claim the way a subagent with repository access can. This is rejected as a substitute for the first pass, not as the final word: every alternative this review overturned still ends at a PR and an Agent Note a person approves.

Judges were one-shot agents: each was spawned once, read its brief and reading list, wrote its report, and ended, with no memory of the other six judges' findings and no back-and-forth with the workflow's author. A durable, cross-model, disinterested judge council — one that runs the same way on every future revision rather than being convened by hand — is itself a proposed plugin over the oversight seam described in [the verification, improvement, and oversight seams note](../architecture/2026-08-29-verification-improvement-oversight-seams.md); this review is a manual rehearsal of what that plugin would automate.

## Acceptance criteria

- A council run produces one report per judge that validates against a JSON Schema matching the fixed format (`Verdict`, `Top gaps`, `Concrete improvements`, `Better solution`, `Answers`, `Missing metadata`, `Risks`) before it is accepted; a report that fails validation returns to the judge with the validation error as its directive, exactly as every other S→D hand-off in the four workflows.
- Every evidence citation in a gap or an improvement resolves to a real repository path, and a line range when one is given, at review time; a citation that does not resolve rejects that finding rather than silently keeping it.
- Verdict scores are stored per judge per workflow, never pre-averaged; `judge_disagreement` in the scoreboard schema and any reported score spread compute from the same stored rows.
- No two judge seats share a model route with each other or with the workflow's own worker or validator route, and the stored record names each seat's route so the constraint is checkable after the fact.
- Every gap, improvement, and better solution is attributable to its producing judge id in the stored record, the way this note attributes every revision above to the judges that proposed it.

## Rollout

- Each judge seat becomes a subagent started with a persona for its lens, a `toolFilter` scoping it to read-only repository access plus the reviewed draft, and an `outputSchema` matching the fixed report format — the same subagent `outputSchema` mechanism the oversight seam proposal already calls for a judge council to use.
- A council Consumer over the subagent seam fans out one review request to every configured seat in parallel, through the existing workflow engine's `parallel` primitive, collects the structured reports, and folds them into stored scoreboard rows without averaging away disagreement.
- The council becomes usable inside the four workflows' own review and promotion gates — W1's auditor and council stage, W2's spec critique and review council, W3's safety and alignment stage, and W4's promotion stage — as the oversight seam's judge-council Consumer lands, per that note's third rollout phase.

## Risks

- **Rubber-stamping at scale.** A PR-plus-Agent-Note gate per promotion decays into approval by fatigue once the queue is large enough, unless deterministic pre-filters keep what reaches a judge or a human small; one-shot, argument-less approvals are exactly what turns a human gate into a semantic one in practice.
- **Judge stake.** A judge whose own verdicts could later train the model it grades, or whose continuation depends on the outcome it is scoring, mislabels far more often than a disinterested one; judge transcripts default to exclusion from training, and no judge's verdict may feed its own future continuation.
- **Disagreement hidden by averaging.** Folding seven scores into one number before storage would erase exactly the signal a council exists to produce; every score stays attributable to its judge, and a wide spread is itself a finding, not noise to smooth over.
- **A stale reading list.** A judge's lens is only as good as the files it was pointed at; a repository change that moves or renames what a lens should read needs the reading list updated in the same change, or the next council run reviews a lens against a target that no longer exists.
