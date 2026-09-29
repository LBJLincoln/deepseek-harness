'use client'

import { useEffect, useState } from 'react'

/**
 * Whether the viewer's primary pointer is a finger.
 * @returns `true` under `(pointer: coarse)`; `false` on the server and the first render.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(pointer: coarse)')
    const update = (): void => setCoarse(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return coarse
}
