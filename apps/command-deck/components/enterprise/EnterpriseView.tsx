'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState, type ReactNode } from 'react'
import type { Agent, Roster, UnattributedReason, WorkCounts } from '@/deck/contract'
import { displayName } from '@/deck/display-name'
import { stamp } from '@/deck/format'
import { divisionColor } from '@/deck/palette'
import { useDeck } from '@/deck/store'
import { EventFeed } from '@/components/shell/EventFeed'
import { ReplayNotice } from '@/components/shell/ReplayNotice'
import { WebGLGate } from '@/components/three/WebGLGate'
import { formatAge } from '@/deck/ops'
import { useNow } from '@/components/ops/Age'
import { deliverables, isOccupied, ledgerLines, NEVER_RUN, outcomePhrases, routelessSessions, routeRows, UNATTRIBUTED_REASON_TEXT, WORK_TEXT, workPhrase } from './evidence.ts'
import { DayPanel } from './DayPanel.tsx'
import { LedgerPanel } from './LedgerPanel.tsx'
import { RecordPanel } from './RecordPanel.tsx'

// three.js reaches for a WebGL context on mount, so the scene never renders on
// the server, and mounts behind a WebGLGate in the browser; the rest of the view
// is ordinary React and renders everywhere.
const EnterpriseStage = dynamic(
  async () => (await import('./EnterpriseStage')).EnterpriseStage,
  { ssr: false, loading: () => <div className="loading">composing the enterprise…</div> },
)

/** Which tab the panel shows while no seat is selected. */
type Tab = 'enterprise' | 'day' | 'ledger' | 'record'

