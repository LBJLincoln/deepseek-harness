# 用户审批

[English](approval.md) | 中文

[dsh-user-approval](../../packages/interaction/user-approval) 的用户审批 seam 回答一个问题：这个具体操作是否可以继续？它拥有共享的请求/结果词汇、`ctx.approval` 分发服务、`approval/request` 应答者 waterfall（瀑布式事件）、仅记录日志的审计事件对，以及按会话的 `ask`/`never` 策略。UI 通道可以提供人类应答者；[ACP（Agent Client Protocol）自动化桥接层](../../packages/acp/acp)为其拥有的 agent（智能体）提供一次性机器决策。调用方如 [dsh-tools](../../packages/core/tools) 和 [dsh-tool-bash](../../packages/shell/tool-bash) 消费闭合的结果，除非结果为 `allowed-once`，否则一律拒绝。

源码：[`packages/interaction/user-approval/src/index.ts`](../../packages/interaction/user-approval/src/index.ts)

## 标识与结果

每个请求都会获得一个全新的 `ApprovalRequestId`。该品牌类型将 `approval/asked` 与 `approval/decided` 审计事件配对，同时不会让审批 id 与工具调用 id 或 agent/会话 id 互换。

```ts type-equiv
/**
 * Pairs one `approval/asked` audit event with its `approval/decided`.
 * Service-issued (one fresh id per {@link ApprovalService.request} call).
 */
type ApprovalRequestId = Branded<'ApprovalRequestId'>
```

`ApprovalOutcome` 是闭合的，且失败时拒绝。`allowed-once` 仅授权所询问的那一个操作；调用方对 `rejected`、`cancelled` 和 `unavailable` 均执行拒绝。缺失、不负责该请求、抛异常或不合规的应答者会产生 `unavailable`，而非放行。

```ts type-equiv
/**
 * Closed approval outcomes: a one-shot grant, explicit rejection, withdrawn
 * request, or unavailable answerer. Callers fail closed on `unavailable`.
 */
type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
```

## 按会话策略

`ApprovalPolicy` 决定在交互式应答者运行之前发生什么。`ask` 委托给组合的应答者链，链的无应答默认值为 `unavailable`；`never` 确定性地返回 `rejected`，不分发任何应答者。生效值为会话日志中最后一条 `approval/policy` 事件，回退到服务配置。`setApprovalPolicy(session, policy)` 是唯一的写入路径，因此回放能重建覆盖值。

```ts type-equiv
/**
 * A session's approval policy — what happens to an {@link ApprovalService}
 * ask BEFORE any interactive answerer sees it:
 *
 * - `'ask'` (the default) — delegate to the composed answerers; with none
 *   composed the chain falls through to the fail-closed `'unavailable'`.
 * - `'never'` — never prompt anyone: every ask resolves `'rejected'`
 *   deterministically. The strict headless stance (CI, unattended runs) and
 *   the policy whose outcome is knowable without asking.
 */
type ApprovalPolicy = 'ask' | 'never'
```

两种策略都会将各自完整的当前含义贡献给缓存安全的运行时上下文快照。带来源的 `user/message` 是持久化且模型可见的输入；审批状态变化时，会在保留的历史后追加一份新的完整快照，而不改写请求头中的系统提示词。

## 审批请求

`ApprovalRequest` 以足够精确的方式标识 agent 和工具操作，以便路由和审计该问题。它携带被决定的参数，以便 seam 把它们摘要进审计事件对，而日志只保留该摘要：应答者通过 `callId` 将提示附加到已流式输出的工具调用上，而非渲染另一份可能漂移的副本。

```ts type-equiv
/**
 * Readonly same-process permission question. `callId` links to an already
 * presented tool call, so arguments are not duplicated here.
 */
interface ApprovalRequest {
  /**
   * The agent on whose behalf the question is asked. Routes the question (a
   * UI answerer only answers for agents it owns) and receives the audit
   * events on its session log.
   */
  readonly agent: Agent
  /** The tool the question is about (presentation and audit). */
  readonly toolName: string
  /**
   * The exact tool call being decided, when the asker has one — lets a UI
   * attach the prompt to the tool call it already streamed.
   */
  readonly callId?: CallId
  /**
   * The losslessly JSON-serializable arguments being decided, when the asker
   * has them. The seam digests them into the audit pair so a decision states
   * what it decided on; an asker whose subject is not a set of tool arguments
   * — a sandbox escalation states its subject in `reason` — omits them.
   */
  readonly arguments?: unknown
  /** The asker's human-readable explanation of WHY it is asking. */
  readonly reason?: string
  /**
   * Aborting withdraws the question: the request settles `'cancelled'`
   * immediately and a late answer from a still-pending answerer is discarded.
   */
  readonly signal?: AbortSignal
}
```

<a id="attribution"></a>

## 归属

`ApprovalPrincipal` 指名是谁达成了某个结果。seam 记录应答方陈述的内容而不做任何认证，因此该 id 的可归属性不超过提供它的那一方；理由由[可归属决定的 Agent Note](../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md)负责。

