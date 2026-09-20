'use client'

import dynamic from 'next/dynamic'
import { useMemo, type ChangeEvent, type ReactNode } from 'react'
import type { EventKind } from '@/deck/contract'
import { clock, duration, stamp } from '@/deck/format'
import { discoverLanes, laneTotals, STAGES, stageOf } from '@/deck/pipeline'
import { usePlayback } from '@/deck/playback'
import { eventsUpTo, eventTimeMs, useDeck } from '@/deck/store'
import { EventFeed } from '@/components/shell/EventFeed'
import { ReplayNotice } from '@/components/shell/ReplayNotice'
import { PlaybackControls } from '@/components/workflow/PlaybackControls'
import { KIND_LOOK } from './kinds'

// three.js reaches for a WebGL context on mount, so the scene never renders on
// the server; the rest of the view is ordinary React and does.
const ProcessStage = dynamic(
  async () => (await import('./ProcessStage')).ProcessStage,
  { ssr: false, loading: () => <div className="loading">laying out the pipeline…</div> },
)

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
  const playback = usePlayback()

  const agents = useMemo(
    () => new Map((roster?.agents ?? []).map(agent => [agent.id, agent])),
    [roster],
  )
  // The feed folds one session at a time, so frames arrive out of the order they
  // were logged; the timeline is the logged order and the scrubber indexes it.
  const ordered = useMemo(
    () => [...events].sort((left, right) => eventTimeMs(left) - eventTimeMs(right)),
    [events],
  )
  const visible = useMemo(() => eventsUpTo(ordered, cursor), [ordered, cursor])
  const run = runs.find(entry => entry.id === selectedRunId)

  const lanes = useMemo(() => discoverLanes(ordered, agents), [ordered, agents])
  const laneCounts = useMemo(() => laneTotals(visible, agents, lanes), [visible, agents, lanes])

  const perStage = useMemo(() => {
    const totals = STAGES.map(() => 0)
    for (const event of visible) {
      const index = stageOf(event, agents.get(event.agentId))
      totals[index] = (totals[index] ?? 0) + 1
    }
    return totals
  }, [visible, agents])

  const perKind = useMemo(() => {
    const totals = new Map<EventKind, number>()
    for (const event of visible) totals.set(event.kind, (totals.get(event.kind) ?? 0) + 1)
    return [...totals.entries()].sort((left, right) => right[1] - left[1])
  }, [visible])

  const head = ordered.at(-1)
  const at = visible.at(-1)
  const max = Math.max(0, ordered.length - 1)
  const position = cursor === undefined ? max : Math.max(0, visible.length - 1)

  // A run reads as finished when the feed has given it an end — `endedAt`, or a
  // status of `completed` from a feed that reports no end time — and the deck is
  // watching its head, or when the event under the cursor is the merge itself.
  const ended = run !== undefined && (run.endedAt !== undefined || run.status === 'completed')
  const completed = (cursor === undefined && ended) || at?.kind === 'merge'
  const progress = cursor === undefined ? undefined : (max === 0 ? 1 : position / max)

  const onScrub = (event: ChangeEvent<HTMLInputElement>): void => {
    const index = Number(event.target.value)
    const frame = ordered[index]
    if (index >= max || frame === undefined) {
      setCursor(undefined)
      return
    }
    setCursor(eventTimeMs(frame))
  }

  return (
    <div className="view view--split">
      <div className="stage">
        <ProcessStage
          events={visible}
          history={ordered}
          agents={agents}
          completed={completed}
          progress={progress}
        />

        <div className="stage__overlay">
          <div className="stage__title">
            <h1>{run?.name ?? 'Process'}</h1>
            <p>
              Departments produce, Verification executes the checks, Judging scores, Integration merges.
              Each light is one logged event travelling to the next gate.
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
              {visible.length} of {ordered.length} events
              {head === undefined ? '' : ` · head ${clock(head.ts)}`}
            </p>
            <div style={{ marginTop: 10 }}>
              <PlaybackControls playback={playback} />
            </div>
          </div>

          <div className="section">
            <h3>Department lanes</h3>
            <div className="lane-key">
              {lanes.list.map((lane, index) => (
                <div key={lane.key}>
                  <i style={{ background: lane.color }} />
                  {lane.label}
                  <span style={{ marginLeft: 'auto', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                    {laneCounts[index] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="section">
            <h3>Event kinds</h3>
            <div className="legend">
              {perKind.map(([kind, total]) => (
                <span key={kind}>
                  <i style={{ background: KIND_LOOK[kind].color }} />
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
