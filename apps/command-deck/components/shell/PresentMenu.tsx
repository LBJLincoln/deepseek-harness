'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Presenter } from './usePresentation.ts'

/** One entry of the menu: what it starts, what that is, and the key that also starts it. */
interface Item {
  label: string
  note: string
  shortcut: string
  run: () => void
}

/**
 * The header's Present control: the deck's showpieces as a menu, each beside
 * the key that also starts it, so a presenter who forgets the keys, and a
 * viewer on a touch screen, can start them.
 *
 * The control carries `data-presenter`, like the tour's own controls, so a
 * press on it does not end the sequence it is starting.
 * @param props - The presentation actions, the presentation mode the deck is
 * in, and whether the view on screen has findings to tour.
 * @returns The button and, while open, its menu.
 */
export function PresentMenu({
  presenter,
  mode,
  findings,
}: {
  presenter: Presenter
  mode: 'off' | 'focus' | 'tour'
  findings: boolean
}): ReactNode {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target instanceof Node && root.current?.contains(event.target) === true)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items: Item[] = [
    { label: 'Cold open', note: 'the enterprise assembles, about 18 s', shortcut: 'O', run: presenter.openCold },
    mode === 'tour'
      ? { label: 'End the tour', note: 'back to the working deck', shortcut: 'P', run: presenter.toggleTour }
      : { label: 'Guided tour', note: 'every view, 30 s each', shortcut: 'P', run: presenter.toggleTour },
    mode === 'focus'
      ? { label: 'Leave focus', note: 'the panel comes back', shortcut: 'F', run: presenter.toggleFocus }
      : { label: 'Focus', note: 'the stage takes the whole frame', shortcut: 'F', run: presenter.toggleFocus },
    ...findings ? [{ label: 'Findings tour', note: 'the twelve worst findings, worst first', shortcut: 'G', run: presenter.startFindings }] : [],
  ]

  return (
    <div className="present" ref={root} data-presenter>
      <button
        type="button"
        className="present__button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
      >
        Present
      </button>
      {open ? (
        <div className="present__menu" role="menu" aria-label="Present">
          {items.map(item => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                item.run()
              }}
            >
              <span>
                {item.label}
                <small>{item.note}</small>
              </span>
              <kbd>{item.shortcut}</kbd>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
