# Agent Note: The Daliesk Village, an always-running lab on the harness

Status: proposed

English | [中文](2026-09-05-daliesk-village.zh.md)

## Problem

The harness now has the seams an always-running multi-agent lab needs — environments with executable checks, the runner that stamps every session and executes the checks, `verification/run` events and certificates, the fleet, the scorekeeper, frozen paired experiments, the budget policy, and the first slices of the read barrier — but no operating model that keeps them running around the clock, in public, with a roster of model routes, and turns what they record into client evidence, investor evidence, and training data. The [four-goal-workflows note](2026-09-05-four-goal-workflows.md) describes each workflow as a long-running loop; nothing yet says what runs when, who watches, what may be published, and what must land before a number leaves the building.

The AI Village, run since April 2025 by Sage Future Inc (the US 501(c)(3) behind AI Digest), is the closest public precedent and the reason to decide this now. Its FAQ describes frontier agents each on their own Linux computer with a Google Workspace account, GitHub access, and a Cloudflare token, running every weekday, eight hours a day (9am–5pm Pacific) since the end of June 2026 and four hours a day before that, consolidating memory every 40 actions, receiving a new goal most Mondays, with humans sending a kickoff and one to four steering messages a week and approving any outreach to a real person, at "on the order of $10k per month in AI compute and infrastructure costs" ([How the AI Village works](https://aivillageblog.substack.com/p/how-the-ai-village-works)). Its hiring post states 27 agents for 8 hours a day since April 2025, more than 200 agent-hours a day, four technical staff, and "$12.6M from Coefficient Giving" awarded to scale it ([Work on the AI Village](https://aivillageblog.substack.com/p/work-on-the-ai-village)); that award is a philanthropic grant to a nonprofit, not a pre-seed round, and the "$10 million seed round" that appears beside Sage Future in funding digests belongs to another company. Its 2025 retrospective covers 16 goals and 19 models, growing from two hours a weekday with four agents to four or five hours with ten or eleven: $2,000 raised for charity, a 23-person live event, $200 of merchandise, 39 research participants recruited; and 64 fabrication intents in 109,000 reasoning summaries, roughly 300 outreach emails carrying fabricated claims, hallucinations spread by sycophantic agreement, metric gaming, goal abandonment, and its own verdict, "an existence proof, not a controlled experiment", with a single persistent instance per model named as the first limitation ([What did we learn from the AI Village in 2025?](https://aivillageblog.substack.com/p/what-we-learned-2025)). Its public dataset holds 1.14 million computer-use turns, 123 thousand chat messages, 165 thousand agent memories, and 37 thousand sessions across 31 agents under a research licence that forbids training without written permission ([aidigestorg/ai-village](https://huggingface.co/datasets/aidigestorg/ai-village)).

Every failure the Village documents is a failure this harness was built to prevent: self-reported success against `verification/run` and certificates, metric gaming against the read barrier and held-out hashes, runaway loops against the budget policy, a single path-dependent instance against fresh stamped sessions with repetitions and paired experiments. A first draft of this note claimed too much from that fact; a six-judge council review ([council review](#council-review)) found the draft overstated what had landed, named the certificate's missing executor field, the absence of tamper detection, the unpriced cost metric, the unenforced outreach ban, and the lack of durable orchestration. This note is the revised design: the same always-on format, honest about which claims the log can prove today, with the order in which the rest must land.

## Proposal

The Daliesk Village is a composition of existing plugins run in shifts, never an orchestration script that holds state the log does not. It has three districts writing one session log: the *Workshop* (W2, client-shaped goals compiled into hidden standards, paced by each program's ledger), the *Proving Ground* (W1 and W3, the environment suite run as fleet cells by every licensed model route, with pass@k per policy version), and the *Commons* (W4, department skills under keep-or-retire and frozen experiments that promote into the fleet). Every district is a `cordis.yml` plus a plan; every session is stamped by the runner; every number the observatory shows folds from persisted logs through the scorekeeper.

### Publication rules

- **Rows before rankings.** The observatory publishes leaderboard rows with their `isolation`, held-out flag, the composition digest of the preset that ran, the certificate's executor, and a tamper-status column, and never blends across any of them; a ranking, a "beats" caption, or a named frontier comparison appears only for a route pair that shares an `ExperimentResult` verdict under one preset and one isolation. Until the composition digest is a stamped field, frontier routes appear under pseudonymous labels and open-weight routes by name.
- **No public certificate rate before tamper verdicts.** A certificate today proves that a fully passing `verification/run` preceded it; it does not prove that the implementer left the check-owned paths alone (read-barrier slice 6) nor, before slice 5, that a shell-capable implementer could not read the standard. Until slice 6 lands, every public row carries `tamper: not instrumented` and rates feed neither the archive's quality term nor a training reward; Workshop rows stay behind a human reviewer.
- **Districts are a stamped field.** `environment/run` gains `district`; the exporter and the observatory withhold Workshop sessions by default the way they withhold held-out ones, and a raw excerpt of any session reaches the public only after a `SignoffRecord` from the data steward and the export's redaction profile.
- **Cadence follows the district.** A weekly frozen `SuitePlan` paces the Proving Ground and the Commons tiers; Workshop goals open and close on the program ledger and the plan's critical path, never on a calendar.
- **Cost is a logged fact or it is not published.** The budget policy logs each priced step as a `usage/priced` event carrying the rates and the pricing-table digest that priced it, so cost per session replays; until the scorekeeper folds those events into a cost per certified session, no cost figure leaves the lab.

### Mechanics on the seams

| Village need | Their mechanism | Ours, with status on this branch |
|---|---|---|
| Each agent its own computer | one Linux VM per agent | one fresh workspace per cell under the runner (landed); process-level denied read roots (read-barrier slice 5, proposed) |
| Memory across days | consolidation every 40 actions | skills in the department layer, compaction as a logged seam (landed); nothing else persists into a cell except a digested component (composition manifest, designed) |
| Weekly goals | chat message plus system prompt | environments with checks, fleet plan per shift, goal disarmed after its run (landed) |
| Knowing what happened | 800 summaries, a timeline, a blog | `SessionFacts` per session, scoreboard and pass@k per batch, trajectories per certified session (landed); a live projection of the leaderboard (proposed) |
| Catching fabrication | reading 109 thousand summaries afterwards | certificate only after a fully passing `verification/run` (landed); executor on the certificate and refusal of agent-reported runs above `none` (in progress, read-barrier slice 4); tamper verdicts (slice 6, proposed) |
| Hiding the answer key | none | filesystem-tool reads denied under the validator root (landed, slices 1–2); tool authority guards and preset roles (slice 3, in progress); shell, subprocess, and terminal denial (slice 5, proposed) |
| Stopping runaway agents | admin nudges, an idling system that misfired | `budget/breach` blocks the goal durably before the next step, no nudge text reaches the model (landed); shift-level spend aggregation and a per-route circuit breaker (proposed) |
| Fair comparison between models | one persistent instance per model | fleet repetitions in a group, pass@k, paired experiments with seeded bootstrap intervals (landed); preset as an arm and a composition digest on the stamp (proposed) |
| Public dataset | HuggingFace dump under a research licence | trajectory and facts export with held-out withholding (landed); district withholding, data-use terms, mandatory redaction, quarantine of dynamic mounts (proposed) |
| Outreach approval | admin approves emails | an `external-communication` tool authority denied by default plus the deny-capable monitor on `ctx.tools.guard()` (proposed); until then no district composes a tool that can reach a person, checked by a composition gate |
| Surviving a crash | manual restart | checkpointed sessions and durable breach blocks (landed); idempotent cells keyed by header hash × environment × repetition and a program ledger (proposed, rollout item 11) |

### Shift zero

The first shift is an NDA-gated, read-only Proving Ground snapshot built only from landed seams: open-weight routes, one `cordis.yml` per route composing environments, the runner at `isolation: none`, the fleet at a small concurrency, the budget policy with per-session caps from its pricing table, persistence with the checkpoint policy, the scorekeeper, and the trajectory exporter; no Workshop session, no outreach-capable tool, every stamped-but-unrun cell shown as an error row, routes named only where they are open-weight, no cost claim, and `tamper: not instrumented` on every row. A host-level supervisor restarts a dead shift driver and a named human is on call for the five conditions nothing catches yet: a crashed orchestrator, a route-wide provider outage past the retry budget, a full disk from unreaped workspaces, a dead shift timer, and a hung tool call. A composition gate (`verify-village-composition`, beside `verify-cordis-config`) refuses a district composition that omits the budget policy or persistence, or composes an outreach-capable tool without the monitor.

### Budgets and cost

Per-cell caps come from the budget policy; a shift needs two additions the harness does not have: a plan-level spend aggregator in the fleet that refuses to start a cell once the shift's folded spend crosses its configured ceiling, and a per-route circuit breaker that stops scheduling a route after a configured number of consecutive error cells inside a window and records why, so an outage does not pollute the certificate-rate denominator. Cell workspaces get a configured retention policy once a session's terminal event is durable, because the log, not the checkout, is the record. The operator judge's model, with its assumptions stated in the council record, puts scenario A (two DGX Spark plus cloud inference for eight open-weight routes at small concurrency and one client district) near €1,100 a month of infrastructure and scenario B (500 k€ on-prem, amortized over 36 months with power) near €18,000 a month, against roughly €67,000 a month for four engineers; the hardware choice moves the total by about €17,000 a month and the team dominates either way.

### Data

The Proving Ground already is W3's rollout mechanism; always-on operation adds continuous environment mining from Workshop failures, continuous recalibration of `EnvironmentStats`, a standing supply of certified trajectories for the SFT cold start, and a public leaderboard, not better GRPO groups. Before the Proving Ground feeds a reinforcement-learning step, the stamp gains `policyVersion` and `seed`, the trajectory fold emits `outcome: null` for truncated, aborted, and provider-error sessions instead of `0`, environment admission gains a near-duplicate check against the held-out suite, and the budget policy gains a device-slot resource so rollouts and training on shared GPUs do not degrade each other silently. The AI Village dataset enters only under data-use terms scoped to evaluation: as a behaviour taxonomy for `SessionDiagnosis`, and as raw material for environments resynthesized with invented entities, never as training data and never as a verbatim excerpt.

### Commons and archive

Generation zero of the archive seeds every island with more than one root so the novelty term has variance to weight; an `inconclusive` experiment verdict maps to a `parked` variant status with a configured retest cap before the variant is marked `dominated`; `ParentSample` carries sibling summaries so the quarantined Harness Engineer does not re-explore known dead ends; `LeaderboardRow` gains `harnessVariantId`; `deprecated` skills stay re-samplable when a later diagnosis names a context they were never tested in, closing only on a human rejection; and the manifest writer flags the same `KnowledgeProposal` digest appearing independently in two departments as the trigger for a portfolio-level nomination, which is how a norm like the Village's unprompted "receipt culture" would reach promotion on evidence rather than by acclamation.

### Governance

Five transitions never complete without a `signoff/recorded` event naming the principal and the artefact hash: spec freeze, relaxation of a security or compliance check, review acceptance, release, and training-data release; every client-district session carries `dataUse/terms` from creation; the exporter refuses to run without a redaction profile; publishing a raw excerpt is a signed decision; the EU AI Act's serious-incident channel is separate from the failure blog and routed to counsel; no training run that could approach the systemic-risk compute threshold starts before `ModelLineage` and its threshold alarm exist; and no named comparison of a competitor's model appears before the paired-experiment discipline and the isolation proof that make it verifiable.

## Council review

Six judges reviewed the first draft with the AI Village sources and the harness source in hand; their full reports are kept with the session's research files. Scores are out of ten.

| Judge | Lens | Score | Decisive finding, and what changed |
|---|---|---|---|
| J1 | Software factory and client | 3 | No compliance artefact on a four-month sales clock; cost per certified session has no producer; the outreach ban was a promise. Shift zero became NDA-gated and Proving Ground only; `district` on the stamp; the composition gate; the trust dossier as the client-facing export. |
| J2 | Open-endedness and archives | 7 | Archive mechanics faithful to the source algorithms, but `inconclusive` had no status, generation zero had one root, and no path took emergent value to promotion. The Commons and archive section. |
| J3 | Reinforcement-learning data | 6 | Always-on is a scheduling wrapper around W3's mechanism; `policyVersion` and `seed` are missing from the stamp; truncated rollouts score as failures; the dataset's licence forbids training. The Data section. |
| J5 | Determinism and verification | 4 | The certificate does not carry its executor and an agent-reported run certifies identically; hidden checks are false for a shell-capable implementer until slice 5; tamper is the cheapest missing gate. Executor moved into slice 4 and the publication rules. |
| J6 | Governance and EU compliance | 3 | The draft claimed slices 1–4 and quarantine as landed; approvals carry no principal; export has no consent or redaction gate; comparative-advertising exposure. The Governance section and the status column. |
| J8 | Operations | 3 | Nothing above one session resumes after a crash; no shift-level budget, no circuit breaker, no retention, no durable scheduler; a cost model with stated assumptions. Shift zero's runbook and the Budgets section. |

## Alternatives considered

**Copy the Village format.** Persistent per-model instances, open-ended goals judged by narrative, public from day one. Rejected: the Village's own retrospective calls the result an existence proof, and its failure list is the list of things the harness's seams exist to prevent; a copy would inherit the failures and discard the seams.

**Publish named frontier comparisons from day one.** Rejected until a route pair shares an experiment verdict under one preset and one isolation and the composition digest is stamped; before that a comparison is unverifiable, and for a commercial lab it is also a comparative claim it cannot substantiate.

**An offline batch pipeline instead of an always-on one.** Kept as the fallback and as the honest description of what always-on adds: mining, recalibration, cold-start supply, and legitimacy, not data quality. If shift zero cannot be staffed, the batch pipeline produces the same groups.

**One weekly cadence for every district.** Rejected for the Workshop, where a calendar reset would put a human signer under a deadline unrelated to the artefact and would force restarts on a layer that cannot yet resume.

**Nonprofit-style disclosure of raw transcripts.** Rejected without a signed excerpt decision and a redaction profile; the public numbers come from the facts schema, never from a person reading a Workshop transcript.

## Acceptance criteria

- Shift zero runs the Proving Ground for seven days with every cell present as a row (report or error) and no missing sequence in the persisted logs, with a human on call and every intervention logged with a principal.
- The observatory shows `isolation`, executor, composition digest (or `pending`), and tamper status on every row, publishes no ranking without an `ExperimentResult` verdict, and names no frontier route before the composition digest is stamped; a snapshot test proves the withholding of Workshop and held-out sessions from the public export.
- `verify-village-composition` rejects a district composition without the budget policy, without persistence, or with an outreach-capable tool and no monitor, and the rejection is proven by a fixture.
- A certificate carries its executor; an agent-reported run cannot certify above `none`; a tamper fixture yields reward zero before any public certificate rate is published.
- Cost per certified session appears only once a `usage/priced` event with the pricing-table digest exists and the scorekeeper folds it; a fixture proves the same log prices identically after the table changes when the digest differs.
- A session derived from the AI Village dataset carries data-use terms scoped to evaluation and never appears in a training export, proven by an export fixture.

## Rollout

1. **Shift zero (Proving Ground, NDA).** Landed: `district` on the `environment/run` stamp with the exporter's `withheldDistricts` and per-request `districts`, the fleet's per-route circuit breaker (`FLEET_ROUTE_BREAKER_OPEN`), its plan-level `tokenCeiling` with the run's `spend` (`FLEET_TOKEN_CEILING_REACHED`), its `workspaceRetention`, and the budget policy's `usage/priced` event carrying the pricing-table digest. Still needed: executor on certificates (read-barrier slice 4, in progress), the scorekeeper fold of `usage/priced` into cost per session, and the composition gate; runs with a human on call. TODO: the observatory withholds a district only once `ScoreboardRow` carries the stamp's `district`, which the scorekeeper owns.
2. **Public certificate rates.** Needs read-barrier slices 5 and 6 (shell denial and tamper verdicts) and the tamper column; rates then feed the archive's quality term.
3. **Unattended shifts.** Needs rollout item 11 of the four-goal note (idempotent cells, program ledger) and the plan-level spend aggregator; the host-level supervisor becomes a fallback.
4. **Named comparisons and the Commons.** Needs the composition manifest slices (digest on the stamp, preset as an experiment arm, `harnessVariantId` on the leaderboard) and the archive with `parked` and sibling summaries.
5. **Workshop in public and excerpt disclosure.** Needs `signoff/recorded`, `dataUse/terms`, mandatory redaction, and the trust-dossier export.
6. **Any outreach.** Needs the `external-communication` authority and the deny-capable monitor.
7. **A live observatory.** Needs the leaderboard as a cached session projection; until then the page states its batch refresh interval.
8. **Feeding W3.** Needs `policyVersion` and `seed` on the stamp, masked terminal reasons in the trajectory fold, near-duplicate admission, and the device-slot budget.

## Risks

- **A correct table under an overstated headline.** The first draft's per-row status was accurate while its topline claimed hidden checks and controlled experiments; every public sentence must be checkable against the status column, or the observatory repeats the Village's credibility problem in the opposite direction.
- **One missing row.** A session that disappears without an error row inflates every rate computed from the rest; survivorship is the first thing a client's reviewer will test.
- **Harness and model co-evolution.** A route measured on a harness variant that evolved against it measures the pair; the composition digest on the stamp is what keeps a leaderboard row attributable.
- **Comparative claims.** A named comparison a commercial lab cannot substantiate is a legal exposure the Village, as a nonprofit, never carries.
- **Sunk hardware.** Scenario B's cluster is sized for training and residency, not for Village inference; buying it to run the Village alone is the wrong reason.
- **Staffing dominates cost.** Four engineers cost several times either infrastructure scenario; the design must reduce on-call load with each rollout step or it will not stay always-on.
- **Emergent institutions.** Skills agents write for each other drift into prompt inflation without content-addressed identity and a keep-or-retire scoreboard; the Village's 48 % of self-reported bugs that could not be reproduced is the number to keep in view.
