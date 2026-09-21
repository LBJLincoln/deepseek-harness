'use client'

import { usePathname } from 'next/navigation'

/**
 * The current view's path in the form the view table writes it: without the
 * base path (Next removes it) and without a trailing slash, which Next keeps on
 * every route because the deck is built with `trailingSlash`. `/process/` and
 * `/process` are therefore the same view for the header, the tour and the
 * shortcuts.
 * @returns `/`, `/process`, `/safety` or `/workflow`.
 */
export function useViewPathname(): string {
  const pathname = usePathname()
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}
