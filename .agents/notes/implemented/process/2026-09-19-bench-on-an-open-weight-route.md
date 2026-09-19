# Agent Note: Running the Proving Ground bench on an open-weight route

Status: implemented

English | [中文](2026-09-19-bench-on-an-open-weight-route.zh.md)

## Problem

Every Proving Ground record in `data/proving-ground/` was produced on the operator's own Claude Code subscription. Two things follow from that, and neither is fixed by adding another plan.

The harness claims to run any LLM, and the `llm` seam is built for it, but nothing had ever measured that claim end to end: the bench's base composition mounts one adapter, `@deepseek-ai/dsh-llm-claude-code`, and every checked-in plan names one of its three product models. Whether a bench cell — the goal, the confined tools, the validation loop, the attempt ladder — works on any other route was an argument from the composition rather than an observation.

The subscription's terms admit its transcripts as evaluation only. The RLVR datasets under `data/proving-ground/datasets/` may therefore hold nothing from this corpus, and a dataset fold over it is a fold over data that may not train anything. Only a run on a route whose data-use terms permit training can supply that corpus, and there was no composition an operator could point a key at to produce one.

Pointing the bench at a keyless route was also worse than useless. With `@deepseek-ai/dsh-llm-deepseek` composed and `DEEPSEEK_API_KEY` unset, a twelve-cell fleet ran to completion in four seconds: every cell minted a workspace, wrote a stamp, authored its standard, exhausted its three attempts against a model request that failed before it reached the wire, and reported uncertified. The run produced six leaderboard rows at a certificate rate of `0.00` and a spend of zero tokens, and named the missing credential nowhere in `run.log`, `status.json`, or the leaderboard — only inside each cell's own session log. A reader of that output cannot tell a missing key from a model that failed every task.

## Decision

`examples/headless-agent/tests/fixtures/proving-ground-bench/overlays/with-deepseek.cordis.yml` is the base composition plus one inserted `@deepseek-ai/dsh-llm-deepseek` entry naming `apiKeyEnv: DEEPSEEK_API_KEY` and a one-model catalog. The base's product route stays composed beside it, which is what lets one frozen pair put a product arm and an open-weight arm in the same run. `overlays/with-openai-gateway.cordis.yml` is the same shape for `@deepseek-ai/dsh-llm-pi-ai`: one hand-declared `gateway` route with `api: openai-completions`, a placeholder `baseURL` an operator must replace, and one model entry — a template to copy, with no plan of its own.

Two plans name the open-weight route: `plans/h1-fleet-deepseek-t2.json` (a tier-2 fleet in district `bench-h1`, seed 1, the same policy version as the plans it is comparable with) and `plans/e8-deepseek-vs-sonnet-t3.json` (a frozen pair, tier 3, two repetitions, seed 1, baseline `claude-code`/`sonnet` against candidate `deepseek-official`/`deepseek-v4-flash`). Both are "not recorded" in `plans/README.md`: they are runnable, not run.

`ctx.llm.checkRoute(provider)` is the seam question the keyless run had no way to ask — "can this route be dispatched to?", answered without dispatching. `LlmRuntime` raises `NO_ADAPTER` for a route nothing owns and otherwise delegates to the owning adapter, whose `LlmAdapter.checkRoute` defaults to accepting every route it owns. The DeepSeek and pi-ai adapters override it with exactly what their `stream` resolves before its first byte and nothing after it: the current connection snapshot and that snapshot's credential. No network I/O, no model-id validation. A route the check accepts can still fail its first request.

[The fleet](../../../../packages/improvement/fleet/README.md#service-contract) asks it while preparing a plan, beside the implementer preflight it already ran, for every route a cell of the plan could run on — the plan's own routes and each ladder rung naming another — once per provider, before the first cell is enumerated and before the first workspace is minted. `llm` is therefore a declared injection of `FleetService`. An experiment inherits the refusal through `fleet.runPaired`, which prepares both plans before either arm's first cell, so a frozen pair on a keyless candidate refuses with zero cells minted rather than spending the baseline arm and folding to `inconclusive`.

Keyless, `pnpm run bench -- fleet h1-fleet-deepseek-t2 --overlay with-deepseek` now exits non-zero with `MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service …, or export DEEPSEEK_API_KEY in the launching environment`, having minted nothing.

## What the overlay does and does not prove

It proves that the composition loads, that a plan can name an open-weight route, and that the bench refuses loudly and free of charge when the key is absent. It proves nothing about how that route scores: no cell has run on it. The `with-openai-gateway` overlay proves less still — its `baseURL` is a placeholder, so it is a copy-editable template that passes `verify-cordis-config`, not a route anyone has reached.

What is missing is a key and the compute to spend it. Until a run exists, `data/proving-ground/` holds no record admissible into the RLVR corpus, and its README says so where the datasets are described rather than leaving the omission to be inferred.

## Alternatives considered

- **Let the twelve cells fail and read the session logs.** Rejected: the failure is not merely noisy, it is invisible at the level the operator reads. Each cell's own log records `MISSING_CREDENTIAL`, but the fleet report folds a failed model request into an uncertified cell, which is the same row a genuinely failing model produces, and the run log names the credential nowhere. That is the "silently skipping a missing referent" the repository rule forbids, dressed as a measurement.
- **Refuse at plugin load when the credential reference resolves to nothing.** Rejected: `dsh-llm-deepseek` deliberately registers keyless so the catalog stays browsable and first-run onboarding is "browse models, store the key, prompt again" with no restart. A key that arrives through the settings or credential seam after boot is a supported state, and failing the load would break it for every interactive surface to serve one unattended caller.
- **Extend `EnvironmentRunner.checkImplementer` to cover the route.** Rejected: that method is a dry run of refusals `run()` itself performs, and `run()` does not refuse a keyless route — the failure happens several layers down, inside the agent loop. Folding a new refusal into it would make the two stop matching, and would have made the method asynchronous for every caller.
- **Ask the endpoint.** Rejected: an endpoint probe costs a request per route, needs a timeout policy and a failure taxonomy of its own, and answers a question the preflight is not asking. A missing credential is settled before any request exists; whether the endpoint answers is not, and pretending to decide it at plan time would turn a transient outage into a refused plan.
- **Put the preflight in the bench's own driver.** Rejected: it would hold for `pnpm run bench` and for nothing else — a shift, a program ledger, or any other fleet caller would keep producing leaderboards nothing ran. The refusal belongs to the planner that enumerates the cells.
- **Name the pi-ai `deepseek` catalog route instead of `deepseek-official`.** Rejected for this overlay: the two adapters deliberately own different route names so one composition can mount both, and the direct-fetch adapter is the one whose wire format this repository owns end to end. The pi-ai path is still reachable, and `with-openai-gateway` is where it is demonstrated.

## Consequences

- An operator with a key runs the bench on an open-weight route with one flag and one environment variable; without one, the refusal is immediate, free, and names what to export.
- Every fleet caller pays one credential resolution per distinct route per plan. It reaches no network, and the plan it protects costs orders of magnitude more.
- `FleetService` now requires `llm`. A composition that mounts the fleet without an LLM service fails at mount rather than at the first cell; every composition in this repository already mounts one.
- The claim that the harness runs any LLM remains untested by measurement. The overlay moves it from "unreachable" to "one key away", which is a smaller claim than "demonstrated" and the README says which one is true.
- Two adapters now carry a `checkRoute` override that must keep matching what their `stream` resolves. A credential path added to one without the other would make the preflight accept a route the request then refuses — the failure mode is a false accept, which degrades to today's behaviour rather than to a wrong refusal.
