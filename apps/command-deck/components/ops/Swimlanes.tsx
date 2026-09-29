'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { OPS_AGENT_KINDS, type OpsAgentKind, type OpsRun, type OpsRunOutcome, type OpsSnapshot } from '@/deck/contract'
import { formatAge } from '@/deck/ops'
import { Age } from './Age.tsx'
import styles from './ops.module.css'

/** Lane names, one per agent kind. */
export const KIND_LABEL: Record<OpsAgentKind, string> = {
  'cycle-step': 'Cycle steps',
  coordinator: 'Coordinators',
  department: 'Departments',
  reviewer: 'Reviewers',
  'function-gate': 'Gates and CI',
  'bench-cell': 'Bench cells',
  'operator-agent': 'Operator agents',
}

/** Outcome names, in the order the key lists them. */
const OUTCOME_LABEL: Record<OpsRunOutcome, string> = {
  running: 'running',
  ok: 'passed',
  failed: 'failed',
  unknown: 'end not recorded',
}

/** Height of one track of bars; a lane holds up to {@link MAX_TRACKS}. */
const TRACK = 8

/** Tracks per lane: overlapping runs stack instead of hiding each other. */
const MAX_TRACKS = 2

/** Space between two lanes. */
const LANE_GAP = 5

/** Height of the time axis under the lanes. */
const AXIS = 18

/** A run placed on its lane and track. */
interface Placed {
  run: OpsRun
  lane: number
  track: number
  start: number
  end: number
}

/**
 * Place each run on its kind's lane, in the first track whose last run ended
 * before it began; runs past {@link MAX_TRACKS} overlapping share the last.
 * @param runs - The window's runs.
 * @param since - The window's start, epoch ms.
 * @param until - The window's end, epoch ms.
 * @returns The placed runs and each lane's track count.
 */
