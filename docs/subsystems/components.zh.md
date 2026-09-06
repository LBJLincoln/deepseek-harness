# 组件注册表

[English](components.md) | 中文

组件注册表及把实时 seam 镜像进来的适配器所共享的类型。一个组件是组合中的一个可寻址单元：一个插件，或插件提供的成员，例如工具、技能、subagent 提供方、工作流、MCP 服务器、上下文提供方、preset 或组合。[组件注册表 Agent Note](../../.agents/notes/proposed/architecture/2026-09-01-component-registry-seam.md) 承载注册表设计，[组合清单 Agent Note](../../.agents/notes/proposed/architecture/2026-09-05-composition-manifest.md) 承载内容寻址与作用域分层；本页记录 [`packages/components/components/src/types.ts`](../../packages/components/components/src/types.ts) 中的精确字段。

## 描述符

`ComponentId` 是由类别与所属 seam 的稳定名称派生的[带品牌的 id](core.md#branded-ids)，从不来自挂载顺序。类别是每个生产方包通过声明合并声明的可合并扩展映射；注册表本身不提供任何类别。`ComponentDigestBasis` 在摘要寻址组件自身字节时为 `'content'`，在组件的模型可见文本转而是装配的函数时为 `'registration'`。

```ts type-equiv
/** One addressable unit of a composition. */
interface ComponentDescriptor<K extends ComponentKind = ComponentKind> {
  /** Stable identity across compositions. */
  readonly id: ComponentId
  /** Declared kind. */
  readonly kind: K
  /** Content address of what this registration holds, computed by the producer that owns the kind. */
  readonly digest: ComponentDigest
  /** What the digest covers. */
  readonly digestBasis: ComponentDigestBasis
  /** Human-readable name. */
  readonly name: string
  /** What the component does, stated for people and models. */
  readonly description: string
  /** Package that produced the registration. */
  readonly owner: string
  /** Curated by people or synthesized by an agent. */
  readonly provenance: ComponentProvenance
  /** Component this one derived from, absent for roots. */
  readonly lineage?: ComponentId
  /** Child components of a composition, absent for leaves. */
  readonly members?: readonly ComponentId[]
  /** How a model reaches the component, absent for kinds without a callable route. */
  readonly invoke?: ComponentInvoke
  /** Kind-specific detail. */
  readonly detail: ComponentDetail<K>
}
```

## 内容地址

`componentDigest(kind, canonical)` 对类别、一个换行符与生产方规范值的 JSON 编码做哈希；`componentAddress(id, digest)` 把 id 与摘要拼成 `id@digest`。每个生产方在自己的 `ComponentKindMap` 声明旁拥有该类别的规范值，因此注册表从不按类别分支。

```ts type-equiv
/**
 * Lowercase 64-character SHA-256 hex over one component's kind and canonical
 * value. Stored and compared at full length; truncating it for a card or a
 * table is a presentation choice that never enters a log.
 */
type ComponentDigest = Branded<'ComponentDigest'>
```

```ts type-equiv
/**
 * JSON value a producer reduces its component to before hashing. Every field
 * a digest must cover appears here; a value a registry computes per assembly —
 * the viewing scope, the working directory, a wall clock, an absolute path, a
 * discovery source or rank — must not, so two hosts that composed the same
 * bytes address identically.
 */
type ComponentCanonical =
  | null
  | boolean
  | number
  | string
  | readonly ComponentCanonical[]
  | { readonly [key: string]: ComponentCanonical }
```

## 作用域分层

一次注册归入其调用方上下文[作用域](scope.md)所对应的层；一次读取把全局层与观察作用域的链合并，最近的层在重复 id 上胜出。获胜注册位于上下文全局层时 `ComponentLayer` 为 `'global'`，位于该 agent 链上任意位置时为 `'agent'`。

```ts type-equiv
/** One descriptor read back through a viewing scope, carrying the layer its winning registration sits in. */
interface ComponentView<K extends ComponentKind = ComponentKind> extends ComponentDescriptor<K> {
  /** Layer the winning registration under this id sits in for the reading scope. */
  readonly layer: ComponentLayer
}
```

```ts type-equiv
/** Read options shared by every scope-aware registry read. */
interface ComponentViewOptions {
  /** Viewing scope (the calling agent); omitted reads the global layer alone. */
  readonly scope?: ScopeKey | undefined
}
```

```ts type-equiv
/** List options: the viewing scope plus an optional kind filter. */
interface ComponentListOptions extends ComponentViewOptions {
  /** When given, only components of this kind. */
  readonly kind?: ComponentKind | undefined
}
```

## 组合期适配器

每个 seam 一个适配器，各自把自身上下文作用域可见的内容镜像进该上下文的层，并在自己的 `ComponentKindMap` 声明旁拥有本类别的规范值。挂载在宿主行上时，适配器镜像全局层；通过 agent 预设的组合挂载时，它把该 agent 的视图镜像进那个 agent 的层。

| 类别 | 适配器 | 规范值 | 依据 |
|---|---|---|---|
| `tool` | [`components-tools`](../../packages/components/components-tools/README.md) | 完全按 `ctx.tools.schemas(scope)` 投影的模型可见 `ToolSchema` | content |
| `prompt-section` | [`components-prompt`](../../packages/components/components-prompt/README.md) | `[name, order, complete === true, text]`，由装配求值的文本记为 `null` | content，否则 registration |
| `preset` | [`components-presets`](../../packages/components/components-presets/README.md) | 完成 `include` 解析后的组合上的 `[id, trust, rows]` | content |
| `skill` | [`components-skills`](../../packages/components/components-skills/README.md) | 已加载定义上的 `[name, description, whenToUse ?? null, invocation.modelInvocable, invocation.userInvocable, metadata ?? null, content]`，来自 [`dsh-skill`](../../packages/skill/skill/README.md) 的 `skillDigest()` | content |
| `plugin` | [`components-packages`](../../packages/components/components-packages/README.md) | 已挂载 Loader 行上的 `[specifier, config]` | registration |
| `dynamic-package` | [`components-packages`](../../packages/components/components-packages/README.md) | 来自动态运行器包检视的 `[pluginId, packageId, hostSource, clientSource]` | content |
| `agent-provider` | [`components-subagents`](../../packages/components/components-subagents/README.md) | `[provider]` | registration |

每个适配器跟随其 seam 自身的变更通知——`tools/change`、`system-prompt/change`、`agent/created` 与 `agent-preset/selected`、`skills/change`、`internal/status` 与 `loader/partial-dispose` 与 `cordis/dynamic-changed`、`subagent/provider-added` 与 `subagent/provider-removed`——因此上游释放的注册在下游随之消失，而释放适配器的 fiber 会移除它注册的全部组件。

一个 skill 在其正文被加载后才算在用，而不是被列出后：`ctx.skills.list()` 返回摘要，因此 `components-skills` 从每次加载的记录注册——`skill` 工具已结算的 `tools/result`，以及用户显式 `/name` 注入的 `skill-invocation` 消息来源——并在 `skills/change` 上重放该次查找，为就地编辑的正文重新寻址。一个动态包在其某个版本运行后才算在用：`components-packages` 通过挂载它的 agent 自己的上下文注册它，并标记 `provenance: 'synthesized'`，因此指名它的清单可与人工筛选的组合区分开。

## 组合清单

[`components-manifest`](../../packages/components/components-manifest/README.md) 把某个 agent 当前在用的内容记录为持久的 `composition/manifest` [会话事件](../persistence-catalog.md#compositionmanifest--log-only)。在 `agent/pre-step` 上，它调用 `next()`，重新计算 `ctx.components.list({ scope: agent })`，仅当其 `compositionSha256` 与该会话日志中最后一条不同时才追加清单；去重由日志导出，因此稳定的组合恰好记录一条事件，恢复的会话不会重新发出任何事件。

```ts type-equiv
/** One component in play, as the manifest records it. */
interface CompositionManifestEntry {
  /** Stable component identity; with {@link digest} it forms the `id@digest` address. */
  readonly id: ComponentId
  /** Content address of the generation in play. */
  readonly digest: ComponentDigest
  /** The component's declared kind. */
  readonly kind: ComponentKind
  /** Whether the digest covers the component's own bytes or only its registration. */
  readonly digestBasis: ComponentDigestBasis
  /** Whether people curated the component or an agent synthesized it. */
  readonly provenance: ComponentProvenance
  /** Component this generation derived from, absent for roots. */
  readonly lineage?: ComponentId
  /** Registry layer the winning registration sat in for the recording agent. */
  readonly layer: ComponentLayer
}
```

```ts type-equiv
/** The durable record of every component one agent had in play at one step. */
interface CompositionManifest {
  /** Payload version, so a later field addition is readable against a stated shape. */
  readonly version: typeof COMPOSITION_MANIFEST_VERSION
  /** Every component in play, ordered by `id@digest` address. */
  readonly components: readonly CompositionManifestEntry[]
  /** Lowercase SHA-256 hex over the ordered addresses joined by newlines. */
  readonly compositionSha256: string
}
```

## 可调用路径

invoke 指针命名一个已有工具以及组件固定的参数；其余参数由模型提供。注册表不执行任何东西。

```ts type-equiv
/** The existing tool a model calls, with fixed arguments, to reach a component. */
interface ComponentInvoke {
  /** Registered tool name. */
  readonly tool: string
  /** Arguments fixed by the component; the model supplies the rest. */
  readonly arguments?: Readonly<Record<string, string>>
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxcomponents--componentregistry"></a>

### `ctx.components` — `ComponentRegistry`

Component registry (`ctx.components`): the composition-time inventory mirrored from live seams.

```ts cordis-catalog
/**
 * Register one component into the calling context's layer: an unscoped
 * context (a host row or repository plugin) registers globally, while a
 * scoped context (an agent preset's standing mount) registers for that
 * scope alone. Registrations are effects: the producer keeps the returned
 * disposer under its own fiber so disposal removes the component.
 * @param descriptor - complete component description, including the digest its producer computed.
 * @returns the exact disposer that removes this registration and no later one under the same id.
 * @throws {@link ComponentError} when the id is already registered in the same layer.
 */
register(descriptor: ComponentDescriptor): () => void

/**
 * Read one component as a scope sees it.
 * @param id - component identity.
 * @param options - read options; `scope` selects the viewing agent's layers.
 * @returns a detached view carrying its winning layer, or `undefined` when the id is absent.
 */
get(id: ComponentIdType, options: ComponentViewOptions = {}): ComponentView | undefined

/**
 * List components as a scope sees them, in registration order with the
 * global layer first.
 * @param options - read options; `scope` selects the viewing agent's layers and `kind` filters by kind.
 * @returns detached views carrying their winning layer.
 */
list(options: ComponentListOptions = {}): ComponentView[]
```

Source: [`packages/components/components/src/index.ts:134`](../../packages/components/components/src/index.ts)
<!-- END GENERATED cordis-surface -->
