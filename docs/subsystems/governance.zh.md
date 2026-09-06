# 治理

[English](governance.md) | 中文

客户审计员可以直接从会话日志读取的两类记录。[dsh-signoff](../../packages/governance/signoff)（`ctx.signoffs`）为每一次签署的转变记录一项具名的人类决定；[dsh-data-use](../../packages/governance/data-use)（`ctx.dataUse`）在创建时钉定单个会话的转录所处的合同条款。两者都以日志为先：没有任何东西持有重放无法复现的状态，没有任何东西做认证，也没有任何东西进入模型请求。设计理由由[可归属决定的 Agent Note](../../.agents/notes/proposed/architecture/2026-09-06-attributable-decisions.md)负责，而这两类记录为何约束客户区，由 [Village 笔记](../../.agents/notes/proposed/architecture/2026-09-05-daliesk-village.md)负责。

来源：[`packages/governance/signoff/src/index.ts`](../../packages/governance/signoff/src/index.ts)、[`packages/governance/data-use/src/index.ts`](../../packages/governance/data-use/src/index.ts)

## 已签署的转变

`SignoffTransition` 是没有签名就永远无法完成的那组封闭转变。每一类都在承载该转变的会话上签署，同一个会话可以签署其中若干类。

```ts type-equiv
/**
 * The five transitions that never complete without a signature: freezing a
 * spec, relaxing a security or compliance check, accepting a review, releasing
 * a deliverable, and releasing training data.
 */
type SignoffTransition =
  | 'spec-freeze'
  | 'relaxation'
  | 'review-acceptance'
  | 'release'
  | 'training-data-release'
```

