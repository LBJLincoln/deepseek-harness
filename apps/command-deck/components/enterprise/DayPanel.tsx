'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { DayCycle, DayEffortTotal, DayShippedCommit, DayShippedTicket, EnterpriseDay } from '@/deck/contract'
import { getEnterpriseDay } from '@/deck/feed'
import { stamp } from '@/deck/format'
import { divisionColor } from '@/deck/palette'

/**
 * Colour of a Branch CI verdict: the palette's green for success, red for
 * failure, amber for any other ending or a run still in progress, and the
 * dim ink for no run or an unknown verdict.
 * @param verdict - The report's phrase for the verdict.
 * @returns A CSS colour.
 */
function verdictColor(verdict: string): string {
  if (verdict === 'success') return 'var(--green)'
  if (verdict === 'failure') return 'var(--red)'
  if (verdict === 'no run' || verdict === 'unknown') return 'var(--ink-3)'
  return 'var(--amber)'
}

/**
 * @param cycle - One cycle of the report.
 * @returns Its outcome as a phrase and a colour: clean, the first failed step, or unknown without a record.
 */
function cycleOutcome(cycle: DayCycle): { text: string; color: string } {
  if (cycle.record === undefined) return { text: 'no record · outcome unknown', color: 'var(--ink-3)' }
  if (cycle.record.firstFailure === null) return { text: 'clean', color: 'var(--green)' }
  return { text: `failed at ${cycle.record.firstFailure.step} (exit ${cycle.record.firstFailure.exit})`, color: 'var(--red)' }
}

/**
 * @param entry - A shipped commit with its Branch CI answer.
 * @returns Which run the verdict comes from, in words, and its page when a run gave it.
 */
function verdictSource(entry: DayShippedCommit): { basis: string; url?: string } {
  switch (entry.ci.basis) {
    case 'exact': {
      const run = entry.ci.runs.find(candidate => candidate.status === 'completed') ?? entry.ci.runs[0]
      return { basis: 'a run on this exact commit', ...run === undefined ? {} : { url: run.url } }
    }
    case 'later': return { basis: `the first later run containing it, on ${entry.ci.run.headSha.slice(0, 10)}`, url: entry.ci.run.url }
    case 'none': return { basis: 'no run on it or after it contains it' }
    case 'unknown': return { basis: entry.ci.reason }
    default: return entry.ci satisfies never
  }
}

