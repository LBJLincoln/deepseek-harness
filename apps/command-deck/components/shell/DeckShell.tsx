'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useDeck } from '@/deck/store'
import { RollingNumber } from './RollingNumber.tsx'
import { useEventRate } from './rate.ts'
import { VIEWS } from './views.ts'

/**
 * The persistent frame around every view: header, status footer, global
 * keyboard shortcuts, and the one call that boots the feed.
 * @param props - The routed page to frame.
 * @returns The shell.
 */
export function DeckShell({ children }: { children: ReactNode }): ReactNode {
  const router = useRouter()
  const pathname = usePathname()
  const boot = useDeck(state => state.boot)
  const source = useDeck(state => state.source)
  const streamState = useDeck(state => state.streamState)
  const roster = useDeck(state => state.roster)
  const runs = useDeck(state => state.runs)
  const selectedRunId = useDeck(state => state.selectedRunId)
  const error = useDeck(state => state.error)
  const selectAgent = useDeck(state => state.selectAgent)
  const rate = useEventRate()

  useEffect(() => { void boot() }, [boot])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === 'Escape') {
        selectAgent(undefined)
        return
      }
      const view = VIEWS.find(entry => entry.key === event.key)
      if (view !== undefined) router.push(view.href)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router, selectAgent])

  const mode = source?.mode ?? 'probing'
  const certifiedToday = roster?.agents.filter(agent => agent.status === 'certified').length
  const run = runs.find(entry => entry.id === selectedRunId)

  return (
    <div className="deck">
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

      <main className="deck__main">{children}</main>

      <footer className="deck__footer">
        <span>feed <b>{source?.configured ?? '…'}</b></span>
        <span>·</span>
        <span>stream <b>{streamState}</b></span>
        <span>·</span>
        <span>run <b className="deck__run">{run?.name ?? '—'}</b></span>
        <span>·</span>
        <span><b>{rate ?? '—'}</b> events/min</span>
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
        <span>1 / 2 / 3 views · esc deselect</span>
      </footer>
    </div>
  )
}
