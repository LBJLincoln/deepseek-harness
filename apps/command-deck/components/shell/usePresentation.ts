'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'
import { useDeck } from '@/deck/store'
import { VIEWS } from './views.ts'

/** How long the tour holds one view before moving to the next. */
const TOUR_STEP_MS = 30_000

/** Elements that own their own keystrokes, where the deck's shortcuts must not fire. */
const TYPING = ['INPUT', 'TEXTAREA', 'SELECT']

/**
 * The deck's global keyboard, and the timer that drives the tour.
 *
 * `1`, `2` and `3` select a view and `Esc` clears the selection, as before;
 * `F` toggles the full-bleed stage and `P` the tour. Every other key, and any
 * press anywhere on the page, ends a running tour — a tour is what the deck
 * does while nobody is driving, so the first sign of a driver stops it.
 *
 * The step counter lives in the effect rather than in the route, so the cadence
 * stays at {@link TOUR_STEP_MS} whatever a navigation costs.
 */
export function usePresentation(): void {
  const router = useRouter()
  const pathname = usePathname()
  const presentation = useDeck(state => state.presentation)
  const setPresentation = useDeck(state => state.setPresentation)
  const togglePresentation = useDeck(state => state.togglePresentation)
  const selectAgent = useDeck(state => state.selectAgent)

  const here = useRef(pathname)
  here.current = pathname
  const mode = useRef(presentation)
  mode.current = presentation

  useEffect(() => {
    const leaveTour = (): void => {
      if (mode.current === 'tour') setPresentation('off')
    }

    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && TYPING.includes(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const key = event.key.toLowerCase()
      if (key === 'f') {
        togglePresentation('focus')
        return
      }
      if (key === 'p') {
        togglePresentation('tour')
        return
      }

      leaveTour()
      if (event.key === 'Escape') {
        selectAgent(undefined)
        return
      }
      const view = VIEWS.find(entry => entry.key === event.key)
      if (view !== undefined) router.push(view.href)
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', leaveTour)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', leaveTour)
    }
  }, [router, selectAgent, setPresentation, togglePresentation])

  useEffect(() => {
    if (presentation !== 'tour') return
    // Start from whatever is on screen, so pressing P does not jump the view.
    let step = VIEWS.findIndex(entry => entry.href === here.current)
    const timer = setInterval(() => {
      step = (step + 1) % VIEWS.length
      const next = VIEWS[step]
      if (next !== undefined) router.push(next.href)
    }, TOUR_STEP_MS)
    return () => clearInterval(timer)
  }, [presentation, router])
}
