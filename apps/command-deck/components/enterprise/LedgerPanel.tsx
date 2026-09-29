'use client'

import { useMemo, type ReactNode } from 'react'
import type { EnterpriseReport, FunctionOutcome, FunctionRun, TicketStatus, TicketSummary } from '@/deck/contract'
import { stamp } from '@/deck/format'
import { divisionColor } from '@/deck/palette'
import { useDeck } from '@/deck/store'
import { workPhrase } from './evidence.ts'

/** Colour of one outcome: the palette's green, red and amber. */
const OUTCOME_COLOR: Record<FunctionOutcome, string> = {
  pass: 'var(--green)',
  fail: 'var(--red)',
  error: 'var(--amber)',
}

/** The ticket statuses in the order the panel lists them, with what each means. */
const TICKET_STATUSES: readonly { status: TicketStatus; label: string; meaning: string }[] = [
  { status: 'queued', label: 'queued', meaning: 'in the queue, no ledger line yet' },
  { status: 'shipped', label: 'shipped', meaning: 'reviewed, integrated and merged as a commit' },
  { status: 'rejected', label: 'rejected', meaning: 'an acceptance check failed or the reviewer did not approve' },
  { status: 'halted', label: 'halted', meaning: 'the department stopped short of review' },
]

/** How many tickets of one status the panel names before it counts the rest. */
const TICKETS_SHOWN = 8

/** How many seats a shift's runs are named for; older shifts are summed. */
const SHIFTS_NAMED = 1

/**
 * A seat id without its division prefix, as the chips name it.
 * @param seat - The seat id.
 * @param division - Its division id.
 * @returns The short name.
 */
function shortSeat(seat: string, division: string): string {
  return seat.startsWith(`${division}-`) ? seat.slice(division.length + 1) : seat
}

/**
 * @param seconds - A duration.
 * @returns Such as `12s` or `14m 32s`.
 */
