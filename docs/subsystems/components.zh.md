# 组件注册表

[English](components.md) | 中文

组件注册表及把实时 seam 镜像进来的适配器所共享的类型。一个组件是组合中的一个可寻址单元：一个插件，或插件提供的成员，例如工具、技能、subagent 提供方、工作流、MCP 服务器、上下文提供方、preset 或组合。[组件注册表 Agent Note](../../.agents/notes/proposed/architecture/2026-09-01-component-registry-seam.md) 承载设计；本页记录 [`packages/components/components/src/types.ts`](../../packages/components/components/src/types.ts) 中的精确字段。

## 描述符

`ComponentId` 是由类别与所属 seam 的稳定名称派生的[带品牌的 id](core.md#branded-ids)，从不来自挂载顺序。类别是每个生产方包通过声明合并声明的可合并扩展映射；注册表本身不提供任何类别。

```ts type-equiv
/** One addressable unit of a composition. */
interface ComponentDescriptor<K extends ComponentKind = ComponentKind> {
  /** Stable identity across compositions. */
  readonly id: ComponentId
  /** Declared kind. */
  readonly kind: K
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
 * Register one component. Registrations are effects: the producer keeps the
 * returned disposer under its own fiber so disposal removes the component.
 * @param descriptor - complete component description.
 * @returns the exact disposer that removes this registration and no later one under the same id.
 * @throws {@link ComponentError} when the id is already registered.
 */
register(descriptor: ComponentDescriptor): () => void

/**
 * Read one component.
 * @param id - component identity.
 * @returns a detached descriptor, or `undefined` when nothing is registered under the id.
 */
get(id: ComponentIdType): ComponentDescriptor | undefined

/**
 * List components in registration order.
 * @param kind - when given, only components of this kind.
 * @returns detached descriptors.
 */
list(kind?: ComponentKind): ComponentDescriptor[]
```

Source: [`packages/components/components/src/index.ts:56`](../../packages/components/components/src/index.ts)
<!-- END GENERATED cordis-surface -->
