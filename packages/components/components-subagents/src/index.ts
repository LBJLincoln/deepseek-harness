/**
 * Mirrors subagent providers into the component registry as `agent-provider`
 * components, following the subagent seam's own provider events.
 * @module @deepseek-ai/dsh-components-subagents
 */

import type { Context } from '@deepseek-ai/cordis'
import { ComponentId, componentDigest } from '@deepseek-ai/dsh-components'
import type {
  ComponentDescriptor,
  ComponentDigest,
  ComponentId as ComponentIdType,
} from '@deepseek-ai/dsh-components/types'
// Type-only: resolves ctx.subagents and the subagent lifecycle events.
import type {} from '@deepseek-ai/dsh-subagent'

export const name = 'components-subagents'
export const inject = ['components', 'subagents']

/** Kind-specific detail of an `agent-provider` component. */
export interface AgentProviderComponentDetail {
  /** Provider name as registered with `ctx.subagents`. */
  readonly provider: string
}

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    /**
     * One subagent provider registered with `ctx.subagents`. The callable
     * route is the `subagent` tool instance configured for the provider; the
     * subagent seam does not expose that binding, so the component carries
     * no `invoke` pointer.
     */
    'agent-provider': AgentProviderComponentDetail
  }
}

const OWNER = '@deepseek-ai/dsh-components-subagents'

/**
 * Component id of one subagent provider.
 * @param provider - provider name as registered with `ctx.subagents`.
 * @returns the stable id `agent-provider:<provider>`.
 */
export function agentProviderComponentId(provider: string): ComponentIdType {
  return ComponentId(`agent-provider:${provider}`)
}

/**
 * Content address of one `agent-provider` component. The canonical value is
 * `[provider]`, so the digest addresses the registration and not the agent
 * the provider starts: the subagent seam exposes a provider name and its
 * lifecycle edges, never the composition behind them, which is why this kind's
 * `digestBasis` is `registration`.
 * @param provider - provider name as registered with `ctx.subagents`.
 * @returns the digest over this kind and that canonical value.
 */
export function agentProviderDigest(provider: string): ComponentDigest {
  return componentDigest('agent-provider', [provider])
}

/** Describe one provider as a component. */
function describeProvider(provider: string): ComponentDescriptor {
  return {
    id: agentProviderComponentId(provider),
    kind: 'agent-provider',
    digest: agentProviderDigest(provider),
    digestBasis: 'registration',
    name: provider,
    description: `Subagent provider "${provider}", reached through the subagent tool instance configured for it.`,
    owner: OWNER,
    provenance: 'curated',
    detail: { provider },
  }
}

/**
 * Register every current provider and follow later additions and removals.
 * @param ctx - Cordis context carrying the component registry and the subagent seam.
 */
export function apply(ctx: Context): void {
  const disposers = new Map<string, () => void>()
  const add = (provider: string): void => {
    if (disposers.has(provider)) return
    disposers.set(provider, ctx.components.register(describeProvider(provider)))
  }
  const remove = (provider: string): void => {
    const dispose = disposers.get(provider)
    if (dispose === undefined) return
    disposers.delete(provider)
    dispose()
  }
  for (const provider of ctx.subagents.list()) add(provider)
  ctx.on('subagent/provider-added', (provider) => { add(provider.name) })
  ctx.on('subagent/provider-removed', (provider) => { remove(provider) })
  ctx.effect(() => () => {
    for (const dispose of disposers.values()) dispose()
    disposers.clear()
  }, 'components-subagents teardown')
}
