# Agent Note: The OpenRouter route hangs before a cell's first step

Status: proposed

English | [中文](2026-09-22-openrouter-route-prefirststep-hang.zh.md)

## Problem

The nightly bench queue led with `e10-openrouter-nex-vs-laguna-t2`, the first frozen pair that runs both arms on the OpenRouter free route — the only route whose terms admit its transcripts into the RLVR corpus, so the path to the open-weight model runs through it. The experiment never produced a record. Twice, started twenty and then four minutes apart, the loop printed its `=== loop nightly 1/2 ===` header and then nothing: the process held at zero CPU, no established connection to `:443`, and no file written under the run's workspace or the session tree. The two free models each answer a trivial `chat/completions` request in under two seconds with HTTP 200, so the route and the account are live; the hang is under the bench's agentic load, before the cell's first model request rather than during it.

Two guards that should end a stuck cell do not fire here. The fleet's route breaker (`consecutiveErrors: 4`) counts errors, and a silent await raises none. The composition's per-cell wall cap folds on agent and step events, so a hang before the first step is never measured against it. A request timeout on the route (`timeoutMs`) would bound one HTTP attempt, but the zero established connections show no request is in flight to time out — the await is earlier than the request, in the route's own setup for this cell.

## Proposal

Two changes landed to stop the hang from wasting the automated window, and one is queued to root-cause it.

`e10-openrouter-nex-vs-laguna-t2` is removed from the `nightly` queue and kept in `openrouter-pairs` for a supervised run; the nightly queue is now the `h3-baseline-sonnet-t5` fleet alone, which is reliable and grows the baseline's noise floor. An unattended nightly cannot recover from a hang that escapes both guards, so it must not lead with one.

The OpenRouter route profile in the `with-openrouter` overlay now sets `timeoutMs` and `streamIdleTimeoutMs` to two minutes. This does not fix the pre-first-step hang — no request is in flight when it hangs — but it is the correct bound for a request that stalls mid-flight, which the free tier's queue does drop, so it is kept as route hygiene rather than removed for being insufficient here.

The root cause is not yet found. The next step is to instrument the fleet and experiment startup for this route — provider construction, credential resolution, the implementer-availability preflight, and sandbox setup — to name the awaited promise, since the evidence places the hang in one of those before the first step event. Until then the loop has no per-entry deadline: a companion change should give each loop entry an overall timeout that kills a stuck entry and records it as failed, so one hanging plan cannot stall a queue regardless of which route causes it.

## Alternatives considered

**Lower the cell wall cap for the route.** The wall cap folds on step events; a hang before the first step is not bounded by it at any value, so lowering it changes nothing for this failure.

**Rely on the route breaker.** It counts errors; a silent await is not an error. Making it count elapsed silence would duplicate the per-entry deadline the loop should own, at the wrong layer.

**Keep e10 in the nightly and let it run.** Best case it produces mostly cap-breach cells over many hours; worst case, observed here, it hangs indefinitely with no one to end it. Neither is a nightly number, and both spend the window.

## Acceptance criteria

The `nightly` queue produces a committed record and ledger line unattended. `e10-openrouter-nex-vs-laguna-t2` runs to a recorded verdict — a real pair or an honest fail-fast — only under supervision or after the per-entry deadline lands, whichever comes first. The root-cause instrumentation names the awaited promise, and the fix is verified by an openrouter cell that either makes its first request or fails within the deadline.

## Risks

The diagnosis rests on the process's outward signs — zero CPU, no connection, no file — not on a captured stack, so the awaited promise is inferred, not seen; the instrumentation step exists to replace the inference. Keeping `timeoutMs` on a route whose failure it does not cover risks reading as the fix; the queue note and this note both say plainly that it is hygiene, not the cure. Removing the free route from the nightly leaves the RLVR corpus without an automated source until the hang is resolved, which is a schedule cost, not a correctness one: the route still runs under supervision, and the model program was already gated on credits and prompt supply rather than on this cadence.
