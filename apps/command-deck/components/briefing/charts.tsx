import type { ReactNode } from 'react'
import { clock, count, day, interval, moment, short, signed, tierCost, tierTime } from './format.ts'
import type { CiRun, DivisionRow, ExperimentRow, RecallRow, TierRow } from './types.ts'

/*
 * The briefing's charts, drawn in HTML and CSS rather than scaled SVG so their
 * text keeps its size at phone width and in print. Each chart has one scale,
 * labels its values directly, and keys identity by mark and legend, never by
 * colour alone; every mark carries its value in a hover and focus card, and
 * every value is also printed beside it.
 */

function position(value: number, min: number, max: number): string {
  return `${((value - min) / (max - min)) * 100}%`
}

/** The room a bar's plot keeps at its end for the value printed after the bar; the scale spans the rest. */
const BAR_LABEL_ROOM = '60px'

/**
 * @param value - the bar's value.
 * @param max - the top of the scale.
 * @returns the bar's width on a scale that ends {@link BAR_LABEL_ROOM} before the plot's end, as the axis does.
 */
function barWidth(value: number, max: number): string {
  return `calc((100% - ${BAR_LABEL_ROOM}) * ${value / max})`
}

/**
 * Seats per division on one scale: the track is the seats defined, the middle
 * fill the seats a recorded deliverable occupies, the inner fill the seats
 * active in the roster's window.
 * @param props - the division rows and the window's end.
 * @returns the chart.
 */
export function OccupancyChart({ rows, windowEnd }: { rows: readonly DivisionRow[]; windowEnd: string }): ReactNode {
  const max = Math.max(...rows.map(row => row.defined))
  const top = Math.ceil(max / 10) * 10
  const ticks = Array.from({ length: top / 10 + 1 }, (_, index) => index * 10)
  return (
    <figure className="bf-chart bf-occupancy">
      <ul className="bf-legend" aria-label="Legend">
        <li><i className="bf-key bf-key--defined" />Defined</li>
        <li><i className="bf-key bf-key--occupied" />Occupied by a recorded deliverable</li>
        <li><i className="bf-key bf-key--active" />Active in the 24 hours to {moment(windowEnd)}</li>
      </ul>
      <div className="bf-occupancy__rows">
        {rows.map(row => (
          <div className="bf-occupancy__row" key={row.id}>
            <span className="bf-occupancy__name">{row.name}</span>
            <span className="bf-occupancy__plot">
              <span className="bf-occupancy__track" style={{ width: position(row.defined, 0, top) }} tabIndex={0} aria-label={`${row.name}: ${row.defined} defined, ${row.occupied} occupied, ${row.active} active`}>
                <span className="bf-occupancy__occupied" style={{ width: `${(row.occupied / row.defined) * 100}%` }} />
                <span className="bf-occupancy__active" style={{ width: `${(row.active / row.defined) * 100}%` }} />
                <span className="bf-tip" role="presentation">{row.name}: {row.defined} defined · {row.occupied} occupied · {row.active} active</span>
              </span>
            </span>
            <span className="bf-occupancy__value"><b>{row.occupied}</b> of {row.defined} · {row.active} active</span>
          </div>
        ))}
      </div>
      <div className="bf-axis bf-occupancy__axis" aria-hidden="true">
        {ticks.map(tick => <span key={tick} style={{ left: position(tick, 0, top) }}>{tick}</span>)}
      </div>
      <figcaption className="bf-axis-title">Seats</figcaption>
    </figure>
  )
}

type Outcome = 'success' | 'failure' | 'cancelled' | 'running'

function outcomeOf(run: CiRun): Outcome {
  if (run.status !== 'completed') return 'running'
  if (run.conclusion === 'success') return 'success'
  if (run.conclusion === 'failure') return 'failure'
  return 'cancelled'
}

const OUTCOME_LABEL: Record<Outcome, string> = { success: 'Passed', failure: 'Failed', cancelled: 'Cancelled before a verdict', running: 'Running' }
const OUTCOME_GLYPH: Record<Outcome, string> = { success: '✓', failure: '✕', cancelled: '–', running: '•' }