```ts type-equiv
/**
 * Who decided one approval: a person the deployment's identity provider names,
 * or a rule that reached the outcome without asking anyone. The seam records
 * the principal an answerer states and never authenticates it, so `id` is only
 * as attributable as whatever supplied it.
 */
interface ApprovalPrincipal {
  /** `'human'` for a person's decision, `'policy'` for a rule's. */
  readonly kind: 'human' | 'policy'
  /** Non-empty identity of the person or the rule that decided. */
  readonly id: string
}
```

知道主体的应答方返回 `ApprovalAnswer` 的具名分支，而不是裸结果；所有既有应答方仍只返回结果本身，而封闭词汇表之外的值会被规范化为不带主体的 `unavailable`。

```ts type-equiv
/**
 * One answerer's reply: the bare outcome, or the outcome together with the
 * person or rule that reached it. Answerers that cannot name a principal keep
 * returning the bare outcome.
 */
type ApprovalAnswer =
  | ApprovalOutcome
  | { readonly outcome: ApprovalOutcome; readonly decidedBy: ApprovalPrincipal }
```

## 分发与审计

`ctx.approval.request(req)` 要求发起请求的会话处于一个尚未结束的轮次内。它追加 `approval/asked`，获取一个结果，追加对应的 `approval/decided`，然后以该结果完成。`never` 策略在服务内部、waterfall 分发之前强制执行，因此即使后来以 `prepend` 注册的应答者也无法绕过它——它也是服务自己做出的唯一一个决定，记录为 `decidedBy: { kind: 'policy', id: 'approval-policy:never' }`。应答者在负责处理该请求时返回结果，否则调用 `next()` 委托；第一个应答占据唯一的决策槽位。

当发起方提供了参数时，两条审计事件都携带 `argumentsSha256`：这一个摘要由 `approvalArgumentsDigest` 在任何应答方运行之前算出，并在决定上重复一次，于是只读决定的人也能知道被授权的是什么。[不变量伴随插件](invariants.md)会拒绝摘要与其自身问题不一致的决定，以及 kind 未知或 id 为空的 `decidedBy`。

审计事件仅写入日志，不进入模型 transcript（文本记录）。模型可见的行为是调用方派生的工具结果与当前运行时上下文快照。服务 dispose（资源释放）时会移除其上下文贡献；应答者监听器独立地通过 effect 绑定到其所属插件。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxapproval--approvalservice"></a>

### `ctx.approval` — `ApprovalService`

Approval service that applies session policy before answerers and logs every ask/outcome pair to the requesting session. It exposes deterministic policy changes to the model through the runtime-context snapshot and switch notices.

```ts cordis-catalog
/**
 * Switch one live agent's policy and queue the transition for its next model
 * step. Session initialization uses {@link setApprovalPolicy} directly
 * because there is no previously visible policy to change.
 * @param agent - the live agent whose policy is changing.
 * @param policy - the new effective policy.
 */
setPolicy(agent: Agent, policy: ApprovalPolicy): void

/**
 * Ask the composed answerers to decide one readonly same-process request.
 * The service borrows the request, agent, session, and live signal directly.
 * The request requires an open turn because the audit pair must be enclosed
 * by the durable log's commit/replay boundary; an idle ask rejects before
 * appending anything. The answerer phase always produces an outcome: an
 * aborted signal yields `'cancelled'`, a missing or throwing answerer yields
 * `'unavailable'` (fail closed), and a rogue non-vocabulary return value is
 * normalized to `'unavailable'`. A failure that prevents either audit append
 * from committing still rejects because returning an unlogged decision would
 * violate the pair. Session contains post-commit observer failures, so an
 * authoritative append cannot reject the request or suppress its matching
 * audit event.
 * @param req - the pending decision (agent, tool identity, reason, signal).
 * @returns the closed outcome; `'allowed-once'` is the only grant.
 * @throws when no turn is open or either audit event fails before the session
 *   append commit point.
 */
async request(req: ApprovalRequest): Promise<ApprovalOutcome>

/**
 * Read the session override without applying the configured default.
 * @param session - session whose log supplies the override.
 * @returns the last logged policy, or `undefined` without one.
 */
overrideOf(session: Session): ApprovalPolicy | undefined
```

Types: [Agent](core.md) · [Session](session.md)

Source: [`packages/interaction/user-approval/src/index.ts:274`](../../packages/interaction/user-approval/src/index.ts)

<a id="approval-events"></a>

### `approval/*` events

<a id="approvalrequest--waterfall"></a>

#### `approval/request` — waterfall

Ask composed answerers for one decision. Return an outcome — bare, or as `{ outcome, decidedBy }` when the answerer knows which person or rule decided — to claim the request, or call `next()`; failure yields the fail-closed default. Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.

```ts cordis-catalog
/**
 * Ask composed answerers for one decision. Return an outcome — bare, or as
 * `{ outcome, decidedBy }` when the answerer knows which person or rule
 * decided — to claim the request, or call `next()`; failure yields the
 * fail-closed default.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @param req - the pending decision (agent, tool identity, arguments, reason, signal).
 * @mode waterfall
 */
'approval/request'(this: Scoped<ApprovalService>, req: ApprovalRequest, next: () => Promise<ApprovalAnswer>): Promise<ApprovalAnswer>
```

Types: [Scoped](scope.md)

Source: [`packages/interaction/user-approval/src/index.ts:32`](../../packages/interaction/user-approval/src/index.ts)
<!-- END GENERATED cordis-surface -->
