'use client'

import type { ReactNode } from 'react'
import type { OpsCycle, OpsCycleStep, OpsShift, OpsShiftStage, OpsShiftTicket, OpsShipped, OpsSnapshot } from '@/deck/contract'
import { countdown, factsAsOf, formatAge, SHIFT_TRACK, slotProgress, trackReached } from '@/deck/ops'
import { divisionColor } from '@/deck/palette'
import { REPOSITORY } from '@/deck/repository'
import { Age, useNow } from './Age.tsx'
import styles from './ops.module.css'

/**
 * `HH:MM` of an ISO time, with the month and day in front when it falls on
 * another UTC day than the snapshot.
 * @param at - The ISO time.
 * @param day - The snapshot's UTC day, `YYYY-MM-DD`.
 * @returns `08:13` or `09-28 22:13`.
 */
function when(at: string, day: string): string {
  return at.slice(0, 10) === day ? at.slice(11, 16) : `${at.slice(5, 10)} ${at.slice(11, 16)}`
}

/** A cycle's outcome in words. */
function outcomeWord(cycle: OpsCycle): string {
  switch (cycle.outcome) {
    case 'running': return 'running'
    case 'clean': return 'clean'
    case 'failed': return cycle.exit === undefined || cycle.exit === 0 ? 'step failed' : `exit ${cycle.exit}`
    case 'refused': return cycle.exit === undefined ? 'refused' : `refused · exit ${cycle.exit}`
    case 'interrupted': return 'interrupted'
    case 'unknown': return 'log erased'
    default: return cycle.outcome satisfies never
  }
}

/** One step's state in words, for its title. */
function stepTitle(step: OpsCycleStep, now: number): string {
  switch (step.state) {
    case 'ok': return `${step.name}: exit 0${step.seconds === undefined ? '' : ` after ${formatAge(step.seconds * 1000)}`}`
    case 'failed': return `${step.name}: exit ${step.exit ?? '?'}${step.seconds === undefined ? '' : ` after ${formatAge(step.seconds * 1000)}`}`
    case 'running': return `${step.name}: running for ${step.at === undefined ? 'an unknown time' : formatAge(Math.max(0, now - Date.parse(step.at)))}`
    case 'pending': return `${step.name}: not reached yet`
    default: return step.state satisfies never
  }
}

/**
 * The scheduler's clock on the operations floor: the running cycle's step and
 * progress through its steps, else the countdown to the slot the scheduler
 * announced, as a ring filling from the newest cycle start to that slot.
 * @param props - The snapshot.
 * @returns The clock, or nothing when no cycle source was read.
 */