/** One division's seats as the Enterprise tab counts them from the roster; `work` splits its active seats and is absent when none is. */
interface DivisionCounts {
  defined: number
  occupied: number
  active: number
  work?: WorkCounts
}

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
        <p className="panel__sub">{agent.role} · {deliverables(agent)}</p>
      </div>

      <div className="panel__body">
        <dl style={{ margin: 0 }}>
          <div className="field">
            <dt>Status</dt>
            <dd>
              <span className="status-tag" data-status={agent.status}>{agent.status}</span>
              <span className="evidence-note">
                {agent.status === 'active'
                  ? `a deliverable inside the roster's 24-hour window${agent.work?.active === undefined ? '' : `: ${WORK_TEXT[agent.work.active]}`}`
                  : isOccupied(agent) ? 'occupied; its newest deliverable is older than the window' : NEVER_RUN}
              </span>
            </dd>
          </div>
          <div className="field">
            <dt>Sessions</dt>
            <dd>
              {agent.evidence.sessions > 0
                ? `${agent.evidence.sessions} recorded, last ${agent.evidence.lastSeen === undefined ? '—' : stamp(agent.evidence.lastSeen)}`
                : 'none: no recorded session did this seat\'s work'}
            </dd>
          </div>
          <div className="field">
            <dt>Ledger</dt>
            <dd>
              {ledgerLines(agent) > 0
                ? `${ledgerLines(agent)} ${ledgerLines(agent) === 1 ? 'line' : 'lines'}, last ${agent.ledger?.lastAt === undefined ? '—' : stamp(agent.ledger.lastAt)}`
                : 'none: no ticket or function line names this seat'}
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
    const counts = new Map<string, DivisionCounts>()
    for (const agent of roster?.agents ?? []) {
      const entry = counts.get(agent.division) ?? { defined: 0, occupied: 0, active: 0 }
      entry.defined += 1
      if (isOccupied(agent)) entry.occupied += 1
      if (agent.status === 'active') entry.active += 1
      if (agent.work?.active !== undefined) {
        entry.work ??= { model: 0, check: 0, halted: 0 }
        entry.work[agent.work.active] += 1
      }
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
        <h3>Divisions · occupied of defined · active in 24 h</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {(roster?.divisions ?? []).map((division) => {
            const counts = perDivision.get(division.id) ?? { defined: 0, occupied: 0, active: 0 }
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
                    <span style={{ color: 'var(--ink-3)', marginLeft: 7, fontSize: 12 }}>
                      {counts.occupied} / {counts.defined}
                    </span>
                    {counts.active === 0 ? null : (
                      <span style={{ color: 'var(--cyan)', marginLeft: 7, fontSize: 12 }}>
                        {counts.active} active{counts.work === undefined ? '' : `: ${workPhrase(counts.work)}`}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>{division.purpose}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <details className="section">
        <summary><h3 style={{ display: 'inline' }}>Evidence audit</h3></summary>
        <p className="evidence-lead">
          Which routes the recorded sessions ran on, and the recorded sessions no seat holds.
        </p>
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
      </details>

      <div className="section">
        <h3>Live activity</h3>
        {run === undefined ? null : (
          <p style={{ margin: '-3px 0 9px', fontSize: 12, color: 'var(--ink-2)' }}>{displayName(run)}</p>
        )}
        <EventFeed events={events} agents={agentIndex} follow limit={40} />
      </div>
    </div>
  )
}

/**
 * The seat counts in one sentence: defined, occupied, and the window's active
 * seats split by what they did.
 * @param counts - The roster's counts.
 * @returns Such as `147 seats defined · 53 occupied · 44 active: 18 model-driven · 22 automated checks · 4 halted before any model ran`.
 */
function seatSentence(counts: Roster['counts']): string {
  const split = counts.work === undefined ? '' : workPhrase(counts.work.active)
  return `${counts.defined} seats defined · ${counts.occupied} occupied · ${counts.active} active${split === '' ? '' : `: ${split}`}`
}

/**
 * The panel shown when nothing is selected: what the enterprise delivered in
 * the roster's 24-hour window, then the seats, then the Enterprise, 24 hours,
 * Ledger and Record tabs. Without a published report the seats lead.
 * @returns The panel.
 */
function UnselectedPanel(): ReactNode {
  const roster = useDeck(state => state.roster)
  const report = useDeck(state => state.enterprise)
  const now = useNow()
  const [tab, setTab] = useState<Tab>('enterprise')
  const until = report?.window.until ?? roster?.activeWindow?.until ?? roster?.generatedAt
  const outcomes = report?.outcomes

  return (
    <>
      <div className="panel__head">
        <div className="panel__eyebrow">
          Enterprise{until === undefined ? '' : ` · the 24 h to ${stamp(until)} UTC, ${formatAge(Math.max(0, now - Date.parse(until)))} ago`}
        </div>
        <h2 className="panel__title">
          {outcomes === undefined
            ? roster === undefined ? '' : seatSentence(roster.counts)
            : outcomePhrases(outcomes).join(' · ')}
        </h2>
        <p className="panel__sub">
          {outcomes === undefined || roster === undefined ? '' : `${seatSentence(roster.counts)}. `}
          {outcomes === undefined || outcomes.notShipped + outcomes.haltedBeforeModel === 0
            ? ''
            : `${outcomes.notShipped} tickets worked and not shipped, ${outcomes.haltedBeforeModel} halted before any model ran. `}
          A seat is a role the enterprise defines; it is occupied only by a recorded deliverable (a session, a ticket, a gate run,
          a CI verdict) and active only by one dated inside the window. Click a node to open a seat; Esc clears the selection.
        </p>
      </div>

      <div className="tabs">
        <button type="button" data-active={tab === 'enterprise'} onClick={() => setTab('enterprise')}>Enterprise</button>
        <button type="button" data-active={tab === 'day'} onClick={() => setTab('day')}>24 hours</button>
        <button type="button" data-active={tab === 'ledger'} onClick={() => setTab('ledger')}>Ledger</button>
        <button type="button" data-active={tab === 'record'} onClick={() => setTab('record')}>Record</button>
      </div>

      {tab === 'enterprise' ? <OverviewPanel /> : (
        <div className="panel__body">
          <ReplayNotice />
          {tab === 'day' ? <DayPanel /> : tab === 'ledger' ? <LedgerPanel /> : <RecordPanel />}
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
          : <WebGLGate poster="enterprise" label="the enterprise graph"><EnterpriseStage roster={roster} /></WebGLGate>}
        <div className="stage__overlay">
          <div className="stage__title">
            <h1>The enterprise on record</h1>
            <p>
              Every defined seat, clustered by division; edges are the delegations, verifications and judgements
              between them. A bright seat is one a recorded deliverable occupied; a dim one is provisioned with no work assigned yet.
              A ringed node delivered inside the roster's 24-hour window; a pulsing node is acting right now;
              a burst is a certificate just issued.
            </p>
          </div>
          <span className="hint">
            <span className="hint__mouse">drag to orbit · scroll to zoom · click a node</span>
            <span className="hint__touch">tap a node · Explore 3D to orbit and pinch</span>
          </span>
        </div>
      </div>

      <aside className="panel">
        {selected === undefined ? <UnselectedPanel /> : <AgentPanel agent={selected} />}
      </aside>
    </div>
  )
}
