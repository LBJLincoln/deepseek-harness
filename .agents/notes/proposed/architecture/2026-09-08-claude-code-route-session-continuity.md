# Agent Note: session continuity on the Claude Code route

Status: proposed

English | [中文](2026-09-08-claude-code-route-session-continuity.zh.md)

## Problem

The [Claude Code route](2026-09-06-llm-claude-code.md) runs one stateless query per harness step: it renders the whole conversation into one prompt string and spawns a fresh CLI process. Rendering the conversation into a single user message means every step rewrites that message, so no prefix a previous step cached is ever a prefix of the next step's request. Nothing is read back.

The route's own usage events measure it on the Proving Ground bench. On tier 3 the harness loop spent 352,494 output tokens and 553,676 cache-read tokens against 3,005,288 cache-write tokens over 200 queries across 18 cells; on tier 4, 214,397 output against 4,024,446 cache-write; on tier 5, 860,596 output against 4,778,361 cache-write. The product's own loop over the same cells is read-dominant — one delegated cell reported 3,000,318 cache-read against 68,193 cache-write. The harness loop is also 20 percent slower than the product loop on tier 4, where a cell takes many short steps and each one pays a fresh process start.

## The probe

A scripted 10-step conversation of realistic size — a 600-character system prompt, a 2,000-character task, then ten rounds of one tool call answered with a 1–3 KB canned result, the tools served by an in-process MCP server exactly as [the native-tools note](2026-09-07-claude-code-route-native-tools.md) describes — was driven through the Agent SDK three ways. Cache counters come from each step's `result` message.

| Design | Steps | Cache write | Cache read | Read share | Wall | Process starts |
|---|---|---|---|---|---|---|
| A — fresh query per step, whole conversation rendered (today) | 10 | 114,439 | 0 | 0% | 56.0s | 10 |
| A — repeat | 10 | 110,471 | 0 | 0% | 63.5s | 10 |
| B — one product session per harness session, resumed per step | 10 | 14,606 | 69,212 | 83% | 72.2s | 10 |
| B — repeat | 10 | 14,372 | 67,667 | 82% | 69.9s | 10 |
| C — one held query, conversation pushed as SDK user messages | 10 | 15,478 | 74,870 | 83% | 51.5s | 1 |

Three controls separate the mechanism from the accident:

- **Two identical prompts in separate processes.** The first wrote 13,450 tokens, the second and third each read 13,450 and wrote 0. Prompt caching already crosses the process boundary; design A misses it only because the growing conversation mutates the first user message every step.
- **Resume without tools.** A long first turn wrote 13,453; the resumed second turn read 13,453 and wrote 111; the third read 13,564 and wrote 147. Resume alone produces the read-dominant pattern.
- **A scoped `CLAUDE_CONFIG_DIR`.** Pointing the CLI at an empty config directory costs one extra full rewrite: the first resume after a cold directory read 0 and wrote more than the first turn had, and only the turn after that read. The route therefore leaves the operator's configuration directory alone.

Design C ran with a per-query turn bound of one. Under that bound the SDK's streaming-input query does not end at the bound; it stays open and accepts the next user message, and every step reported exactly one API turn. Raising the bound instead — the form that lets the product speak again after the offered call returns — produced three to five assistant messages per pushed user message and two API calls' worth of uncached input per step, which is the nested agent loop this seam must not have.

## Proposal

Give the route an explicit `sessionContinuity` config field, `'per-session' | 'per-query'`, defaulting to `'per-session'`.

Under `'per-session'` the route keeps, per harness conversation, the product session id it started and a digest of the conversation prefix that session already holds. A request whose prefix matches resumes that product session with `resume` and sends only the newest turn as its prompt; a request that does not match starts a fresh query and replaces the entry. Under `'per-query'` every request renders the whole conversation and starts a fresh query, which is today's behavior kept as the escape hatch for an installation where resume misbehaves.

