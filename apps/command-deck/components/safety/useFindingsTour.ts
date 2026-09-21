/**
 * The guided tour of a review's findings.
 *
 * `G` on the Code safety view walks the loaded review's worst findings, one
 * every STEP_MS: each is selected in turn, so the city flies to its beacon,
 * hangs its callout and the panel opens its card, exactly as a click would.
 * The tour ends by itself after the last finding, clearing the selection so
 * the camera flies back, and any other key or a click ends it at once. It is
 * bound here rather than in the shell's keyboard handler because it only means
 * something while this view is mounted, like the playback keys.
 */

'use client'

import { useEffect, useRef, useState } from 'react'
import { SEVERITY_ORDER, type Finding } from '@/deck/contract'

/** How long each finding holds the frame. */
const STEP_MS = 4_500

/** How many findings a tour visits, worst first. */
const TOUR_LENGTH = 12

/** Element tags whose focus keeps the key inert, so typing in the review form never starts a tour. */
const TYPING = ['INPUT', 'TEXTAREA', 'SELECT']

/**
 * The findings a tour visits: the worst TOUR_LENGTH, in severity order and
 * otherwise in the review's own order.
 * @param findings - The loaded review's findings.
 * @returns The tour's stops.
 */
function stops(findings: readonly Finding[]): Finding[] {
  return findings
    .map((finding, index) => ({ finding, index }))
    .sort((a, b) => (
      SEVERITY_ORDER.indexOf(a.finding.severity) - SEVERITY_ORDER.indexOf(b.finding.severity)
      || a.index - b.index
    ))
    .slice(0, TOUR_LENGTH)
    .map(entry => entry.finding)
}

/**
 * Bind `G` and run the tour while it is on.
 * @param findings - The loaded review's findings; an empty list makes `G` a no-op.
 * @param select - Selects a finding, or clears the selection.
 * @returns Whether a tour is running, for the footer hint.
 */
export function useFindingsTour(findings: readonly Finding[], select: (id: string | undefined) => void): boolean {
  const [running, setRunning] = useState(false)
  const available = useRef(findings)
  available.current = findings

  useEffect(() => {
    const stop = (): void => setRunning(false)
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && TYPING.includes(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() === 'g') {
        setRunning(on => !on && available.current.length > 0)
        return
      }
      stop()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', stop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', stop)
    }
  }, [])

  useEffect(() => {
    if (!running) return
    const route = stops(available.current)
    let step = 0
    const visit = (): void => {
      const finding = route[step]
      if (finding === undefined) {
        select(undefined)
        setRunning(false)
        return
      }
      select(finding.id)
      step += 1
    }
    visit()
    const timer = setInterval(visit, STEP_MS)
    return () => clearInterval(timer)
  }, [running, select])

  return running
}
