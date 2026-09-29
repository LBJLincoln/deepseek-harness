'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { OpsAgent, OpsAttention, OpsAttentionKind, OpsHeartbeat, OpsSnapshot, OpsSource, OpsSourceId, Roster, Severity } from '@/deck/contract'
import { factsAsOf, formatAge, groupAttention, snapshotAge, STATION_NAME, STATIONS, stationCounts, type OpsReading } from '@/deck/ops'
import { stopOps, useOps } from '@/deck/ops-store'
import { divisionColor } from '@/deck/palette'
import { REPOSITORY } from '@/deck/repository'
import { useDeck } from '@/deck/store'
import { isOccupied } from '@/components/enterprise/evidence'
import { Age, useNow } from './Age.tsx'
import { WebGLGate } from '@/components/three/WebGLGate'
import { FlatFloor } from './FlatFloor.tsx'
import { CycleClock, MissionBand, NextAction, ShippedTickets } from './Mission.tsx'
import { KIND_LABEL, Swimlanes } from './Swimlanes.tsx'
import styles from './ops.module.css'

// three.js reaches for a WebGL context on mount, so the scene never renders on
// the server, and mounts behind the deck's WebGLGate in the browser.
const OpsStage = dynamic(
  async () => (await import('./OpsStage')).OpsStage,
  { ssr: false, loading: () => <div className={styles.loading}>lighting the operations floor…</div> },
)

/** The view's theme: the viewer's system setting, or one they chose here. */
type Theme = 'auto' | 'light' | 'dark'

/** Where the chosen theme is remembered in this browser. */
const THEME_KEY = 'dsh-deck-ops-theme'

/** Severity names, as the attention queue prints them. */
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

/** Each agent kind as a count names it, singular and plural. */
const KIND_NOUN: Record<OpsAgent['kind'], readonly [string, string]> = {
  'cycle-step': ['cycle step', 'cycle steps'],
  coordinator: ['coordinator', 'coordinators'],
  department: ['department', 'departments'],
  reviewer: ['reviewer', 'reviewers'],
  'function-gate': ['gate', 'gates'],
  'bench-cell': ['bench cell', 'bench cells'],
  'operator-agent': ['operator agent', 'operator agents'],
}

/** The theme the viewer chose, remembered per browser when storage allows. */
function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>('auto')
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_KEY)
      if (saved === 'light' || saved === 'dark') setTheme(saved)
    } catch {
      // Storage blocked (a private window, a preview): the view follows the system setting.
    }
  }, [])
  const choose = (next: Theme): void => {
    setTheme(next)
    try {
      if (next === 'auto') window.localStorage.removeItem(THEME_KEY)
      else window.localStorage.setItem(THEME_KEY, next)
    } catch {
      // Storage blocked: the choice holds for this page only.
    }
  }
  return [theme, choose]
}

/**
 * Minutes or hours for a duration in seconds.
 * @param seconds - The duration.
 * @returns `42 s`, `12 min` or `3 h 5 min`.
 */
function span(seconds: number): string {
  return formatAge(seconds * 1000)
}

