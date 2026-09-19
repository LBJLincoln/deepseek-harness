'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import type { Agent, RunEvent } from '@/lib/contract'
import { clock } from '@/lib/format'

/**
 * The run's event stream as a reverse-chronological list.
 * @param props - The events to show, an optional agent index for attribution,
 * and whether the list should scroll itself to the newest frame.
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

  useEffect(() => {
    if (!follow) return
    top.current?.scrollIntoView({ block: 'nearest' })
  }, [follow, newest])

  if (events.length === 0) {
    return <div className="panel__empty">No events yet on this run.</div>
  }

  const shown = events.slice(-limit).reverse()

  return (
    <div className="feed">
      <div ref={top} />
      {shown.map(event => (
        <div className="feed__row" key={`${event.seq}-${event.agentId}`} data-kind={event.kind}>
          <time>{clock(event.ts)}</time>
          <div>
            <div className="feed__label">{event.label}</div>
            {event.detail === undefined ? null : <div className="feed__detail">{event.detail}</div>}
            <div className="feed__who">
              {agents?.get(event.agentId)?.name ?? event.agentId}
              {event.file === undefined ? '' : ` · ${event.file}${event.line === undefined ? '' : `:${event.line}`}`}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
