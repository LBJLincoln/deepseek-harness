# Agent Note: The Claude Code route runs in the session directory

Status: implemented

English | [中文](2026-09-27-claude-code-route-runs-in-the-session-directory.zh.md)

## Problem

`@deepseek-ai/dsh-llm-claude-code` started every product query with `cwd: process.cwd()`, the directory the harness process was launched in. The SDK hands that directory to the installation, whose own system-prompt envelope states it to the model as its working directory and files the product session under its project entry. A harness session whose working directory differs was told nothing else: the `dsh-program` service creates each department session with `meta: { cwd: <worktree> }`, and a composition that does not render `{{cwd}}` into its prompt, such as the readme-rows program's `agent-spine-demo` persona with `workspaceContext: false`, leaves the envelope as the only statement of a directory the model reads. The first real run of that program, [`2026-09-27-readme-rows-program`](../../../../data/proving-ground/README.md), shows the consequence: the department did all 29 of its steps in the clone's main checkout instead of the program worktree beneath it, so the tool it wrote in its last step was never on the branch a certificate measures, and the session then crossed its token cap before a first attempt. The request the seam hands an adapter carries no directory, and the route had no way to learn one.

## Decision

The route resolves the directory per request from the session store. `GenerateOptions.sessionId` is the identity the loop stamps on every request from a live session; the plugin injects `sessions` beside `llm` and `subprocess`, and `queryDirectory(ctx.sessions, sessionId)` returns `session.header.cwd` — the `meta.cwd` the session was created with — or the harness process's own directory for a request that names no session or whose session recorded none. A request naming a session the store does not hold fails with `LlmError('UNKNOWN_SESSION')` before any query. The adapter's `cwd` dependency takes the request's session identity and is resolved before the continuity plan, and the SDK's `cwd` option is the plan's directory.

A product session belongs to the directory it was created in: the installation files it under that directory's project entry and locates a resumed session there. The route therefore records the directory on `ProductSessionRecord` beside the held message count and the digest, resumes only when the request's directory is the record's, names a mismatch `cwd-changed` in the plan's fallback, and deletes each transcript it created from the recorded directory — on replacement, eviction, a step that delivered no answer, and unload — rather than from wherever the process happens to run. The `ContinuityPlan` carries the directory on both the fresh and the resumed branch, so the query options, the record, and the release after a failed fresh step read one value.

## Alternatives considered

**Put the directory on `GenerateOptions`.** The loop would stamp `cwd` beside `sessionId`, and every adapter would receive it. Rejected: it widens the seam's Service Definition for one provider's need, the loop and the request header would change for a field nothing else reads, and the request already carries the session identity from which the directory derives; the session header is the one home of a session's working directory.

**Hand the adapter the `Agent` or `Session` through a new global.** An `AsyncLocalStorage` slot or a module-level "current session" set by the loop before `llm.stream()`. Rejected: the conventions derive the Agent and Session explicitly at each entry and forbid a hidden ambient; `sessions.get(sessionId)` is that explicit derivation, and the agent-loop invariant already asserts that a loop-built request names a live session.

**State the directory in the harness prompt instead.** The `{{cwd}}` prompt variable exists and the `dsh-claude-code` bundle renders it. Complementary, not sufficient: the envelope names a directory whatever the prompt says, a product session is filed under the query's directory regardless, and a composition that omits the variable would keep the defect.

**Default an unknown session id to the process directory.** Rejected: a query silently run in the wrong directory is the failure being fixed; the seam stamps session identity from a live session, so an unknown id is a caller error and the earliest resolvable point is the request.

**Make `sessions` optional through `ctx.get`.** Rejected: a request with a session id and no store has no honest answer, and every shipped composition that mounts the route already mounts the store; a composition without one fails at load rather than at the first session request.

**Fold the directory into the prefix digest.** A moved directory would surface as `prefix-changed`. Rejected: the log would name the wrong reason; `cwd-changed` costs one union member and states what happened.

## Consequences

A department on this route now works in its worktree because the product tells its model so, and a headless session, a subagent, or a workflow worker with a `cwd` is told its own. Compositions that mount the route need a session store; all shipped ones have one, and the package's Loader-composition test mounts one. Product sessions are filed per directory in the operator's configuration directory — one project entry per department worktree rather than all under the harness process's — and `deleteSession` addresses the recorded directory, so cleanup does not depend on the process's directory at release time. The fallback set gains `cwd-changed`, reachable in production only for a session without a recorded directory in a process whose directory moved, and pinned by tests. The envelope stays the one model-visible input the log does not reconstruct, but the directory it states is now the session header's `cwd`, which the log carries. The harness still names no directory in a prompt that does not render `{{cwd}}`; that remains a composition's choice.

## Verification

- `pnpm exec vitest run packages/llm/llm-claude-code --coverage --coverage.include='packages/llm/llm-claude-code/src/**/*.ts'` holds the package at 100% per file: the adapter runs a session's query in the resolved directory and hands the resolver the request's session identity, refuses before any query when resolution throws, deletes a product session from the directory it was created in, and runs fresh with `cwd-changed` and releases the old session from its own directory when the conversation's directory moved; on a real context with the session store, a session with `meta.cwd` runs there, one without runs in `process.cwd()`, and an unknown session id ends the stream with `UNKNOWN_SESSION` without a query; the continuity table releases each transcript with its recorded directory.
- `pnpm exec vitest run --config vitest.e2e.config.ts packages/llm/llm-claude-code/tests/loader-composition.e2e.ts` boots the route from a `cordis.yml` with the store and proves a session's request reaches the query, and the spawned CLI, in that session's directory.
- `pnpm run lint`, `npx tsc --noEmit -p tsconfig.host.json`, `pnpm run knip`, and `pnpm run doc-sync` cover the package, its README pair, `docs/module-graph.md`, and this note.
