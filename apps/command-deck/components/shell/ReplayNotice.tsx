'use client'

import type { ReactNode } from 'react'
import { useDeck } from '@/lib/store'

/**
 * The standing statement that what is on screen is example data.
 *
 * It is shown inside every view's panel rather than once in the shell, because
 * a screenshot of a single view must carry the claim with it.
 * @returns The notice in replay mode, and nothing when the feed is live.
 */
export function ReplayNotice(): ReactNode {
  const source = useDeck(state => state.source)
  if (source?.mode !== 'replay') return null
  return (
    <div className="notice">
      <b>Example data.</b>
      <span>
        The feed at {source.configured} is not answering, so the deck is replaying the fixtures committed with it.
        Nothing on screen comes from a live run.
      </span>
    </div>
  )
}
