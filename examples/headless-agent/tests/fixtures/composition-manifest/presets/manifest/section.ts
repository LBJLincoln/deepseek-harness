/** Test-only preset row: the two prompt sections this session's composition adds. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'

export const name = 'preset-section'
export const inject = ['systemPrompt']

/**
 * Contribute one stored-text section and one provider section into the mounting
 * session's own layer, so the manifest records both digest bases.
 * @param ctx - the preset's standing scope context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'preset:manifest',
    order: 20,
    text: 'This session was composed from the manifest preset.',
  }))
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'preset:manifest-assembled',
    order: 21,
    text: () => 'Every part of this composition is recorded before the step that uses it.',
  }))
}
