# @deepseek-ai/dsh-user-approval

English | [中文](README.zh.md)

Channel-neutral one-shot approval seam. `ctx.approval.request(req)` returns `allowed-once`, `rejected`, `cancelled`, or `unavailable`; missing or failing answerers fail closed, and a grant applies only to the requested action. Exact event signatures live in the generated region of [approval.md](../../../docs/subsystems/approval.md#cordis-surface).

Each request must belong to an open agent turn. The service appends a paired `approval/asked` and `approval/decided` audit record, while the model sees only the resulting logged tool outcome. An aborted request resolves `cancelled`; an audit append that fails before commit rejects rather than returning an unlogged decision.

Answerers are `approval/request` waterfall listeners. Return an outcome to answer for an owned agent, return `{ outcome, decidedBy }` to answer and name the person or rule that decided, or call `next()` to delegate. Agent-scoped listeners receive only that agent's requests; compose one terminal answerer per deployment because sibling listener order is not a policy priority mechanism. The ACP automation bridge supplies one-shot machine decisions for sessions it owns.

### What a decision states it decided on

A request may carry the `arguments` being decided. The seam digests them once with `approvalArgumentsDigest` — the lowercase SHA-256 hex over their JSON encoding with every object's keys ordered — and records that digest as `argumentsSha256` on both halves of the audit pair, so a reader of the decision alone learns what was granted rather than only which call id it belonged to. The tools pipeline supplies the decided call's arguments; the sandbox escalation path states its subject in `reason` instead and records no digest.

`approval/decided` also carries `decidedBy: { kind: 'human' | 'policy', id }` when someone claimed the decision. The service attributes the one decision it makes itself — the deterministic `'never'` policy records `APPROVAL_POLICY_NEVER_PRINCIPAL`, `{ kind: 'policy', id: 'approval-policy:never' }` — and an attributing answerer supplies its own principal; a withdrawn request, an unavailable chain, and a bare answer record none. The seam records a principal and never authenticates one. The invariant companion rejects a decision whose `argumentsSha256` differs from its own question's, and a `decidedBy` with an unknown kind or an empty id. Design record: [the attributable-decisions Agent Note](../../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md).

`ApprovalPolicy` is `'ask'` or `'never'`. The effective value is the last `approval/policy` event, falling back to config; `setApprovalPolicy()` is the write path. `'never'` rejects before interactive dispatch. Both policies contribute their complete current meaning to the cache-safe runtime-context snapshot.

The tools pipeline routes `ask` decisions through this seam and fails closed when it is absent; the sandboxed bash tool also uses it for escalated retries. The ACP automation bridge answers calls for its own agents through the client's machine policy. Audit events remain log-only, so the model sees only the asking consumer's result. See the [approval-seam Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-approval-seam.md) and [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md).

## Model Experience

### Current approval policy context

#### What the model sees

The first request and each effective policy change append a full runtime-context snapshot after retained history. Under `ask`, the approval contribution states that configured answerers may be consulted and absence fails closed. Under `never`, it states the deterministic rejection and non-escalation consequence. Unchanged requests retain the earlier snapshot without adding another message.

##### Ask-policy contribution

```markdown
Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed.
```

##### Never-policy contribution

```markdown
Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`).
```

#### Token effect

One concise context message on the first request and on an effective change; unchanged requests add no duplicate policy tokens.

#### KV Cache effect

Append-only after retained history. An `ask`/`never` switch preserves the stable system and conversation prefix instead of rewriting the first wire message.

### Tool outcome

#### What the model sees

`approval/asked` and `approval/decided` are log-only, including their `argumentsSha256` and `decidedBy` fields. The model sees only the asking consumer's eventual allowed, rejected, cancelled, or unavailable tool outcome; the human permission UI is not context.

#### Token effect

Zero duplicate audit tokens. A rejection may replace a normal tool result with a small retained error, while an allowance leaves the consumer's ordinary result.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **Requests are valid only inside an open turn** — an idle or between-turn caller throws before auditing; a durable out-of-turn approval workflow is deferred.
- **Only one-shot grants exist** — the outcome vocabulary has `allowed-once` but no `allow-always`, remembered rule, revocation, or grant store; session policy is only `ask` / `never`.
- **The audit pair carries a digest, never the arguments** — an answerer sees the tool name, reason, optional call id, and the arguments the asker supplied, but the log keeps only their digest, so reconstructing what was decided needs the tool call the `callId` names. The ACP machine channel requires a call id and delegates requests without one.
- **A sandbox escalation records no argument digest** — the escalation channel is a structural function shape in `@deepseek-ai/dsh-sandbox` that carries no arguments, so those decisions state their subject in `reason` alone.
- **No answerer names a person** — `decidedBy.kind: 'human'` has no producer in this repository: the ACP and web answerers forward a person's decision but carry no principal the deployment's identity provider vouched for, so today only the `'never'` policy attributes itself.
- **No built-in answerer** — headless or incompletely composed deployments resolve `unavailable` and fail closed; the service itself never prompts a human.
