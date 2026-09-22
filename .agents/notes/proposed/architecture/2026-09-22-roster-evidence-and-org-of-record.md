# Agent Note: Roster seats carry recorded evidence, and the organisation of record is the ledger of program runs

Status: proposed

English | [中文](2026-09-22-roster-evidence-and-org-of-record.zh.md)

## Problem

The command deck presented the 147 seats of `data/enterprise/roster.json` as the enterprise, and `docs/code-safety-poc.md` and the deck README repeated the count as one. A read-only audit of the tree on 2026-09-22 found the presentation to be a projection:

- Every seat's `preset` is one of the two test-fixture presets under `packages/subagent/subagent-in-process-driver/tests/fixtures/presets/`: `coding` on 47 seats, `reviewing` on 100.
- 74 seats name the route `deepseek-official` and 25 name `codex`, and no recorded session ran on either. Of the 1,380 session files in the 52 committed records, 830 stamped a route, 801 `claude-code` and 29 `openrouter` (free-tier models); the other 550 made no model request.
- The feed's `mapSessionToAgentId` placed a session on the first seat sharing its provider and model, then on a seat whose role or division appeared in its system prompt, then on any seat of its provider, and finally on `roster.agents[0]`. Replayed over every committed session it lit 16 of 147 seats and sent 541 sessions to the fallback seat `harness-core-agent-steward`; 515 bench sessions landed on one bench operator whatever environment they ran, because it was the first seat of their route, 29 OpenRouter bench sessions landed on code-safety reviewer seats, and 4 sessions of the csv-tools and self-assessment programs on the code-safety program lead.

The [four-goals rethink](../process/2026-09-22-four-goals-rethink.md) declined to discard the roster: the definitions are real; the correction is to light only seats a recorded session occupied, to stop presenting routes never used as the enterprise's routes, and to treat the ledger of program runs, not a roster, as the organisation of record. This supersedes the session-to-seat mapping of the [enterprise roster and harness feed](../../implemented/architecture/2026-09-19-enterprise-roster-and-harness-feed.md) decision; its roster generation and discovery rules stand.

## Proposal

**One attribution module.** `scripts/roster-evidence.ts` places a session on a seat only when the session's own record names that seat's work:

- a program session in a code-safety review occupies the code-safety seat its id names: a department's session its department's integrator, the program's own session and its integration session the program lead;
- a session whose `environment/run` names a bench environment occupies the Proving Ground bench operator seat specialized in that environment;
- a delegated session, whose header names a `parentSession`, occupies what its delegating session occupies.

Every other session is unattributed and counted under the reason no rule applied: `environment-not-seated`, `program-not-code-safety`, `program-member-not-seated`, `parent-not-recorded`, or `no-seat-evidence`. A route a session shares with a seat is not evidence. `scripts/session-records.ts` holds the reading both callers share: where a run keeps its session files, how a line decodes, and the facts one session file states about itself.

**Evidence in the roster file.** `scripts/enterprise-roster.ts` gives every seat `evidence: { sessions, lastSeen?, routesSeen }` from the committed records and adds `counts.occupied`, a top-level `evidence` (the records read, their session count, sessions per route) and `unattributed`. The file names the records its evidence covers, so its spec rebuilds it from exactly those records, and a record the nightly loop commits leaves the suite green until `pnpm run roster` takes it in.

**The feed agrees by construction.** `GET /roster` recomputes the same fields with the same module over every run it discovers, live runs included, and a seat's live status comes only from sessions attributed to it. An event frame carries `agentId` only for a session placed on a seat.

**The organisation of record.** `GET /programs` lists every program run the feed discovers, code-safety reviews and Proving Ground programs alike: the program id, the target or the spec, each department's session, status, certificate, steps and tool calls counted the way `data/code-safety/tools/trajectory.mjs` counts them, the integration's verdict, every `signoff/recorded` with its time and recorded principal as `decidedBy`, and the record path. The deck snapshots it into `public/fixtures/programs.json` and the mirror relays it.

**The deck.** The Enterprise view's headline is `<n> seats defined · <m> occupied by recorded sessions`; a seat no recorded session occupied burns at a third of an occupied seat's brightness and its hover label reads `defined, never run`; the routes legend counts sessions per route rather than seats per route; a Record tab lists the program runs with their departments and sign-off chain, marking a release signed before the integration certified.

