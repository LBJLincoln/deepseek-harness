/**
 * Mirrors the tools one scope sees into the component registry as `tool`
 * components, following the tool registry's own `tools/change` notification.
 * @module @deepseek-ai/dsh-components-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { ComponentId, componentDigest } from '@deepseek-ai/dsh-components'
import type {
  ComponentCanonical,
  ComponentDescriptor,
  ComponentDigest,
  ComponentId as ComponentIdType,
} from '@deepseek-ai/dsh-components/types'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import { scopeOf } from '@deepseek-ai/dsh-scope'
// Type-only: resolves ctx.tools and the registry's `tools/change` notification.
import type {} from '@deepseek-ai/dsh-tools'

export const name = 'components-tools'
export const inject = ['components', 'tools']

/** Kind-specific detail of a `tool` component. */
export interface ToolComponentDetail {
  /** Model-facing tool name as `ctx.tools.schemas()` projects it. */
  readonly toolName: string
}

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    /**
     * One tool the adapter's own scope sees, as the model sees it. A tool
     * removed from that scope — unregistered, restricted away, or collapsed by
     * a presentation mode — leaves the inventory with it.
     */
    'tool': ToolComponentDetail
  }
}

const OWNER = '@deepseek-ai/dsh-components-tools'

/**
 * Component id of one tool.
 * @param toolName - the model-facing tool name.
 * @returns the stable id `tool:<name>`.
 */
export function toolComponentId(toolName: string): ComponentIdType {
  return ComponentId(`tool:${toolName}`)
}

/**
 * Content address of one `tool` component. The canonical value is the
 * model-facing schema exactly as `ctx.tools.schemas(scope)` projects it — name,
 * description, and parameter schema, in the registry's own field order — so one
 * byte changed in a parameter description moves the digest and nothing the
 * registry computes per assembly enters it.
 * @param schema - one projected schema from `ctx.tools.schemas(scope)`.
 * @returns the digest over this kind and that canonical value.
 */
export function toolDigest(schema: ToolSchema): ComponentDigest {
  // `schemas()` materializes each projection as lossless JSON, so the cast
  // records what the projection already is rather than re-encoding it.
  return componentDigest('tool', schema as unknown as ComponentCanonical)
}

/** Describe one projected schema as a component. */
function describeTool(schema: ToolSchema, digest: ComponentDigest): ComponentDescriptor {
  return {
    id: toolComponentId(schema.name),
    kind: 'tool',
    digest,
    digestBasis: 'content',
    name: schema.name,
    description: schema.description,
    owner: OWNER,
    provenance: 'curated',
    invoke: { tool: schema.name },
    detail: { toolName: schema.name },
  }
}

/** One mirrored tool: the digest that produced it and the disposer that removes it. */
interface MirroredTool {
  readonly digest: ComponentDigest
  readonly dispose: () => void
}

/**
 * Mirror the visible tools of `ctx`'s own scope and follow every later change.
 *
 * The registry publishes one unfiltered `tools/change` for a registration, a
 * disposal, and a scoped restriction alike, and reports no diff with it, so the
 * adapter recomputes the visible set and reconciles: a tool whose schema is
 * unchanged keeps its registration, a changed one is replaced under the same id,
 * and one that left the scope is disposed.
 * @param ctx - Cordis context carrying the component registry and the tool registry.
 */
export function apply(ctx: Context): void {
  const mirrored = new Map<string, MirroredTool>()
  const scope = scopeOf(ctx)
  const sync = (): void => {
    const present = new Set<string>()
    for (const schema of ctx.tools.schemas(scope)) {
      present.add(schema.name)
      const digest = toolDigest(schema)
      const current = mirrored.get(schema.name)
      if (current?.digest === digest) continue
      current?.dispose()
      mirrored.set(schema.name, { digest, dispose: ctx.components.register(describeTool(schema, digest)) })
    }
    for (const [toolName, entry] of [...mirrored]) {
      if (present.has(toolName)) continue
      mirrored.delete(toolName)
      entry.dispose()
    }
  }
  sync()
  ctx.on('tools/change', sync)
  ctx.effect(() => () => {
    for (const entry of mirrored.values()) entry.dispose()
    mirrored.clear()
  }, 'components-tools teardown')
}