interface CiStripProps {
  /** The runs, oldest first. */
  runs: readonly CiRun[]
  /** The badge each marked run wears, by run id. */
  marked: Readonly<Record<number, string>>
  /** What each badge marks, in badge order. */
  captions: readonly { label: string; text: ReactNode }[]
}

/**
 * Every Branch CI run of the branch in order, one mark per run keyed by glyph
 * and colour, with the runs that bear on the shipped work labelled.
 * @param props - the runs, oldest first, and the runs to label by id.
 * @returns the chart.
 */
export function CiStrip({ runs, marked, captions }: CiStripProps): ReactNode {
  const counts: Record<Outcome, number> = { success: 0, failure: 0, cancelled: 0, running: 0 }
  for (const run of runs) counts[outcomeOf(run)] += 1
  const days = [...new Set(runs.map(run => day(run.createdAt)))]
  return (
    <figure className="bf-chart bf-ci">
      <ul className="bf-legend" aria-label="Legend">
        {(Object.keys(counts) as Outcome[]).filter(outcome => counts[outcome] > 0).map(outcome => (
          <li key={outcome}><i className={`bf-run bf-run--${outcome}`} aria-hidden="true">{OUTCOME_GLYPH[outcome]}</i>{OUTCOME_LABEL[outcome]} <b>{counts[outcome]}</b></li>
        ))}
      </ul>
      <div className="bf-ci__days">
        {days.map(date => (
          <div className="bf-ci__day" key={date}>
            <span className="bf-ci__date">{date}</span>
            <span className="bf-ci__runs">
              {runs.filter(run => day(run.createdAt) === date).map((run) => {
                const outcome = outcomeOf(run)
                const label = marked[run.id]
                return (
                  <a key={run.id} href={run.url} className={`bf-run bf-run--${outcome}${label === undefined ? '' : ' bf-run--marked'}`} aria-label={`Run ${run.id} on ${short(run.head)} at ${clock(run.createdAt)}: ${OUTCOME_LABEL[outcome]}`}>
                    <span aria-hidden="true">{OUTCOME_GLYPH[outcome]}</span>
                    {label === undefined ? null : <span className="bf-run__badge">{label}</span>}
                    <span className="bf-tip" role="presentation">{OUTCOME_LABEL[outcome]} · {short(run.head)} · started {clock(run.createdAt)}</span>
                  </a>
                )
              })}
            </span>
          </div>
        ))}
      </div>
      {captions.length === 0 ? null : (
        <ul className="bf-ci__captions">
          {captions.map(caption => <li key={caption.label}><span className="bf-run__badge bf-run__badge--static">{caption.label}</span><span>{caption.text}</span></li>)}
        </ul>
      )}
    </figure>
  )
}

const DOMAIN_MIN = -1
const DOMAIN_MAX = 0.5
const FOREST_TICKS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5]

const GROUP_TITLE: Record<string, string> = {
  model: 'Which model',
  loop: "Harness loop against the product's own loop",
  attempts: 'How many attempts',
  'hand-off': 'Handing a task from one model to another',
  method: 'Review and preset methods',
}

/**
 * The frozen paired experiments as a forest plot: each row's point is the
 * change in certified share (candidate minus baseline) and its bar the 95%
 * bootstrap interval, on one scale; a filled point marks a decisive verdict.
 * A pair a later fold re-read under the current statistic is drawn at the
 * re-read reading and says so.
 * @param props - the rows.
 * @returns the chart.
 */
