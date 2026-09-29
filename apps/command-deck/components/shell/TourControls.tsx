'use client'

import type { ReactNode } from 'react'
import { FINDINGS_TOUR_LENGTH } from '@/components/safety/useFindingsTour'
import { useDeck } from '@/deck/store'
import { useViewPathname } from './pathname.ts'
import type { Presenter } from './usePresentation.ts'
import { VIEWS } from './views.ts'

/**
 * The bar a running tour shows: where it is, and previous, next and end.
 *
 * A tap on the stage no longer ends a tour on a touch screen, so these are how
 * a touch viewer steers it; a mouse or keyboard presenter can use them too
 * (the arrow keys do the same). The bar carries `data-presenter`, so pressing
 * it does not count as the interruption that ends a tour.
 * @param props - The presentation actions.
 * @returns The bar while the view tour or the findings tour runs, else nothing.
 */
export function TourControls({ presenter }: { presenter: Presenter }): ReactNode {
  const pathname = useViewPathname()
  const presentation = useDeck(state => state.presentation)
  const findingsStop = useDeck(state => state.findingsStop)
  const findings = useDeck(state => state.safety?.findings.length ?? 0)
  const stepFindingsTour = useDeck(state => state.stepFindingsTour)
  const stopFindingsTour = useDeck(state => state.stopFindingsTour)

  if (findingsStop !== undefined) {
    const total = Math.min(FINDINGS_TOUR_LENGTH, findings)
    return (
      <Bar
        label={`Findings tour · ${Math.min(findingsStop + 1, total)} of ${total}`}
        onPrevious={() => stepFindingsTour(-1)}
        onNext={() => stepFindingsTour(1)}
        onEnd={stopFindingsTour}
      />
    )
  }
  if (presentation !== 'tour') return null
  const index = VIEWS.findIndex(view => view.href === pathname)
  return (
    <Bar
      label={`Tour · ${VIEWS[index]?.label ?? 'view'} · ${index + 1} of ${VIEWS.length}`}
      onPrevious={presenter.previousView}
      onNext={presenter.nextView}
      onEnd={presenter.endTour}
    />
  )
}

/**
 * The bar itself.
 * @param props - Where the tour is, and its three actions.
 * @returns The toolbar.
 */
function Bar({
  label,
  onPrevious,
  onNext,
  onEnd,
}: {
  label: string
  onPrevious: () => void
  onNext: () => void
  onEnd: () => void
}): ReactNode {
  return (
    <div className="tour-bar" role="toolbar" aria-label="Tour" data-presenter>
      <button type="button" className="btn" onClick={onPrevious}>‹ Previous</button>
      <span className="tour-bar__where" aria-live="polite">{label}</span>
      <button type="button" className="btn" onClick={onNext}>Next ›</button>
      <button type="button" className="btn" data-variant="primary" onClick={onEnd}>End</button>
    </div>
  )
}
