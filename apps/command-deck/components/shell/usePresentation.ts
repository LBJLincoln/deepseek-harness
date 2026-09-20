'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'
import { VIEWS } from './views.ts'

/** How long the tour holds one view before moving to the next. */
const TOUR_STEP_MS = 30_000

/** Elements that own their own keystrokes, where the deck's shortcuts must not fire. */
const TYPING = ['INPUT', 'TEXTAREA', 'SELECT']

/** The view the cold open assembles; `O` and the tour's first act both open there. */
const OPENING_VIEW = '/'

/**
 * The deck's global keyboard, and the timer that drives the tour.
 *
 * `1`, `2` and `3` select a view and `Esc` clears the selected agent and the
 * selected finding, so each stage flies back on the one key whichever view is
 * up; `F` toggles the full-bleed stage, `P` the tour and `O` the cold open.
 * Every other key, and any press anywhere on the page, ends a running tour — a
 * tour is what the deck does while nobody is driving, so the first sign of a
 * driver stops it — and ends a running cold open, leaving the graph whole.
 *
 * The cold open is the tour's first act, once per page load: the step timer
 * does not start until the sequence is over, so the tour never navigates off a
 * half-assembled enterprise, and a second `P` finds the opening spent and
 * starts on the view that is up.
 *
 * The step counter lives in the effect rather than in the route, so the cadence
 * stays at {@link TOUR_STEP_MS} whatever a navigation costs.
 */
export function usePresentation(): void {
  const router = useRouter()
  const pathname = usePathname()
  const reduced = usePrefersReducedMotion()
  const presentation = useDeck(state => state.presentation)
  const opening = useDeck(state => state.opening)
  const setPresentation = useDeck(state => state.setPresentation)
  const togglePresentation = useDeck(state => state.togglePresentation)
  const startOpening = useDeck(state => state.startOpening)
  const endOpening = useDeck(state => state.endOpening)
  const selectAgent = useDeck(state => state.selectAgent)
  const selectFinding = useDeck(state => state.selectFinding)

  const here = useRef(pathname)
  here.current = pathname
  const mode = useRef(presentation)
  mode.current = presentation
  const wantsMotion = useRef(!reduced)
  wantsMotion.current = !reduced

  useEffect(() => {
    const open = (): void => {
      if (!startOpening(wantsMotion.current)) return
      if (here.current !== OPENING_VIEW) router.push(OPENING_VIEW)
    }

    const leaveTour = (): void => {
      if (mode.current === 'tour') setPresentation('off')
    }

    const stopAll = (): void => {
      endOpening()
      leaveTour()
    }

    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && TYPING.includes(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      // Any key ends a running sequence before it does its own work, so the
      // deck is never driven out of a half-lit graph.
      endOpening()

      const key = event.key.toLowerCase()
      if (key === 'o') {
        open()
        return
      }
      if (key === 'f') {
        togglePresentation('focus')
        return
      }
      if (key === 'p') {
        if (mode.current !== 'tour') open()
        togglePresentation('tour')
        return
      }

      leaveTour()
      if (event.key === 'Escape') {
        selectAgent(undefined)
        selectFinding(undefined)
        return
      }
      const view = VIEWS.find(entry => entry.key === event.key)
      if (view !== undefined) router.push(view.href)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', stopAll)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', stopAll)
    }
  }, [endOpening, router, selectAgent, selectFinding, setPresentation, startOpening, togglePresentation])

  useEffect(() => {
    if (presentation !== 'tour' || opening === 'playing') return
    // Start from whatever is on screen, so pressing P does not jump the view.
    let step = VIEWS.findIndex(entry => entry.href === here.current)
    const timer = setInterval(() => {
      step = (step + 1) % VIEWS.length
      const next = VIEWS[step]
      if (next !== undefined) router.push(next.href)
    }, TOUR_STEP_MS)
    return () => clearInterval(timer)
  }, [opening, presentation, router])
}