export function ForestPlot({ rows }: { rows: readonly ExperimentRow[] }): ReactNode {
  const groups = Object.keys(GROUP_TITLE).filter(group => rows.some(row => row.group === group))
  return (
    <figure className="bf-chart bf-forest">
      <ul className="bf-legend" aria-label="Legend">
        <li><i className="bf-dot bf-dot--decisive" />Decisive verdict (promote or reject)</li>
        <li><i className="bf-dot bf-dot--open" />Inconclusive</li>
        <li><i className="bf-whisker" />95% bootstrap interval</li>
      </ul>
      <div className="bf-forest__head" aria-hidden="true">
        <span>Comparison: baseline → candidate</span>
        <span className="bf-forest__scale">
          {FOREST_TICKS.map(tick => <span key={tick} style={{ left: position(tick, DOMAIN_MIN, DOMAIN_MAX) }}>{tick === 0 ? '0' : signed(tick).replace('.00', '').replace(/0$/, '')}</span>)}
        </span>
        <span>Certified; change, interval, verdict</span>
      </div>
      {groups.map(group => (
        <div className="bf-forest__group" key={group}>
          <h4 className="bf-forest__title">{GROUP_TITLE[group]}</h4>
          {rows.filter(row => row.group === group).map((row) => {
            const reading = row.reread ?? row
            const decisive = reading.verdict === 'promote' || reading.verdict === 'reject'
            return (
              <div className="bf-forest__row" key={row.record}>
                <span className="bf-forest__label">
                  <b>{row.baseline} → {row.candidate}</b>
                  <small>{row.tiers} · {row.pairs} paired cells · {day(row.date)}</small>
                </span>
                <span className="bf-forest__plot" tabIndex={0} aria-label={`${row.baseline} to ${row.candidate}: ${signed(reading.delta)}, interval ${interval(reading.interval.lower, reading.interval.upper)}, ${reading.verdict}`}>
                  {FOREST_TICKS.map(tick => <i key={tick} className={tick === 0 ? 'bf-forest__zero' : 'bf-forest__grid'} style={{ left: position(tick, DOMAIN_MIN, DOMAIN_MAX) }} />)}
                  <i className="bf-forest__interval" style={{ left: position(reading.interval.lower, DOMAIN_MIN, DOMAIN_MAX), width: `calc(${position(reading.interval.upper, DOMAIN_MIN, DOMAIN_MAX)} - ${position(reading.interval.lower, DOMAIN_MIN, DOMAIN_MAX)})` }} />
                  <i className={`bf-dot ${decisive ? 'bf-dot--decisive' : 'bf-dot--open'} bf-forest__point`} style={{ left: position(reading.delta, DOMAIN_MIN, DOMAIN_MAX) }} />
                  <span className="bf-tip" role="presentation">{signed(reading.delta)} {interval(reading.interval.lower, reading.interval.upper)} · {reading.verdict}</span>
                </span>
                <span className="bf-forest__value">
                  <span><b>{row.baselineCertified} → {row.candidateCertified}</b> of {row.pairs} cells</span>
                  <span>
                    {signed(reading.delta)} {interval(reading.interval.lower, reading.interval.upper)}{' '}
                    <span className={decisive ? 'bf-verdict bf-verdict--decisive' : 'bf-verdict'}>{reading.verdict}</span>
                  </span>
                  {row.reread === null
                    ? null
                    : <small>re-read; recorded {row.verdict} {interval(row.interval.lower, row.interval.upper)}</small>}
                </span>
              </div>
            )
          })}
        </div>
      ))}
      <figcaption className="bf-axis-title">Change in the share of cells certified, candidate minus baseline</figcaption>
    </figure>
  )
}

/**
 * The ticks of an issues-found axis: every sixth issue up to the ground truth's count.
 * @param props - the count of documented issues.
 * @returns the ticks.
 */
function IssueTicks({ known }: { known: number }): ReactNode {
  return [0, 6, 12, 18].filter(tick => tick <= known).map(tick => <span key={tick} style={{ left: position(tick, 0, known) }}>{tick}</span>)
}

/**
 * The three-tier comparison on one scale of documented issues found (a finding
 * within three lines of an issue), the enterprise's row in the accent and the
 * other two in the neutral.
 * @param props - the tiers.
 * @returns the chart.
 */
export function TierBars({ rows }: { rows: readonly TierRow[] }): ReactNode {
  const known = Math.max(...rows.map(row => row.knownIssues))
  return (
    <figure className="bf-chart bf-bars">
      {rows.map(row => (
        <div className="bf-bars__row" key={row.id}>
          <span className="bf-bars__name">{row.name}</span>
          <span className="bf-bars__plot">
            <span className={`bf-bars__bar${row.id === 'enterprise' ? ' bf-bars__bar--accent' : ''}`} style={{ width: barWidth(row.found, known) }} tabIndex={0} aria-label={`${row.name}: ${row.found} of ${row.knownIssues}`}>
              <span className="bf-tip" role="presentation">{row.name}: {row.found} of {row.knownIssues} documented issues</span>
            </span>
            <span className="bf-bars__tip"><b>{row.found}</b> of {row.knownIssues}</span>
          </span>
          <span className="bf-bars__meta">
            {count(row.findings)} findings · {row.verifiedAtLine ? 'each checked by the examiner at its cited line' : 'not checked'} · {tierTime(row)} · {tierCost(row)}
          </span>
        </div>
      ))}
      <div className="bf-axis bf-bars__axis" aria-hidden="true">
        <IssueTicks known={known} />
      </div>
      <figcaption className="bf-axis-title">Documented issues found by a finding within three lines, of {known}</figcaption>
    </figure>
  )
}

