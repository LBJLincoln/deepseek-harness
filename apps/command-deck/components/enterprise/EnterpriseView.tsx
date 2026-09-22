'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState, type ReactNode } from 'react'
import type { Agent, UnattributedReason } from '@/deck/contract'
import { stamp } from '@/deck/format'
import { divisionColor } from '@/deck/palette'
import { useDeck } from '@/deck/store'
import { EventFeed } from '@/components/shell/EventFeed'
import { ReplayNotice } from '@/components/shell/ReplayNotice'
import { isOccupied, NEVER_RUN, routelessSessions, routeRows, UNATTRIBUTED_REASON_TEXT } from './evidence.ts'
import { RecordPanel } from './RecordPanel.tsx'

// three.js reaches for a WebGL context on mount, so the scene never renders on
// the server; the rest of the view is ordinary React and does.
const EnterpriseStage = dynamic(
  async () => (await import('./EnterpriseStage')).EnterpriseStage,
  { ssr: false, loading: () => <div className="loading">composing the enterprise…</div> },
)

/** Which tab the panel shows while no seat is selected. */
type Tab = 'enterprise' | 'record'

/**
 * The detail panel for one selected seat: its definition, and what the
 * recorded sessions show of it.
 * @param props - The seat to describe.
 * @returns The panel body.
 */
function AgentPanel({ agent }: { agent: Agent }): ReactNode {
  const roster = useDeck(state => state.roster)
  const events = useDeck(state => state.events)
  const division = roster?.divisions.find(entry => entry.id === agent.division)
  const recent = useMemo(
    () => events.filter(event => event.agentId === agent.id),
    [events, agent.id],
  )
  const ranOnRoute = agent.evidence.routesSeen.includes(agent.route.provider)

  return (
    <>
      <div className="panel__head">
        <div className="panel__eyebrow" style={{ color: divisionColor(agent.division) }}>
          {division?.name ?? agent.division}
          {agent.department === undefined ? '' : ` · ${agent.department}`}
        </div>
        <h2 className="panel__title">{agent.name}</h2>
        <p className="panel__sub">{agent.role}{isOccupied(agent) ? '' : ` · ${NEVER_RUN}`}</p>
      </div>

      <div className="panel__body">
        <dl style={{ margin: 0 }}>
          <div className="field">
            <dt>Status</dt>
            <dd><span className="status-tag" data-status={agent.status}>{agent.status}</span></dd>
          </div>
          <div className="field">
            <dt>Sessions</dt>
            <dd>
              {isOccupied(agent)
                ? `${agent.evidence.sessions} recorded, last ${agent.evidence.lastSeen === undefined ? '—' : stamp(agent.evidence.lastSeen)}`
                : 'none: no recorded session did this seat\'s work'}
            </dd>
          </div>
          <div className="field">
            <dt>Route</dt>
            <dd className="mono">
              {agent.route.provider} / {agent.route.model}
              <span className="evidence-note">
                {ranOnRoute ? 'defined, and run on' : isOccupied(agent) ? 'defined; its sessions ran elsewhere' : NEVER_RUN}
              </span>
            </dd>
          </div>
          <div className="field">
            <dt>Ran on</dt>
            <dd className="mono">{agent.evidence.routesSeen.length === 0 ? '—' : agent.evidence.routesSeen.join(', ')}</dd>
          </div>
          <div className="field">
            <dt>Preset</dt>
            <dd className="mono">{agent.preset}</dd>
          </div>
          <div className="field">
            <dt>Source</dt>
            <dd className="mono">{agent.source}</dd>
          </div>
        </dl>

        <div className="section">
          <h3>Skills</h3>
          <div className="chips">
            {agent.skills.map(skill => <span className="chip" data-tone="skill" key={skill}>{skill}</span>)}
          </div>
        </div>

        <div className="section">
          <h3>Tools</h3>
          <div className="chips">
            {agent.tools.map(tool => <span className="chip" data-tone="tool" key={tool}>{tool}</span>)}
          </div>
        </div>

        <div className="section">
          <h3>Recent events</h3>
          {recent.length === 0
            ? <div className="panel__empty">This seat has not acted in the run being followed.</div>
            : <EventFeed events={recent} limit={14} />}
        </div>
      </div>
    </>
  )
}

/**
 * The Enterprise tab: the seats defined and occupied, the routes the recorded
 * sessions ran on, the sessions no seat holds, the divisions, and the run's
 * live stream.
 * @returns The tab body.
 */
