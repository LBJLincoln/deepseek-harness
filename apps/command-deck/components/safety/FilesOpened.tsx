'use client'

import type { ReactNode } from 'react'
import { useDeck } from '@/deck/store'
import { useReadTrail } from './read-trail.ts'

/**
 * How much of the target the departments have opened so far.
 *
 * It counts the same resolution the city flares on — distinct inventory files
 * named by the admitted tool events — so the number and the lights on the
 * buildings can never disagree. It subscribes on its own rather than through
 * the view, because it changes on every event and the findings table does not.
 *
 * It is drawn only while a department is still pending; the run's reads are
 * over once the last one reports.
 * @returns The counter, or nothing when no review is running.
 */
export function FilesOpened(): ReactNode {
  const safety = useDeck(state => state.safety)
  const trail = useReadTrail(safety?.target)
  const running = safety?.departments.some(entry => entry.status === 'pending') === true

  if (!running || trail.total === 0) return null

  return (
    <p className="panel__sub" style={{ color: 'var(--cyan)' }}>
      {trail.opened} of {trail.total} files opened
    </p>
  )
}
