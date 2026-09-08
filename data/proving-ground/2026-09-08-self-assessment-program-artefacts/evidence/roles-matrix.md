# Agent Note: Every harness role run once on the operator's subscription

Status: proposed

English | [中文](2026-09-07-roles-matrix-on-the-subscription.zh.md)

## Problem

The Claude Code LLM route put every harness role on the operator's subscription in principle, but until today no role other than the cell implementer had been run on it for real. Whether the validator can author a standard, whether a blind judge can rule, whether program departments implement anything, and whether bridge mode confines the product to the served tools were claims backed by keyless fixtures with scripted models, not by a real model on the real route.

## Proposal

Run each role once on the subscription from its own keyless fixture with the scripted route replaced by the Claude Code route, keep the composition, the driver, the diff, and the session logs as evidence, and record the outcome per role. The matrix below is that record; roles 2 and 4 were run twice, before and after the route began offering the harness tools natively (the native-tools note explains the change).

| Role | Fixture | Before the native-tool route | After it |
| --- | --- | --- | --- |
| Implementer through the harness loop | `environment-run` | yes: one environment certified in one attempt, the unsatisfiable one refused after two attempts with two directives, the reserved one certified and withheld from the reward export; 165 s for the three | the bench's 48 of 48 certified cells stand in |
| Validator, the standard author | `recreation-instrument` | no: `standard_author` was never called; every query died at the route's two-turn bound after five and eight retries | yes: a standard with weighted cases frozen in 137 s, 13 steps, 40 tool calls, no retry |
| Blind judge | `blind-judge` | yes: a lineage-free judge session ruled `upheld` with a reasoned rationale in 20 s | not re-run |
| Program departments | `program` | the orchestration released and merged both goals, but both department turns died at the two-turn bound and the goals certified only because the fixture's checks pass on the untouched base | yes: both departments worked (13 and 7 shell calls), certified, and the program released with no retry |
| Bridge mode | `agent-bridge` | yes: the product ran with only the served `mcp__dsh__` tools, called one, the harness executed it, and the three bridge events were recorded; 10 s | unaffected, the product is the model in this mode |
| Subagents in process | drafted composition | not reached | not run |
| Ralph workflow | none | not reached | not run |

The evidence directory (compositions, diffs, drivers, session logs) is the session's scratchpad `roles/` tree, summarised in its `SUMMARY.md`; the durable facts are the ones in this table.

## Gaps the matrix exposed

1. The route's two-turn bound broke every role whose conversation grew past a short exchange, which is most of them; the native-tool rewrite removed the bound and the two re-runs are the proof.
2. The validator is never told where the reference program is. The persona says it is given a reference, the sampling skill says to probe with the shell first, and nothing model-visible carries the barrier root: the scope event is not shown to the model and the tool description names no path. The re-run succeeded because the model probed the workspace, so the gap is a cost, not a wall.
3. Bridge mode is reachable only through the subagent service: the fixture's driver never starts the product, and the delegation tool has no option that asks for a bridged child, so an agent cannot request one from a tool call.
4. Two roles have no evidence: in-process subagents and the Ralph workflow.

## Alternatives considered

- Trusting the keyless fixtures as evidence that the roles work on the route: they prove composition and protocol, not model behaviour, and roles 2 and 4 failed on the real route while their fixtures passed.
- Running the matrix once and treating the first failures as final: the failures had one root cause in the route, so re-running the two failed roles after the fix was cheaper than any workaround in the roles.

## Acceptance criteria

- Each role in the table has a composition, a command, a wall time, and a session log that show the role's own events (a frozen standard, a judge verdict, program goal records, bridge events) on the subscription.
- The validator's reference location is carried by a model-visible input (the task prompt or the tool description) in a follow-up slice, with a snapshot pinning the text.
- The two roles without evidence are run once each and added to the table.

## Risks

- The matrix is one run per role on one model at one effort; it shows the roles work, not how reliably. The bench's repeated cells are where reliability is measured.
- The evidence directory lives outside the repository; only this table and the referenced fixtures are durable.