function spell(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/** One outcome chip, the seat's short name in the outcome's colour. */
function OutcomeChip({ run }: { run: FunctionRun }): ReactNode {
  const href = 'url' in run.evidence ? run.evidence.url : undefined
  const body = (
    <span className="chip" style={{ color: OUTCOME_COLOR[run.outcome], borderColor: 'currentColor' }} title={`${run.function}: ${run.outcome}, ${'url' in run.evidence ? `CI job time ${spell(run.seconds)}, read from GitHub` : `ran ${spell(run.seconds)}`}`}>
      {shortSeat(run.seat, run.division)} · {run.outcome}
    </span>
  )
  return href === undefined ? body : <a href={href} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>{body}</a>
}

/** The count of each outcome over some runs, in pass, fail, error order. */
function tally(runs: readonly FunctionRun[]): string {
  const counts = { pass: 0, fail: 0, error: 0 }
  for (const run of runs) counts[run.outcome] += 1
  return `${counts.pass} pass · ${counts.fail} fail · ${counts.error} error`
}

/** One ticket row: id, seat, and the commit or reason its line states. */
function TicketRow({ ticket }: { ticket: TicketSummary }): ReactNode {
  return (
    <div className="routes__row" data-run={ticket.status !== 'queued'}>
      <span className="mono">{ticket.ticket}</span>
      <b style={{ color: divisionColor(ticket.division), fontWeight: 500, fontSize: 12 }}>{shortSeat(ticket.seat, ticket.division)}</b>
      <span>
        {ticket.status === 'queued'
          ? ticket.title ?? ''
          : ticket.at === undefined ? '' : stamp(ticket.at)}
        {ticket.commit === undefined ? '' : ` · ${ticket.commit.slice(0, 10)}`}
        {ticket.reason === undefined ? '' : ` · ${ticket.reason}`}
      </span>
    </div>
  )
}

/**
 * The Ledger tab: seats occupied and active per division, the tickets of the
 * enterprise's current day by status, the function runs of that day by
 * shift, and the latest shipped commits with their CI verdicts, all read from
 * the published `enterprise.json`.
 * @returns The tab body.
 */
export function LedgerPanel(): ReactNode {
  const report: EnterpriseReport | undefined = useDeck(state => state.enterprise)
  const shifts = useMemo(() => {
    const byShift = new Map<string, FunctionRun[]>()
    for (const run of report?.functions ?? []) byShift.set(run.shift, [...byShift.get(run.shift) ?? [], run])
    return [...byShift.entries()]
  }, [report])

  if (report === undefined) {
    return <div className="panel__empty">No enterprise report is bundled: `pnpm run enterprise:publish` writes it from the roster and the ledger.</div>
  }

  return (
    <>
      <p className="evidence-lead">
        As of {stamp(report.asOf)}. The enterprise's day runs from {stamp(report.window.since)} to {stamp(report.window.until)};
        a seat is occupied only by a recorded deliverable and active only by one dated inside that day.
        The ledger holds {report.ledger.lines} lines: {report.ledger.tickets} tickets, {report.ledger.functions} function runs
        {report.ledger.skipped === 0 ? '' : `, ${report.ledger.skipped} unreadable`}.
      </p>

      <div className="section">
        <h3>Divisions · occupied / defined · active in the window</h3>
        <div className="routes">
          {report.divisions.map(division => (
            <div className="routes__row" key={division.id} data-run={division.occupied > 0}>
              <span style={{ color: divisionColor(division.id) }}>{division.name}</span>
              <b>{division.occupied} / {division.defined}</b>
              <span>{division.active === 0 ? 'none active' : `${division.active} active${division.work === undefined ? '' : `: ${workPhrase(division.work)}`}`}</span>
            </div>
          ))}
          <div className="routes__row" data-run="true">
            <span>All divisions</span>
            <b>{report.counts.occupied} / {report.counts.defined}</b>
            <span>{report.counts.active} active{report.counts.work === undefined ? '' : `: ${workPhrase(report.counts.work.active)}`}</span>
          </div>
        </div>
      </div>

      <div className="section">
        <h3>Tickets in the window</h3>
        {TICKET_STATUSES.map(({ status, label, meaning }) => {
          const tickets = report.tickets[status]
          return (
            <div key={status} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 4 }}>
                <b style={{ color: 'var(--ink)' }}>{tickets.length}</b> {label}
                <span style={{ color: 'var(--ink-3)' }}> · {meaning}</span>
              </div>
              {tickets.length === 0 ? null : (
                <div className="routes">
                  {tickets.slice(0, TICKETS_SHOWN).map(ticket => <TicketRow ticket={ticket} key={ticket.ticket} />)}
                  {tickets.length > TICKETS_SHOWN ? <div className="routes__row" data-run="false"><span /><b /><span>and {tickets.length - TICKETS_SHOWN} more</span></div> : null}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="section">
        <h3>Function runs in the window</h3>
        {report.functions.length === 0
          ? <div className="panel__empty">No seat performed a function inside the day.</div>
          : (
            <>
              <p className="evidence-lead">{report.functions.length} runs in {shifts.length} {shifts.length === 1 ? 'shift' : 'shifts'}: {tally(report.functions)}.</p>
              {shifts.map(([shift, runs], index) => (
                <div key={shift} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 4 }}>
                    <span className="mono">{shift}</span>
                    <span style={{ color: 'var(--ink-3)' }}> · {stamp(runs[0]?.at ?? report.asOf)} · {tally(runs)}</span>
                  </div>
                  {index < SHIFTS_NAMED ? <div className="chips">{runs.map(run => <OutcomeChip run={run} key={`${run.seat}-${run.at}-${run.function}`} />)}</div> : null}
                </div>
              ))}
            </>
          )}
      </div>

      <div className="section">
        <h3>Latest shipped commits · CI verdicts</h3>
        {report.shipped.length === 0
          ? <div className="panel__empty">No ticket has shipped a commit yet.</div>
          : report.shipped.map(entry => (
            <div key={entry.commit} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', marginBottom: 4 }}>
                <span className="mono">{entry.commit.slice(0, 10)}</span>
                <span style={{ color: 'var(--ink-3)' }}> · {stamp(entry.at)} · {entry.tickets.join(', ')} · {entry.seats.map(seat => shortSeat(seat, 'harness-core')).join(', ')}</span>
              </div>
              {entry.verdicts.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>no CI verdict recorded on this commit yet</div>
                : (
                  <div className="chips">
                    {entry.verdicts.map(verdict => (
                      <a href={verdict.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }} key={`${verdict.seat}-${verdict.url}`}>
                        <span className="chip" style={{ color: OUTCOME_COLOR[verdict.outcome], borderColor: 'currentColor' }} title={`${verdict.seat} at ${stamp(verdict.at)}`}>
                          {verdict.function} · {verdict.outcome}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
            </div>
          ))}
      </div>
    </>
  )
}
