'use client'

import dynamic from 'next/dynamic'
import { useMemo, type ChangeEvent, type ReactNode } from 'react'
import { clock, duration, stamp } from '@/lib/format'
import { SEVERITY_COLOR } from '@/lib/palette'
import { STAGES, stageOf } from '@/lib/pipeline'
import { eventsUpTo, useDeck } from '@/lib/store'
import { EventFeed } from '@/components/shell/EventFeed'
import { ReplayNotice } from '@/components/shell/ReplayNotice'

// three.js reaches for a WebGL context on mount, so the scene never renders on
// the server; the rest of the view is ordinary React and does.
const ProcessStage = dynamic(
  async () => (await import('./ProcessStage')).ProcessStage,
  { ssr: false, loading: () => <div className="loading">laying out the pipeline…</div> },
)

/** Colour per event kind, matching the particles in the scene. */
const KIND_COLOR: Record<string, string> = {
  step: '#5fa8ff',
  tool: '#4fd8ff',
  delegation: '#9b7bff',
  directive: '#ffbe5c',
  certificate: '#49e0a6',
  finding: SEVERITY_COLOR.critical,
  merge: '#ff8a6b',
  refusal: '#ff8a3d',
}

/**
 * The Process view: the pipeline on the left, the run and its stream on the right.
 * @returns The view.
 */
export function ProcessView(): ReactNode {
  const roster = useDeck(state => state.roster)
  const runs = useDeck(state => state.runs)
  const selectedRunId = useDeck(state => state.selectedRunId)
  const selectRun = useDeck(state => state.selectRun)
  const events = useDeck(state => state.events)
  const cursor = useDeck(state => state.cursor)
  const setCursor = useDeck(state => state.setCursor)

  const agents = useMemo(
    () => new Map((roster?.agents ?? []).map(agent => [agent.id, agent])),
    [roster],
  )
  const visible = useMemo(() => eventsUpTo(events, cursor), [events, cursor])
  const run = runs.find(entry => entry.id === selectedRunId)

  const perStage = useMemo(() => {
    const totals = STAGES.map(() => 0)
    for (const event of visible) {
      const index = stageOf(event, agents.get(event.agentId))
      totals[index] = (totals[index] ?? 0) + 1
    }
    return totals
  }, [visible, agents])

  const perKind = useMemo(() => {
    const totals = new Map<string, number>()
    for (const event of visible) totals.set(event.kind, (totals.get(event.kind) ?? 0) + 1)
    return [...totals.entries()].sort((left, right) => right[1] - left[1])
  }, [visible])

  const head = events.at(-1)
  const at = visible.at(-1)
  const max = Math.max(0, events.length - 1)
  const position = cursor === undefined ? max : Math.max(0, visible.length - 1)

  const onScrub = (event: ChangeEvent<HTMLInputElement>): void => {
    const index = Number(event.target.value)
    if (index >= max) {
      setCursor(undefined)
      return
    }
    setCursor(events[index]?.seq)
  }

  return (
    <div className="view view--split">
      <div className="stage">
        <ProcessStage events={visible} agents={agents} />

        <div className="stage__overlay">
          <div className="stage__title">
            <h1>{run?.name ?? 'Process'}</h1>
            <p>
              Departments produce, Verification executes the checks, Judging scores, Integration merges.
              Each light is one logged event moving to the next stage.
            </p>
          </div>
          <span className="hint">
            {STAGES.map((stage, index) => `${stage.name} ${perStage[index] ?? 0}`).join('  ·  ')}
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
            <h3>Timeline</h3>
            <div className="scrub">
              <span className="scrub__time">{at === undefined ? '--:--:--' : clock(at.ts)}</span>
              <input
                type="range"
                min={0}
                max={max}
                value={position}
                onChange={onScrub}
                aria-label="Timeline position"
                style={{ ['--fill' as string]: `${max === 0 ? 100 : (position / max) * 100}%` }}
              />
              <button
                type="button"
                className="btn"
                data-variant={cursor === undefined ? 'primary' : undefined}
                onClick={() => setCursor(undefined)}
              >
                Head
              </button>
            </div>
            <p style={{ margin: '7px 0 0', fontSize: 11, color: 'var(--ink-3)' }}>
              {visible.length} of {events.length} events
              {head === undefined ? '' : ` · head ${clock(head.ts)}`}
            </p>
          </div>

          <div className="section">
            <h3>Event kinds</h3>
            <div className="legend">
              {perKind.map(([kind, total]) => (
                <span key={kind}>
                  <i style={{ background: KIND_COLOR[kind] ?? '#5fa8ff' }} />
                  {kind} {total}
                </span>
              ))}
            </div>
          </div>

          <div className="section">
            <h3>Stream</h3>
            <EventFeed events={visible} agents={agents} follow={cursor === undefined} limit={50} />
          </div>
        </div>
      </aside>
    </div>
  )
}