function place(runs: readonly OpsRun[], since: number, until: number): { placed: Placed[]; tracks: number[] } {
  const tracks = OPS_AGENT_KINDS.map(() => [] as number[])
  const placed: Placed[] = []
  for (const run of [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const lane = OPS_AGENT_KINDS.indexOf(run.kind)
    const ends = tracks[lane]
    if (lane === -1 || ends === undefined) continue
    const start = Math.max(since, Date.parse(run.startedAt))
    const end = Math.min(until, run.endedAt === undefined ? until : Date.parse(run.endedAt))
    if (Number.isNaN(start) || Number.isNaN(end) || end < since) continue
    let track = ends.findIndex(last => last < start)
    if (track === -1) track = ends.length < MAX_TRACKS ? ends.length : MAX_TRACKS - 1
    ends[track] = Math.max(ends[track] ?? 0, end)
    placed.push({ run, lane, track, start, end })
  }
  return { placed, tracks: tracks.map(ends => Math.max(1, ends.length)) }
}

/** The element's width, followed as it resizes. */
function useWidth(): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    const observer = new ResizeObserver(entries => setWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

function clock(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16)
}

/** The UTC month and day, `09-28`, so a 24-hour window names both of its days. */
function day(ms: number): string {
  return new Date(ms).toISOString().slice(5, 10)
}

/**
 * The last 24 hours as swimlanes: one lane per agent kind, one bar per run
 * from its start to its end, coloured by how it ended, with the snapshot's
 * moment at the right edge. Hovering a bar names the run; the same runs are
 * listed in a table under the chart.
 * @param props - The snapshot.
 * @returns The chart.
 */
export function Swimlanes({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<{ placed: Placed; x: number; y: number } | undefined>(undefined)
  const since = Date.parse(snapshot.window.since)
  const until = Date.parse(snapshot.window.until)
  const { placed, tracks } = useMemo(() => place(snapshot.runs, since, until), [snapshot.runs, since, until])
  const narrow = width < 560
  const labelWidth = narrow ? 92 : 118
  const plot = Math.max(10, width - labelWidth - 8)
  const x = (ms: number): number => labelWidth + (((ms - since) / Math.max(1, until - since)) * plot)
  const laneTops: number[] = []
  let top = 0
  for (const count of tracks) {
    laneTops.push(top)
    top += (count * TRACK) + ((count - 1) * 2) + LANE_GAP
  }
  const height = top + AXIS
  const tickHours = narrow ? 6 : 3
  const firstTick = Math.ceil(since / (tickHours * 3_600_000)) * tickHours * 3_600_000
  const ticks: number[] = []
  for (let tick = firstTick; tick <= until; tick += tickHours * 3_600_000) ticks.push(tick)
  const counts = OPS_AGENT_KINDS.map(kind => snapshot.runs.filter(run => run.kind === kind).length)
  const byOutcome = (outcome: OpsRunOutcome): number => snapshot.runs.filter(run => run.outcome === outcome).length

  return (
    <div className={styles.timeline}>
      <div className={styles.sectionHead}>
        <h2>Every agent run, last 24 hours</h2>
        <p>{snapshot.runs.length} runs by kind, {day(since)} {clock(since)} – {day(until)} {clock(until)} UTC</p>
        <Age at={snapshot.generatedAt} />
        <div className={styles.keys} aria-label="Bar colours">
          {(['running', 'ok', 'failed', 'unknown'] as const).map(outcome => (
            <span key={outcome}>
              <i style={{ background: `var(--o-${outcome === 'ok' ? 'ok' : outcome})` }} />
              {OUTCOME_LABEL[outcome]} {byOutcome(outcome)}
            </span>
          ))}
        </div>
      </div>
      <div ref={ref} style={{ position: 'relative' }}>
        {width === 0 ? <div style={{ height }} /> : (
          <svg className={styles.lanes} width={width} height={height} role="img" aria-label={`Agent runs in the last 24 hours: ${snapshot.runs.length}`}>
            {OPS_AGENT_KINDS.map((kind, lane) => {
              const laneTop = laneTops[lane] ?? 0
              const laneHeight = ((tracks[lane] ?? 1) * TRACK) + (((tracks[lane] ?? 1) - 1) * 2)
              return (
                <g key={kind}>
                  <rect className={styles.band} x={labelWidth} y={laneTop} width={plot} height={laneHeight} rx={2} />
                  <text x={0} y={laneTop + (laneHeight / 2) + 4}>{narrow ? KIND_LABEL[kind].split(' ')[0] : KIND_LABEL[kind]} {counts[lane] ?? 0}</text>
                </g>
              )
            })}
            {ticks.map(tick => (
              <g key={tick}>
                <line x1={x(tick)} x2={x(tick)} y1={0} y2={top - LANE_GAP} />
                {/* A tick too close to `now` gives its label up, so the two never overlap. */}
                {x(until) - x(tick) < 48 ? null : <text className={styles.axis} x={x(tick)} y={height - 4} textAnchor="middle">{clock(tick)}</text>}
              </g>
            ))}
            {placed.map((entry) => {
              const left = x(entry.start)
              const barWidth = Math.max(2, x(entry.end) - left)
              const y = (laneTops[entry.lane] ?? 0) + (entry.track * (TRACK + 2))
              return (
                <rect
                  key={entry.run.id}
                  x={left}
                  y={y}
                  width={barWidth}
                  height={TRACK}
                  rx={2}
                  data-outcome={entry.run.outcome}
                  onPointerEnter={() => setHover({ placed: entry, x: left + (barWidth / 2), y })}
                  onPointerLeave={() => setHover(undefined)}
                >
                  <title>{`${entry.run.label} · ${OUTCOME_LABEL[entry.run.outcome]}`}</title>
                </rect>
              )
            })}
            <line className={styles.now} x1={x(until)} x2={x(until)} y1={0} y2={top - LANE_GAP} />
            <text className={styles.axis} x={x(until)} y={height - 4} textAnchor="end">now</text>
          </svg>
        )}
        {hover === undefined ? null : (
          <div className={styles.tip} style={{ left: Math.min(Math.max(hover.x, 110), Math.max(110, width - 110)), top: hover.y }}>
            <b>{hover.placed.run.label}</b>
            <span>{KIND_LABEL[hover.placed.run.kind]} · {OUTCOME_LABEL[hover.placed.run.outcome]}</span>
            <span>
              {clock(Date.parse(hover.placed.run.startedAt))}–{hover.placed.run.endedAt === undefined ? 'now' : clock(Date.parse(hover.placed.run.endedAt))} UTC
              {' · '}{formatAge(hover.placed.end - Date.parse(hover.placed.run.startedAt))}
            </span>
          </div>
        )}
      </div>
      <details className={styles.table}>
        <summary>The same runs as a table</summary>
        <div className={styles.tableScroll}>
          <table>
            <thead><tr><th>Kind</th><th>Run</th><th>Start (UTC)</th><th>End</th><th>Outcome</th></tr></thead>
            <tbody>
              {[...snapshot.runs].reverse().map(run => (
                <tr key={run.id}>
                  <td>{KIND_LABEL[run.kind]}</td>
                  <td>{run.label}</td>
                  <td>{run.startedAt.slice(5, 16).replace('T', ' ')}</td>
                  <td>{run.endedAt === undefined ? 'running' : run.endedAt.slice(11, 16)}</td>
                  <td>{OUTCOME_LABEL[run.outcome]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
