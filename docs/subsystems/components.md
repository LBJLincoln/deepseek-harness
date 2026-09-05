# Component registry

English | [中文](components.zh.md)

Types shared by the component registry and the adapters that mirror live seams into it. A component is one addressable unit of a composition: a plugin, or a plugin-provided member such as a tool, skill, subagent provider, workflow, MCP server, context provider, preset, or composition. The [component-registry Agent Note](../../.agents/notes/proposed/architecture/2026-09-01-component-registry-seam.md) owns the design; this page records the exact fields from [`packages/components/components/src/types.ts`](../../packages/components/components/src/types.ts).

## Descriptor

`ComponentId` is a [branded id](core.md#branded-ids) derived from the kind and the owning seam's stable name, never from mount order. Kinds are a merge-extensible map each producer package declares by declaration merging; the registry ships none.

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

## Callable route

The invoke pointer names an existing tool and the arguments the component fixes; the model supplies the rest. The registry executes nothing.

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
