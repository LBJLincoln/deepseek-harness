'use client'

import Link from 'next/link'
import { useViewPathname } from './pathname.ts'
import { useEffect, type ReactNode } from 'react'
import { useDeck } from '@/deck/store'
import { Opening } from './Opening.tsx'
import { RollingNumber } from './RollingNumber.tsx'
import { TitleCard } from './TitleCard.tsx'
import { useEventRate } from './rate.ts'
import { usePresentation } from './usePresentation.ts'
import { VIEWS } from './views.ts'

/**
 * The persistent frame around every view: header, status footer, global
 * keyboard shortcuts, and the one call that boots the feed.
 *
 * `data-presentation` on the root carries the mode the whole layout answers to:
 * in `focus` and `tour` the panel goes and the stage takes the frame. The view
 * itself is keyed on the route so each navigation replays the dissolve that
 * covers the cut. `data-opening` carries the cold open, which holds the tour's
 * own title card back while the enterprise assembles.
 * @param props - The routed page to frame.
 * @returns The shell.
 */
export function DeckShell({ children }: { children: ReactNode }): ReactNode {
  const pathname = useViewPathname()
  const boot = useDeck(state => state.boot)
  const source = useDeck(state => state.source)
  const streamState = useDeck(state => state.streamState)
  const roster = useDeck(state => state.roster)
  const runs = useDeck(state => state.runs)
  const selectedRunId = useDeck(state => state.selectedRunId)
  const error = useDeck(state => state.error)
  const presentation = useDeck(state => state.presentation)
  const qualityTier = useDeck(state => state.qualityTier)
  const qualityPinned = useDeck(state => state.qualityPinned)
  const opening = useDeck(state => state.opening)
  const rate = useEventRate()

  useEffect(() => { void boot() }, [boot])
  usePresentation()

  const mode = source?.mode ?? 'probing'
  const certifiedToday = roster?.agents.filter(agent => agent.status === 'certified').length
  const run = runs.find(entry => entry.id === selectedRunId)

  return (
    <div className="deck" data-presentation={presentation} data-opening={opening}>
      <header className="deck__header">
        <div className="deck__mark">
          <b>Daliesk</b>
          <span>Command Deck</span>
        </div>

        <nav className="deck__nav">
          {VIEWS.map(view => (
            <Link key={view.href} href={view.href} data-active={pathname === view.href}>
              {view.label}
              <kbd>{view.key}</kbd>
            </Link>
          ))}
        </nav>

        <div className="deck__spacer" />

        <div className="deck__counts">
          <div className="count">
            <b><RollingNumber value={roster?.counts.defined} /></b>
            <span>defined</span>
          </div>
          <div className="count" data-tone="active">
            <b><RollingNumber value={roster?.counts.active} /></b>
            <span>active</span>
          </div>
          <div className="count" data-tone="certified">
            <b><RollingNumber value={certifiedToday} /></b>
            <span>certified today</span>
          </div>
        </div>

        <span className="badge" data-mode={mode}>
          <i className="badge__dot" />
          {mode === 'probing' ? 'connecting' : mode}
        </span>
      </header>

      <main className="deck__main">
        <div className="deck__view" key={pathname}>
          {children}
          <i className="deck__veil" />
        </div>
        <TitleCard />
        <Opening />
      </main>

      <footer className="deck__footer">
        <span>feed <b>{source?.configured ?? '…'}</b></span>
        <span>·</span>
        <span>stream <b>{streamState}</b></span>
        <span>·</span>
        <span>run <b className="deck__run">{run?.name ?? '—'}</b></span>
        <span>·</span>
        <span><b>{rate ?? '—'}</b> events/min</span>
        <span>·</span>
        <span>quality <b>{qualityPinned ? 'pinned' : 'auto'} · {qualityTier}</b></span>
        {source?.mode === 'replay' ? (
          <>
            <span>·</span>
            <span>replaying committed fixtures{source.reason === undefined ? '' : ` — ${source.reason}`}</span>
          </>
        ) : null}
        {error === undefined ? null : (
          <>
            <span>·</span>
            <span style={{ color: 'var(--red)' }}>{error}</span>
          </>
        )}
        <span className="deck__spacer" />
        {presentation === 'off' ? null : (
          <span className="deck__mode" data-mode={presentation}>{presentation}</span>
        )}
        <span>1 / 2 / 3 / 4 views · o open · f focus · p tour · esc deselect</span>
      </footer>
    </div>
  )
}