`SignoffPrincipal` 指名签署者。只有人才签署转变；做出决定的规则属于[审批主体](approval.md#attribution)，而不是签名。

```ts type-equiv
/**
 * Who signed, as the deployment's identity provider names them. This package
 * records a principal and never authenticates one, so `id` is only as
 * attributable as the provider that supplied it.
 */
interface SignoffPrincipal {
  /** Only a person signs a transition; a rule that decides is not a signature. */
  readonly kind: 'human'
  /** Non-empty identity string from the deployment's identity provider. */
  readonly id: string
  /** Human-readable name for a reader of the log; non-empty when present. */
  readonly displayName?: string
}
```

`SignoffRecord` 既是 `signoff/recorded` 的载荷，也是 `record()` 的返回值。`artefactSha256` 寻址被签署的对象——冻结的规格、一份证书、一个合并后的 head、一份数据集清单——`evidence` 指向签署者当时所见之物，其规模由插件的配置上限限定。

```ts type-equiv
/** Payload of `signoff/recorded`. */
interface SignoffRecord {
  readonly transition: SignoffTransition
  readonly principal: SignoffPrincipal
  /** Lowercase 64-character SHA-256 hex of the artefact signed. */
  readonly artefactSha256: string
  /** What the signer had in view, bounded by the plugin's configured limits. */
  readonly evidence: readonly SignoffEvidence[]
}
```

```ts type-equiv
/** One pointer to something the signer had in view when they signed. */
interface SignoffEvidence {
  /** Non-empty kind of the referenced material, named by the recording caller. */
  readonly kind: string
  /** Non-empty reference the deployment can resolve: a path, a url, a session id, a digest. */
  readonly ref: string
}
```

读取签名就是一次折叠：`latest(agent, transition)` 折叠该 agent 自身的日志，纯函数 `latestSignoff(events, transition)` 折叠消费方持有的任意日志。[`dsh-program`](improvement.md) 正是这样把守它两处 `requireSignoff` 转变而无需注入本服务——打开程序之前读 `spec-freeze`，`program/end { outcome: released }` 之前读 `release`。

## 数据使用条款

`DataUsePurpose` 是转录可以服务的用途。`DataUseTerms` 是 `dataUse/terms` 的载荷：条款来源的协议、它授予的用途，以及导出必须遵守的驻留地、保留期与脱敏配置。

```ts type-equiv
/**
 * What a session's transcript may serve: `delivery` is the client work itself,
 * `training` admits it to a training corpus, `evaluation` admits it to
 * measurement. A session carries the subset its agreement grants.
 */
type DataUsePurpose = 'delivery' | 'training' | 'evaluation'
```

```ts type-equiv
/** Payload of `dataUse/terms`. */
interface DataUseTerms {
  /** The client the transcript belongs to; cards hash it rather than showing it. */
  readonly clientId: string
  /** The agreement these terms come from. */
  readonly agreementId: string
  /** Non-empty subset of {@link DataUsePurpose}, in the order the terms list them. */
  readonly purposes: readonly DataUsePurpose[]
  /** Region the transcript may live in. */
  readonly residency: string
  /** Positive number of days the transcript is kept. */
  readonly retentionDays: number
  /** Versioned redaction profile an export applies to this transcript. */
  readonly redactionProfile: string
}
```

服务在 `agent/session-start` 时向任何尚未携带条款的会话追加部署配置的条款，于是会话在第一个回合之前就陈述了自己的条款，而被恢复的会话保留它创建时所处的条款。`pin(agent, terms)` 记录更窄的条款；一次允许了现有条款所不允许之用途的钉定会以 `DATA_USE_TERMS_PINNED` 被拒绝且不追加任何内容，因为事后拓宽会把交付转录变成训练材料。其余字段可以朝任意方向重新钉定。`termsOf(events)` 是消费方读取的折叠函数。

## 日志能证明与不能证明什么

[不变量伴随插件](invariants.md)负责日志所承载的两项关系：一个会话绝不会为同一转变签署两个产物，也绝不会拓宽它已经携带的用途。每个字段都会被检查是否具有读者可据以行动的形态——已知的转变、小写 64 位十六进制摘要、具有非空 id 的人、指名了东西的证据指针、每项只列一次的已知用途非空集合、正整数天的保留期。

日志之外的一切在这里都无法检查，两个伴随插件也都不声称能检查：主体是否就是所指名的那个人、摘要是否指向真实存在的产物、证据引用是否可解析、客户与协议是否存在，以及是否真有导出应用了所指名的脱敏配置。让身份具有约束力是部署方身份提供方的职责。完整的事件声明见[持久化日志事件目录](../persistence-catalog.md)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxdatause--datauseservice"></a>

### `ctx.dataUse` — `DataUseService`

Data use (`ctx.dataUse`): the contract terms every session log states about itself.

```ts cordis-catalog
/**
 * Pin narrower terms to one session and return the record as it was appended.
 * @param agent - the agent whose session the terms hold.
 * @param terms - the terms to record; their purposes may not exceed the session's.
 * @returns the terms exactly as they were appended.
 * @throws {@link DataUseError} when a field is unusable, or when the pin would
 *   admit a purpose the session's standing terms do not.
 */
pin(agent: Agent, terms: DataUseTerms): DataUseTerms
```

Types: [Agent](core.md)

Source: [`packages/governance/data-use/src/index.ts:95`](../../packages/governance/data-use/src/index.ts)

<a id="ctxsignoffs--signoffservice"></a>

### `ctx.signoffs` — `SignoffService`

Signoffs (`ctx.signoffs`): attributed human decisions recorded in the session log.

```ts cordis-catalog
/**
 * Record one signature on the agent's session and return the detached record.
 * The record is validated before anything is appended, so a session log never
 * carries a signature this service refused.
 * @param agent - the agent whose session carries the transition being signed.
 * @param input - the transition, principal, artefact digest, and evidence the
 *   caller states; every field is validated before anything is appended.
 * @returns the record exactly as it was appended.
 * @throws {@link SignoffError} when a field cannot become a durable signature,
 *   or when the same session already signed this transition on another artefact.
 */
record(agent: Agent, input: SignoffRecord): SignoffRecord

/**
 * The newest signature of one transition on the agent's own session.
 * @param agent - the agent whose session log is folded.
 * @param transition - the transition whose newest signature is wanted.
 * @returns the last matching record, or `undefined` without one.
 */
latest(agent: Agent, transition: SignoffTransition): SignoffRecord | undefined
```

Types: [Agent](core.md)

Source: [`packages/governance/signoff/src/index.ts:86`](../../packages/governance/signoff/src/index.ts)
<!-- END GENERATED cordis-surface -->