function OverviewPanel(): ReactNode {
  const roster = useDeck(state => state.roster)
  const events = useDeck(state => state.events)
  const runs = useDeck(state => state.runs)
  const selectedRunId = useDeck(state => state.selectedRunId)
  const agentIndex = useMemo(
    () => new Map((roster?.agents ?? []).map(agent => [agent.id, agent])),
    [roster],
  )
  const run = runs.find(entry => entry.id === selectedRunId)

  const perDivision = useMemo(() => {
    const counts = new Map<string, { defined: number; occupied: number }>()
    for (const agent of roster?.agents ?? []) {
      const entry = counts.get(agent.division) ?? { defined: 0, occupied: 0 }
      entry.defined += 1
      if (isOccupied(agent)) entry.occupied += 1
      counts.set(agent.division, entry)
    }
    return counts
  }, [roster])
  const routes = useMemo(() => (roster === undefined ? [] : routeRows(roster)), [roster])
  const reasons = useMemo(
    () => (Object.entries(roster?.unattributed.reasons ?? {}) as [UnattributedReason, number][]).filter(([, count]) => count > 0),
    [roster],
  )

  return (
    <div className="panel__body">
      <ReplayNotice />

      <div className="section">
        <h3>Routes, by sessions recorded</h3>
        <div className="routes">
          {routes.map(route => (
            <div className="routes__row" key={route.provider} data-run={route.sessions > 0}>
              <span className="mono">{route.provider}</span>
              <b>{route.sessions}</b>
              <span>
                sessions
                {route.seats === 0
                  ? ' · no seat defined for it'
                  : route.sessions > 0 ? ` · ${route.seats} seats defined for it` : ` · defined for ${route.seats} seats, never run`}
              </span>
            </div>
          ))}
          {roster === undefined ? null : (
            <div className="routes__row" data-run="false">
              <span className="mono">no model request</span>
              <b>{routelessSessions(roster)}</b>
              <span>sessions</span>
            </div>
          )}
        </div>
      </div>

      {roster === undefined || roster.unattributed.sessions === 0 ? null : (
        <div className="section">
          <h3>Sessions no seat holds</h3>
          <p className="evidence-lead">
            {roster.unattributed.sessions} of {roster.evidence.sessions} recorded sessions are attributed to no seat, and light none:
          </p>
          <div className="routes routes--reasons">
            {reasons.map(([reason, count]) => (
              <div className="routes__row" key={reason} data-run="true">
                <b>{count}</b>
                <span>{UNATTRIBUTED_REASON_TEXT[reason]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <h3>Divisions · occupied of defined</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {(roster?.divisions ?? []).map((division) => {
            const counts = perDivision.get(division.id) ?? { defined: 0, occupied: 0 }
            return (
              <div key={division.id} style={{ display: 'flex', gap: 9, opacity: counts.occupied === 0 ? 0.62 : 1 }}>
                <i
                  style={{
                    width: 3,
                    borderRadius: 3,
                    background: divisionColor(division.id),
                    flex: '0 0 3px',
                    boxShadow: counts.occupied === 0 ? 'none' : `0 0 10px ${divisionColor(division.id)}`,
                  }}
                />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ink)' }}>
                    {division.name}
                    <span style={{ color: 'var(--ink-3)', marginLeft: 7, fontSize: 10.5 }}>
                      {counts.occupied} / {counts.defined}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.45 }}>{division.purpose}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="section">
        <h3>Live activity</h3>
        {run === undefined ? null : (
          <p style={{ margin: '-3px 0 9px', fontSize: 11, color: 'var(--ink-2)' }}>{run.name}</p>
        )}
        <EventFeed events={events} agents={agentIndex} follow limit={40} />
      </div>
    </div>
  )
}

/**
 * The panel shown when nothing is selected: the headline the roster's evidence
 * supports, then the Enterprise and Record tabs.
 * @returns The panel.
 */
function UnselectedPanel(): ReactNode {
  const roster = useDeck(state => state.roster)
  const [tab, setTab] = useState<Tab>('enterprise')

  return (
    <>
      <div className="panel__head">
        <div className="panel__eyebrow">Enterprise</div>
        <h2 className="panel__title">
          {roster?.counts.defined ?? 0} seats defined · {roster?.counts.occupied ?? 0} occupied by recorded sessions
        </h2>
        <p className="panel__sub">
          A seat is occupied when a recorded session did its work; the rest are definitions no session has run.
          Click a node to open a seat; Esc clears the selection.
        </p>
      </div>

      <div className="tabs">
        <button type="button" data-active={tab === 'enterprise'} onClick={() => setTab('enterprise')}>Enterprise</button>
        <button type="button" data-active={tab === 'record'} onClick={() => setTab('record')}>Record</button>
      </div>

      {tab === 'enterprise' ? <OverviewPanel /> : (
        <div className="panel__body">
          <ReplayNotice />
          <RecordPanel />
        </div>
      )}
    </>
  )
}

/**
 * The Enterprise view: the graph on the left, the panel on the right.
 * @returns The view.
 */
export function EnterpriseView(): ReactNode {
  const roster = useDeck(state => state.roster)
  const selectedAgentId = useDeck(state => state.selectedAgentId)
  const selected = roster?.agents.find(agent => agent.id === selectedAgentId)

  return (
    <div className="view view--split">
      <div className="stage">
        {roster === undefined
          ? <div className="loading">reading the roster…</div>
          : <EnterpriseStage roster={roster} />}
        <div className="stage__overlay">
          <div className="stage__title">
            <h1>The enterprise on record</h1>
            <p>
              Every defined seat, clustered by division; edges are the delegations, verifications and judgements
              between them. A bright seat is one recorded sessions occupied; a dim one is defined and has never run.
              A pulsing node is acting right now; a ring is a certificate just issued.
            </p>
          </div>
          <span className="hint">drag to orbit · scroll to zoom · click a node</span>
        </div>
      </div>

      <aside className="panel">
        {selected === undefined ? <UnselectedPanel /> : <AgentPanel agent={selected} />}
      </aside>
    </div>
  )
}
