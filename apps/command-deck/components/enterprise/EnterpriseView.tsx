'use client'

import dynamic from 'next/dynamic'
import { useMemo, type ReactNode } from 'react'
import type { Agent } from '@/lib/contract'
import { divisionColor } from '@/lib/palette'
import { useDeck } from '@/lib/store'
import { EventFeed } from '@/components/shell/EventFeed'
import { ReplayNotice } from '@/components/shell/ReplayNotice'

// three.js reaches for a WebGL context on mount, so the scene never renders on
// the server; the rest of the view is ordinary React and does.
const EnterpriseStage = dynamic(
  async () => (await import('./EnterpriseStage')).EnterpriseStage,
  { ssr: false, loading: () => <div className="loading">composing the enterprise…</div> },
)

/**
 * The detail panel for one selected agent.
 * @param props - The agent to describe.
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

  return (
    <>
      <div className="panel__head">
        <div className="panel__eyebrow" style={{ color: divisionColor(agent.division) }}>
          {division?.name ?? agent.division}
          {agent.department === undefined ? '' : ` · ${agent.department}`}
        </div>
        <h2 className="panel__title">{agent.name}</h2>
        <p className="panel__sub">{agent.role}</p>
      </div>

      <div className="panel__body">
        <dl style={{ margin: 0 }}>
          <div className="field">
            <dt>Status</dt>
            <dd><span className="status-tag" data-status={agent.status}>{agent.status}</span></dd>
          </div>
          <div className="field">
            <dt>Route</dt>
            <dd className="mono">{agent.route.provider} / {agent.route.model}</dd>
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
            ? <div className="panel__empty">This agent has not acted in the run being followed.</div>
            : <EventFeed events={recent} limit={14} />}
        </div>
      </div>
    </>
  )
}

/**
 * The panel shown when nothing is selected: the enterprise's own shape, and
 * the run's live stream.
 * @returns The panel body.
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
    const counts = new Map<string, number>()
    for (const agent of roster?.agents ?? []) counts.set(agent.division, (counts.get(agent.division) ?? 0) + 1)
    return counts
  }, [roster])

  return (
    <>
      <div className="panel__head">
        <div className="panel__eyebrow">Enterprise</div>
        <h2 className="panel__title">{roster?.counts.defined ?? 0} agents, ten divisions</h2>
        <p className="panel__sub">Click a node to open an agent. Esc clears the selection.</p>
      </div>

      <div className="panel__body">
        <ReplayNotice />

        <div className="section">
          <h3>Divisions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {(roster?.divisions ?? []).map(division => (
              <div key={division.id} style={{ display: 'flex', gap: 9 }}>
                <i
                  style={{
                    width: 3,
                    borderRadius: 3,
                    background: divisionColor(division.id),
                    flex: '0 0 3px',
                    boxShadow: `0 0 10px ${divisionColor(division.id)}`,
                  }}
                />
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ink)' }}>
                    {division.name}
                    <span style={{ color: 'var(--ink-3)', marginLeft: 7, fontSize: 10.5 }}>
                      {perDivision.get(division.id) ?? 0}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.45 }}>{division.purpose}</div>
                </div>
              </div>
            ))}
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
            <h1>The enterprise at work</h1>
            <p>
              Every defined agent, clustered by division; edges are the delegations, verifications and judgements
              between them. A pulsing node is acting right now; a ring is a certificate just issued.
            </p>
          </div>
          <span className="hint">drag to orbit · scroll to zoom · click a node</span>
        </div>
      </div>

      <aside className="panel">
        {selected === undefined ? <OverviewPanel /> : <AgentPanel agent={selected} />}
      </aside>
    </div>
  )
}