## Counts over the committed records

| Measure | The heuristic mapping | The attribution rules |
| --- | --- | --- |
| Seats lit or occupied | 16 of 147 | 19 of 147: 12 bench operators, 6 code-safety integrators, the code-safety lead |
| Sessions on a fallback seat | 541 | 0 |
| Sessions placed on a seat | 1,380 of 1,380 | 380 of 1,380 |
| Sessions unattributed | none reported | 1,000: 892 `environment-not-seated`, 8 `program-not-code-safety`, 100 `no-seat-evidence` |

Sessions per route: `claude-code` 801, `openrouter` 29, `deepseek-official` 0 with 74 seats defined for it, `codex` 0 with 25; 550 sessions made no model request. Of the 892, 871 ran bench environments the roster does not seat and 21 were delegated by such sessions: the Proving Ground quota takes 12 of the 44 bench environments, and the records ran 49 distinct ones. The 100 are shift ledgers of the village scheduler, and the 8 are the sessions of the csv-tools and self-assessment programs. The organisation of record holds 7 program runs, 5 code-safety reviews and 2 Proving Ground programs, all released; in all 7 the release signature was recorded within milliseconds of the spec freeze, before the integration certified.

## Alternatives considered

- **Remove only the `roster.agents[0]` fallback and keep the provider and model match.** The match's own last step, any seat of the session's provider, still placed 515 sessions of other environments on one bench operator and OpenRouter bench sessions on code-safety reviewers; a route says where a session ran, not whose work it did.
- **Discard the roster.** The rethink rejected it: the definitions cite real sources, and what was false was the presentation.
- **Seat every environment the records ran, so fewer sessions are unattributed.** That changes the definitions to fit the evidence; the division quotas are a design constant, and 892 sessions in unseated environments is the accurate reading of a 12-seat division.
- **Make the committed evidence always cover every committed record.** The nightly loop commits records without regenerating the roster, so every loop commit would fail the unit suite; naming the covered records keeps the file reproducible and leaves freshness to `pnpm run roster`.
- **Recognise a code-safety program by its goal keys rather than by its record tree.** The record tree is what discovery already knows for every run, live or committed; reading the spec's goal keys would duplicate that knowledge without a case it decides differently.
- **Record `routesSeen` as provider and model pairs.** A seat's route is compared by provider key in every statement the deck makes (`defined for deepseek-official, never run`), and provider keys keep model ids out of the evidence.

## Acceptance criteria

- `pnpm run roster` writes every seat's `evidence`, `counts.occupied`, `evidence` and `unattributed`; `scripts/enterprise-roster.spec.ts` rebuilds the committed file byte for byte from the records it names and checks that every session is on exactly one seat or unattributed.
- `GET /roster` over the repository equals the committed evidence field for field while no live run exists, and no session reaches a seat except by an attribution rule; `scripts/roster-evidence.spec.ts` pins each rule and reason.
- `GET /programs` lists the seven program records; `scripts/harness-feed.spec.ts` pins a record's departments, integration verdict and signatures.
- The Enterprise view shows the headline from the evidence, dims never-occupied seats with the `defined, never run` label, counts sessions per route, and lists the organisation of record in its Record tab; the deck's typecheck and production build pass.
- `apps/command-deck/README.md`, `docs/code-safety-poc.md` and `data/enterprise/README.md`, with their Chinese counterparts, describe the roster as definitions with evidence beside the organisation of record.

## Risks

- **Attribution follows the record vocabulary.** A new kind of session, such as a reviewer run outside a program, stays unattributed until a rule names it; the reasons make such a gap visible rather than silent.
- **The process and workflow views lose seat names for unattributed sessions.** A csv-tools department is labelled by its goal key and a bench cell in an unseated environment by its session id, which is what the record supports.
- **The committed file and a running feed can differ.** The file covers the records it names and the feed covers what it discovers now; `evidence.records` states which records each covers.
- **A cold stream reads every file of its run before its first frame,** because a delegated session's seat depends on the run's other sessions; the feed's warm-up at start reduces that to one `stat` per file.
- **The organisation of record reports what the program driver writes.** The release signature recorded over a placeholder digest before the work starts is shown and marked, not fixed; correcting it belongs to the driver.