/** A compact count: 1,284 · 12.9K · 4.2M. */
function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${(value / 1_000).toFixed(1)}K`
  return value.toLocaleString('en-US')
}

/** What a tile's or a panel's age is drawn from. */
interface FactsAgeProps {
  snapshot: OpsSnapshot
  /** The sources its figures are counted from; none for the whole snapshot. */
  sources?: readonly OpsSourceId[]
  short?: boolean
}

/**
 * A tile's or a panel's age: the facts of the sources it reads.
 * @param props - The snapshot, the sources and whether to leave out `old`.
 * @returns The age.
 */
function FactsAge({ snapshot, sources = [], short = false }: FactsAgeProps): ReactNode {
  return <Age at={factsAsOf(snapshot, sources)} short={short} />
}

/**
 * The UTC clock time a cycle id stamps.
 * @param cycle - `cycle-20260929T001517Z`.
 * @returns `00:15`, or the id itself when it carries no stamp.
 */
function cycleClock(cycle: string): string {
  const stamp = /T(\d{2})(\d{2})\d{2}Z$/.exec(cycle)
  return stamp === null ? cycle : `${stamp[1]}:${stamp[2]}`
}

/**
 * `/ops` — the Operations Center: what needs attention, every agent working
 * now, the enterprise's day, and the operations floor they play on. Every
 * figure is read from one operations snapshot; the view says whether that
 * snapshot is live, a recent replay with its age, or missing.
 * @returns The view.
 */
export function OpsView(): ReactNode {
  const boot = useOps(state => state.boot)
  const reading = useOps(state => state.reading)
  const [theme, setTheme] = useTheme()

  useEffect(() => {
    boot()
    return () => stopOps()
  }, [boot])

  const snapshot = reading?.snapshot

  return (
    <div className={styles.root} data-theme={theme === 'auto' ? undefined : theme}>
      <TopStrip reading={reading} theme={theme} setTheme={setTheme} />
      <div className={styles.body}>
        <div className={styles.main}>
          <div className={styles.stage}>
            <div className={styles.canvasBox}>
              {snapshot === undefined ? (
                <div className={styles.loading}>{reading === undefined ? 'reading the operations snapshot…' : 'no operations snapshot to draw'}</div>
              ) : (
                <WebGLGate flat={<FlatFloor snapshot={snapshot} />} label="the operations floor">
                  <OpsStage snapshot={snapshot} />
                </WebGLGate>
              )}
            </div>
            <StageOverlay reading={reading} />
          </div>
          {snapshot === undefined ? null : <MissionBand snapshot={snapshot} />}
          {snapshot === undefined ? null : <Swimlanes snapshot={snapshot} />}
        </div>
        <aside className={styles.side} aria-label="Attention and agents">
          {snapshot === undefined ? <Offline reading={reading} /> : <Panel snapshot={snapshot} />}
        </aside>
      </div>
    </div>
  )
}

/** The mode badge's words. */
function modeLine(reading: OpsReading | undefined, now: number): ReactNode {
  if (reading === undefined) return 'Asking the feed for the operations snapshot.'
  const snapshot = reading.snapshot
  const age = snapshot === undefined ? undefined : formatAge(snapshotAge(snapshot, now))
  if (reading.mode === 'live') {
    return <>Live: the feed&apos;s snapshot is <b>{age} old</b>, refreshed every {snapshot?.intervalSeconds ?? 15} s.</>
  }
  if (reading.mode === 'recent') {
    const from = reading.origin === 'fixture' ? 'the snapshot the enterprise cycle published' : 'the relay\'s last snapshot'
    return <>Replaying {from}, <b>{age} old</b>. {reading.reason}.</>
  }
  return <>No snapshot: {reading.reason}.</>
}

/** The strip across the top: the mode, then the enterprise at a glance. */
/** What the top strip is drawn from. */
interface TopStripProps {
  reading: OpsReading | undefined
  theme: Theme
  setTheme: (theme: Theme) => void
}

function TopStrip({ reading, theme, setTheme }: TopStripProps): ReactNode {
  const now = useNow()
  const snapshot = reading?.snapshot
  return (
    <header className={styles.top}>
      <div className={styles.mode}>
        <div className={styles.modeRow}>
          <span className={styles.badge} data-mode={reading?.mode ?? 'probing'}>
            <i />
            {reading === undefined ? 'connecting' : reading.mode}
          </span>
          <div className={styles.theme} role="group" aria-label="Theme">
            {(['auto', 'light', 'dark'] as const).map(option => (
              <button key={option} type="button" aria-pressed={theme === option} onClick={() => setTheme(option)}>{option}</button>
            ))}
          </div>
        </div>
        <div className={styles.modeText}>{modeLine(reading, now)}</div>
      </div>
      {snapshot === undefined ? null : <NextAction snapshot={snapshot} />}
      {snapshot === undefined ? null : <Tiles snapshot={snapshot} />}
    </header>
  )
}

/** Seats of one division, or of the whole enterprise, as the view counts them. */
interface SeatCount {
  defined: number
  occupied: number
  activeToday: number
}

/** The view's seat counts: one reading, with the time it describes. */
interface SeatReading extends SeatCount {
  /** When the roster the counts come from was stamped; `undefined` when it cannot be told. */
  asOf: string | undefined
  divisions: (SeatCount & { id: string; name: string; workingNow: number })[]
}

/**
 * The seat counts the view shows: the deck's roster, which the header counts
 * from, whenever the deck has read one, so the tile, the divisions and the
 * header never disagree; the snapshot's own reading of the roster otherwise.
 * Working-now counts always come from the snapshot, which is the only record
 * of who is working.
 * @param roster - The deck's roster, if read.
 * @param snapshot - The operations snapshot.
 * @returns The reading, or `undefined` when neither holds seats.
 */
function seatReading(roster: Roster | undefined, snapshot: OpsSnapshot): SeatReading | undefined {
  const working = new Map((snapshot.big.seats?.divisions ?? []).map(division => [division.id, division.workingNow]))
  if (roster === undefined) {
    const seats = snapshot.big.seats
    return seats === null ? undefined : { ...seats, asOf: factsAsOf(snapshot, ['roster']), divisions: seats.divisions }
  }
  const divisions = roster.divisions.map((division) => {
    const members = roster.agents.filter(agent => agent.division === division.id)
    return {
      id: division.id,
      name: division.name,
      defined: members.length,
      occupied: members.filter(isOccupied).length,
      activeToday: members.filter(agent => agent.status === 'active').length,
      workingNow: working.get(division.id) ?? 0,
    }
  })
  const { defined, occupied, active } = roster.counts
  return { defined, occupied, activeToday: active, asOf: roster.generatedAt, divisions }
}

/** The six glance tiles, each counted from the snapshot, each saying unknown when its source was. */
function Tiles({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const { big } = snapshot
  const roster = useDeck(state => state.roster)
  const seats = seatReading(roster, snapshot)
  const bySeverity = (severity: Severity): number => snapshot.attention.filter(item => item.severity === severity).length
  const worst = snapshot.attention[0]?.severity
  const unknown = snapshot.sources.filter(source => source.state === 'unknown').length
  const kinds = new Map<string, number>()
  for (const agent of snapshot.agents) kinds.set(agent.kind, (kinds.get(agent.kind) ?? 0) + 1)
  const stuck = snapshot.agents.filter(agent => agent.state === 'stuck').length
  const hours = big.throughput?.hours ?? []
  const peak = Math.max(1, ...hours.map(hour => hour.shipped + hour.functions + hour.rejected + hour.halted))
  const inWindow = (field: 'shipped' | 'rejected' | 'halted' | 'functions'): number => hours.reduce((sum, hour) => sum + hour[field], 0)
  const entries = inWindow('shipped') + inWindow('rejected') + inWindow('halted') + inWindow('functions')
  return (
    <>
      <div className={styles.tile}>
        <p className={styles.tileLabel}>Needs attention <FactsAge snapshot={snapshot} short /></p>
        <div className={styles.tileValue}>
          <i className={styles.statusDot} data-tone={worst ?? 'clear'} />
          {snapshot.attention.length === 0 ? 'Nothing' : snapshot.attention.length}
          <small>{snapshot.attention.length === 0 ? 'flagged' : snapshot.attention.length === 1 ? 'item' : 'items'}</small>
        </div>
        <div className={styles.tileSub}>
          {snapshot.attention.length === 0 ? 'no red CI, halt, stuck agent or pressure' : (['critical', 'high', 'medium', 'low'] as const).filter(bySeverity).map(severity => `${bySeverity(severity)} ${severity}`).join(' · ')}
          {unknown === 0 ? '' : ` · ${unknown} ${unknown === 1 ? 'source' : 'sources'} unknown`}
        </div>
      </div>
      <div className={`${styles.tile} ${styles.hero}`}>
        <p className={styles.tileLabel}>Agents working now <FactsAge snapshot={snapshot} short /></p>
        <div className={styles.tileValue}>{snapshot.agents.length}{stuck === 0 ? null : <small>{stuck} stuck</small>}</div>
        <div className={styles.tileSub}>{[...kinds.entries()].map(([kind, count]) => `${count} ${KIND_NOUN[kind as OpsAgent['kind']][count === 1 ? 0 : 1]}`).join(' · ') || 'none'}</div>
      </div>
      <div className={styles.tile}>
        <p className={styles.tileLabel}>Shipped · 24 h <FactsAge snapshot={snapshot} sources={['ledger', 'tickets']} short /></p>
        <div className={styles.tileValue}>{big.tickets === null ? 'unknown' : big.tickets.shipped}</div>
        <div className={styles.tileSub}>{big.tickets === null ? 'the ledger or the queue could not be read' : `${big.throughput === null ? '' : `${inWindow('rejected')} rejected by review · `}now ${big.tickets.queued} queued, ${big.tickets.halted} halted`}</div>
      </div>
      <div className={styles.tile}>
        <p className={styles.tileLabel}>Ledger entries · 24 h <FactsAge snapshot={snapshot} sources={['ledger']} short /></p>
        <div className={styles.tileValue}>{big.throughput === null ? 'unknown' : entries}</div>
        <div className={styles.tileSub}>{big.throughput === null ? 'the ledger could not be read' : `${inWindow('shipped')} shipped · ${inWindow('halted')} halted · ${inWindow('rejected')} rejected · ${inWindow('functions')} automated checks`}</div>
        {hours.length === 0 ? null : (
          <svg className={styles.spark} viewBox={`0 0 ${hours.length * 6} 22`} preserveAspectRatio="none" role="img" aria-label="Ledger entries per hour, last 24 hours">
            {hours.map((hour, index) => {
              const value = hour.shipped + hour.functions + hour.rejected + hour.halted
              const barHeight = value === 0 ? 1 : Math.max(2, (value / peak) * 22)
              return <rect key={hour.hour} x={index * 6} y={22 - barHeight} width={4.5} height={barHeight} rx={1} data-empty={value === 0}><title>{`${hour.hour.slice(11, 16)} UTC: ${value}`}</title></rect>
            })}
          </svg>
        )}
      </div>
      <div className={styles.tile}>
        <p className={styles.tileLabel}>Cycles · 24 h <FactsAge snapshot={snapshot} sources={['cycle-logs', 'cycle-history']} short /></p>
        <div className={styles.tileValue}>{big.cycles === null ? 'unknown' : big.cycles.last24h}</div>
        <div className={styles.tileSub}>
          {big.cycles === null ? 'no cycle log or history could be read'
            : big.cycles.running !== undefined ? `one running since ${cycleClock(big.cycles.running)} UTC`
              : big.cycles.nextAt !== undefined ? `next at ${big.cycles.nextAt.slice(11, 16)} UTC`
                : big.cycles.lastStartedAt === undefined ? 'none started' : `last began ${big.cycles.lastStartedAt.slice(11, 16)} UTC`}
        </div>
      </div>
      <div className={styles.tile}>
        <p className={styles.tileLabel}>Branch CI <FactsAge snapshot={snapshot} sources={['ci']} short /></p>
        <div className={styles.tileValue}>
          <i className={styles.statusDot} data-tone={big.ci?.latest === undefined ? 'unknown' : big.ci.latest.conclusion === 'success' ? 'pass' : 'fail'} />
          {big.ci === null ? 'unknown' : big.ci.latest === undefined ? 'no run' : big.ci.latest.conclusion === 'success' ? 'green' : 'red'}
        </div>
        <div className={styles.tileSub}>
          {big.ci?.latest === undefined ? (big.ci === null ? 'GitHub could not be read' : 'no completed run read') : (
            <a href={big.ci.latest.url} target="_blank" rel="noreferrer">{big.ci.latest.commit.slice(0, 9)} · {big.ci.latest.at.slice(11, 16)} UTC</a>
          )}
          {big.ci?.running === undefined ? '' : ' · a run in progress'}
        </div>
      </div>
      <div className={styles.tile}>
        <p className={styles.tileLabel}>Seats occupied <Age at={seats?.asOf} short /></p>
        <div className={styles.tileValue}>{seats === undefined ? 'unknown' : seats.occupied}<small>{seats === undefined ? '' : `of ${seats.defined}`}</small></div>
        <div className={styles.tileSub}>{seats === undefined ? 'the roster could not be read' : `${seats.activeToday} active in the roster's day · ${big.seats?.workingNow ?? 0} working now`}</div>
      </div>
    </>
  )
}

