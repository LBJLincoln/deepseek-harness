/**
 * The deck's three views, in one order.
 *
 * The same order is the number keys that select them, the nav, and the cycle
 * the presentation tour walks, so there is one place to change it.
 */
export const VIEWS = [
  { href: '/', key: '1', label: 'Enterprise' },
  { href: '/process', key: '2', label: 'Process' },
  { href: '/safety', key: '3', label: 'Code safety' },
] as const

/** One entry of {@link VIEWS}. */
export type View = (typeof VIEWS)[number]
