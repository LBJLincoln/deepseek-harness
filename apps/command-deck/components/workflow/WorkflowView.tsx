'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { clock, duration, stamp } from '@/deck/format'
import { layoutWorkflow } from '@/deck/layout-workflow'
import { usePlayback } from '@/deck/playback'
import { eventsUpTo, useDeck } from '@/deck/store'
import { EventFeed } from '@/components/shell/EventFeed'
import { ReplayNotice } from '@/components/shell/ReplayNotice'
import { PlaybackControls } from './PlaybackControls.tsx'
import styles from './workflow.module.css'

// three.js reaches for a WebGL context on mount, so the scene never renders on
// the server; the rest of the view is ordinary React and does.
const WorkflowStage = dynamic(
  async () => (await import('./WorkflowStage')).WorkflowStage,
  { ssr: false, loading: () => <div className="loading">tracing the run's sessions…</div> },
)

/** How many of a session's own events the selected card lists. */
const CARD_EVENTS = 10

/**
 * The Workflow view: the run's session graph on the left, the selected session
 * and the playback transport on the right.
 * @returns The view.
 */
export function WorkflowView(): ReactNode {
  const roster = useDeck(state => state.roster)
  const runs = useDeck(state => state.runs)
  const selectedRunId = useDeck(state => state.selectedRunId)
  const selectRun = useDeck(state => state.selectRun)
  const events = useDeck(state => state.events)
  const cursor = useDeck(state => state.cursor)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [hovered, setHovered] = useState<string | undefined>(undefined)
  const playback = usePlayback()

  const agents = useMemo(
    () => new Map((roster?.agents ?? []).map(agent => [agent.id, agent])),
    [roster],
  )
  const visible = useMemo(() => eventsUpTo(events, cursor), [events, cursor])
  const graph = useMemo(() => layoutWorkflow(visible, agents), [visible, agents])
  const run = runs.find(entry => entry.id === selectedRunId)

  const card = selected === undefined ? undefined : graph.byId.get(selected)
  const own = useMemo(
    () => (selected === undefined ? [] : visible.filter(event => event.sessionId === selected)),
    [visible, selected],
  )

  return (
    <div className="view view--split">
      <div className="stage">
        <WorkflowStage
          graph={graph}
          selected={selected}
          hovered={hovered}
          onHover={setHovered}
          onSelect={setSelected}
        />

        <div className="stage__overlay">
          <div className="stage__title">
            <h1>{run?.name ?? 'Workflow'}</h1>
            <p>
              Every session the run opened, tiered by who started whom. An edge grows as its session
              first reports, a ring seals a certified one, and the strands into integration are its merges.
            </p>
          </div>
          <span className="hint">
            {graph.nodes.length} sessions · {graph.edges.length} edges · {graph.certificates} certificates
            {' · '}{graph.merges} merges
          </span>
        </div>
      </div>

      <aside className="panel">
        <div className="panel__head">
          <div className="panel__eyebrow">Run</div>
          <select
            className="input"
            value={selectedRunId ?? ''}
            onChange={event => selectRun(event.target.value)}
            aria-label="Run"
          >
            {runs.map(entry => (
              <option key={entry.id} value={entry.id}>{entry.kind} — {entry.name}</option>
            ))}
          </select>
          <p className="panel__sub" style={{ marginTop: 8 }}>
            {run === undefined ? '—' : `${run.status} · ${duration(run.startedAt, run.endedAt)} · ${stamp(run.startedAt)}`}
          </p>
        </div>

        <div className="panel__body">
          <ReplayNotice />

          <div className="section">
            <h3>Playback</h3>
            <PlaybackControls playback={playback} />
            <p style={{ margin: '7px 0 0', fontSize: 11, color: 'var(--ink-3)' }}>
              {visible.length} of {events.length} events admitted · space plays, [ and ] step the speed
            </p>
          </div>

          <div className="section">
            <h3>Sessions</h3>
            <div className={styles.sessions}>
              {graph.nodes.map(node => (
                <button
                  key={node.id}
                  type="button"
                  className={styles.session}
                  style={{ '--tone': node.color } as CSSProperties}
                  data-selected={node.id === selected}
                  onClick={() => setSelected(node.id === selected ? undefined : node.id)}
                >
                  <i className={styles.sessionDot} />
                  {node.label}
                  {node.integration ? <span className={styles.seal} data-tone="integration">integration</span> : null}
                  {node.certificates > 0 ? <span className={styles.seal}>sealed</span> : null}
                  {node.refusals > 0 ? <span className={styles.seal} data-tone="refused">refused</span> : null}
                  <span className={styles.sessionCount}>{node.events}</span>
                </button>
              ))}
            </div>
          </div>

          {card === undefined ? null : (
            <div className="section">
              <h3>Session</h3>
              <div className="card">
                <div className="card__head">
                  <h4>{card.label}</h4>
                  <button type="button" className="btn finding-card__close" onClick={() => setSelected(undefined)}>
                    Close
                  </button>
                </div>
                <dl className="field">
                  <dt>Session</dt>
                  <dd className="mono">{card.id}</dd>
                  <dt>Tier</dt>
                  <dd>{card.integration ? 'integration' : `tier ${card.tier + 1}`}</dd>
                  <dt>Events</dt>
                  <dd>{card.events}</dd>
                  <dt>Seals</dt>
                  <dd>
                    {card.certificates} certificates · {card.merges} merges · {card.refusals} refusals
                  </dd>
                  <dt>Last</dt>
                  <dd>
                    {card.lastLabel === undefined
                      ? 'nothing admitted yet'
                      : `${card.lastLabel} · ${Number.isNaN(card.lastMs) ? '--:--:--' : clock(new Date(card.lastMs).toISOString())}`}
                  </dd>
                </dl>
              </div>

              <div className="section">
                <h3>Its last {CARD_EVENTS} events</h3>
                <EventFeed events={own} agents={agents} limit={CARD_EVENTS} />
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