export function CycleClock({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const now = useNow()
  const summary = snapshot.big.cycles
  if (summary === null) return null
  const running = snapshot.cycles?.find(cycle => cycle.outcome === 'running')
  const scheduler = snapshot.heartbeats.find(beat => beat.id === 'scheduler')
  let label: string
  let value: string
  let sub: string
  let progress: number | undefined
  if (running !== undefined) {
    const done = running.steps.filter(step => step.state === 'ok' || step.state === 'failed').length
    const step = running.steps.find(entry => entry.state === 'running')
    label = 'Cycle running'
    value = step?.name ?? 'running'
    sub = `step ${done + 1} of ${running.steps.length}${step?.at === undefined ? '' : ` · ${formatAge(Math.max(0, now - Date.parse(step.at)))}`}`
    progress = running.steps.length === 0 ? undefined : done / running.steps.length
  } else if (summary.running !== undefined) {
    label = 'Cycle running'
    value = summary.running.slice(-7, -3).replace(/(\d{2})(\d{2})/, '$1:$2')
    sub = 'started UTC'
  } else if (summary.nextAt !== undefined) {
    label = 'Next cycle'
    value = countdown(summary.nextAt, now) ?? '—'
    sub = `at ${summary.nextAt.slice(11, 16)} UTC`
    progress = slotProgress(summary.lastStartedAt, summary.nextAt, now)
  } else {
    label = 'Next cycle'
    value = '—'
    sub = 'no slot announced'
  }
  const radius = 42
  const circumference = 2 * Math.PI * radius
  return (
    <div className={styles.clock} data-state={running === undefined && summary.running === undefined ? 'waiting' : 'running'} role="timer" aria-label={`${label}: ${value}, ${sub}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className={styles.clockTrack} cx="50" cy="50" r={radius} />
        {progress === undefined ? null : (
          <circle
            className={styles.clockArc}
            cx="50"
            cy="50"
            r={radius}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            transform="rotate(-90 50 50)"
          />
        )}
      </svg>
      <div className={styles.clockText}>
        <span className={styles.clockLabel}>{label}</span>
        <b className={styles.clockValue}>{value}</b>
        <span className={styles.clockSub}>{sub}</span>
        <span className={styles.clockBeat} data-state={scheduler?.state ?? 'unknown'}>scheduler {scheduler?.state ?? 'unknown'} · <Age at={factsAsOf(snapshot, ['scheduler'])} short /></span>
      </div>
    </div>
  )
}

/**
 * The first item of the attention queue across the top: what needs the
 * operator now and the exact next action.
 * @param props - The snapshot.
 * @returns The banner, or a clear line when nothing is flagged.
 */
export function NextAction({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const first = snapshot.attention[0]
  if (first === undefined) {
    return <div className={styles.nextAction} data-severity="clear"><i className={styles.statusDot} data-tone="clear" /><b>Nothing needs you now.</b><span>No red CI, halt, failed step, stale loop or pressure in this snapshot.</span></div>
  }
  const link = first.evidence.find(entry => entry.url !== undefined)
  return (
    <div className={styles.nextAction} data-severity={first.severity}>
      <i className={styles.statusDot} data-tone={first.severity} />
      <b>Do next{snapshot.attention.length === 1 ? '' : ` · 1 of ${snapshot.attention.length}`}:</b>
      <span className={styles.nextTitle}>{first.title}</span>
      <span className={styles.nextStep}>{first.next}</span>
      {link?.url === undefined ? null : <a href={link.url} target="_blank" rel="noreferrer">{link.label}</a>}
    </div>
  )
}

/**
 * The band under the floor: the cycle timeline and the shift board.
 * @param props - The snapshot.
 * @returns The band, or nothing for a snapshot written before the collector reported either.
 */
export function MissionBand({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  if (snapshot.cycles === undefined && snapshot.shift === undefined) return null
  return (
    <div className={styles.band}>
      <CycleTimeline snapshot={snapshot} />
      <ShiftBoard snapshot={snapshot} />
    </div>
  )
}

/**
 * The step columns of the cycle matrix: every step name the window's cycles
 * logged, in the order the most complete cycle ran them, then any other name
 * in the order it first appears.
 * @param cycles - The window's cycles.
 * @returns The step names.
 */
function stepColumns(cycles: readonly OpsCycle[]): string[] {
  const fullest = [...cycles].sort((a, b) => b.steps.length - a.steps.length)[0]
  const columns = (fullest?.steps ?? []).map(step => step.name)
  for (const cycle of cycles) for (const step of cycle.steps) if (!columns.includes(step.name)) columns.push(step.name)
  return columns
}

/** The window's cycles, newest first, one row each with every step's exit status, under the scheduler's next slot. */
function CycleTimeline({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const now = useNow()
  const cycles = snapshot.cycles
  const summary = snapshot.big.cycles
  const day = snapshot.generatedAt.slice(0, 10)
  const running = cycles?.some(cycle => cycle.outcome === 'running') ?? false
  const columns = stepColumns(cycles ?? [])
  const clean = cycles?.filter(cycle => cycle.outcome === 'clean').length ?? 0
  const failed = cycles?.filter(cycle => cycle.outcome === 'failed' || cycle.outcome === 'interrupted').length ?? 0
  return (
    <section className={styles.bandPanel} aria-label="Cycles">
      <div className={styles.sectionHead}>
        <h2>Cycles · 24 h</h2>
        <p>{cycles === null || cycles === undefined ? 'unknown' : `${cycles.length} cycles · ${clean} clean · ${failed} failed`}</p>
        <Age at={factsAsOf(snapshot, ['cycle-logs', 'scheduler'])} />
      </div>
      {cycles === null || cycles === undefined ? (
        <div className={styles.empty}>Neither the cycle logs nor the branch history could be read.</div>
      ) : (
        <div className={styles.matrixScroll}>
          <div className={styles.matrix} style={{ gridTemplateColumns: `max-content max-content repeat(${Math.max(1, columns.length)}, minmax(22px, 28px)) minmax(120px, 1fr)` }} role="table" aria-label="Each cycle's steps and their exit codes">
            <div className={styles.matrixRow} role="row">
              <span className={styles.matrixHead} role="columnheader">UTC</span>
              <span className={styles.matrixHead} role="columnheader">outcome</span>
              {columns.map(name => <span key={name} className={styles.matrixHead} data-step role="columnheader" title={name}><span>{name}</span></span>)}
              <span className={styles.matrixHead} role="columnheader">delivered</span>
            </div>
            {summary?.nextAt === undefined || running ? null : (
              <div className={styles.matrixRow} role="row" data-outcome="next">
                <span className={styles.cycleWhen} role="cell">{when(summary.nextAt, day)}</span>
                <span className={styles.cycleState} role="cell">in {countdown(summary.nextAt, now)}</span>
                {columns.map(name => <i key={name} className={styles.cell} role="cell" data-state="pending" title={`${name}: scheduled`} />)}
                <span className={styles.cycleSum} role="cell">the scheduler&apos;s next slot</span>
              </div>
            )}
            {cycles.map(cycle => (
              <div key={cycle.cycle} className={styles.matrixRow} role="row" data-outcome={cycle.outcome}>
                <span className={styles.cycleWhen} role="cell">
                  {cycle.evidence.url === undefined ? when(cycle.startedAt, day) : <a href={cycle.evidence.url} target="_blank" rel="noreferrer" title={cycle.evidence.label}>{when(cycle.startedAt, day)}</a>}
                </span>
                <span className={styles.cycleState} role="cell" data-outcome={cycle.outcome}>{outcomeWord(cycle)}</span>
                {cycle.steps.length === 0 ? (
                  <em className={styles.cycleNote} role="cell" style={{ gridColumn: `span ${Math.max(1, columns.length)}` }}>{cycle.detail ?? (cycle.source === 'history' ? 'its log is gone; only its commits remain' : 'no step logged')}</em>
                ) : columns.map((name) => {
                  const step = cycle.steps.find(entry => entry.name === name)
                  return step === undefined
                    ? <i key={name} className={styles.cell} role="cell" data-state="absent" title={`${name}: did not run`} />
                    : <i key={name} className={styles.cell} role="cell" data-state={step.state} title={stepTitle(step, now)}>{step.state === 'failed' ? step.exit : null}</i>
                })}
                <span className={styles.cycleSum} role="cell" title={cycleDetail(cycle)}>{cycleSummary(cycle) || (cycle.shift === undefined ? '' : `shift ${cycle.shift}`)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** What a cycle delivered in full words, for the delivered cell's title. */
function cycleDetail(cycle: OpsCycle): string {
  const parts: string[] = []
  if (cycle.shift !== undefined) parts.push(`shift ${cycle.shift}`)
  if (cycle.tickets !== undefined) parts.push(`tickets: ${cycle.tickets.shipped} shipped, ${cycle.tickets.rejected} rejected, ${cycle.tickets.halted} halted`)
  if (cycle.functions !== undefined) parts.push(`gates: ${cycle.functions.pass} pass, ${cycle.functions.fail} fail, ${cycle.functions.error} error`)
  return parts.join('; ')
}

/** What a cycle delivered, from its record: its tickets shipped of those worked, and its gates passed of those run. */
function cycleSummary(cycle: OpsCycle): string {
  const parts: string[] = []
  if (cycle.tickets !== undefined) {
    const { shipped, rejected, halted } = cycle.tickets
    const total = shipped + rejected + halted
    if (total > 0) parts.push(`${shipped}/${total} shipped`)
  }
  if (cycle.functions !== undefined) {
    const total = cycle.functions.pass + cycle.functions.fail + cycle.functions.error
    if (total > 0) parts.push(`${cycle.functions.pass}/${total} gates`)
  }
  return parts.join(' · ')
}

/**
 * How a ticket line written after the fact reads: a shipped ticket whose push
 * its writer did not finish, else a line recorded later, with who wrote it.
 * @param shipped - Whether the line records the ticket shipped.
 * @param by - Who wrote the line, as the ledger names it.
 * @returns `recovered push (supervisor)` or `recorded after the fact (supervisor)`.
 */
function recordedWords(shipped: boolean, by: string): string {
  return shipped ? `recovered push (${by})` : `recorded after the fact (${by})`
}

/** A shift stage in words. */
const STAGE_WORD: Record<OpsShiftStage, string> = {
  queued: 'queued',
  working: 'working',
  certified: 'certified',
  review: 'in review',
  integration: 'integration',
  shipped: 'shipped',
  rejected: 'rejected',
  halted: 'halted',
}

/** The shift running now, else the newest: each ticket's stage along the pipeline. */
function ShiftBoard({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const now = useNow()
  const shift: OpsShift | null | undefined = snapshot.shift
  if (shift === undefined) return null
  const day = snapshot.generatedAt.slice(0, 10)
  const live = shift?.state === 'running'
  return (
    <section className={styles.bandPanel} aria-label="Shift">
      <div className={styles.sectionHead}>
        <h2>{shift === null ? 'Shift' : live ? `Shift ${shift.shift} · running` : `Last shift ${shift.shift}`}</h2>
        <p>
          {shift === null ? 'no shift known' : live
            ? `since ${when(shift.startedAt, day)} UTC · ${formatAge(Math.max(0, now - Date.parse(shift.startedAt)))}`
            : `${when(shift.startedAt, day)}–${shift.endedAt === undefined ? '?' : when(shift.endedAt, day)} UTC`}
        </p>
        <Age at={factsAsOf(snapshot, shift?.source === 'record' ? ['ledger'] : ['shifts'])} />
      </div>
      {shift === null ? <div className={styles.empty}>No shift has run on this machine and none is recorded on the branch.</div> : (
        <>
          {shift.tickets.length === 0 ? <div className={styles.empty}>The shift names no ticket.</div> : null}
          <div className={styles.tickets}>
            {shift.tickets.map(ticket => <ShiftTicketRow key={ticket.ticket} ticket={ticket} live={live} day={day} />)}
          </div>
          <div className={styles.links}>
            {shift.evidence.url === undefined
              ? <span title="a record kept on the enterprise's machine, not published">{shift.evidence.label}</span>
              : <a href={shift.evidence.url} target="_blank" rel="noreferrer">{shift.evidence.label}</a>}
          </div>
        </>
      )}
    </section>
  )
}

/** One ticket of the shift: its title, its seat's division, and the track up to its stage. */
function ShiftTicketRow({ ticket, live, day }: { ticket: OpsShiftTicket; live: boolean; day: string }): ReactNode {
  const reached = trackReached(ticket)
  const ended = ticket.stage === 'shipped' || ticket.stage === 'rejected' || ticket.stage === 'halted'
  return (
    <div className={styles.ticket} data-stage={ticket.stage}>
      <div className={styles.ticketHead}>
        <i style={{ background: ticket.division === undefined ? 'var(--o-unknown)' : divisionColor(ticket.division) }} />
        <b>{ticket.ticket}</b>
        <span title={ticket.title}>{ticket.title ?? ticket.seat ?? ''}</span>
        <em data-stage={ticket.stage}>{STAGE_WORD[ticket.stage]}{ticket.since === undefined ? '' : ` · ${when(ticket.since, day)}`}</em>
      </div>
      <div className={styles.track} aria-label={`${ticket.ticket}: ${STAGE_WORD[ticket.stage]}`}>
        {SHIFT_TRACK.map((stage, index) => (
          <span
            key={stage}
            data-on={index < reached}
            data-current={!ended && live && index === reached - 1}
            data-stop={ended && ticket.stage !== 'shipped' && index === reached - 1}
          >
            {stage}
          </span>
        ))}
        <span data-end={ticket.stage}>{ended ? STAGE_WORD[ticket.stage] : 'ship'}</span>
      </div>
      {ticket.recordedBy === undefined ? null : <p className={styles.recorded}>{recordedWords(ticket.stage === 'shipped', ticket.recordedBy)}</p>}
      {ticket.reason === undefined ? null : <p className={styles.ticketWhy} title={ticket.reason}>{ticket.reason}</p>}
      {ticket.commit === undefined ? null : <p className={styles.ticketWhy}><a href={`${REPOSITORY}/commit/${ticket.commit}`} target="_blank" rel="noreferrer">commit {ticket.commit.slice(0, 9)}</a></p>}
    </div>
  )
}

/** Each Branch CI verdict in words and tone. */
const VERDICT: Record<OpsShipped['ci'], { word: string; tone: string }> = {
  pass: { word: 'CI green', tone: 'pass' },
  fail: { word: 'CI red', tone: 'fail' },
  running: { word: 'CI running', tone: 'running' },
  cancelled: { word: 'CI cancelled', tone: 'unknown' },
  'no-run': { word: 'no CI run yet', tone: 'unknown' },
  unknown: { word: 'CI unknown', tone: 'unknown' },
}

/**
 * Which run a shipped ticket's verdict was read from, in words.
 * @param ciCommit - The later commit the run ran on, when it is not the ticket's own.
 * @returns The link's title.
 */
function verdictTitle(ciCommit: string | undefined): string {
  return ciCommit === undefined ? 'the run on this commit' : `the first later run that rendered a verdict, on ${ciCommit.slice(0, 9)}, which contains it`
}

/**
 * The newest shipped tickets, each with its commit and the Branch CI verdict
 * that covers it.
 * @param props - The snapshot.
 * @returns The panel, or nothing for a snapshot written before the collector listed tickets.
 */
export function ShippedTickets({ snapshot }: { snapshot: OpsSnapshot }): ReactNode {
  const shipped = snapshot.big.shippedTickets
  if (shipped === undefined) return null
  const day = snapshot.generatedAt.slice(0, 10)
  return (
    <section className={styles.section} aria-label="Shipped tickets">
      <h2>Shipped tickets <small>{shipped === null ? 'ledger unknown' : `${shipped.length} newest · commit · CI verdict`}</small><Age at={factsAsOf(snapshot, ['ledger', 'ci'])} /></h2>
      {shipped === null || shipped.length === 0 ? <div className={styles.empty}>{shipped === null ? 'The ledger could not be read.' : 'The ledger records no shipped ticket.'}</div> : (
        <div className={`${styles.card} ${styles.rows}`}>
          {shipped.map(entry => (
            <div key={entry.ticket} className={styles.shipRow}>
              <div className={styles.shipTop}>
                <b>{entry.ticket}</b>
                <span className={styles.shipTitle} title={entry.title}>{entry.title ?? entry.seat}</span>
              </div>
              <div className={styles.shipBottom}>
                <span className={styles.shipMeta}>
                  <a href={`${REPOSITORY}/commit/${entry.commit}`} target="_blank" rel="noreferrer">{entry.commit.slice(0, 7)}</a>
                  {' · '}{when(entry.at, day)} UTC · shift {entry.shift}
                  {entry.recordedBy === undefined
                    ? null
                    : <span className={styles.recorded}> · {recordedWords(true, entry.recordedBy)}</span>}
                </span>
                {entry.url === undefined
                  ? (
                    <span className={styles.verdict}>
                      <i className={styles.statusDot} data-tone={VERDICT[entry.ci].tone} />{VERDICT[entry.ci].word}
                    </span>
                  )
                  : (
                    <a className={styles.verdict} href={entry.url} target="_blank" rel="noreferrer" title={verdictTitle(entry.ciCommit)}>
                      <i className={styles.statusDot} data-tone={VERDICT[entry.ci].tone} />
                      {VERDICT[entry.ci].word}{entry.ciCommit === undefined ? '' : ` · later run ${entry.ciCommit.slice(0, 7)}`}
                    </a>
                  )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
