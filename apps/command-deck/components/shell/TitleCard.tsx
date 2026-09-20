'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { layoutWorkflow } from '@/deck/layout-workflow'
import { usePrefersReducedMotion } from '@/deck/motion'
import { eventsUpTo, useDeck } from '@/deck/store'
import { kinetic } from './kinetic.tsx'
import { VIEWS } from './views.ts'

/** How long a card holds before it fades back off the view. */
const HOLD_MS = 5_200

/** Small counts read better spelled out than as digits at this size. */
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

/**
 * Spell a small count.
 * @param count - The number to name.
 * @returns The English word, or the digits when there is no word for it.
 */
function spell(count: number): string {
  return WORDS[count] ?? String(count)
}

/** What one card announces: a name, and up to two lines of fact under it. */
interface Card {
  title: string
  lines: string[]
}

/**
 * Compose the card for the view on screen out of what the deck has actually
 * read.
 *
 * Every line is counted from the feed's own payloads, and a line whose data has
 * not arrived is left out rather than filled with a placeholder, so the card
 * never claims more than the deck knows.
 * @param pathname - The route on screen.
 * @returns The card to draw.
 */
function useCard(pathname: string): Card {
  const roster = useDeck(state => state.roster)
  const runs = useDeck(state => state.runs)
  const selectedRunId = useDeck(state => state.selectedRunId)
  const events = useDeck(state => state.events)
  const cursor = useDeck(state => state.cursor)
  const safety = useDeck(state => state.safety)

  const workflow = useMemo(() => {
    if (pathname !== '/workflow') return undefined
    const agents = new Map((roster?.agents ?? []).map(agent => [agent.id, agent]))
    return layoutWorkflow(eventsUpTo(events, cursor), agents)
  }, [pathname, roster, events, cursor])

  if (pathname === '/workflow') {
    if (workflow === undefined || workflow.nodes.length === 0) return { title: 'Workflow', lines: [] }
    return {
      title: 'Workflow',
      lines: [
        `${spell(workflow.nodes.length)} sessions, ${workflow.edges.length} edges between them`,
        `${workflow.certificates} certificates, ${spell(workflow.merges)} merges`,
      ],
    }
  }

  if (pathname === '/process') {
    const run = runs.find(entry => entry.id === selectedRunId)
    if (run === undefined) return { title: 'Process', lines: [] }
    return {
      title: 'Process',
      lines: [run.name, `${events.length} events received, ${run.status}`],
    }
  }

  if (pathname === '/safety') {
    if (safety === undefined) return { title: 'Code safety', lines: [] }
    const certified = safety.certificate.verified ? 'certified' : 'not certified'
    return {
      title: 'Code safety',
      lines: [safety.target.name, `${safety.findings.length} findings, ${certified}`],
    }
  }

  if (roster === undefined) return { title: 'Enterprise', lines: [] }
  return {
    title: 'Enterprise',
    lines: [
      `${roster.counts.defined} agents, ${spell(roster.divisions.length)} divisions`,
      `${roster.edges.length} relationships between them`,
    ],
  }
}

/**
 * The tour's announcement of the view it has just moved to.
 *
 * It is drawn only while the tour runs, holds for {@link HOLD_MS}, then fades
 * out and leaves the view alone for the rest of the step. Under
 * `prefers-reduced-motion` the title is one plain run of text and the card cuts
 * in and out instead of animating.
 * @returns The card, or nothing when no tour is running.
 */
export function TitleCard(): ReactNode {
  const pathname = usePathname()
  const presentation = useDeck(state => state.presentation)
  const reduced = usePrefersReducedMotion()
  const card = useCard(pathname)
  const [held, setHeld] = useState(true)

  useEffect(() => {
    if (presentation !== 'tour') return
    setHeld(true)
    const timer = setTimeout(() => setHeld(false), HOLD_MS)
    return () => clearTimeout(timer)
  }, [pathname, presentation])

  if (presentation !== 'tour') return null

  const view = VIEWS.find(entry => entry.href === pathname)

  return (
    <div className="title-card" data-state={held ? 'in' : 'out'}>
      <div className="title-card__inner" key={pathname}>
        <div className="title-card__eyebrow">
          Daliesk Command Deck
          {view === undefined ? '' : ` · view ${view.key} of ${VIEWS.length}`}
        </div>
        <h2 className="title-card__title">{reduced ? card.title : kinetic(card.title)}</h2>
        {card.lines.map((line, index) => (
          <p className="title-card__line" key={line} style={{ '--i': index } as CSSProperties}>
            {line}
          </p>
        ))}
      </div>
    </div>
  )
}
