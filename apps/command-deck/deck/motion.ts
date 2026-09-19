'use client'

import { useEffect, useState } from 'react'

/**
 * Whether the viewer asked for reduced motion.
 *
 * The deck honours it by dropping auto-orbit, pulsing and chromatic
 * aberration, and by holding bloom at a constant intensity. The initial value
 * is `false` so the server render and the first client render agree; the media
 * query resolves immediately afterwards.
 * @returns `true` once `prefers-reduced-motion: reduce` matches.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}