/** One shipped ticket: its id, its commit, and the commit's CI verdict chip linking to the run. */
function ShippedRow({ ticket, entry }: { ticket: DayShippedTicket; entry: DayShippedCommit | undefined }): ReactNode {
  const verdict = entry?.verdict ?? 'unknown'
  const source = entry === undefined ? { basis: 'no answer was read' } : verdictSource(entry)
  const chip = (
    <span className="chip" style={{ color: verdictColor(verdict), borderColor: 'currentColor' }} title={`Branch CI: ${source.basis}`}>
      CI · {verdict}{entry?.ci.basis === 'later' ? ' · later run' : ''}
    </span>
  )
  return (
    <div className="routes__row" data-run="true">
      <span className="mono">{ticket.ticket}</span>
      <b className="mono" style={{ fontWeight: 500, fontSize: 11 }}>{ticket.commit.slice(0, 10)}</b>
      <span>{source.url === undefined ? chip : <a href={source.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>{chip}</a>}</span>
    </div>
  )
}

/**
 * The 24 hours tab: the report `pnpm run enterprise:publish` publishes over
 * the 24 hours ending at the roster's stamp — the pilot's headline counts, the
 * cycles run with their outcomes and starters, the shifts, the tickets shipped
 * by division with each commit's Branch CI verdict (labelled when a later run
 * gave it) and the review outcomes, the spend per source, the seats active by
 * division, and every fact the data does not show — read from
 * `fixtures/enterprise-day.json`.
 * @returns The tab body.
 */
export function DayPanel(): ReactNode {
  const [day, setDay] = useState<EnterpriseDay | null | undefined>(undefined)
  useEffect(() => {
    let mounted = true
    void getEnterpriseDay().then((read) => {
      if (mounted) setDay(read ?? null)
    })
    return () => {
      mounted = false
    }
  }, [])

  if (day === undefined) return <div className="panel__empty">Reading the published 24-hour report…</div>
  if (day === null) return <div className="panel__empty">No 24-hour report is bundled: `pnpm run enterprise:publish` writes it with the deck's data.</div>

  const verdicts = new Map(day.commits.map(entry => [entry.commit, entry]))
  const divisions = [...new Set(day.tickets.shipped.map(ticket => ticket.division))].sort()
  const { cycles } = day
  const { reviews } = day.tickets
  const effort: DayEffortTotal[] = Array.isArray(day.effort) ? day.effort as DayEffortTotal[] : []

  return (
    <>
      {day.headline === undefined ? null : <p className="evidence-lead" style={{ color: 'var(--ink)' }}>{day.headline}</p>}
      <p className="evidence-lead">
        From {stamp(day.window.since)} to {stamp(day.window.until)}, read from commit <span className="mono">{day.head.commit.slice(0, 10)}</span>:
        the cycle, shift and intake records, the ledger, the recorded sessions, the git history and the Branch CI runs. A cycle's record
        is committed after the deck's data, so the cycle that published this report shows without one.
      </p>

      <div className="section">
        <h3>Cycles · {cycles.count} run</h3>
        <p className="evidence-lead">
          {cycles.recorded} recorded: {cycles.clean} clean, {cycles.failed} failed; {cycles.gitOnly} seen only in git history.
        </p>
        {cycles.list.length === 0 ? <div className="panel__empty">No cycle started in these 24 hours.</div> : (
          <div className="routes">
            {cycles.list.map((cycle) => {
              const outcome = cycleOutcome(cycle)
              return (
                <div className="routes__row" key={cycle.cycle} data-run={cycle.record !== undefined}>
                  <span className="mono">{stamp(cycle.startedAt)}</span>
                  <b style={{ color: outcome.color, fontWeight: 500, fontSize: 11 }}>{outcome.text}</b>
                  <span title={cycle.startedBy?.basis}>
                    {cycle.startedBy === undefined || cycle.startedBy.by === 'unknown' ? 'starter unknown' : `by the ${cycle.startedBy.by}`}
                    {' · '}
                    {cycle.record === undefined
                      ? `pushed: ${cycle.commits.map(commit => commit.carries).join(' · ') || 'nothing'}`
                      : `${cycle.record.tickets.shipped} shipped · ${cycle.record.functions.pass} pass · ${cycle.record.functions.fail} fail · ${cycle.record.functions.error} error`}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {day.shifts === undefined ? null : (
        <div className="section">
          <h3>Shifts · {day.shifts.length}</h3>
          {day.shifts.length === 0 ? <div className="panel__empty">No shift in these 24 hours.</div> : (
            <div className="routes">
              {day.shifts.map(shift => (
                <div className="routes__row" key={shift.shift} data-run={shift.source === 'record'} title={shift.evidence}>
                  <span className="mono">{shift.shift}</span>
                  <b style={{ color: shift.source === 'lost' ? 'var(--red)' : 'var(--ink-2)', fontWeight: 500, fontSize: 11 }}>{shift.outcome}</b>
                  <span>{shift.tickets.shipped} shipped · {shift.tickets.rejected} rejected · {shift.tickets.halted} halted</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="section">
        <h3>Tickets shipped · by division · Branch CI</h3>
        <p className="evidence-lead">
          {day.tickets.lines} ticket lines: {day.tickets.byStatus.shipped} shipped, {day.tickets.byStatus.rejected} rejected,
          {' '}{day.tickets.byStatus.halted} halted
          {reviews === undefined ? '.' : `; reviews ${reviews.approved} approved, ${reviews.rejected} rejected, ${reviews.notReached} not reached.`}
        </p>
        {divisions.length === 0 ? <div className="panel__empty">No ticket shipped in these 24 hours.</div> : divisions.map((division) => {
          const shipped = day.tickets.shipped.filter(ticket => ticket.division === division)
          return (
            <div key={division} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: divisionColor(division), marginBottom: 4 }}>{division} · {shipped.length}</div>
              <div className="routes">
                {shipped.map(ticket => <ShippedRow ticket={ticket} entry={verdicts.get(ticket.commit)} key={`${ticket.ticket}-${ticket.commit}`} />)}
              </div>
            </div>
          )
        })}
      </div>

      <div className="section">
        <h3>Seats active · by division</h3>
        <div className="routes">
          {day.seats.byDivision.map(division => (
            <div className="routes__row" key={division.id} data-run={division.active > 0}>
              <span style={{ color: divisionColor(division.id) }}>{division.name}</span>
              <b>{division.active} active</b>
              <span>{division.occupied} of {division.defined} occupied</span>
            </div>
          ))}
          <div className="routes__row" data-run="true">
            <span>All divisions</span>
            <b>{day.seats.active} active</b>
            <span>{day.seats.occupied} of {day.seats.defined} occupied</span>
          </div>
        </div>
      </div>

      {effort.length === 0 ? null : (
        <div className="section">
          <h3>Tokens and seconds · per source, not summed</h3>
          <div className="routes">
            {effort.map(total => (
              <div className="routes__row" key={`${total.source}-${total.covers}`} data-run={total.items > 0} title={total.covers}>
                <span className="mono">{total.source}</span>
                <b style={{ fontWeight: 500, fontSize: 11 }}>{total.tokens === null ? 'no tokens recorded' : `${total.tokens.toLocaleString('en-US')} tokens`}</b>
                <span>{total.items} items · {total.seconds === null ? 'no seconds recorded' : `${total.seconds}s`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {day.unknowns.length === 0 ? null : (
        <div className="section">
          <h3>Unknown</h3>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, color: 'var(--ink-2)' }}>
            {day.unknowns.map(unknown => <li key={unknown}>{unknown}</li>)}
          </ul>
        </div>
      )}
    </>
  )
}
