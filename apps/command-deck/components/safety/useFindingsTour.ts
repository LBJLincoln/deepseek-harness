/**
 * The guided tour of a review's findings.
 *
 * `G` on the Code safety view, or the header's Present menu, walks the loaded
 * review's worst findings, one every STEP_MS: each is selected in turn, so the
 * city flies to its beacon, hangs its callout and the panel opens its card,
 * exactly as a click would. The tour ends by itself after the last finding,
 * clearing the selection so the camera flies back. The arrow keys and the
 * tour bar's buttons step it; any other key, and a mouse press anywhere but
 * the deck's presenter controls, ends it at once. A touch on the stage does
 * not, because a touch viewer steers with the bar. The stop lives in the store
 * so the shell's menu and bar can drive it; the keys are bound here, while
 * this view is mounted, like the playback keys, and leaving the view ends it.
 */

'use client'

import { useEffect, useRef } from 'react'
import { SEVERITY_ORDER, type Finding } from '@/deck/contract'
import { useDeck } from '@/deck/store'

/** How long each finding holds the frame. */
const STEP_MS = 4_500

/** How many findings a tour visits, worst first. */
export const FINDINGS_TOUR_LENGTH = 12

/** Element tags whose focus keeps the key inert, so typing in the review form never starts a tour. */
const TYPING = ['INPUT', 'TEXTAREA', 'SELECT']

/**
 * The findings a tour visits: the worst {@link FINDINGS_TOUR_LENGTH}, in
 * severity order and otherwise in the review's own order.
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
    .slice(0, FINDINGS_TOUR_LENGTH)
    .map(entry => entry.finding)
}

/**
 * Whether an event came from the deck's presenter controls (the Present menu,
 * the tour bar), which drive a tour rather than interrupt it.
 * @param target - The event's target.
 * @returns `true` inside an element marked `data-presenter`.
 */
export function fromPresenter(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-presenter]') !== null
}

/**
 * Bind `G` and the arrow keys, and run the tour while it is on.
 * @param findings - The loaded review's findings; an empty list makes `G` a no-op.
 * @param select - Selects a finding, or clears the selection.
 * @returns Whether a tour is running, for the panel's eyebrow.
 */
export function useFindingsTour(findings: readonly Finding[], select: (id: string | undefined) => void): boolean {
  const stop = useDeck(state => state.findingsStop)
  const start = useDeck(state => state.startFindingsTour)
  const step = useDeck(state => state.stepFindingsTour)
  const end = useDeck(state => state.stopFindingsTour)
  const available = useRef(findings)
  available.current = findings

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && TYPING.includes(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey || fromPresenter(target)) return
      const running = useDeck.getState().findingsStop !== undefined
      if (event.key.toLowerCase() === 'g') {
        if (running) end()
        else start()
        return
      }
      if (running && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        step(event.key === 'ArrowRight' ? 1 : -1)
        return
      }
      end()
    }
    const onPointer = (event: PointerEvent): void => {
      if (event.pointerType !== 'touch' && !fromPresenter(event.target)) end()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
      end()
    }
  }, [end, start, step])

  useEffect(() => {
    if (stop === undefined) return undefined
    const finding = stops(available.current)[stop]
    if (finding === undefined) {
      select(undefined)
      end()
      return undefined
    }
    select(finding.id)
    const timer = setTimeout(() => step(1), STEP_MS)
    return () => clearTimeout(timer)
  }, [end, select, step, stop])

  return stop !== undefined
}
