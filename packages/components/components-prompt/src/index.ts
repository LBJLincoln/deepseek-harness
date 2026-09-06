/**
 * Mirrors the system-prompt sections one scope resolves into the component
 * registry as `prompt-section` components, following the prompt registry's own
 * `system-prompt/change` notification.
 * @module @deepseek-ai/dsh-components-prompt
 */

import type { Context } from '@deepseek-ai/cordis'
import { ComponentId, componentDigest } from '@deepseek-ai/dsh-components'
import type {
  ComponentDescriptor,
  ComponentDigest,
  ComponentDigestBasis,
  ComponentId as ComponentIdType,
} from '@deepseek-ai/dsh-components/types'
import { scopeOf } from '@deepseek-ai/dsh-scope'
// Type-only: resolves ctx.systemPrompt and the `system-prompt/change` notification.
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

export const name = 'components-prompt'
export const inject = ['components', 'systemPrompt']

/** Kind-specific detail of a `prompt-section` component. */
export interface PromptSectionComponentDetail {
  /** Ascending position the section is concatenated at. */
  readonly order: number
  /** Whether the section is registered as the complete system prompt. */
  readonly complete: boolean
  /** Whether the registered text is stored bytes rather than a per-assembly provider. */
  readonly static: boolean
}

declare module '@deepseek-ai/dsh-components/types' {
  interface ComponentKindMap {
    /**
     * One system-prompt section the adapter's own scope resolves. A section
     * whose text is a provider is addressed by its registration alone, because
     * the bytes it produces are a function of each assembly and live in
     * `request/header` instead.
     */
    'prompt-section': PromptSectionComponentDetail
  }
}

const OWNER = '@deepseek-ai/dsh-components-prompt'

/**
 * Component id of one prompt section.
 * @param sectionName - the section's registered name.
 * @returns the stable id `prompt-section:<name>`.
 */
export function promptSectionComponentId(sectionName: string): ComponentIdType {
  return ComponentId(`prompt-section:${sectionName}`)
}

/**
 * Whether one section's digest addresses its own bytes.
 * @param section - the registered section.
 * @returns `content` for stored text, `registration` for a per-assembly provider.
 */
export function promptSectionDigestBasis(section: PromptSection): ComponentDigestBasis {
  return typeof section.text === 'string' ? 'content' : 'registration'
}

/**
 * Content address of one `prompt-section` component. The canonical value is
 * `[name, order, complete === true, text]` for stored text and
 * `[name, order, complete === true, null]` for a provider, so one byte changed
 * in a static section moves the digest while two runs whose dynamic section
 * rendered differently share an address.
 * @param section - the registered section.
 * @returns the digest over this kind and that canonical value.
 */
export function promptSectionDigest(section: PromptSection): ComponentDigest {
  return componentDigest('prompt-section', [
    section.name,
    section.order,
    section.complete === true,
    typeof section.text === 'string' ? section.text : null,
  ])
}

/** Describe one resolved section as a component. */
function describeSection(section: PromptSection, digest: ComponentDigest): ComponentDescriptor {
  const isStatic = typeof section.text === 'string'
  const complete = section.complete === true
  return {
    id: promptSectionComponentId(section.name),
    kind: 'prompt-section',
    digest,
    digestBasis: promptSectionDigestBasis(section),
    name: section.name,
    description: `System prompt section at order ${String(section.order)}, ${
      isStatic ? 'registered as stored text' : 'rendered for each assembly'
    }${complete ? ', declared as the complete system prompt' : ''}.`,
    owner: OWNER,
    provenance: 'curated',
    detail: { order: section.order, complete, static: isStatic },
  }
}

/** One mirrored section: the digest that produced it and the disposer that removes it. */
interface MirroredSection {
  readonly digest: ComponentDigest
  readonly dispose: () => void
}

/**
 * Mirror the prompt sections of `ctx`'s own scope and follow every later change.
 *
 * The prompt registry publishes one unfiltered `system-prompt/change` for every
 * provider edit and reports no diff with it, so the adapter re-reads the
 * resolved sections and reconciles: an unchanged section keeps its
 * registration, a changed one is replaced under the same id, and one that left
 * the scope is disposed.
 * @param ctx - Cordis context carrying the component registry and the prompt registry.
 */
export function apply(ctx: Context): void {
  const mirrored = new Map<string, MirroredSection>()
  const scope = scopeOf(ctx)
  const sync = (): void => {
    const present = new Set<string>()
    for (const section of ctx.systemPrompt.sections(scope)) {
      present.add(section.name)
      const digest = promptSectionDigest(section)
      const current = mirrored.get(section.name)
      if (current?.digest === digest) continue
      current?.dispose()
      mirrored.set(section.name, { digest, dispose: ctx.components.register(describeSection(section, digest)) })
    }
    for (const [sectionName, entry] of [...mirrored]) {
      if (present.has(sectionName)) continue
      mirrored.delete(sectionName)
      entry.dispose()
    }
  }
  sync()
  ctx.on('system-prompt/change', sync)
  ctx.effect(() => () => {
    for (const entry of mirrored.values()) entry.dispose()
    mirrored.clear()
  }, 'components-prompt teardown')
}