/** What the scene carries over it: its name, the replay notice, the legend and the frames as they play. */
function StageOverlay({ reading }: { reading: OpsReading | undefined }): ReactNode {
  const now = useNow()
  const ticker = useOps(state => state.ticker)
  const snapshot = reading?.snapshot
  const labels = useMemo(() => new Map((snapshot?.agents ?? []).map(agent => [agent.id, agent.label])), [snapshot?.agents])
  const counts = useMemo(() => (snapshot === undefined ? undefined : stationCounts(snapshot)), [snapshot])
  return (
    <div className={styles.overlay}>
      <div className={styles.stageTop}>
        <div className={styles.overlayTitle}>
          <h1>The operations floor</h1>
          <p>
            Every seat of the enterprise on the ring, the pipeline from intake to ship across it, and a beam from every
            agent working now to its station.
          </p>
          {reading?.mode === 'recent' && snapshot !== undefined ? (
            <div className={styles.replay}>
              <b>Replay.</b> This is a recorded snapshot from {snapshot.generatedAt.slice(0, 16).replace('T', ' ')} UTC,
              {' '}{formatAge(snapshotAge(snapshot, now))} old; its activity plays on a loop and nothing on this floor is live.
            </div>
          ) : null}
        </div>
        <div className={styles.ticker} aria-live="off">
          {ticker.slice(0, 5).map(played => (
            <div key={`${played.frame.sessionId}:${played.frame.seq}`}>
              <b>{labels.get(played.frame.sessionId) ?? played.frame.agentId ?? played.frame.sessionId}</b> · {played.frame.label}
            </div>
          ))}
        </div>
      </div>
      {snapshot === undefined ? null : <CycleClock snapshot={snapshot} />}
      <div className={styles.stageBottom}>
        {counts === undefined ? null : (
          <div className={styles.flow} aria-label="The pipeline">
            {STATIONS.map((station, index) => (
              <div key={station} style={{ display: 'contents' }}>
                {index === 0 ? null : <span className={styles.flowArrow} aria-hidden="true">→</span>}
                <div className={styles.flowCell} data-busy={counts[station].busy > 0}>
                  <b>{STATION_NAME[station]}</b>
                  {counts[station].lines.map(line => <span key={line}>{line}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className={styles.legend}>
          <span><i style={{ background: '#4fd8ff', opacity: 0.35 }} />defined seat</span>
          <span><i style={{ background: '#4fd8ff' }} />occupied or active</span>
          <span><i style={{ background: '#9b7bff' }} />operator agent</span>
          <span><i style={{ background: '#ffcf7a' }} />certificate or merge</span>
          <span>{reading?.mode === 'live' ? `comets replay each tool call ${Math.round(((snapshot?.intervalSeconds ?? 15) + 5))} s behind the machine` : 'comets replay the recorded calls'}</span>
        </div>
      </div>
    </div>
  )
}

/** The side panel when there is no snapshot: why, and what would bring one. */
function Offline({ reading }: { reading: OpsReading | undefined }): ReactNode {
  return (
    <section className={styles.section}>
      <h2>Offline</h2>
      <div className={styles.card}>
        <p className={styles.itemDetail}>
          {reading === undefined ? 'Reading the operations snapshot.' : `The deck asked its feed for /ops and read its bundled snapshot; ${reading.reason ?? 'neither answered'}.`}
        </p>
        <p className={styles.next}>
          <b>Next:</b> start the operations loop (scripts/enterprise-ops-live.sh) on the enterprise&apos;s machine, or open
          the deck with ?feed= naming a feed that serves /ops.
        </p>
      </div>
    </section>
  )
}

/** The operator's panel: the loops' heartbeats, attention, agents, divisions, shipped commits and sources. */
function Panel({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  return (
    <>
      <Heartbeats snapshot={snapshot} />
      <section className={styles.section} aria-label="Attention queue">
        <h2>Attention <small>{snapshot.attention.length === 0 ? 'nothing flagged' : `${snapshot.attention.length} ranked by severity`}</small><FactsAge snapshot={snapshot} /></h2>
        {snapshot.attention.length === 0 ? (
          <div className={styles.empty}>
            No red CI, halted or rejected ticket, failed step, stale scheduler, stuck agent, pressure or open request in this snapshot.
          </div>
        ) : null}
        {groupAttention(snapshot.attention, ATTENTION_GROUP_MIN).map(entry => ('item' in entry
          ? <AttentionCard key={entry.item.id} item={entry.item} />
          : <AttentionGroup key={`${entry.kind}:${entry.severity}`} severity={entry.severity} kind={entry.kind} items={entry.items} />))}
      </section>
      <section className={styles.section} aria-label="Agents working now">
        <h2>Working now <small>{snapshot.agents.length} {snapshot.agents.length === 1 ? 'agent' : 'agents'}</small><FactsAge snapshot={snapshot} /></h2>
        {snapshot.agents.length === 0 ? <div className={styles.empty}>No agent is working in this snapshot.</div> : null}
        {snapshot.agents.map(agent => (
          <div key={agent.id} className={`${styles.card} ${styles.agent}`} data-state={agent.state}>
            <span className={styles.kind}>{KIND_LABEL[agent.kind]}</span>
            <span className={styles.agentLabel} title={agent.label}>{agent.label}</span>
            <span className={styles.agentTime}>{span(agent.elapsedSeconds)}{agent.tokens === undefined ? '' : ` · ${compact(agent.tokens)} tok`}</span>
            <span className={styles.agentDoing} title={agent.doing}>
              {agent.state === 'stuck' ? `silent ${span(agent.idleSeconds)} · ` : ''}{agent.doing}
            </span>
          </div>
        ))}
      </section>
      <Divisions snapshot={snapshot} />
      {snapshot.big.shippedTickets === undefined ? <Shipped snapshot={snapshot} /> : <ShippedTickets snapshot={snapshot} />}
      <Sources snapshot={snapshot} />
    </>
  )
}

/** A heartbeat's state, as the panel names it and colours its dot. */
const BEAT: Record<OpsHeartbeat['state'], { word: string; tone: string }> = {
  alive: { word: 'alive', tone: 'pass' },
  late: { word: 'late', tone: 'medium' },
  down: { word: 'down', tone: 'fail' },
  unknown: { word: 'unknown', tone: 'unknown' },
}

/** The background loops: the scheduler, the transcript capture and the operations loop, each with its newest run. */
function Heartbeats({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const alive = snapshot.heartbeats.filter(beat => beat.state === 'alive').length
  return (
    <section className={styles.section} aria-label="Heartbeats">
      <h2>Heartbeats <small>{alive} of {snapshot.heartbeats.length} alive</small><FactsAge snapshot={snapshot} /></h2>
      <div className={`${styles.card} ${styles.rows}`}>
        {snapshot.heartbeats.map(beat => (
          <div key={beat.id} className={styles.beat} title={beat.detail}>
            <i className={styles.statusDot} data-tone={BEAT[beat.state].tone} />
            <b>{beat.label}</b>
            <span className={styles.beatState} data-state={beat.state}>{BEAT[beat.state].word}</span>
            <span className={styles.beatLast}>
              {beat.lastPush !== undefined
                ? <>last push <Age at={beat.lastPush.at} verb="pushed" short /> ago · <a href={`${REPOSITORY}/commit/${beat.lastPush.commit}`} target="_blank" rel="noreferrer">{beat.lastPush.commit.slice(0, 7)}</a></>
                : beat.lastRunAt === undefined ? 'no run recorded' : <>last ran <Age at={beat.lastRunAt} verb="last ran" short /> ago</>} · every {span(beat.everySeconds)}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

/** The fewest items of one kind and severity the attention panel shows as one card. */
const ATTENTION_GROUP_MIN = 3

/** What a group of attention items of one kind is, counted. */
const GROUP_NOUN: Record<OpsAttentionKind, string> = {
  'ci-red': 'red Branch CI runs',
  'ticket-halted': 'tickets halted',
  'ticket-rejected': 'tickets rejected',
  'cycle-step-failed': 'failed cycle steps',
  'cycle-interrupted': 'interrupted cycles',
  'scheduler-stale': 'stale scheduler reports',
  'scheduler-down': 'scheduler reports',
  'agent-stuck': 'stuck agents',
  'shift-halted': 'halted shifts',
  'shift-failed': 'failed shifts',
  'shift-abandoned': 'abandoned shifts',
  'heartbeat-down': 'loops down or late',
  'disk-pressure': 'filesystems under pressure',
  'memory-pressure': 'memory reports',
  'owner-request': 'owner requests',
  'source-unknown': 'unread sources',
}

/** What an attention group is drawn from. */
interface AttentionGroupProps {
  severity: Severity
  kind: OpsAttentionKind
  items: readonly OpsAttention[]
}

/**
 * A run of attention items of one kind and severity as one card: the count,
 * the items' titles, the shared next action when they share one, and every
 * item in full behind a disclosure.
 * @param props - The group's severity, kind and items.
 * @returns The card.
 */
function AttentionGroup({ severity, kind, items }: AttentionGroupProps): ReactNode {
  const next = items.every(item => item.next === items[0]?.next) ? items[0]?.next : undefined
  const newest = items.map(item => item.at).filter((at): at is string => at !== undefined).sort().at(-1)
  return (
    <details className={`${styles.card} ${styles.item} ${styles.group}`} data-severity={severity}>
      <summary>
        <span className={styles.sev}>
          <i className={styles.statusDot} data-tone={severity} />{SEVERITY_LABEL[severity]} · {items.length} items{newest === undefined ? '' : ` · newest ${newest.slice(11, 16)} UTC`}
        </span>
        <h3 className={styles.itemTitle}>{items.length} {GROUP_NOUN[kind]}</h3>
        <p className={styles.itemDetail}>{items.map(item => item.title).join(' · ')}</p>
        <p className={styles.next}><b>Next:</b> {next ?? 'each item names its own; open the list.'}</p>
        <span className={styles.groupOpen}>Show all {items.length}</span>
      </summary>
      {items.map(item => <AttentionCard key={item.id} item={item} />)}
    </details>
  )
}

/** One attention item: severity, what, why, the records it rests on, and the next action. */
function AttentionCard({ item }: { item: OpsAttention }): ReactNode {
  return (
    <article className={`${styles.card} ${styles.item}`} data-severity={item.severity}>
      <span className={styles.sev}><i className={styles.statusDot} data-tone={item.severity} />{SEVERITY_LABEL[item.severity]}{item.at === undefined ? '' : ` · ${item.at.slice(11, 16)} UTC`}</span>
      <h3 className={styles.itemTitle}>{item.title}</h3>
      <p className={styles.itemDetail}>{item.detail}</p>
      <p className={styles.next}><b>Next:</b> {item.next}</p>
      {item.evidence.length === 0 ? null : (
        <div className={styles.links}>
          {item.evidence.map(link => (link.url === undefined
            ? <span key={link.label} title="a record kept on the enterprise's machine, not published">{link.label}</span>
            : <a key={link.url} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>))}
        </div>
      )}
    </article>
  )
}

/** Seats by division: occupied against defined, with the day's active seats and those working now. */
function Divisions({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const roster = useDeck(state => state.roster)
  const seats = seatReading(roster, snapshot)
  return (
    <section className={styles.section} aria-label="Seats by division">
      <h2>Divisions <small>{seats === undefined ? 'roster unknown' : `${seats.occupied} of ${seats.defined} seats occupied`}</small><Age at={seats?.asOf} /></h2>
      {seats === undefined ? <div className={styles.empty}>The roster could not be read.</div> : (
        <div className={`${styles.card} ${styles.rows}`}>
          {seats.divisions.map(division => (
            <div key={division.id} className={styles.row}>
              <i style={{ background: divisionColor(division.id) }} />
              <b>{division.name}</b>
              <span>{division.occupied}/{division.defined} · {division.activeToday} active{division.workingNow === 0 ? '' : ` · ${division.workingNow} working`}</span>
              <div className={styles.meter} aria-hidden="true"><i style={{ width: `${division.defined === 0 ? 0 : (division.occupied / division.defined) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** The latest shipped commits and the Branch CI verdict that covers each. */
function Shipped({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const shipped = snapshot.big.shipped
  const tone = { pass: 'pass', fail: 'fail', running: 'running', cancelled: 'unknown', 'no-run': 'unknown', unknown: 'unknown' } as const
  const words = { pass: 'CI green', fail: 'CI red', running: 'CI running', cancelled: 'CI cancelled', 'no-run': 'no CI run yet', unknown: 'CI unknown' } as const
  return (
    <section className={styles.section} aria-label="Latest shipped commits">
      <h2>Latest shipped <small>{shipped === null ? 'ledger unknown' : `${shipped.length} commits`}</small><FactsAge snapshot={snapshot} sources={['ledger', 'ci']} /></h2>
      {shipped === null || shipped.length === 0 ? <div className={styles.empty}>{shipped === null ? 'The ledger could not be read.' : 'The ledger records no shipped commit.'}</div> : (
        <div className={`${styles.card} ${styles.rows}`}>
          {shipped.map(entry => (
            <div key={entry.commit} className={styles.commit}>
              <a href={`${REPOSITORY}/commit/${entry.commit}`} target="_blank" rel="noreferrer">{entry.commit.slice(0, 7)}</a>
              <span title={entry.tickets.join(', ')}>{entry.tickets.join(', ')} · {entry.at.slice(5, 16).replace('T', ' ')}</span>
              {entry.url === undefined
                ? <span className={styles.verdict}><i className={styles.statusDot} data-tone={tone[entry.ci]} />{words[entry.ci]}</span>
                : <a className={styles.verdict} href={entry.url} target="_blank" rel="noreferrer" title={entry.ciCommit === undefined ? undefined : `verdict of the run on ${entry.ciCommit.slice(0, 9)}, which contains it`}><i className={styles.statusDot} data-tone={tone[entry.ci]} />{words[entry.ci]}{entry.ciCommit === undefined ? '' : ' (later run)'}</a>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Every source the snapshot read, how old its facts are, and why any could not be read. */
function Sources({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const sources: readonly OpsSource[] = snapshot.sources
  return (
    <section className={styles.section} aria-label="Sources">
      <h2>Sources <small>{sources.filter(source => source.state === 'ok').length} of {sources.length} read</small><FactsAge snapshot={snapshot} /></h2>
      <div className={`${styles.card} ${styles.rows}`}>
        {sources.map(source => (
          <div key={source.id} className={styles.source}>
            <i className={styles.statusDot} data-tone={source.state === 'ok' ? 'ok' : 'unknown'} />
            <b>{source.id}{source.state === 'ok' ? '' : ' · unknown'}{source.state === 'ok' ? <Age at={source.asOf} /> : null}</b>
            <span>{source.detail}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