function armLabel(row: RecallRow): string {
  const iteration = row.iteration
  if (iteration === null) return 'Review, standard departments'
  if (iteration.pair === null) return 'Injection skill widened'
  if (iteration.pair === '2') return iteration.arm === 'with' ? 'With a generalist department' : 'Specialists only (control)'
  if (iteration.pair === '3') return iteration.arm === 'with' ? 'With the diagnosed checklists' : 'Without them (control)'
  return `Iteration ${iteration.id}`
}

/**
 * Every review of one target against its ground truth, in order, the runs
 * with the diagnosed checklists in the accent.
 * @param props - the target's rows.
 * @returns the chart.
 */
export function RecallRuns({ rows }: { rows: readonly RecallRow[] }): ReactNode {
  const known = Math.max(...rows.map(row => row.knownIssues))
  return (
    <figure className="bf-chart bf-bars bf-bars--compact">
      {rows.map((row) => {
        const accent = row.iteration?.pair === '3' && row.iteration.arm === 'with'
        return (
          <div className="bf-bars__row" key={row.record}>
            <span className="bf-bars__name"><small>{day(row.date)}</small>{armLabel(row)}</span>
            <span className="bf-bars__plot">
              <span className={`bf-bars__bar${accent ? ' bf-bars__bar--accent' : ''}`} style={{ width: barWidth(row.found, known) }} tabIndex={0} aria-label={`${row.record}: ${row.found} of ${row.knownIssues}`}>
                <span className="bf-tip" role="presentation">{row.record}: {row.found} of {row.knownIssues}; missed {row.missed.length === 0 ? 'none' : row.missed.join(', ')}</span>
              </span>
              <span className="bf-bars__tip"><b>{row.found}</b></span>
            </span>
            <span className="bf-bars__meta">{count(row.findings)} findings · {row.elapsedSeconds === null ? 'time unknown' : `${count(row.elapsedSeconds)} s`}</span>
          </div>
        )
      })}
      <div className="bf-axis bf-bars__axis" aria-hidden="true">
        <IssueTicks known={known} />
      </div>
      <figcaption className="bf-axis-title">Documented issues found by a finding within three lines, of {known}</figcaption>
    </figure>
  )
}

/**
 * A proportion with its interval on a 0 to 1 scale.
 * @param props - the count, the total and the interval.
 * @returns the meter.
 */
export function IntervalMeter({ caught, planted, low, high }: { caught: number; planted: number; low: number; high: number }): ReactNode {
  return (
    <figure className="bf-chart bf-meter">
      <span className="bf-meter__plot" tabIndex={0} aria-label={`${caught} of ${planted}, 95% interval ${low.toFixed(2)} to ${high.toFixed(2)}`}>
        <i className="bf-meter__interval" style={{ left: position(low, 0, 1), width: `calc(${position(high, 0, 1)} - ${position(low, 0, 1)})` }} />
        <i className="bf-dot bf-dot--decisive bf-meter__point" style={{ left: position(caught / planted, 0, 1) }} />
        <span className="bf-meter__label" style={{ left: position(caught / planted, 0, 1) }}>{caught} of {planted}</span>
        <span className="bf-tip" role="presentation">{caught} of {planted} = {(caught / planted).toFixed(2)}; 95% Wilson interval {low.toFixed(2)}–{high.toFixed(2)}</span>
      </span>
      <div className="bf-axis bf-meter__axis" aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map(tick => <span key={tick} style={{ left: position(tick, 0, 1) }}>{tick === 0 ? '0' : tick === 1 ? '1' : tick.toFixed(2)}</span>)}
      </div>
      <figcaption className="bf-axis-title">Share of planted defects caught, with the 95% Wilson interval</figcaption>
    </figure>
  )
}