A second field, `resumableSessionLimit`, bounds how many product sessions stay resumable at once. It is a cleanup policy as much as a memory bound: evicting the least recently used entry is what deletes its transcript, so a harness process whose sessions never end still releases what it created. The default of 64 leaves room for several concurrent runs of the widest fan-out a current consumer has, the Proving Ground bench's 18 cells.

`generate()`'s contract and the seam's `StreamChunk` protocol are unchanged. The turn bound stays one assistant message, the tool offer is still rebuilt per request and mounted per query, the answer is still read out of the query's assistant messages, and usage is still whatever the product reported for that step — so the scorekeeper sees cache reads and writes per step exactly as it does today.

### Keying the product session to the harness session

`GenerateOptions.sessionId` already carries the harness session identity, and the seam documents it as available to adapters. The route keys its table on that value, so no seam change is needed. A request that carries no `sessionId` — a hand-built one-shot — has no session to continue and always runs as a fresh query.

`GenerateOptions.purpose` separates an auxiliary call from the conversation: a compaction or session-title request on the same harness session is a different conversation, so the key is the session id together with the purpose.

### The equivalence check

A resumed product session must show the model exactly the conversation the harness log holds. The route therefore records, with each product session id, how many of that request's messages the session was sent and a SHA-256 digest over everything it sent for them: the system prompt, the offered tool definitions, the model id, and those messages' framed elements. The next request recomputes the digest from itself and resumes only when four things hold — it grew past the recorded count, the message at exactly that index is the product's own answer, no later message is an assistant message the product did not write, and the digest matches.

Each failure names itself. A request no longer than the record is `history-rewound`, which is what a retried step looks like: the route already sent that turn, so the product session holds one the harness log no longer does. A missing or misplaced answer is `answer-missing`. A moved prefix — compaction replacing it with a summary, a spliced inbox message, a changed system prompt or tool set — is `prefix-changed`. Each of them runs a fresh query and starts a new product session.

The fallback is logged, not silent. The answer's finish chunk carries `{ continuity, productSessionId, fallback? }` as its `replayState`, the seam's existing adapter-private slot, which the session log records verbatim as an `assistant/chunk` and again on the assembled `assistant/message`. A step whose model-visible input differs from the previous step's prefix is exactly the case a reader of the log must be able to see, and it needs no new session event to see it.

The product's own transcript holds one thing the harness log does not: the fixed sentence the offered MCP server answers a call with. It is a constant of this package, inserted at positions the log's tool calls already determine, so the conversation the resumed model reads stays reconstructable from the log plus that constant. The README states it.

### The on-disk transcript

Resume requires `persistSession: true`, which writes `~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl` under the operator's configuration directory. The ten-step probe conversation left 88.9 KB. The route deletes each product session it started through the SDK's `deleteSession`, at the point the entry leaves its table: replaced after a failed check, evicted past `resumableSessionLimit`, dropped after a step that delivered no answer, and released when the plugin is disposed. Sessions the route did not start are never touched, and a store that refuses the delete leaves one file behind rather than failing the step.

A step that fails drops its entry rather than keeping it, because a query that did not deliver an answer may still have written its prompt into the product session; the next step of that conversation starts fresh.

The configuration directory is the operator's own, not a scoped one. The probe measured what scoping costs — one full prefix rewrite on the first resume after a cold directory — and it would also hide the operator's authentication and settings from the CLI the route drives.

## Alternatives considered

**Design C: hold one streaming-input query per harness session.** It measured the same cache-read share as B (83 percent) with one process start instead of ten and about 26 percent less wall time, and its one-turn bound did keep one API turn per harness step. It loses on the contract, not on the numbers. `systemPrompt`, the mounted MCP servers, `model`, `effort`, and `thinking` are all fixed when the query is created, while `GenerateOptions` carries them per request — so a step that changes its tool set (plan mode, a loaded skill) or its system prompt would either be served the previous step's values or force the query to be rebuilt anyway. It also depends on the SDK leaving a streaming query open past its own turn bound, which is undocumented, and it holds a CLI process for the whole lifetime of every harness session rather than for the duration of a step. Resume buys the same cache with a documented surface and no held process; the process starts C would save are the deferred work, and the numbers above are what would justify reopening it.

