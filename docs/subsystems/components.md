# Component registry

English | [中文](components.zh.md)

Types shared by the component registry and the adapters that mirror live seams into it. A component is one addressable unit of a composition: a plugin, or a plugin-provided member such as a tool, skill, subagent provider, workflow, MCP server, context provider, preset, or composition. The [component-registry Agent Note](../../.agents/notes/proposed/architecture/2026-09-01-component-registry-seam.md) owns the registry design and the [composition-manifest Agent Note](../../.agents/notes/proposed/architecture/2026-09-05-composition-manifest.md) owns content addressing and the scoped layers; this page records the exact fields from [`packages/components/components/src/types.ts`](../../packages/components/components/src/types.ts).

## Descriptor

`ComponentId` is a [branded id](core.md#branded-ids) derived from the kind and the owning seam's stable name, never from mount order. Kinds are a merge-extensible map each producer package declares by declaration merging; the registry ships none. `ComponentDigestBasis` is `'content'` when a digest addresses the component's own bytes and `'registration'` when the component's model-visible text is a function of the assembly instead.

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

## Content address

`componentDigest(kind, canonical)` hashes the kind, a newline, and the JSON encoding of the producer's canonical value; `componentAddress(id, digest)` joins the id and digest as `id@digest`. Each producer owns its kind's canonical value beside its `ComponentKindMap` declaration, so the registry never switches on kind.

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

## Scoped layers

A registration files into the layer of its calling context's [scope](scope.md); a read merges the global layer with the viewing scope's chain, the nearest layer winning a duplicate id. `ComponentLayer` is `'global'` when the winning registration sits in the context-global layer and `'agent'` when it sits anywhere on that agent's chain.

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
