/**
 * Human-facing read-only `/components` command over the component registry.
 * @module @deepseek-ai/dsh-command-components
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { ComponentDescriptor } from '@deepseek-ai/dsh-components'

export const name = 'command-components'
export const inject = ['commands', 'components']

const USAGE = 'Usage: /components'

/** Render one component as a single inventory line. */
function renderComponent(component: ComponentDescriptor): string {
  const facets: string[] = [component.provenance]
  if (component.lineage !== undefined) facets.push(`from ${component.lineage}`)
  if (component.members !== undefined) facets.push(`${component.members.length} members`)
  if (component.invoke !== undefined) facets.push(`via ${component.invoke.tool}`)
  return `- ${component.id}: ${component.description} · ${facets.join(' · ')}`
}

/** Render the inventory grouped by kind in first-seen order. */
function renderInventory(components: readonly ComponentDescriptor[]): CommandResult {
  const byKind = new Map<string, ComponentDescriptor[]>()
  for (const component of components) {
    const group = byKind.get(component.kind)
    if (group === undefined) byKind.set(component.kind, [component])
    else group.push(component)
  }
  const lines = [`Components (${components.length})`]
  for (const [kind, group] of byKind) {
    lines.push(`${kind} (${group.length}):`, ...group.map(renderComponent))
  }
  return { kind: 'success', text: lines.join('\n') }
}

/** Execute the read-only inventory view through the registry that owns it. */
function executeComponentsCommand(ctx: Context, invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim().length !== 0) {
    return { kind: 'error', text: `The components command takes no arguments. ${USAGE}` }
  }
  const components = ctx.components.list()
  return components.length === 0
    ? { kind: 'success', text: `No components are registered in this composition.\n${USAGE}` }
    : renderInventory(components)
}

/** Register the read-only `/components` inventory command for every composed command adapter. */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'components',
    description: 'view every addressable component in this composition, grouped by kind',
    handler: invocation => executeComponentsCommand(ctx, invocation),
  })
}
