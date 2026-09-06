// A preset row: registers one prompt section named from config. Import-free on
// purpose — the Loader resolves entry modules through Node's ESM resolver,
// which cannot see this workspace's TypeScript sources.
export const name = 'contribute'
export const inject = ['systemPrompt']

export function apply(ctx, config) {
  ctx.effect(() => ctx.systemPrompt.section({
    name: `preset:${config.section}`,
    order: 10,
    text: `section for ${config.section}`,
  }))
}