**Send the whole conversation on every resumed step too.** It would keep the rendering identical between the two continuity modes and need no equivalence check. It also reproduces exactly the failure being fixed: the first user message would change every step, and the probe's design-A rows are what that costs.

**Detect an edited history by comparing message counts.** Cheaper than a digest and wrong for the case that matters: compaction replaces a long prefix with a shorter summary and a retry rewinds to an earlier count, so a count comparison accepts a prefix the product session does not hold. The digest is over content because the property being checked is content.

**Make the route stateless again by asking the product to store nothing and re-uploading the conversation as structured history.** The SDK's `sessionStore` mirrors a transcript into a caller-supplied store, but it cannot be used with `persistSession: false` and it materializes the session into a temporary file before spawn — it moves where the bytes live, not whether the prefix is re-sent. It buys nothing the local transcript plus `deleteSession` does not.

**Leave the route as it is and tell deployments to prefer a keyed provider.** That is the standing advice and it stays true, but the route exists for the host that has no key, and on that host every bench cell pays full input every step. An 83 percent cache-read share is not a micro-optimization at these volumes.

## Acceptance criteria

- `sessionContinuity` and `resumableSessionLimit` are validated `Config` fields reachable from `cordis.yml`, and `resolveAdapterOptions` rejects an unknown continuity and a limit that keeps no session, at load.
- Under `'per-session'`, a second request on the same harness session whose prefix matches the first resumes the product session and sends only the newest turn; the SDK receives `resume` with the recorded id and a prompt that does not contain the earlier turns.
- Under `'per-session'`, a second request whose system prompt, tool definitions, model, or any earlier message differs runs a fresh query with the whole conversation rendered, and the previous product session is deleted.
- Under `'per-query'`, every request renders the whole conversation and no product session is recorded or deleted.
- A request without `sessionId` never resumes, whatever the mode; a request that names a `purpose` never continues the conversation's own session.
- The answer's `replayState` names the continuity path each step took, so the session log distinguishes a resumed step from a fresh one and names why a fresh one was fresh.
- Unit specs hold per-file 100 percent coverage over `src/`, covering the digest, the table's eviction and disposal, the continuation rendering, and both modes' query options.
- The opt-in real-installation e2e (`DSH_E2E_CLAUDE_CODE=1`) runs two steps on one harness session under `'per-session'` and asserts the second step's reported cache read exceeds its cache write.

## Risks

**The product session and the harness log can diverge without the digest catching it.** The digest covers what the route sends. It does not cover what the product's own envelope adds, which the route already cannot see or record — the limitation [the route's note](2026-09-06-llm-claude-code.md) records. A product update that injected per-resume text into the conversation would be invisible to the check and visible only as a cache miss.

**Cleanup is best-effort against a directory the operator owns.** A harness process killed between steps leaves one transcript per live session behind. The route deletes what it started when it can; it does not sweep the operator's directory for orphans, because a transcript it did not start may be the operator's own work.

**One extra failure mode per step.** A resume whose recorded session id no longer exists on disk — an operator who cleared the directory between steps — fails that step through the seam's normal retry policy rather than being repaired in place. The route drops the record and its transcript on any failed step, so the retry and every step after it runs fresh, but the first such step is a failure the `per-query` mode does not have.

**The evidence is one probe generation on one installation.** Two runs per design, ten steps each, on one product version. The bench figures the problem statement cites are the independent confirmation of design A's behavior; designs B and C rest on the probe and on the opt-in e2e a maintainer must run.
