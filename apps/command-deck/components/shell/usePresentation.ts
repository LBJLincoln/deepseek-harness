'use client'

import { useRouter } from 'next/navigation'
import { useViewPathname } from './pathname.ts'
import { useEffect, useMemo, useRef } from 'react'
import { fromPresenter } from '@/components/safety/useFindingsTour'
import { usePrefersReducedMotion } from '@/deck/motion'
import { useDeck } from '@/deck/store'
import { VIEWS } from './views.ts'

/** How long the tour holds one view before moving to the next. */
const TOUR_STEP_MS = 30_000

/** Elements that own their own keystrokes, where the deck's shortcuts must not fire. */
const TYPING = ['INPUT', 'TEXTAREA', 'SELECT']

/** The view the cold open assembles; `O` and the tour's first act both open there. */
const OPENING_VIEW = '/'

/** Query parameter that starts a sequence on load: `?present=open`, `tour` or `focus`. */
const PRESENT_PARAM = 'present'

/** The presentation actions the header's Present menu and the tour bar call. */
export interface Presenter {
  /** Run the cold open on the enterprise view, unless it has already run in this page load. */
  openCold: () => void
  /** Start the tour, with the cold open as its first act the first time, or end it. */
  toggleTour: () => void
  /** End the tour and a running cold open. */
  endTour: () => void
  /** Give the stage the whole frame, or give the panel back. */
  toggleFocus: () => void
  /** Move to the next view in the tour's order; the tour's timer starts again from there. */
  nextView: () => void
  /** Move to the previous view in the tour's order. */
  previousView: () => void
  /** Start the findings tour of the loaded review. */
  startFindings: () => void
}

/**
 * The deck's presentation: its keyboard, the actions its on-screen controls
 * call, the timer that drives the tour, and the `?present=` link.
 *
 * `1` to `5` select a view and `Esc` clears the selected agent and the
 * selected finding, so each stage flies back on the one key whichever view is
 * up; `F` toggles the full-bleed stage, `P` the tour and `O` the cold open,
 * and the arrow keys step a running tour. Every other key ends a running tour
 * and a running cold open, leaving the graph whole; so does a mouse press
 * anywhere but the presenter controls (`data-presenter`). A touch ends the
 * cold open but not a tour, which a touch viewer steers with the tour bar.
 *
 * The cold open is the tour's first act, once per page load: the step timer
 * does not start until the sequence is over, so the tour never navigates off a
 * half-assembled enterprise, and a second `P` finds the opening spent and
 * starts on the view that is up. The timer restarts on every view change, so
 * a view stepped to by hand also holds for {@link TOUR_STEP_MS}.
 *
 * `?present=open`, `?present=tour` or `?present=focus` on a link starts that
 * sequence once the roster has been read, so a link sent ahead of a meeting
 * opens on the story rather than on the working deck.
 * @returns The presentation actions.
 */
export function usePresentation(): Presenter {
  const router = useRouter()
  const pathname = useViewPathname()
  const reduced = usePrefersReducedMotion()
  const roster = useDeck(state => state.roster)
  const presentation = useDeck(state => state.presentation)
  const opening = useDeck(state => state.opening)
  const setPresentation = useDeck(state => state.setPresentation)
  const togglePresentation = useDeck(state => state.togglePresentation)
  const startOpening = useDeck(state => state.startOpening)
  const endOpening = useDeck(state => state.endOpening)
  const selectAgent = useDeck(state => state.selectAgent)
  const selectFinding = useDeck(state => state.selectFinding)
  const startFindingsTour = useDeck(state => state.startFindingsTour)

  const here = useRef(pathname)
  here.current = pathname
  const mode = useRef(presentation)
  mode.current = presentation
  const wantsMotion = useRef(!reduced)
  wantsMotion.current = !reduced

  const presenter = useMemo<Presenter>(() => {
    const openCold = (): void => {
      if (!startOpening(wantsMotion.current)) return
      if (here.current !== OPENING_VIEW) router.push(OPENING_VIEW)
    }
    const move = (delta: number): void => {
      endOpening()
      const index = VIEWS.findIndex(view => view.href === here.current)
      const next = VIEWS[(index + delta + VIEWS.length) % VIEWS.length]
      if (next !== undefined) router.push(next.href)
    }
    return {
      openCold,
      toggleTour: () => {
        if (mode.current !== 'tour') openCold()
        togglePresentation('tour')
      },
      endTour: () => {
        endOpening()
        if (mode.current === 'tour') setPresentation('off')
      },
      toggleFocus: () => togglePresentation('focus'),
      nextView: () => move(1),
      previousView: () => move(-1),
      startFindings: startFindingsTour,
    }
  }, [endOpening, router, setPresentation, startFindingsTour, startOpening, togglePresentation])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && TYPING.includes(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey || fromPresenter(target)) return

      const key = event.key.toLowerCase()
      if (mode.current === 'tour' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
        if (event.key === 'ArrowRight') presenter.nextView()
        else presenter.previousView()
        return
      }

      // Any other key ends a running sequence before it does its own work, so
      // the deck is never driven out of a half-lit graph.
      endOpening()
      if (key === 'o') {
        presenter.openCold()
        return
      }
      if (key === 'f') {
        presenter.toggleFocus()
        return
      }
      if (key === 'p') {
        presenter.toggleTour()
        return
      }

      if (mode.current === 'tour') setPresentation('off')
      if (event.key === 'Escape') {
        selectAgent(undefined)
        selectFinding(undefined)
        return
      }
      const view = VIEWS.find(entry => entry.key === event.key)
      if (view !== undefined) router.push(view.href)
    }

    const onPointer = (event: PointerEvent): void => {
      if (fromPresenter(event.target)) return
      endOpening()
      if (event.pointerType !== 'touch' && mode.current === 'tour') setPresentation('off')
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [endOpening, presenter, router, selectAgent, selectFinding, setPresentation])

  useEffect(() => {
    if (presentation !== 'tour' || opening === 'playing') return undefined
    const timer = setTimeout(presenter.nextView, TOUR_STEP_MS)
    return () => clearTimeout(timer)
  }, [opening, pathname, presentation, presenter])

  // The link's sequence starts once, after the roster lands, so the cold open's claim has its facts.
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || roster === undefined) return
    asked.current = true
    const wanted = new URLSearchParams(window.location.search).get(PRESENT_PARAM)
    if (wanted === 'open') presenter.openCold()
    else if (wanted === 'tour') presenter.toggleTour()
    else if (wanted === 'focus') presenter.toggleFocus()
  }, [presenter, roster])

  return presenter
}
