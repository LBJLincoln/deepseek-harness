'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Agent, RunEvent } from '@/deck/contract'
import { clock } from '@/deck/format'

/** Kinds that arrive in bursts, hundreds to a run, and fold into one row each run of them. */
const BURST_KINDS: ReadonlySet<RunEvent['kind']> = new Set(['tool', 'step'])

/** How many of a burst's labels its row names before it says how many more there are. */
const BURST_NAMES = 3

/** One row of the feed: a single event, or a run of consecutive tool calls and steps. */
type Row =
  | { kind: 'event'; event: RunEvent }
  | { kind: 'burst'; events: RunEvent[] }

/**
 * Group the newest events into rows, newest first, until `limit` rows are
 * filled: consecutive tool calls and steps fold into one burst row unless
 * every event is asked for.
 * @param events - The events, oldest first.
 * @param limit - How many rows to fill.
 * @param verbose - Whether every event keeps its own row.
 * @returns The rows, newest first.
 */
function rowsOf(events: readonly RunEvent[], limit: number, verbose: boolean): Row[] {
  const rows: Row[] = []
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event === undefined) continue
    const last = rows.at(-1)
    if (!verbose && BURST_KINDS.has(event.kind) && last?.kind === 'burst') {
      last.events.push(event)
      continue
    }
    if (rows.length >= limit) break
    rows.push(!verbose && BURST_KINDS.has(event.kind) ? { kind: 'burst', events: [event] } : { kind: 'event', event })
  }
  return rows
}

/**
 * A burst's one line: its most frequent labels with their counts.
 * @param events - The burst's events.
 * @returns For example `read 5 · steps 4 · bash 4 · 3 more`.
 */
function burstLine(events: readonly RunEvent[]): string {
  const counts = new Map<string, number>()
  for (const event of events) {
    // A step or turn logs its start and its end; the line counts each once, by its end.
    if (event.kind === 'step' && !/ended$/.test(event.label)) continue
    const label = event.kind === 'step' ? (event.label.startsWith('Turn') ? 'turns' : 'steps') : event.label
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1])
  const named = ranked.slice(0, BURST_NAMES).map(([label, count]) => `${label} ${count}`)
  const rest = ranked.slice(BURST_NAMES).reduce((total, [, count]) => total + count, 0)
  return named.length === 0 ? `${events.length} steps starting` : [...named, ...rest === 0 ? [] : [`${rest} more`]].join(' · ')
}

/**
 * Who acted in a set of events.
 * @param events - The events.
 * @param agents - The roster index, for seat names.
 * @returns The seats' names, or `no seat`.
 */
function whoOf(events: readonly RunEvent[], agents: Map<string, Agent> | undefined): string {
  const names = [...new Set(events.map(event => (event.agentId === undefined ? 'no seat' : agents?.get(event.agentId)?.name ?? event.agentId)))]
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/**
 * The run's event stream as a reverse-chronological list.
 *
 * The stream is mostly tool calls and steps, so each run of them folds into
 * one row that names its most frequent calls; `Show every step` gives each its
 * own row again. A certificate's row reads the line the feed composed from its
 * checks, with the certificate's record behind a disclosure.
 * @param props - The events to show, an optional agent index for attribution,
 * whether the list should scroll itself to the newest frame, and how many rows
 * to show.
 * @returns The feed.
 */
export function EventFeed({
  events,
  agents,
  follow = false,
  limit = 60,
}: {
  events: readonly RunEvent[]
  agents?: Map<string, Agent>
  follow?: boolean
  limit?: number
}): ReactNode {
  const top = useRef<HTMLDivElement>(null)
  const newest = events.at(-1)?.seq
  const [verbose, setVerbose] = useState(false)

  // Following scrolls the panel, never the page: on a phone the panel is part of
  // the page's own scroll, and a feed that pulled the page down would take the
  // viewer away from the stage on every new frame.
  useEffect(() => {
    const anchor = top.current
    if (!follow || anchor === null) return
    const scroller = anchor.closest('.panel__body')
    if (!(scroller instanceof HTMLElement) || getComputedStyle(scroller).overflowY === 'visible') return
    anchor.scrollIntoView({ block: 'nearest' })
  }, [follow, newest])

  if (events.length === 0) {
    return <div className="panel__empty">No events yet on this run.</div>
  }

  const rows = rowsOf(events, limit, verbose)

  return (
    <div className="feed">
      <div ref={top} />
      <label className="feed__toggle">
        <input type="checkbox" checked={verbose} onChange={event => setVerbose(event.target.checked)} />
        Show every step
      </label>
      {rows.map((row) => {
        if (row.kind === 'burst' && row.events.length > 1) {
          const first = row.events.at(-1)
          const last = row.events[0]
          return (
            <div className="feed__row" key={`burst-${last?.sessionId}-${last?.seq}`} data-kind="burst">
              <time>{last === undefined ? '' : clock(last.ts)}</time>
              <div>
                <div className="feed__label">{row.events.length} tool calls and steps</div>
                <div className="feed__detail">{burstLine(row.events)}</div>
                <div className="feed__who">
                  {whoOf(row.events, agents)}
                  {first === undefined ? '' : ` · since ${clock(first.ts)}`}
                </div>
              </div>
            </div>
          )
        }
        const event = row.kind === 'burst' ? row.events[0] : row.event
        if (event === undefined) return null
        return (
          <div className="feed__row" key={`${event.sessionId}-${event.seq}`} data-kind={event.kind}>
            <time>{clock(event.ts)}</time>
            <div>
              <div className="feed__label">{event.label}</div>
              {event.detail === undefined ? null : event.kind === 'certificate' ? (
                <details className="feed__raw">
                  <summary>the certificate&apos;s record</summary>
                  <pre>{event.detail}</pre>
                </details>
              ) : <div className="feed__detail">{event.detail}</div>}
              <div className="feed__who">
                {whoOf([event], agents)}
                {event.file === undefined ? '' : ` · ${event.file}${event.line === undefined ? '' : `:${event.line}`}`}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
