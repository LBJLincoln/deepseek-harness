'use client'

import Link from 'next/link'
import { useViewPathname } from './pathname.ts'
import { useEffect, type ReactNode } from 'react'
import type { Roster } from '@/deck/contract'
import { formatAge } from '@/deck/ops'
import { useDeck } from '@/deck/store'
import { useOps } from '@/deck/ops-store'
import { useNow } from '@/components/ops/Age'
import { Opening } from './Opening.tsx'
import { PresentMenu } from './PresentMenu.tsx'
import { RollingNumber } from './RollingNumber.tsx'
import { TitleCard } from './TitleCard.tsx'
import { TourControls } from './TourControls.tsx'
import { useEventRate } from './rate.ts'
import { usePresentation } from './usePresentation.ts'
import { VIEWS } from './views.ts'

/**
 * When the roster behind every seat count on screen was stamped, and how old
 * that is by the viewer's clock, so a count read from an old roster says so.
 * @param props - The roster's `generatedAt`.
 * @returns The stamp beside the header's counts.
 */
function RosterStamp({ at }: { at: string }): ReactNode {
  const now = useNow()
  return (
    <div className="count" data-tone="stamp" title={`Every seat count on screen is read from the roster (data/enterprise/roster.json) stamped ${at.slice(0, 19).replace('T', ' ')} UTC; the 24 h counts cover the 24 hours before that stamp`}>
      <b><time dateTime={at}>{at.slice(11, 16)} UTC</time></b>
      <span>{formatAge(Math.max(0, now - Date.parse(at)))} old</span>
    </div>
  )
}

/**
 * The header's seat counts, in order: seats defined, seats occupied by a
 * recorded deliverable, then the active seats of the roster's 24-hour window
 * split by what they did (model-driven, automated checks and, when any, halted
 * before any model ran) in one block, and the seats running now when the live
 * feed says. A roster from before the split shows its active seats unsplit.
 * @param props - The roster's counts.
 * @returns The counts, ahead of the roster's stamp.
 */
function SeatCounts({ counts }: { counts: Roster['counts'] }): ReactNode {
  const work = counts.work?.active
  return (
    <>
      <div className="count" title="Seat definitions in the roster; a definition is not a running agent">
        <b><RollingNumber value={counts.defined} /></b>
        <span>defined</span>
      </div>
      <div className="count" data-tone="occupied" data-zero={counts.occupied === 0} title="Seats a recorded deliverable occupies: a session, a ticket, a gate run, a CI verdict">
        <b><RollingNumber value={counts.occupied} /></b>
        <span>occupied</span>
      </div>
      {work === undefined ? (
        <div className="count" data-tone="active" data-zero={counts.active === 0} title="Seats with a deliverable in the 24 hours before the roster's stamp">
          <b><RollingNumber value={counts.active} /></b>
          <span>active · 24h</span>
        </div>
      ) : (
        <div
          className="count"
          data-tone="split"
          title={`Active seats in the 24 hours before the roster's stamp: ${work.model} model-driven (a session, a ticket, a code-safety review, an intake), ${work.check} automated checks (a verify-* gate, a CI verdict, a fold), ${work.halted} halted before any model ran`}
        >
          <b>
            <i data-zero={work.model === 0}><RollingNumber value={work.model} /></i>
            {' · '}
            <RollingNumber value={work.check} />
            {work.halted === 0 ? null : <>{' · '}<RollingNumber value={work.halted} /></>}
          </b>
          <span>{work.halted === 0 ? 'model · checks · 24h' : 'model · checks · halted · 24h'}</span>
        </div>
      )}
      {counts.running === undefined ? null : (
        <div className="count" data-tone="active" data-zero={counts.running === 0} title="Seats a session is running on at this moment">
          <b><RollingNumber value={counts.running} /></b>
          <span>running now</span>
        </div>
      )}
    </>
  )
}

/**
 * The persistent frame around every view: header with its Present menu,
 * status footer, the tour bar, global keyboard shortcuts, and the one call
 * that boots the feed.
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
  const opsMode = useOps(state => state.reading?.mode)
  const rate = useEventRate()

  useEffect(() => { void boot() }, [boot])
  const presenter = usePresentation()

  // The Operations view reads its own snapshot, so on /ops the badge says which of its modes it is in.
  const onOps = pathname === '/ops'
  const mode = onOps ? (opsMode === undefined ? 'probing' : opsMode === 'live' ? 'live' : 'replay') : source?.mode ?? 'probing'
  const modeName = onOps && opsMode !== undefined ? opsMode : mode === 'probing' ? 'connecting' : mode
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

        <PresentMenu presenter={presenter} mode={presentation} findings={pathname === '/safety'} />

        <div className="deck__spacer" />

        <div className="deck__counts">
          {roster === undefined ? null : <SeatCounts counts={roster.counts} />}
          {roster === undefined ? null : <RosterStamp at={roster.generatedAt} />}
        </div>

        <span className="badge" data-mode={mode}>
          <i className="badge__dot" />
          {modeName}
        </span>
      </header>

      <main className="deck__main">
        <div className="deck__view" key={pathname}>
          {children}
          <i className="deck__veil" />
        </div>
        <TitleCard />
        <Opening />
        <TourControls presenter={presenter} />
      </main>

      <footer className="deck__footer">
        {/* The Operations view is shown to clients; it names its mode, never the feed's address. */}
        {onOps ? null : (
          <>
            <span>feed <b>{source?.configured ?? '…'}</b></span>
            <span>·</span>
          </>
        )}
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
            <span>replay{source.reason === undefined ? '' : ` — ${source.reason}`}</span>
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
        <span className="deck__keys">1–{VIEWS.length} views · O open · F focus · P tour{pathname === '/safety' ? ' · G findings' : ''} · Esc deselect</span>
      </footer>
    </div>
  )
}
