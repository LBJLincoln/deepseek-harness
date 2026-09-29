import Link from 'next/link'
import type { ReactNode } from 'react'
import { CiStrip, ForestPlot, IntervalMeter, OccupancyChart, RecallRuns, TierBars } from './charts.tsx'
import { Controls } from './Controls.tsx'
import { DataFlow, FlowDiagram, OrgChart, type Flow } from './diagrams.tsx'
import { clock, commitUrl, count, duration, interval, listed, minutes, moment, numberOf, pathUrl, percent, short, shown, signed, tierCost, tierTime } from './format.ts'
import { Cite, Notes, SourceNotes, type Note } from './notes.tsx'
import type { Briefing as BriefingData, CiRun, ExperimentRow, Figure, PilotRow, ReviewRecordRow, ShipmentCi, ShippedRow, Source, Starter } from './types.ts'

/*
 * The client briefing: an executive account of the enterprise's pilot in eight
 * sections, every figure read from `briefing.json` and cited to the note that
 * names its source. Each section cites all of its figures before it renders,
 * so a note's number follows the section's reading order.
 */

const README = 'data/enterprise/README.md'
const TICKETS_README = 'data/enterprise/tickets/README.md'
const SHIFT_NOTE = '.agents/notes/implemented/architecture/2026-09-28-enterprise-shift-engine.md'
const FUNCTIONS_NOTE = '.agents/notes/implemented/architecture/2026-09-28-enterprise-functions-and-occupancy.md'
const RESULTS_NOTE = '.agents/notes/proposed/architecture/2026-09-08-hypothesis-program-results.md'
const GOALS_NOTE = '.agents/notes/proposed/process/2026-09-22-four-goals-rethink.md'
const COMPARISON_README = 'data/code-safety/comparisons/2026-09-22-nodegoat/README.md'
const SAFETY_README = 'data/code-safety/README.md'
const DATA_HANDLING = 'docs/client/data-handling.md'
const SHIFT_COMPOSITION = 'examples/headless-agent/tests/fixtures/enterprise-shift/cordis.yml'
const SHIFT_OVERLAY = 'examples/headless-agent/tests/fixtures/enterprise-shift/overlays/claude-code.cordis.yml'
const ENGINE_README = 'examples/headless-agent/tests/fixtures/enterprise-shift/README.md'
const REVIEW_NOTE = '.agents/notes/implemented/architecture/2026-09-29-enterprise-review-independence.md'
const INTAKE_OVERLAY = 'examples/headless-agent/tests/fixtures/enterprise-intake/overlays/claude-code.cordis.yml'
const CLAUDE_CODE_ROUTE = 'packages/llm/llm-claude-code/README.md'
const TRANSCRIPTS_README = 'data/transcripts/README.md'
const LOSSES = 'data/transcripts/LOSSES.md'
/** The UTC day whose container resets `LOSSES.md` accounts for; a unit lost on another day is not in it. */
const LOSSES_DAY = '2026-09-28'
const DATA_USE = 'packages/governance/data-use/README.md'
const CLAIMS = 'apps/command-deck/public/fixtures/briefing-claims.md'

const CYCLE_SOURCE: Source = {
  paths: [README, 'scripts/enterprise-cycle.sh', 'scripts/enterprise-scheduler.sh'],
  computation: 'The cycle and the scheduler as their scripts document them: one cycle every 2 hours, at 13 minutes past every even UTC hour, '
    + 'or when the operator starts one; intake when fewer than 8 tickets are open; a shift over the next 2 open tickets. These are the scripts’ defaults.',
}

const SECTIONS = [
  ['standing', 'Where the pilot stands'],
  ['operating-model', 'The operating model'],
  ['record', 'The pilot record'],
  ['quality', 'Measured quality'],
  ['governance', 'Data handling, governance and audit'],
  ['economics', 'Economics'],
  ['limits', 'Limits and risks'],
  ['roadmap', 'Roadmap and engagement'],
] as const

const STARTER_LABEL: Record<Starter, string> = { scheduler: 'Scheduler', operator: 'Operator', unknown: 'Unknown' }

/** A rejection a later shipped line of the same ticket overturned. */
type Overturned = ReviewRecordRow & { overturnedBy: string }

/** An approval that shipped. */
type Reworked = ReviewRecordRow & { shipped: string }

/**
 * What became of a reviewed change.
 * @param row - one review.
 * @returns the later shipment that overturned a rejection, or the change's own shipment and the commits that reworked it.
 */
function afterwards(row: ReviewRecordRow): string {
  if (row.overturnedBy !== null) return `overturned: shipped later as ${short(row.overturnedBy)}`
  if (row.shipped === null) return 'not shipped'
  const rework = row.followUps.length === 0 ? '' : `, reworked by ${listed(row.followUps.map(commit => short(commit.commit)))}`
  return `shipped as ${short(row.shipped)}${rework}`
}

type Fig = Figure<number | string> | undefined

function text(figure: Fig, show: (value: number) => string = count): string {
  return shown(figure, value => (typeof value === 'number' ? show(value) : value))
}

function plural(value: number | undefined, one: string, many: string): string {
  return value === 1 ? one : many
}

function V({ figure, note, branch, show }: { figure: Fig; note: Note; branch: string; show?: (value: number) => string }): ReactNode {
  return <span className="bf-figure">{text(figure, show)}<Cite note={note} branch={branch} /></span>
}

interface KpiProps {
  label: string
  value: string
  detail: string
  note: Note
  branch: string
  /** The note of a figure the detail line states, when it states one. */
  detailNote?: Note
}

function Kpi({ label, value, detail, note, branch, detailNote }: KpiProps): ReactNode {
  return (
    <div className="bf-kpi">
      <span className="bf-kpi__label">{label}</span>
      <span className="bf-kpi__value">{value}<Cite note={note} branch={branch} /></span>
      <span className="bf-kpi__detail">{detail}{detailNote === undefined ? null : <Cite note={detailNote} branch={branch} />}</span>
    </div>
  )
}

/** The shipped tickets one push carried, with that push's Branch CI verdicts. */
interface Shipment {
  ci: ShipmentCi
  rows: ShippedRow[]
}

/**
 * @param shipped - the shipped tickets, oldest first.
 * @returns them grouped by the containing run of the push that carried them, oldest first; tickets whose verdicts are unknown are left out.
 */
function shipmentsOf(shipped: readonly ShippedRow[]): Shipment[] {
  const groups: Shipment[] = []
  for (const row of shipped) {
    if (row.ci.value === null) continue
    const run = row.ci.value.carrying?.id
    const group = run === undefined ? undefined : groups.find(entry => entry.ci.carrying?.id === run)
    if (group === undefined) groups.push({ ci: row.ci.value, rows: [row] })
    else group.rows.push(row)
  }
  return groups
}

interface SectionProps {
  index: number
  children: ReactNode
  notes: Notes
  branch: string
  lead: ReactNode
}

function Section({ index, children, notes, branch, lead }: SectionProps): ReactNode {
  const [id, title] = SECTIONS[index - 1] ?? ['section', 'Section']
  return (
    <section className="bf-section" id={id} aria-labelledby={`${id}-title`}>
      <header className="bf-section__head">
        <span className="bf-section__number">{String(index).padStart(2, '0')}</span>
        <h2 id={`${id}-title`}>{title}</h2>
        <p className="bf-lead">{lead}</p>
      </header>
      {children}
      <SourceNotes notes={notes.list()} branch={branch} />
    </section>
  )
}

/** Each section's lead: what the section answers, in one sentence. */
const LEADS = {
  standing: 'What the pilot has delivered so far, counted only from recorded deliverables.',
  model: ['Every seat is a role grounded in a real part of this repository', 'A person owns the queue policy, the schedule and the branch; the agents work inside those limits'],
  record: 'Every unit of work so far, what it shipped, and what continuous integration said about it.',
  quality: 'How well the harness and the code-safety program perform, measured against tasks and targets whose answers are known.',
  governance: 'Where a client’s code and the records of the work go, the controls on what an agent can read, run and ship, and the record that makes each action attributable.',
  economics: 'What a shipped change costs in model tokens and time, as the records state it. The records carry no currency',
  limits: 'What the evidence does not show, and the risks a client should weigh.',
  roadmap: 'The work that closes the limits above, and a proposed way to start with a client.',
}

function secondsBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 1000)
}

function experiment(rows: readonly ExperimentRow[], plan: string): ExperimentRow | undefined {
  return rows.find(row => row.plan === plan)
}

function reading(row: ExperimentRow): string {
  const current = row.reread ?? row
  return `${signed(current.delta)}, interval ${interval(current.interval.lower, current.interval.upper)}, ${current.verdict}`
}

/**
 * Cite each shipment's CI verdict in the order the callouts render, and, after the first, the note that explains the
 * failure the first shipped ticket introduced.
 * @param notes - the section's notes.
 * @param shipments - the shipments, oldest first.
 * @returns the notes.
 */
function citeShipments(notes: Notes, shipments: readonly Shipment[]): { ci: Note[]; cause: Note | undefined } {
  const ci: Note[] = []
  let cause: Note | undefined
  shipments.forEach((shipment, index) => {
    const first = shipment.rows[0]
    if (first !== undefined) ci.push(notes.cite(first.ci))
    if (explainsCause(shipment, index)) cause = notes.cite(CAUSE_SOURCE)
  })
  return { ci, cause }
}

/**
 * @param shipment - a shipment.
 * @param index - its position, oldest first.
 * @returns whether the cause note applies: the oldest shipment, whose push introduced the translation-pairing failure.
 */
function explainsCause(shipment: Shipment, index: number): boolean {
  return index === 0 && shipment.ci.introduced.includes('translation pairing')
}

const CAUSE_SOURCE: Source = {
  paths: [SHIFT_NOTE],
  computation: 'The shift engine note: the first shipped commit edited a README pair without re-recording its pairing record; the queue policy’s documentation gate now runs that check in the department, the integration and the recertification.',
}

interface ShipmentCalloutProps {
  shipment: Shipment
  note: Note
  /** The note explaining the introduced failure, for the shipment it explains. */
  cause: Note | undefined
  branch: string
}

/**
 * The Branch CI verdicts on one push that carried shipped tickets, labelled by what each run tested: a run on the
 * exact shipped commit, then the containing run of the push with its lanes and failed gates, each gate marked as
 * introduced by the push or already failing on the shift's base, and the first fully successful run after it.
 * @param props - the shipment, its note and the branch.
 * @returns the callout.
 */
function ShipmentCallout({ shipment, note, cause, branch }: ShipmentCalloutProps): ReactNode {
  const { ci, rows } = shipment
  const run = ci.carrying
  const passed = run?.conclusion === 'success'
  const exact = rows.filter(row => row.ci.value?.exact !== null && row.ci.value?.exact !== undefined)
  return (
    <div className={`bf-callout${passed ? ' bf-callout--good' : ''}`}>
      <h4>Continuous integration on {listed(rows.map(row => row.ticket))}<Cite note={note} branch={branch} /></h4>
      <p>
        <b className="bf-callout__label">Exact commit.</b>{' '}
        {exact.length === 0
          ? <>No Branch CI run tested {rows.map(row => short(row.commit)).join(rows.length === 2 ? ' or ' : ', ')} on its own.</>
          : <>{exact.length} of {rows.length} shipped commits had a run on exactly that commit.</>}
      </p>
      {ci.verdict === undefined ? null : (
        <p>
          <b className="bf-callout__label">Verdict.</b>{' '}
          {ci.verdict === null ? 'No run containing these commits has reached a verdict yet.' : <VerdictRun run={ci.verdict} />}
        </p>
      )}
      {run === null ? <p><b className="bf-callout__label">Containing run.</b> No Branch CI run contains these commits yet.</p> : (
        <>
          <p>
            <b className="bf-callout__label">Containing run.</b> Run <a href={run.url}>{run.id}</a> on{' '}
            <a href={commitUrl(run.head)}><code>{short(run.head)}</code></a>, the push that carried them, started {moment(run.createdAt)}:{' '}
            <b className={passed ? 'bf-status bf-status--good' : run.conclusion === 'failure' ? 'bf-status bf-status--bad' : 'bf-status'}>
              {verdictOf(run)}
            </b>.
          </p>
          <ul className="bf-lanes">
            {run.jobs.map(job => (
              <li key={job.name}>
                <span className="bf-lane">
                  <span className={laneOf(job.conclusion).tone}>{laneOf(job.conclusion).mark}</span>
                  <a href={job.url}>{job.name.replace(/^node \d+ \/ /, '')}</a>
                  <span className="bf-lane__verdict">{laneOf(job.conclusion).word}</span>
                </span>
                {job.failedGates.length === 0 ? null : (
                  <ul className="bf-gates">
                    {job.failedGates.map(gate => (
                      <li key={gate}>
                        <code>{gate}</code>{' '}
                        <span>{ci.introduced.includes(gate) ? 'introduced by this push' : 'already failing before the shift'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {cause === undefined ? null : (
            <p>
              The introduced failure came from the first shipped ticket: its department edited a documentation pair without
              re-recording the pair&rsquo;s consistency record. The engine now runs that check before a change can be
              approved<Cite note={cause} branch={branch} />.
            </p>
          )}
          {passed || ci.verdict !== undefined ? null : ci.firstGreen === null ? <p>No fully successful run contains them yet.</p> : (
            <p>
              The first fully successful run containing them,
              on <a href={commitUrl(ci.firstGreen.head)}><code>{short(ci.firstGreen.head)}</code></a>,
              finished at {clock(ci.firstGreen.updatedAt)},{' '}
              {duration(secondsBetween(run.createdAt, ci.firstGreen.updatedAt))} after the push.
            </p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * @param conclusion - a Branch CI job's conclusion.
 * @returns its mark, word and status class: a job a later push cancelled reads cancelled, not failed.
 */
function laneOf(conclusion: string | null): { mark: string; word: string; tone: string } {
  if (conclusion === 'success') return { mark: '✓', word: 'passed', tone: 'bf-status bf-status--good' }
  if (conclusion === 'cancelled') return { mark: '•', word: 'cancelled', tone: 'bf-status' }
  return { mark: '✕', word: 'failed', tone: 'bf-status bf-status--bad' }
}

/**
 * @param props - the run whose verdict answers for a push's shipped commits.
 * @returns the run, its commit and its verdict, with the rule that chose it.
 */
function VerdictRun({ run }: { run: CiRun }): ReactNode {
  const tone = run.conclusion === 'success' ? 'bf-status bf-status--good' : 'bf-status bf-status--bad'
  return (
    <>
      Run <a href={run.url}>{run.id}</a> on <a href={commitUrl(run.head)}><code>{short(run.head)}</code></a>, the first run
      containing them that passed or failed (a run a later push cancelled reached no verdict):{' '}
      <b className={tone}>{verdictOf(run)}</b>.
    </>
  )
}

/**
 * @param run - a Branch CI run's status and conclusion.
 * @returns its verdict for a reader; a run a later push cancelled reached no verdict, so it reads neither passed nor failed.
 */
function verdictOf(run: { status: string; conclusion: string | null }): string {
  if (run.status !== 'completed') return '• running'
  if (run.conclusion === 'success') return '✓ passed'
  if (run.conclusion === 'failure') return '✕ failed'
  if (run.conclusion === 'cancelled') return '• cancelled before a verdict'
  return run.conclusion ?? 'no conclusion'
}

/**
 * @param row - a pilot unit.
 * @param shipped - every shipped ticket.
 * @returns the unit's Branch CI cell: what ran on its shipped commits, or that it shipped nothing.
 */
function PilotCi({ row, shipped }: { row: PilotRow; shipped: readonly ShippedRow[] }): ReactNode {
  const own = shipped.filter(entry => row.shifts.includes(entry.shift))
  if (own.length === 0) return <span className="bf-muted">nothing shipped</span>
  const verdicts = own.map(entry => entry.ci.value)
  if (verdicts.some(verdict => verdict === null)) return <span className="bf-unknown">unknown</span>
  const known = verdicts as ShipmentCi[]
  const exact = known.filter(verdict => verdict.exact !== null).length
  const answered = known.every(verdict => verdict.verdict !== undefined)
  const conclusions = [...new Set(known.map(verdict => (answered ? verdict.verdict?.conclusion : verdict.carrying?.conclusion) ?? 'none'))]
  return (
    <>
      <span className="bf-pilot__ci">Exact commit: {exact === 0 ? `no run on ${known.length === 1 ? 'it' : `either of ${known.length}`}` : `${exact} of ${known.length}`}</span>
      <span className="bf-pilot__ci">
        {answered ? 'Verdict' : 'Containing run'}:{' '}
        {conclusions.map(conclusion => (
          <b key={conclusion} className={conclusion === 'success' ? 'bf-status bf-status--good' : conclusion === 'failure' ? 'bf-status bf-status--bad' : 'bf-status'}>
            {conclusion === 'none' ? 'none yet' : verdictOf({ status: 'completed', conclusion })}
          </b>
        ))}
      </span>
    </>
  )
}

/**
 * @param props - ticket ids.
 * @returns them listed, each kept on one line.
 */
function Tickets({ ids }: { ids: readonly string[] }): ReactNode {
  return ids.map((id, index) => (
    <span key={id}>
      {index === 0 ? '' : index === ids.length - 1 ? ' and ' : ', '}
      <span className="bf-nowrap">{id}</span>
    </span>
  ))
}

interface PilotTableProps {
  rows: readonly PilotRow[]
  shipped: readonly ShippedRow[]
  /** The note of each row's starter, by unit id. */
  starters: ReadonlyMap<string, Note>
  branch: string
}

/**
 * The pilot, one row per cycle and per shift outside a cycle: who started it, what its shifts attempted, shipped,
 * failed or lost, what Branch CI said about what it shipped, and its model tokens.
 * @param props - the rows, the shipped tickets and the notes.
 * @returns the table.
 */
function PilotTable({ rows, shipped, starters, branch }: PilotTableProps): ReactNode {
  const unknown = <span className="bf-unknown">unknown</span>
  return (
    <div className="bf-table bf-table--pilot" role="table" aria-label="The pilot, unit by unit">
      <div className="bf-table__row bf-table__row--head" role="row">
        <span role="columnheader">Unit</span>
        <span role="columnheader">Started by</span>
        <span role="columnheader">Attempted</span>
        <span role="columnheader">Shipped</span>
        <span role="columnheader">Failed or halted</span>
        <span role="columnheader">Lost</span>
        <span role="columnheader">Branch CI</span>
        <span role="columnheader">Model tokens</span>
      </div>
      {rows.map((row) => {
        const checks = [...new Set(row.failed.flatMap(entry => entry.failedChecks))]
        const note = starters.get(row.id)
        return (
          <div className="bf-table__row" role="row" key={row.id}>
            <span role="cell" data-label="Unit">
              <b>{row.kind === 'cycle' ? 'Cycle' : 'Shift'} {moment(row.startedAt)}</b>
              <small className="bf-pilot__id"><code>{row.id}</code></small>
              {row.finished === false ? <small className="bf-pilot__state">No end on the branch{row === rows.at(-1) ? ' yet' : ''}</small> : null}
            </span>
            <span role="cell" data-label="Started by">{STARTER_LABEL[row.startedBy]}{note === undefined ? null : <Cite note={note} branch={branch} />}</span>
            <span role="cell" data-label="Attempted">{row.attempted === null ? unknown : row.attempted}</span>
            <span role="cell" data-label="Shipped">
              {row.shipped.length === 0 ? '0' : <><b>{row.shipped.length}</b>: <Tickets ids={row.shipped} /></>}
            </span>
            <span role="cell" data-label="Failed or halted">
              {row.failed.length === 0 ? '0' : (
                <>
                  <b>{row.failed.length}</b>: <Tickets ids={row.failed.map(entry => entry.ticket)} />
                  {checks.length === 0 ? null : <>; {checks.map(check => <code key={check} className="bf-nowrap">{check}</code>)} failed</>}
                </>
              )}
            </span>
            <span role="cell" data-label="Lost">{row.lost === null ? unknown : row.lost}</span>
            <span role="cell" data-label="Branch CI"><PilotCi row={row} shipped={shipped} /></span>
            <span role="cell" data-label="Model tokens" className="bf-num">{row.tokens === null ? unknown : count(row.tokens)}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The briefing page's body.
 * @param props - the parsed `briefing.json`.
 * @returns the document.
 */
export function Briefing({ data }: { data: BriefingData }): ReactNode {
  const branch = data.repository.branch
  const f = (id: string): Fig => data.figures[id]
  const divisions = data.divisions.value ?? []
  const shipped = data.shipped.value ?? []
  const pilot = data.pilot.value ?? []
  const shifts = data.shifts.value ?? []
  const experiments = data.bench.experiments.value ?? []
  const recall = data.safety.recall.value ?? []
  const nodegoat = recall.filter(row => row.record.includes('nodegoat'))
  const dvja = recall.find(row => row.record.includes('dvja'))
  const tiers = data.safety.tiers.value ?? []
  const seeded = data.safety.seeded.value
  const terms = data.governance.terms.value ?? []
  const signoffs = data.governance.signoffs.value ?? []
  const reviews = data.governance.reviews.value ?? []
  const reviewRecord = data.governance.reviewRecord?.value ?? []
  const overturned = reviewRecord.filter((row): row is Overturned => row.overturnedBy !== null)
  const reworked = reviewRecord.filter((row): row is Reworked => row.shipped !== null && row.followUps.length > 0)
  const routes = data.routes.value ?? []
  const economics = data.economics.tickets.value ?? []
  const ciRuns = data.ci.value?.runs ?? []
  const shipments = shipmentsOf(shipped)
  const ciGreen = f('ci.latestConclusion')?.value === 'success'
  const failedPushes = shipments.filter(shipment => shipment.ci.carrying?.status === 'completed' && shipment.ci.carrying.conclusion === 'failure').length
  const cancelledPushes = shipments.filter(shipment => shipment.ci.carrying?.status === 'completed' && shipment.ci.carrying.conclusion === 'cancelled').length
  const ciUnknown = shipped.map(row => row.ci).flatMap(figure => ('unknown' in figure ? [figure.unknown] : [])).at(0)
  const unoccupied = divisions.filter(division => division.occupied === 0).map(division => division.name)
  const routeTotal = routes.reduce((sum, row) => sum + row.sessions, 0)
  const topRoute = routes[0]
  const benchTerms = terms.find(row => row.family === 'bench')
  const otherTerms = terms.filter(row => row.family !== 'bench')
  const events = signoffs.filter(row => row.form === 'event')
  const decisions = signoffs.filter(row => row.form === 'decision')
  const eventRuns = [...new Set(events.map(row => row.run))]
  const decisionRuns = [...new Set(decisions.map(row => row.run))]
  const quoted = (items: readonly string[]): string => listed([...new Set(items)].map(item => `“${item}”`))
  const spreadMs = eventRuns
    .map((run) => {
      const times = events.filter(row => row.run === run).map(row => Date.parse(row.at ?? ''))
      return Math.max(...times) - Math.min(...times)
    })
    .filter(Number.isFinite)
  const withChecklists = nodegoat.filter(row => row.iteration?.pair === '3' && row.iteration.arm === 'with')
  const withoutChecklists = nodegoat.filter(row => row.iteration?.pair === '3' && row.iteration.arm === 'without')
  const untuned = nodegoat.filter(row => !withChecklists.includes(row))
  const untunedFound = untuned.map(row => row.found)
  const enterpriseTier = tiers.find(row => row.id === 'enterprise')
  // A briefing.json written before the tiers carried `onKnown` has none to subtract.
  const beyond = enterpriseTier?.onKnown === undefined ? undefined : enterpriseTier.findings - enterpriseTier.onKnown
  const cycles = pilot.filter(row => row.kind === 'cycle')
  const schedulerCycles = cycles.filter(row => row.startedBy === 'scheduler')
  const latestScheduled = schedulerCycles.at(-1)
  const newestCycle = cycles.at(-1)
  const shippingUnits = pilot.filter(row => row.shipped.length > 0)
  const unattendedShipped = shippingUnits.filter(row => row.startedBy === 'scheduler' && (row.completedBy ?? []).length === 0).flatMap(row => row.shipped)
  const lostCycles = cycles.filter(row => row.attempted === null && row !== newestCycle)
  // A cycle of the reset day whose shift left no line, or whose lines the supervisor wrote afterwards as abandoned in the reset.
  const resetCycles = cycles.filter(row => row !== newestCycle && row.startedAt.startsWith(LOSSES_DAY)
    && (row.attempted === null || row.failed.some(entry => entry.reason === 'abandoned in the container reset')))
  const lossUnits = pilot.filter(row => row.lost !== null && row.lost > 0)
  const partialShifts = shifts.filter(row => row.type === 'partial')
  const visibility = f('repository.visibility')
  const repositoryPlace = `this repository, ${text(visibility)}`
  const marked: Record<number, string> = {}
  const markCaptions: { label: string; text: ReactNode }[] = []
  for (const shipment of shipments) {
    const tickets = <Tickets ids={shipment.rows.map(row => row.ticket)} />
    if (shipment.ci.carrying !== null && marked[shipment.ci.carrying.id] === undefined) {
      marked[shipment.ci.carrying.id] = String(markCaptions.length + 1)
      markCaptions.push({ label: String(markCaptions.length + 1), text: <>the containing run of the push that carried {tickets}</> })
    }
    const answer = shipment.ci.verdict === undefined ? shipment.ci.firstGreen : shipment.ci.verdict
    if (answer !== null && marked[answer.id] === undefined) {
      marked[answer.id] = String(markCaptions.length + 1)
      const caption = shipment.ci.verdict === undefined
        ? <>the first fully successful run containing {tickets}</>
        : <>the first run containing {tickets} that reached a verdict</>
      markCaptions.push({ label: String(markCaptions.length + 1), text: caption })
    }
  }
  const failedOf = (row: PilotRow): ReactNode => {
    const checks = [...new Set(row.failed.flatMap(entry => entry.failedChecks))]
    const reasons = [...new Set(row.failed.map(entry => entry.reason).filter((reason): reason is string => reason !== null))]
    const verb = `${row.failed.length === 1 ? 'was' : 'were'} ${row.failed.every(entry => entry.status === 'halted') ? 'halted' : 'stopped'}`
    return (
      <>
        <Tickets ids={row.failed.map(entry => entry.ticket)} /> {verb}{reasons.length === 0 ? '' : ` (${reasons.join('; ')})`}
        {checks.length === 0 ? '' : `, with the ${listed(checks)} ${plural(checks.length, 'check', 'checks')} failing`}
      </>
    )
  }

  // ---- Cover ------------------------------------------------------------
  const nC = new Notes('C')
  const cC = nC.cite({
    paths: [SHIFT_NOTE, README],
    computation: 'The shift engine as its Agent Note and the enterprise README describe it: a worktree per ticket, the ticket’s acceptance '
      + 'checks, a separate reviewer given the diff, the commit messages and the check output, one commit per ticket pushed to the '
      + 'development branch, Branch CI on the pushed tip, and the record each step leaves.',
  })

  // ---- 1. Where the pilot stands -------------------------------------------
  const n1 = new Notes('1')
  const c1 = {
    shipped: n1.cite(f('tickets.shipped') ?? data.shipped),
    operatorShipped: n1.cite(f('pilot.operatorShipped') ?? data.pilot),
    schedulerShipped: n1.cite(f('pilot.schedulerShipped') ?? data.pilot),
    schedulerCycles: n1.cite(f('pilot.schedulerCycles') ?? data.pilot),
    cycles: n1.cite(f('pilot.cycles') ?? data.pilot),
    exact: n1.cite(f('ci.exactShipped') ?? data.shipped),
    occupied: n1.cite(f('seats.occupied') ?? data.divisions),
    defined: n1.cite(f('seats.defined') ?? data.divisions),
    open: n1.cite(f('tickets.open') ?? data.shipped),
    cycle: n1.cite(CYCLE_SOURCE),
    pilot: n1.cite(data.pilot),
  }

  // ---- 2. Operating model ----------------------------------------------
  const n2 = new Notes('2')
  const c2 = {
    divisions: n2.cite(data.divisions),
    engagement: n2.cite({ paths: [README, TICKETS_README], computation: 'How each division is engaged: the functions table and the cycle in the enterprise README, and the divisions that hold tickets in the queue README.' }),
    flow: n2.cite({ paths: [SHIFT_NOTE, README, TICKETS_README], computation: 'The shift engine as its Agent Note and the enterprise README describe it, step by step, with the record each step leaves.' }),
  }

  // ---- 3. The pilot record ----------------------------------------------
  const n3 = new Notes('3')
  const c3pilot = n3.cite(data.pilot)
  const starters = new Map(pilot.map(row => [row.id, n3.cite({ paths: row.paths, computation: `Started by: ${row.startedBy}. ${row.basis}` })]))
  const c3 = {
    pilot: c3pilot,
    losses: n3.cite({ paths: [LOSSES], computation: 'What the container resets of 2026-09-28 erased, stated from commits and files on the branch: the shift the 22:07Z reset interrupted, and why no line or record of it exists.' }),
    shifts: n3.cite(data.shifts),
    shipped: n3.cite(data.shipped),
    ...citeShipments(n3, shipments),
    runs: n3.cite(data.ci),
    completed: n3.cite(f('ci.completed') ?? data.ci),
    occupancy: n3.cite(data.divisions),
    vacant: n3.cite({ paths: [README, FUNCTIONS_NOTE], computation: 'The vacancy table: five judge seats whose CI lanes this fork does not run and five observer seats whose backends nothing here composes.' }),
  }

  // ---- 4. Quality ------------------------------------------------------
  const n4 = new Notes('4')
  const opus = experiment(experiments, 'e1-sonnet-vs-opus-t5')
  const haiku = experiment(experiments, 'e1-haiku-vs-sonnet-t5')
  const sealed = experiment(experiments, 'e2-harness-vs-product-sonnet-t5-sealed')
  const polyglot = experiment(experiments, 'polyglot-harness-vs-product-sonnet')
  const attempts = experiments.filter(row => row.plan === 'e3-attempts-t5')
  const selfReview = experiment(experiments, 'e12-self-review-sonnet-t5t6')
  const c4 = {
    environments: n4.cite(f('bench.environments') ?? data.bench.experiments),
    domains: n4.cite(f('bench.domains') ?? data.bench.experiments),
    pairs: n4.cite(f('bench.frozenPairs') ?? data.bench.experiments),
    decisive: n4.cite(f('bench.decisive') ?? data.bench.experiments),
    experiments: n4.cite(data.bench.experiments),
    noise: n4.cite({ paths: [RESULTS_NOTE], computation: 'The results note: two sealed runs of the same arm agree on 15 of 16 cells, so a paired delta of one cell in sixteen is inside one arm’s own variation, and sixteen cells give an interval no narrower than about ±0.19.' }),
    recallRule: n4.cite(data.safety.recall),
    tiers: n4.cite(data.safety.tiers),
    comparison: n4.cite({ paths: [COMPARISON_README], computation: 'The comparison’s authored reading: the tiers, the gap list and the three improvement iterations with their decisions.' }),
    runs: n4.cite(f('safety.nodegoatRuns') ?? data.safety.recall),
    seeded: n4.cite(data.safety.seeded),
    seededNote: n4.cite({ paths: [SAFETY_README], computation: 'The code-safety README: three of the eight planted sites wrap an already narrowed value and carry no reachable defect; on the five that do, the review caught five.' }),
    dataHandling: n4.cite({ paths: [DATA_HANDLING], computation: 'Where a reviewed codebase and its records go: each movement of the data with the file that shows it, the terms of each destination, and what a client engagement needs first.' }),
  }

  // ---- 5. Data handling and governance ---------------------------------------
  const n5 = new Notes('5')
  const c5 = {
    clone: n5.cite({ paths: [SHIFT_NOTE, README], computation: 'A shift clones the development branch into a scratch directory, gives each department its own worktree of that clone, points the clone’s push address at an unreachable URL, and pushes once from it at the end.' }),
    model: n5.cite({ paths: [SHIFT_OVERLAY, INTAKE_OVERLAY, CLAUDE_CODE_ROUTE], computation: 'The shift’s and the intake’s Claude Code overlays route every department, reviewer and coordinator through the operator’s own authenticated Claude Code installation; the route serves each model request as one query to it, whose prompt carries the conversation, tool results included.' }),
    records: n5.cite({ paths: [README, SHIFT_NOTE], computation: 'A shift commits its record, result.json, manifest.json and every session log, with its ledger lines, and pushes it to the development branch.' }),
    live: n5.cite({ paths: [TRANSCRIPTS_README, 'scripts/transcripts-capture.sh'], computation: 'The live capture appends what is new in every Claude Code project directory (the operator’s session and its subagents, and the sessions of departments, reviewers and intake coordinators), the shifts’ session directories and the cycle logs, masks credential-shaped strings, and pushes the result every 5 minutes.' }),
    visibility: n5.cite(visibility ?? data.ci),
    terms: n5.cite({ paths: [DATA_USE, 'packages/governance/curator/README.md'], computation: 'Data-use terms pinned to a session at creation (client, agreement, purposes, residency, retention, redaction profile); the curator refuses to export without a redaction profile and withholds sessions whose terms do not admit the purpose.' }),
    sandbox: n5.cite({ paths: ['packages/sandbox/sandbox-local/README.md', 'packages/sandbox/sandbox-policy/README.md'], computation: 'The local sandbox provider: bubblewrap, then Landlock on Linux, Seatbelt on macOS, a restricted token on Windows; an unusable runner fails with SANDBOX_UNAVAILABLE rather than running unconfined.' }),
    sealed: n5.cite({ paths: [RESULTS_NOTE, 'data/proving-ground/README.md'], computation: 'Since 2026-09-08 09:25 UTC every bench cell is sealed: an empty directory is mounted over the run directory with only the cell’s workspace bound back in.' }),
    shiftIsolation: n5.cite({ paths: [SHIFT_COMPOSITION, SHIFT_OVERLAY, SHIFT_NOTE, 'examples/headless-agent/tests/fixtures/enterprise-shift/README.md'], computation: 'The shift README’s section on what is confined states that the unreachable push URL contains a mistaken push and is not a sandbox, that nothing controls network egress, and that a department’s shell reads whatever the host user can. The shift composition runs shell commands through the local bash provider, not the sandbox; each department works in its own worktree of a scratch clone and pushes through an origin whose push URL is unreachable; the Claude Code overlay states the edits and version-control commands a department may run without a prompt.' }),
    barrier: n5.cite({ paths: ['packages/verification/read-barrier/README.md', 'packages/fs/fs-read-barrier/README.md'], computation: 'The read barrier: implementer and judge sessions are denied the validator-owned tree; the filesystem capability enforces the decision where it opens a path.' }),
    refusals: n5.cite(f('safety.barrierRefusals') ?? data.safety.recall),
    reviewer: n5.cite({ paths: [SHIFT_NOTE, REVIEW_NOTE, 'packages/verification/judge/README.md', 'data/enterprise/ledger.jsonl'], computation: 'Commit 3291b6402 (29 Sep 2026, 10:15 UTC) holds a rejected ticket for triage; ledger line 167 records T-0019 rejected on 28 Sep at 18:19 UTC, before that commit, and a later line records it shipped; every review session ran sonnet through Claude Code, as the departments did. The shift’s reviewer: a fresh session with no parent and no seed, the judge preset, an empty working directory, and a history of the ticket and the evidence only; since the second shift every tool is restricted away from it; it runs on the route and model of the composition’s enterprise-review-model entry, configured apart from the departments’, and a rejected ticket is held for a person rather than reviewed again.' }),
    reviews: n5.cite(data.governance.reviews),
    reviewRecord: n5.cite(data.governance.reviewRecord ?? data.governance.reviews),
    approved: n5.cite(f('reviews.approved') ?? data.governance.reviews),
    recordOnly: n5.cite(f('reviews.recordOnly') ?? data.governance.reviews),
    reviewerRecorded: n5.cite(f('reviews.reviewerRecorded') ?? data.governance.reviews),
    overturned: n5.cite(f('reviews.overturned') ?? data.governance.reviews),
    reworked: n5.cite(f('reviews.reworked') ?? data.governance.reviews),
    examinerRule: n5.cite({ paths: [SAFETY_README, 'examples/headless-agent/tests/fixtures/program-code-safety/README.md'], computation: 'What a code-safety record proves: every released finding existed at the line it cites, in the locked tree, when the committed examiner ran over the merged head.' }),
    examiner: n5.cite(f('safety.examinerPassed') ?? data.safety.recall),
    signoff: n5.cite({
      paths: ['packages/governance/signoff/README.md', ENGINE_README, SHIFT_NOTE],
      computation: 'The sign-off plugin records a person’s signature, with the principal, the artefact’s SHA-256 and the evidence, and never '
        + 'authenticates it; unattended shifts and intakes compose no sign-off plugin and record their spec freeze and release as decisions '
        + 'of a machine principal, with no human release gate.',
    }),
    signoffs: n5.cite(data.governance.signoffs),
    termsCount: n5.cite(data.governance.terms),
    secrets: n5.cite({ paths: [SAFETY_README, README, TRANSCRIPTS_README], computation: 'Code-safety records replace private key material and example cloud keys before commit and list the files touched under redactions; a shift record cuts credential-shaped strings from its session logs and counts them; the live capture masks credential-shaped strings.' }),
    redaction: n5.cite(f('safety.redactedRecords') ?? data.safety.recall),
    shiftRedaction: n5.cite(f('shifts.redacted') ?? data.shifts),
    audit: n5.cite({ paths: [README, SHIFT_NOTE, 'AGENTS.md', 'data/enterprise/ledger.jsonl', 'data/transcripts/LOSSES.md'], computation: 'The ledger gate refuses a push that edits, removes or inserts a committed ledger line from commit 580d9e688 (29 Sep 2026, 10:54 UTC); its commit message lists the edits before it: commit dae1babd0 (29 Sep 2026, 06:45 UTC) rewrote the shipped commit of T-0007 in place, and d46e02bd9, d1aec806b, 1f669dbf9 and 8a4dd9c02 inserted lines (git log -p data/enterprise/ledger.jsonl). A shift record holds result.json, manifest.json with every file’s SHA-256 and every session log; each ticket commit names the shift, ticket, seat, program and sessions; model-visible input is logged, except the sessions LOSSES.md records as lost.' }),
    ledger: n5.cite(f('ledger.lines') ?? data.shifts),
    sessions: n5.cite(f('sessions.recorded') ?? data.divisions),
    dataHandling: n5.cite({ paths: [DATA_HANDLING], computation: 'The full data flow of a review: each movement of the data with the file that shows it, the terms of each destination, what the repository does not record about them, and what a client engagement needs first.' }),
  }
  const flows: Flow[] = [
    {
      from: 'A scratch clone of the branch, one worktree per department',
      to: 'GitHub: the development branch',
      direction: 'in',
      party: 'github',
      how: <>cloned at the start of each shift<Cite note={c5.clone} branch={branch} /></>,
    },
    {
      from: 'Department, reviewer and intake sessions',
      to: 'Anthropic’s model API, under the operator’s Claude Code login',
      direction: 'out',
      party: 'anthropic',
      how: (
        <>
          every model request: the conversation, with the contents of each file a department
          reads<Cite note={c5.model} branch={branch} />
        </>
      ),
    },
    {
      from: 'Shift records: every session log',
      to: `GitHub: ${repositoryPlace}`,
      direction: 'out',
      party: 'github',
      how: <>committed and pushed at the end of each shift<Cite note={c5.records} branch={branch} /></>,
    },
    {
      from: 'Claude Code transcripts of the operator and of every department',
      to: `GitHub: ${repositoryPlace}`,
      direction: 'out',
      party: 'github',
      how: <>pushed every 5 minutes; credential-shaped strings masked, the rest as written<Cite note={c5.live} branch={branch} /></>,
    },
  ]

  // ---- 6. Economics ----------------------------------------------------
  const n6 = new Notes('6')
  const c6 = {
    currency: n6.cite(f('economics.currency') ?? data.economics.tickets),
    tokens: n6.cite(f('economics.tokensPerShipped') ?? data.economics.tickets),
    seconds: n6.cite(f('economics.secondsPerShipped') ?? data.economics.tickets),
    shift: n6.cite(f('economics.shiftSeconds') ?? data.shifts),
    review: n6.cite(f('safety.reviewSecondsMin') ?? data.safety.recall),
    tickets: n6.cite(data.economics.tickets),
    tiers: n6.cite(data.safety.tiers),
  }

  // ---- 7. Limits -------------------------------------------------------
  const n7 = new Notes('7')
  const c7 = {
    operatorShipped: n7.cite(f('pilot.operatorShipped') ?? data.pilot),
    schedulerShipped: n7.cite(f('pilot.schedulerShipped') ?? data.pilot),
    losses: n7.cite({ paths: [LOSSES], computation: 'What the container resets of 2026-09-28 erased, stated from commits and files on the branch.' }),
    provenance: n7.cite({ paths: ['README.md', 'LICENSE', 'data/enterprise/ledger.jsonl'], computation: 'The README\'s provenance paragraph and its account of which models ran: every enterprise ticket line records Claude Code or no model, every intake and code-safety review ran on Claude Code, and the bench\'s tier 2 ran free open-weight models through OpenRouter.' }),
    isolation: n7.cite({ paths: [SHIFT_COMPOSITION, SHIFT_OVERLAY], computation: 'The shift composition names the local bash and subprocess providers and no sandbox provider.' }),
    ci: n7.cite(f('ci.success') ?? data.ci),
    exact: n7.cite(f('ci.exactShipped') ?? data.shipped),
    dataFlow: n7.cite({ paths: [SHIFT_OVERLAY, CLAUDE_CODE_ROUTE, TRANSCRIPTS_README], computation: 'The departments’ route is the operator’s Claude Code installation, and the live capture publishes the operator’s and the departments’ transcripts to the branch.' }),
    signoffs: n7.cite(data.governance.signoffs),
    terms: n7.cite(data.governance.terms),
    routes: n7.cite(data.routes),
    goals: n7.cite({ paths: [GOALS_NOTE], computation: 'The four-goals note: every harness-loop cell on record ran an eight-tool build under a two-sentence persona, and the bench’s 44 tasks are hand-authored JavaScript programs, saturated below tier 5.' }),
    bench: n7.cite({ paths: [RESULTS_NOTE], computation: 'The results note: the tasks are authored in-house; sixteen cells per arm; no frozen pair has promoted a harness change.' }),
    comparison: n7.cite({ paths: [COMPARISON_README, 'data/code-safety/targets/README.md'], computation: 'The comparison’s own caveat on the checklists, and the self-review’s triage: none of its findings confirmed, a Windows executable-search defect found by the triage and missed by the review.' }),
    preview: n7.cite({ paths: ['README.md'], computation: 'The repository README: DeepSeek Harness is in developer preview, with compatibility-breaking changes to come.' }),
  }

  // ---- 8. Roadmap ------------------------------------------------------
  const n8 = new Notes('8')
  const c8 = {
    terms: n8.cite({ paths: [DATA_USE], computation: 'The dataUse/terms fields a session pins at creation: client, agreement, purposes, residency, retention and redaction profile.' }),
    goals: n8.cite({ paths: [GOALS_NOTE], computation: 'The four-goals note’s proposal: task supply first (public suites, the completion family, a SWE-bench subset), more than one route, and a release signature recorded after the certificate by a principal the driver did not invent.' }),
    pilot: n8.cite(data.pilot),
    vacancy: n8.cite({ paths: [README], computation: 'The vacancy table names what changes when a Windows runner, a primary pool, an OTLP collector or a session store is composed.' }),
    safety: n8.cite({ paths: [SAFETY_README, 'data/code-safety/tools/seed-defects.mjs'], computation: 'Seeded-defect recall: plant known defects in a copy of a target without telling the review, and read the share it catches within three lines, with a Wilson interval.' }),
    duration: n8.cite(f('safety.reviewSecondsMax') ?? data.safety.recall),
    queue: n8.cite({ paths: ['scripts/enterprise-tickets.ts', SHIFT_NOTE], computation: 'The ticket validator takes its queue policy as a parameter: this repository’s policy mandates its typecheck and coverage runs; the open policy mandates nothing beyond the ticket’s own checks.' }),
  }

  // ---- A. Inputs -------------------------------------------------------
  const nA = new Notes('A')
  const cA = {
    inputs: nA.cite({ paths: ['apps/command-deck/public/fixtures/briefing.json'], computation: 'The inputs field of briefing.json: per input set, the files the builder read, their bytes, and the SHA-256 of the file or of the listing of the files under a directory.' }),
    claims: nA.cite({ paths: [CLAIMS, 'scripts/enterprise-briefing-claims.ts'], computation: 'The claims register the builder writes beside briefing.json: every sentence of this page with the notes it cites, rendered from the same data.' }),
  }

  const routeShare = topRoute === undefined || routeTotal === 0 ? 'unknown' : percent(topRoute.sessions, routeTotal)
  const units = shippingUnits.map((row) => {
    const started = row.startedBy === 'unknown' ? 'whose starter the records do not state' : `started by the ${row.startedBy}`
    const completedBy = row.completedBy ?? []
    const completed = completedBy.length === 0 ? '' : `, whose push the ${listed(completedBy)} completed (its ledger lines are recorded by the ${listed(completedBy)})`
    return `${row.kind === 'cycle' ? row.id : `shift ${row.id}`}, ${started}${completed}`
  })
  // Each unit's phrase holds commas of its own, so the units are separated by semicolons.
  const shippedBy = units.length <= 1 ? units.join('') : `${units.slice(0, -1).join('; ')}; and ${units.at(-1) ?? ''}`
  const schedulerShippedCount = numberOf(f('pilot.schedulerShipped'))
  const tier = (id: string): { found: number; knownIssues: number; findings: number } | undefined => tiers.find(row => row.id === id)
  const [scanner, single, enterprise] = [tier('semgrep'), tier('single-model'), tier('enterprise')]
  const scheduledCount = numberOf(f('pilot.schedulerCycles'))
  const scheduledChecks = [...new Set(schedulerCycles.flatMap(row => row.failed.flatMap(entry => entry.failedChecks)))]
  const cycleAccount = (row: PilotRow): ReactNode => (
    <>
      {row.id}, started {moment(row.startedAt)},{' '}
      {row.attempted === null
        ? `has no record of its shift on the branch${row.finished === false && row === newestCycle ? ' yet' : ''}`
        : `worked ${row.attempted} ${plural(row.attempted, 'ticket', 'tickets')} and shipped ${row.shipped.length}`}
      {row.failed.length === 0 ? '' : <>: {failedOf(row)}</>}
    </>
  )

  return (
    <div className="bf" data-briefing suppressHydrationWarning>
      <div className="bf-bar">
        <div className="bf-bar__inner">
          <Link href="/" className="bf-bar__mark"><b>Daliesk</b><span>Command Deck</span></Link>
          <span className="bf-bar__title">Client briefing</span>
          <Controls />
        </div>
      </div>

      <div className="bf-layout">
        <nav className="bf-toc" aria-label="Contents">
          <span className="bf-toc__title">Contents</span>
          <ol>
            {SECTIONS.map(([id, title], index) => (
              <li key={id}><a href={`#${id}`}><span>{String(index + 1).padStart(2, '0')}</span>{title}</a></li>
            ))}
            <li><a href="#inputs"><span>A</span>Inputs and verification</a></li>
          </ol>
        </nav>

        <main className="bf-main">
          <header className="bf-cover">
            <span className="bf-eyebrow">Client briefing · committed records as of {moment(data.asOf)}</span>
            <h1>Daliesk</h1>
            <p className="bf-cover__claim">
              A pilot of an organisation of AI agents that changes a codebase through a ticket queue. Each change is made in its
              own working copy, must pass the ticket&rsquo;s own acceptance checks, is approved by a separate reviewer that reads
              the change but not the session that made it, and is pushed to the development branch as one attributable commit;
              continuous integration then runs on the branch. Every step is recorded in the
              repository<Cite note={cC} branch={branch} />.
            </p>
            <dl className="bf-cover__meta">
              <div><dt>Prepared for</dt><dd>Executive review: information, security and finance</dd></div>
              <div><dt>Repository</dt><dd><a href={data.repository.url}>{data.repository.name}</a>, branch <code>{branch}</code></dd></div>
              <div>
                <dt>Method</dt>
                <dd>
                  Every figure is computed from committed records or read from GitHub and carries a numbered source; what the
                  records do not show is marked unknown
                </dd>
              </div>
            </dl>
            <SourceNotes notes={nC.list()} branch={branch} />
          </header>

          <Section index={1} notes={n1} branch={branch} lead={LEADS.standing}>
            <div className="bf-kpis">
              <Kpi label="Tickets shipped" value={text(f('tickets.shipped'))} detail={`${text(f('pilot.operatorShipped'))} from work the operator started`} note={c1.shipped} detailNote={c1.operatorShipped} branch={branch} />
              <Kpi
                label="Shipped with no human or supervisor step"
                value={`${unattendedShipped.length} of ${shipped.length}`}
                detail="started by the scheduler and pushed by the engine itself"
                note={c1.pilot}
                branch={branch}
              />
              <Kpi
                label="Shipped from scheduler-started cycles"
                value={text(f('pilot.schedulerShipped'))}
                detail={`from the ${text(f('pilot.schedulerCycles'))} ${plural(scheduledCount, 'cycle', 'cycles')} the scheduler started`}
                note={c1.schedulerShipped}
                detailNote={c1.schedulerCycles}
                branch={branch}
              />
              <Kpi label="Cycles run" value={text(f('pilot.cycles'))} detail={cycles[0] === undefined ? 'none yet' : `since ${moment(cycles[0].startedAt)}`} note={c1.cycles} branch={branch} />
              <Kpi label="Shipped commits CI tested alone" value={`${text(f('ci.exactShipped'))} of ${text(f('tickets.shipped'))}`} detail="a Branch CI run on the exact commit" note={c1.exact} branch={branch} />
              <Kpi label="Seats occupied" value={text(f('seats.occupied'))} detail={`of ${text(f('seats.defined'))} defined, by a recorded deliverable`} note={c1.occupied} detailNote={c1.defined} branch={branch} />
              <Kpi label="Tickets open" value={text(f('tickets.open'))} detail="in the queue" note={c1.open} branch={branch} />
            </div>
            <h3>What is running</h3>
            <p>
              A cycle script and a scheduler that starts it are in place<Cite note={c1.cycle} branch={branch} />. Every two hours, at
              13 minutes past an even UTC hour, the scheduler starts one cycle: intake refills the queue when fewer than 8 tickets
              are open, a shift works the next 2 open tickets, the divisions that need no ticket run their functions on the new
              branch tip, and the roster, the deck and this briefing are regenerated. The operator can also start a shift or a
              cycle by hand.
            </p>
            <p>
              This is a pilot. {shipped.length === 0 ? 'No ticket has shipped yet.' : `The ${text(f('tickets.shipped'))} ${plural(shipped.length, 'ticket', 'tickets')} shipped so far came from ${shippedBy}`}
              <Cite note={c1.pilot} branch={branch} />.{' '}
              {latestScheduled === undefined
                ? 'The scheduler has not started a cycle yet.'
                : <>The scheduler has started {text(f('pilot.schedulerCycles'))} {plural(scheduledCount, 'cycle', 'cycles')}, which shipped {text(f('pilot.schedulerShipped'))}<Cite note={c1.schedulerShipped} branch={branch} />; {unattendedShipped.length === 0 ? 'no shipped ticket has yet reached the branch without an operator or supervisor step' : `${unattendedShipped.length} shipped ${plural(unattendedShipped.length, 'ticket', 'tickets')} reached the branch with no operator or supervisor step`}.</>}
              {' '}Section 3 sets out every unit of work.
            </p>
            {schedulerCycles.length === 0 ? null : (
              <ul>
                {schedulerCycles.map(row => <li key={row.id}>{cycleAccount(row)}<Cite note={c1.pilot} branch={branch} />.</li>)}
              </ul>
            )}
          </Section>

          <Section
            index={2}
            notes={n2}
            branch={branch}
            lead={(
              <>
                {LEADS.model[0]}<Cite note={c2.divisions} branch={branch} />. {LEADS.model[1]}<Cite note={c2.engagement} branch={branch} />.
              </>
            )}
          >
            <h3>The organisation<Cite note={c2.divisions} branch={branch} /></h3>
            <p>
              A seat is a defined role: a package steward, a verification gate, a CI judge, a review department. It counts as
              occupied only when a recorded deliverable names it &mdash; a session, a ledger line, a CI verdict &mdash; and never
              by its definition alone. The tags show how each division receives work<Cite note={c2.engagement} branch={branch} />.
            </p>
            <OrgChart divisions={divisions} />
            <h3>One ticket, from intake to the branch<Cite note={c2.flow} branch={branch} /></h3>
            <p>
              Each step is performed by a different actor and leaves its own record, so the path of any change can be read back
              from the repository. Continuous integration runs after the push; it reports on the branch and does not gate the
              change.
            </p>
            <FlowDiagram />
          </Section>

          <Section index={3} notes={n3} branch={branch} lead={LEADS.record}>
            <h3>Every unit of work, oldest first<Cite note={c3.pilot} branch={branch} /></h3>
            <p>
              A unit is one run of the cycle script, or one shift the operator started outside any cycle. The note on each
              &ldquo;started by&rdquo; gives its evidence: the cycle&rsquo;s own record when it states its starter, else the
              scheduler&rsquo;s own log as the live capture keeps it, or when the scripts reached the branch.
              &ldquo;Lost&rdquo; counts tickets a shift took on that no ledger line records.
            </p>
            {pilot.length === 0
              ? <p>No unit of work is on record.</p>
              : <PilotTable rows={pilot} shipped={shipped} starters={starters} branch={branch} />}
            {lostCycles.length === 0 && lossUnits.length === 0 ? null : (
              <ul className="bf-points bf-points--compact">
                {lostCycles.map(row => (
                  <li key={row.id}>
                    <b>{row.id}:</b> no record of its shift and no line from it is on the branch, so what it attempted and lost is
                    unknown
                    {resetCycles.includes(row)
                      ? (
                        <>
                          ; the account of the container reset that erased the shift is on the
                          branch<Cite note={c3.losses} branch={branch} />
                        </>
                      )
                      : null}
                    .
                  </li>
                ))}
                {lossUnits.map(row => (
                  <li key={row.id}>
                    <b>{row.kind === 'cycle' ? row.id : `Shift ${row.id}`}:</b> its record names {row.attempted} {plural(row.attempted ?? 0, 'ticket', 'tickets')} and
                    the ledger holds no line for {row.lost} of them{partialShifts.some(shift => row.shifts.includes(shift.shift)) ? ': the shift stopped before writing its ledger lines, and its record was written afterwards' : ''}<Cite note={c3.shifts} branch={branch} />.
                  </li>
                ))}
              </ul>
            )}

            <h3>Shipped work<Cite note={c3.shipped} branch={branch} /></h3>
            {shipped.length === 0 ? <p>No ticket has shipped yet.</p> : (
              <div className="bf-table" role="table" aria-label="Shipped tickets">
                <div className="bf-table__row bf-table__row--head" role="row">
                  <span role="columnheader">Ticket</span><span role="columnheader">Seat</span><span role="columnheader">Checks</span><span role="columnheader">Review</span><span role="columnheader">Commit</span><span role="columnheader">Model tokens</span><span role="columnheader">Time</span>
                </div>
                {shipped.map(row => (
                  <div className="bf-table__row" role="row" key={row.ticket}>
                    <span role="cell" data-label="Ticket"><b>{row.ticket}</b> {row.title ?? ''}</span>
                    <span role="cell" data-label="Seat">{row.seatName ?? row.seat}</span>
                    <span role="cell" data-label="Checks">{row.checks.passed} of {row.checks.total} passed</span>
                    <span role="cell" data-label="Review">{row.review ?? 'none'}{row.reviewToolCalls === null ? '' : `, ${row.reviewToolCalls === 0 ? 'no' : row.reviewToolCalls} tool call${row.reviewToolCalls === 1 ? '' : 's'}`}</span>
                    <span role="cell" data-label="Commit"><a href={commitUrl(row.commit)}><code>{short(row.commit)}</code></a></span>
                    <span role="cell" data-label="Model tokens" className="bf-num">{row.tokens === null ? 'unknown' : count(row.tokens)}</span>
                    <span role="cell" data-label="Time" className="bf-num">{row.seconds === null ? 'unknown' : duration(row.seconds)}</span>
                  </div>
                ))}
              </div>
            )}
            {shipped.length > 0 && shipments.length === 0
              ? <p>The Branch CI verdict on the shipped commits is unknown{ciUnknown === undefined ? '' : `: ${ciUnknown}`}.</p>
              : null}
            {shipments.map((shipment, index) => (
              <ShipmentCallout
                key={shipment.rows[0]?.ticket ?? index}
                shipment={shipment}
                note={c3.ci[index] as Note}
                cause={explainsCause(shipment, index) ? c3.cause : undefined}
                branch={branch}
              />
            ))}

            <h3>The Branch CI record<Cite note={c3.runs} branch={branch} /></h3>
            <p>Branch CI runs the static, coverage and snapshot lanes on every push to the development branch. Of {text(f('ci.completed'))} completed runs since {shown(f('ci.first'), value => moment(String(value)))}<Cite note={c3.completed} branch={branch} />, {text(f('ci.success'))} passed, {text(f('ci.failure'))} failed and {text(f('ci.cancelled'))} were cancelled by a later push before a verdict. The newest run with a verdict finished at {shown(f('ci.latestAt'), value => moment(String(value)))} and {shown(f('ci.latestConclusion'), value => (value === 'success' ? 'passed' : 'failed'))}.</p>
            {data.ci.value === null
              ? <p>Branch CI could not be read when this briefing was built.</p>
              : <CiStrip runs={ciRuns} marked={marked} captions={markCaptions} />}

            <h3>Seats that have delivered<Cite note={c3.occupancy} branch={branch} /></h3>
            <p>{text(f('seats.occupied'))} of {text(f('seats.defined'))} seats are occupied by a recorded deliverable, and {text(f('seats.active'))} delivered in the 24 hours to {shown(f('roster.stamp'), value => moment(String(value)))}. {unoccupied.length === 0 ? '' : `${listed(unoccupied)} ${unoccupied.length === 1 ? 'has' : 'have'} no occupied seat yet. `}Ten seats are vacant by construction: five CI judges whose lanes this fork does not run and five observers whose backends nothing here composes<Cite note={c3.vacant} branch={branch} />.</p>
            {divisions.length === 0 ? null : <OccupancyChart rows={divisions} windowEnd={String(f('roster.stamp')?.value ?? data.asOf)} />}
          </Section>

          <Section index={4} notes={n4} branch={branch} lead={LEADS.quality}>
            <h3>The Proving Ground benchmark</h3>
            <p>The harness is measured on <V figure={f('bench.environments')} note={c4.environments} branch={branch} /> task environments across <V figure={f('bench.domains')} note={c4.domains} branch={branch} /> domains; the two hardest tiers are judged on hidden cases the implementer never sees. A frozen paired experiment runs the same cells under two arms that differ in one field and reads the difference with a bootstrap interval; its verdict is promote or reject only when the interval clears the plan&rsquo;s thresholds. <V figure={f('bench.frozenPairs')} note={c4.pairs} branch={branch} /> frozen pairs are on record, and <V figure={f('bench.decisive')} note={c4.decisive} branch={branch} /> reached a decisive verdict.</p>
            {experiments.length === 0 ? null : <ForestPlot rows={experiments} />}
            <h4>What the pairs show<Cite note={c4.experiments} branch={branch} /></h4>
            <ul className="bf-points">
              {opus === undefined || haiku === undefined ? null : (
                <li>
                  <b>The model matters most.</b> On tier 5 a larger model certified {opus.candidateCertified} of {opus.pairs} cells
                  against {opus.baselineCertified} for the middle model ({reading(opus)}); a smaller one
                  certified {haiku.candidateCertified} against {haiku.baselineCertified} ({reading(haiku)}).
                </li>
              )}
              {sealed === undefined ? null : <li><b>The harness loop and the product&rsquo;s own loop are level on results.</b> {sealed.baselineCertified} against {sealed.candidateCertified} of {sealed.pairs} sealed tier-5 cells ({reading(sealed)}){polyglot === undefined ? '' : `; ${polyglot.baselineCertified} against ${polyglot.candidateCertified} of ${polyglot.pairs} on the public polyglot suite`}.</li>}
              {attempts.length === 0 ? null : <li><b>Retrying helps, by less than the first reading.</b> Three attempts against one read {reading(attempts[0] as ExperimentRow)} in the first pair; {attempts.length > 1 ? `the ${attempts.length - 1} replications read ${listed(attempts.slice(1).map(row => reading(row)))}.` : 'it has not been replicated.'}</li>}
              {selfReview === undefined ? null : (
                <li>
                  <b>No harness mechanism has been promoted.</b> The largest mechanism reading, a self-review turn before
                  validation, is {reading(selfReview)}.
                </li>
              )}
              <li>
                <b>The instrument&rsquo;s resolution.</b> A repeat of the same 16 cells differs by about one cell, so one pair of 16
                cannot resolve an effect smaller than about 0.19<Cite note={c4.noise} branch={branch} />.
              </li>
            </ul>

            <h3>Security-review recall against documented defects</h3>
            <p>The code-safety program reviews a codebase in six departments &mdash; secrets, injection, access, data, dependencies and platform &mdash; and a committed examiner rejects any finding whose cited line does not hold; a finding it passes is line-verified: the quoted text is at the cited line of the cited file, which does not show that the finding is a real defect. Every review sends the code it reads to the model API and commits records that quote it<Cite note={c4.dataHandling} branch={branch} />. Recall is read against targets whose defects are documented{nodegoat[0] === undefined ? '' : `: ${nodegoat[0].target}, with ${nodegoat[0].knownIssues} issues`}{dvja === undefined ? '' : `, and ${dvja.target}, with ${dvja.knownIssues}`}. A documented issue counts as found when a finding cites its file within three lines of the issue&rsquo;s lines<Cite note={c4.recallRule} branch={branch} />.</p>
            {tiers.length === 0 ? null : (
              <>
                <h4>Three ways to review the same application<Cite note={c4.tiers} branch={branch} /></h4>
                <TierBars rows={tiers} />
                <p>Each tier ran once. On this small application one model in one pass found {single?.found ?? 'unknown'} of {single?.knownIssues ?? 'unknown'} documented issues, more than the enterprise&rsquo;s {enterprise?.found ?? 'unknown'}; the scanner found {scanner?.found ?? 'unknown'}. The single pass released {single?.findings ?? 'unknown'} findings, unverified: nothing checked them against the code. The enterprise released {enterprise?.findings ?? 'unknown'}, each line-verified, with a record of how every finding was reached{beyond === undefined ? '' : `; ${beyond} of them land on no documented issue and are untriaged candidates, not established defects`}<Cite note={c4.comparison} branch={branch} />.</p>
              </>
            )}
            {nodegoat.length === 0 ? null : (
              <>
                <h4>Every review of {nodegoat[0]?.target ?? 'the target'}, in order<Cite note={c4.runs} branch={branch} /></h4>
                <RecallRuns rows={nodegoat} />
                <p>The {untuned.length} reviews of the same revision without the diagnosed checklists found between {untunedFound.length === 0 ? 'unknown' : Math.min(...untunedFound)} and {untunedFound.length === 0 ? 'unknown' : Math.max(...untunedFound)} of {nodegoat[0]?.knownIssues ?? 'unknown'} documented issues, each within three lines. A generalist department added nothing. Checklists written from a diagnosis of the enterprise&rsquo;s misses on this application found {listed(withChecklists.map(row => String(row.found)))} in their two runs against {listed(withoutChecklists.map(row => String(row.found)))} without them, an in-sample reading, because the checklists were written from the application they were scored on; whether they transfer to another codebase is untested. {dvja === undefined ? '' : `On ${dvja.target} the review found ${dvja.found} of ${dvja.knownIssues}.`}</p>
              </>
            )}
            {seeded === null ? null : (
              <>
                <h4>Planted defects in this repository&rsquo;s own code<Cite note={c4.seeded} branch={branch} /></h4>
                <p>
                  With no ground truth for a client&rsquo;s code, recall is read by planting defects in a copy without telling the
                  review. On this repository&rsquo;s own packages the review caught {seeded.caught} of {seeded.planted} planted
                  defects within three lines, 95% interval {seeded.interval.low.toFixed(2)} to {seeded.interval.high.toFixed(2)}. Three
                  of the planted sites carried no reachable defect; on the five that did, it caught
                  five<Cite note={c4.seededNote} branch={branch} />.
                </p>
                <IntervalMeter caught={seeded.caught} planted={seeded.planted} low={seeded.interval.low} high={seeded.interval.high} />
              </>
            )}
          </Section>

          <Section index={5} notes={n5} branch={branch} lead={LEADS.governance}>
            <h3>Where the data goes</h3>
            <p>
              A shift runs on one review machine<Cite note={c5.clone} branch={branch} />. Four movements of data cross its edge;
              the arrows point the way the data moves.
            </p>
            <DataFlow flows={flows} />
            <p>
              The repository&rsquo;s visibility on GitHub is {text(visibility)}<Cite note={c5.visibility} branch={branch} />. A
              client&rsquo;s code read by a department therefore reaches Anthropic&rsquo;s model API under the operator&rsquo;s
              Claude Code login, and the session logs and transcripts that hold it are published with the repository. Every
              movement of the data, the terms of each destination and what the repository does not record about them are on the
              data-handling page<Cite note={c5.dataHandling} branch={branch} />.
            </p>
            <div className="bf-callout bf-callout--requirement">
              <h4>Required before a client&rsquo;s code is read</h4>
              <ul className="bf-points bf-points--compact">
                <li>
                  An Anthropic API organisation for the engagement, under a data processing agreement with zero data retention, in
                  place of the operator&rsquo;s login.
                </li>
                <li>
                  The records, session logs and transcripts of the engagement kept in a private repository, and the live capture
                  pointed at it.
                </li>
                <li>
                  Data-use terms naming the client, the agreement, the purposes, the residency and the retention pinned on every
                  session<Cite note={c5.terms} branch={branch} />.
                </li>
              </ul>
            </div>

            <h3>Controls</h3>
            <div className="bf-controls-table" role="table" aria-label="Controls">
              <div className="bf-controls-table__row bf-controls-table__row--head" role="row">
                <span role="columnheader">Control</span><span role="columnheader">Mechanism</span><span role="columnheader">Evidence on record</span>
              </div>
              <div className="bf-controls-table__row" role="row">
                <span role="cell" data-label="Control"><b>Execution isolation</b></span>
                <span role="cell" data-label="Mechanism">Shift departments, reviewers, intake and code-safety reviews run unconfined, as the host user: each department works in its own worktree of a scratch clone whose push address is unreachable, which contains a mistaken push but is not a sandbox, and nothing yet limits their network or the host files and credentials they can read<Cite note={c5.shiftIsolation} branch={branch} />. The harness&rsquo;s operating-system sandbox (bubblewrap, then Landlock on Linux; Seatbelt on macOS; a restricted token on Windows) confines the Proving Ground bench only<Cite note={c5.sandbox} branch={branch} />.</span>
                <span role="cell" data-label="Evidence">Every bench cell has run sealed since 8 Sep 2026, 09:25 UTC: only the cell&rsquo;s workspace is visible to it<Cite note={c5.sealed} branch={branch} />. Running departments under that sandbox, without the host&rsquo;s credentials in their environment, is work to finish before any client engagement.</span>
              </div>
              <div className="bf-controls-table__row" role="row">
                <span role="cell" data-label="Control"><b>Least privilege on reads</b></span>
                <span role="cell" data-label="Mechanism">The read barrier denies implementing and judging sessions the directories the validator owns, enforced where the filesystem capability opens a path<Cite note={c5.barrier} branch={branch} />.</span>
                <span role="cell" data-label="Evidence">Reads refused on the code-safety records: <V figure={f('safety.barrierRefusals')} note={c5.refusals} branch={branch} />.</span>
              </div>
              <div className="bf-controls-table__row" role="row">
                <span role="cell" data-label="Control"><b>Separation of duties</b></span>
                <span role="cell" data-label="Mechanism">The reviewer of a change is a separate session with no parent and an empty directory, and has had no tools since the second shift; it sees the diff, the commit messages and the check output, not the implementer&rsquo;s work. Its route and model are configured apart from the departments&rsquo;, but every review so far ran the same model through the same Claude Code login as the departments. Since 29 Sep, 10:15 UTC (commit 3291b6402) a ticket it rejects is held for a person and not reviewed again; before that rule, T-0019 was rejected on 28 Sep at 18:19 UTC, reviewed again and shipped<Cite note={c5.reviewer} branch={branch} />.</span>
                <span role="cell" data-label="Evidence">{reviews.length === 0 ? 'No review is on record.' : `${reviews.map(row => `Shift ${row.shift}: ${row.reviews} reviews, ${row.toolCalls} tool calls`).join('; ')}.`}<Cite note={c5.reviews} branch={branch} /></span>
              </div>
              <div className="bf-controls-table__row" role="row">
                <span role="cell" data-label="Control"><b>Independent verification</b></span>
                <span role="cell" data-label="Mechanism">A committed examiner re-reads every code-safety finding at the line it cites and fails the release if the text is not there<Cite note={c5.examinerRule} branch={branch} />.</span>
                <span role="cell" data-label="Evidence">Records whose examiner passed: {text(f('safety.examinerPassed'))} of {text(f('safety.records'))}<Cite note={c5.examiner} branch={branch} />.</span>
              </div>
              <div className="bf-controls-table__row" role="row">
                <span role="cell" data-label="Control"><b>Sign-off</b></span>
                <span role="cell" data-label="Mechanism">
                  A shift and an intake each record a spec freeze and a release. A person&rsquo;s sign-off would carry the principal,
                  the SHA-256 of what was signed and the evidence, unauthenticated; unattended runs record both as decisions of the
                  engine, under a machine principal, and no person approves a release<Cite note={c5.signoff} branch={branch} />.
                </span>
                <span role="cell" data-label="Evidence">
                  {events.length === 0 ? null : <>{events.length} sign-off events in {eventRuns.length} records were written by the engine as the program opened{spreadMs.length === 0 ? '' : `, at most ${Math.max(...spreadMs)} ms apart`}, under {quoted(events.map(row => row.principal))} with the kind {quoted(events.map(row => row.kind))}: machine decisions labelled as a person&rsquo;s. </>}
                  {decisionRuns.length === 0 ? 'No record carries the engine’s decisions yet. ' : <>{decisionRuns.length} {plural(decisionRuns.length, 'record carries', 'records carry')} the engine&rsquo;s decisions, under {quoted(decisions.map(row => row.principal))} with the kind {quoted(decisions.map(row => row.kind))}. </>}
                  No person signs a change before it is pushed<Cite note={c5.signoffs} branch={branch} />.
                </span>
              </div>
              <div className="bf-controls-table__row" role="row">
                <span role="cell" data-label="Control"><b>Data use and retention</b></span>
                <span role="cell" data-label="Mechanism">A session pins its terms when it is created &mdash; client, agreement, purposes, residency, retention, redaction profile &mdash; and later terms may only narrow them. Exports are refused without a redaction profile<Cite note={c5.terms} branch={branch} />.</span>
                <span role="cell" data-label="Evidence">{benchTerms === undefined ? '' : `${count(benchTerms.withTerms)} of ${count(benchTerms.sessions)} bench sessions pin terms; `}{otherTerms.map(row => `${row.family === 'codeSafety' ? 'code-safety' : row.family} ${count(row.withTerms)} of ${count(row.sessions)}`).join(', ')}<Cite note={c5.termsCount} branch={branch} />.</span>
              </div>
              <div className="bf-controls-table__row" role="row">
                <span role="cell" data-label="Control"><b>Secrets in records</b></span>
                <span role="cell" data-label="Mechanism">Key material a review reads out of a target is replaced before its record is committed; shift records cut credential-shaped strings and count them, and the live capture masks them<Cite note={c5.secrets} branch={branch} />.</span>
                <span role="cell" data-label="Evidence">Code-safety records with redactions: <V figure={f('safety.redactedRecords')} note={c5.redaction} branch={branch} />; strings cut from shift records: <V figure={f('shifts.redacted')} note={c5.shiftRedaction} branch={branch} />.</span>
              </div>
              <div className="bf-controls-table__row" role="row">
                <span role="cell" data-label="Control"><b>Audit trail</b></span>
                <span role="cell" data-label="Mechanism">The ledger is append-only, enforced by a gate since commit 580d9e688 (29 Sep, 10:54 UTC). Before that gate the ledger was edited: commit dae1babd0 (29 Sep, 06:45 UTC) rewrote the shipped commit on T-0007&rsquo;s line in place, and commits d46e02bd9, d1aec806b, 1f669dbf9 and 8a4dd9c02 inserted lines mid-file; the gate&rsquo;s commit lists them. Each shift record keeps every session log with each file&rsquo;s SHA-256; each commit names its shift, ticket, seat, program and sessions. Anything that reached a model is reconstructable from the session logs, except the sessions the loss register (LOSSES.md) records as erased by a container reset<Cite note={c5.audit} branch={branch} />.</span>
                <span role="cell" data-label="Evidence">Ledger lines: <V figure={f('ledger.lines')} note={c5.ledger} branch={branch} />; session logs in committed records: <V figure={f('sessions.recorded')} note={c5.sessions} branch={branch} />.</span>
              </div>
            </div>

            <h3>The review record<Cite note={c5.reviewRecord} branch={branch} /></h3>
            <p>
              The ledger records {text(f('reviews.approved'))} {plural(numberOf(f('reviews.approved')), 'approval', 'approvals')} and {text(f('reviews.rejected'))} {plural(numberOf(f('reviews.rejected')), 'rejection', 'rejections')} by the separate
              reviewer session<Cite note={c5.approved} branch={branch} />
              {numberOf(f('reviews.recordOnly')) === 0 ? null : <>, and the record of a shift that crashed before it wrote its ledger lines holds {text(f('reviews.recordOnly'))} more<Cite note={c5.recordOnly} branch={branch} /></>}.
              Each review ran in a session of its own that never saw the department&rsquo;s.
              {' '}{text(f('reviews.reviewerRecorded'))} of the ledger&rsquo;s reviews name the reviewer&rsquo;s model and route; the older
              lines read reviewer not recorded, and the model each review&rsquo;s request was sent with is read from its own session
              log<Cite note={c5.reviewerRecorded} branch={branch} />.
            </p>
            {overturned.length + reworked.length === 0 ? null : (
              <ul className="bf-points bf-points--compact">
                {overturned.map(row => (
                  <li key={`overturned-${row.shift}-${row.ticket}`}>
                    <b>{row.ticket}</b>, shift {row.shift}: the reviewer rejected the change; a later review approved the same ticket and it
                    shipped as <a href={commitUrl(row.overturnedBy)}><code>{short(row.overturnedBy)}</code></a>, which overturned the
                    rejection<Cite note={c5.overturned} branch={branch} />.
                  </li>
                ))}
                {reworked.map(row => (
                  <li key={`reworked-${row.shift}-${row.ticket}`}>
                    <b>{row.ticket}</b>, shift {row.shift}: the reviewer approved the change and it shipped as{' '}
                    <a href={commitUrl(row.shipped)}><code>{short(row.shipped)}</code></a>; it was reworked afterwards
                    by {listed(row.followUps.map(commit => `${short(commit.commit)} (“${commit.subject}”)`))}<Cite note={c5.reworked} branch={branch} />.
                  </li>
                ))}
              </ul>
            )}
            {reviewRecord.length === 0 ? null : (
              <div className="bf-table" role="table" aria-label="Reviews">
                <div className="bf-table__row bf-table__row--head" role="row">
                  <span role="columnheader">Ticket</span><span role="columnheader">Shift</span><span role="columnheader">Verdict</span><span role="columnheader">Reviewer on the ledger line</span><span role="columnheader">Request sent on</span><span role="columnheader">Tool calls</span><span role="columnheader">Afterwards</span>
                </div>
                {reviewRecord.map(row => (
                  <div className="bf-table__row" role="row" key={`${row.shift}-${row.ticket}-${row.sessionId ?? ''}`}>
                    <span role="cell" data-label="Ticket"><b>{row.ticket}</b> {row.sessionId === null ? '' : <code>{row.sessionId}</code>}</span>
                    <span role="cell" data-label="Shift">{row.shift}{row.at === null ? '' : `, ${moment(row.at)}`}</span>
                    <span role="cell" data-label="Verdict">{row.verdict === 'approve' ? 'approved' : 'rejected'}</span>
                    <span role="cell" data-label="Reviewer">{row.recordedIn === 'shift record' ? 'no ledger line: shift record only' : row.reviewer === null ? 'reviewer not recorded' : `${row.reviewer.model} on ${row.reviewer.route}`}</span>
                    <span role="cell" data-label="Request sent on">{row.requested === null ? 'no session log' : `${row.requested.model} on ${row.requested.route}`}</span>
                    <span role="cell" data-label="Tool calls" className="bf-num">{row.toolCalls === null ? 'unknown' : count(row.toolCalls)}</span>
                    <span role="cell" data-label="Afterwards">
                      {afterwards(row)}
                      <Cite note={c5.reviewRecord} branch={branch} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section index={6} notes={n6} branch={branch} lead={<>{LEADS.economics}<Cite note={c6.currency} branch={branch} />.</>}>
            <div className="bf-kpis bf-kpis--four">
              <Kpi label="Tokens per shipped ticket" value={text(f('economics.tokensPerShipped'))} detail={`mean of ${economics.length}, department and review`} note={c6.tokens} branch={branch} />
              <Kpi label="Agent time per ticket" value={text(f('economics.secondsPerShipped'), minutes)} detail={`mean of ${economics.length}, department and review`} note={c6.seconds} branch={branch} />
              <Kpi
                label="Shift, clone to its recorded end"
                value={text(f('economics.shiftSeconds'), minutes)}
                detail={`mean of ${text(f('economics.shippingShifts'))} ${plural(numberOf(f('economics.shippingShifts')), 'shift', 'shifts')} that shipped; a push a person completed later is not counted`}
                note={c6.shift}
                branch={branch}
              />
              <Kpi
                label="Security review time"
                value={`${text(f('safety.reviewSecondsMin'), value => (value / 60).toFixed(1))}–${text(f('safety.reviewSecondsMax'), minutes)}`}
                detail={`per review, over ${text(f('safety.records'))} reviews`}
                note={c6.review}
                branch={branch}
              />
            </div>
            {economics.length === 0 ? null : (
              <>
                <h3>Per shipped ticket<Cite note={c6.tickets} branch={branch} /></h3>
                <div className="bf-table bf-table--narrow" role="table" aria-label="Tokens and time per shipped ticket">
                  <div className="bf-table__row bf-table__row--head" role="row"><span role="columnheader">Ticket</span><span role="columnheader">Model tokens</span><span role="columnheader">Time</span></div>
                  {economics.map(row => (
                    <div className="bf-table__row" role="row" key={row.ticket}>
                      <span role="cell" data-label="Ticket"><b>{row.ticket}</b></span>
                      <span role="cell" data-label="Model tokens" className="bf-num">{count(row.tokens)}</span>
                      <span role="cell" data-label="Time" className="bf-num">{duration(row.seconds)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <h3>What the records support, and what they do not</h3>
            <ul className="bf-points">
              <li><b>Price per change is not recorded.</b> <span className="bf-unknown">Unknown</span><Cite note={c6.currency} branch={branch} />: every shift ran on a flat-rate subscription route, so a per-ticket price would be an estimate, and this briefing states none.</li>
              {tiers.length === 0 ? null : <li><b>A single model pass is cheaper and faster, and unchecked.</b> On the same application one pass took {tierTime(tiers.find(row => row.id === 'single-model'))} and cost {tierCost(tiers.find(row => row.id === 'single-model'))} by its own accounting; the enterprise took {tierTime(tiers.find(row => row.id === 'enterprise'))} on the subscription and had every finding checked at its cited line<Cite note={c6.tiers} branch={branch} />.</li>}
              <li><b>Scale is not yet established.</b> These means rest on {economics.length} shipped {plural(economics.length, 'ticket', 'tickets')}<Cite note={c6.tickets} branch={branch} />; a cost model for a client queue needs a pilot measured the same way.</li>
            </ul>
          </Section>

          <Section index={7} notes={n7} branch={branch} lead={LEADS.limits}>
            <ol className="bf-risks">
              <li>
                <b>{schedulerShippedCount === 0 ? 'A pilot, not yet unattended delivery.' : 'A pilot.'}</b> <V figure={f('tickets.shipped')} note={c7.operatorShipped} branch={branch} /> {plural(numberOf(f('tickets.shipped')), 'ticket has', 'tickets have')} shipped{shipped.length > 0 && shipped.length <= 3 ? ` (${listed(shipped.map(row => `“${row.title ?? row.ticket}”`))})` : ''}, {numberOf(f('pilot.operatorShipped')) === numberOf(f('tickets.shipped')) ? 'all' : `${text(f('pilot.operatorShipped'))} of them`} from work the operator started. The cycles the scheduler started have shipped <V figure={f('pilot.schedulerShipped')} note={c7.schedulerShipped} branch={branch} />{resetCycles.length === 0 ? '' : <>, and a container reset erased the session logs of the shift of {listed(resetCycles.map(row => row.id))} before it recorded its tickets, which the supervisor wrote to the ledger as abandoned afterwards<Cite note={c7.losses} branch={branch} /></>}.
              </li>
              <li>
                <b>Shift work is not yet sandboxed.</b> A department runs its commands unconfined in a worktree of a scratch clone
                that cannot push; the sandbox and the sealed workspace are in use on the bench
                only<Cite note={c7.isolation} branch={branch} />.
              </li>
              <li>
                {ciGreen
                  ? <><b>Continuous integration has only lately turned green.</b> The newest Branch CI run with a verdict passed; </>
                  : <><b>Continuous integration is not green.</b>{' '}</>}
                <V figure={f('ci.success')} note={c7.ci} branch={branch} /> of {text(f('ci.completed'))} completed Branch CI runs passed.
                No run tested a shipped commit on its own (<V figure={f('ci.exactShipped')} note={c7.exact} branch={branch} /> of{' '}
                {text(f('tickets.shipped'))}). Of the {shipments.length} {plural(shipments.length, 'push', 'pushes')} that carried them,
                the containing run of {failedPushes} failed{cancelledPushes === 0 ? '' : ` and of ${cancelledPushes} was cancelled by a later push before a verdict`}.
              </li>
              <li>
                <b>The name DeepSeek is provenance, not a supplier.</b> This repository is a fork of an open-source agent harness
                that DeepSeek AI publishes under the MIT licence, which is why its name and its package scope carry DeepSeek; DeepSeek
                AI has not built, reviewed or endorsed Daliesk. No shift, review or intake request goes to a DeepSeek endpoint: they
                go to Anthropic, as the next item states. Only the Proving Ground bench has run open-weight models, DeepSeek&rsquo;s
                among them, through OpenRouter<Cite note={c7.provenance} branch={branch} />.
              </li>
              <li>
                <b>A client&rsquo;s code would leave the machine.</b> Every model request, with the files a department reads, goes
                to Anthropic under the operator&rsquo;s Claude Code login, and the session logs and transcripts are published with
                a {text(visibility)} repository<Cite note={c7.dataFlow} branch={branch} />. The requirements in section 5 come
                first.
              </li>
              <li>
                <b>No person signs.</b> The engine decides each shift&rsquo;s spec freeze and release itself, and no person approves a
                change before it is pushed{eventRuns.length === 0 ? '' : `; the ${eventRuns.length} records that hold sign-off events label the engine’s decisions with a principal of the kind ${quoted(events.map(row => row.kind))}`}<Cite note={c7.signoffs} branch={branch} />.
              </li>
              <li><b>Data-use terms are not yet pinned on delivery work.</b> Sessions that pin terms: {otherTerms.map(row => `${row.family === 'codeSafety' ? 'code-safety' : row.family === 'shifts' ? 'shift' : 'intake'} ${count(row.withTerms)} of ${count(row.sessions)}`).join(', ')}<Cite note={c7.terms} branch={branch} />.</li>
              <li><b>One vendor.</b> {topRoute === undefined ? 'The route of the recorded sessions is unknown.' : `${routeShare} of the recorded sessions that made a model request ran on one route, ${topRoute.route} (${count(topRoute.sessions)} of ${count(routeTotal)})`}; a route&rsquo;s usage limit halts a shift<Cite note={c7.routes} branch={branch} />.</li>
              <li>
                <b>The benchmark is narrow.</b> The tasks are written in-house; the harness measured runs an eight-tool build rather
                than the full shipped composition<Cite note={c7.goals} branch={branch} />; and no harness change has been promoted
                by a frozen pair<Cite note={c7.bench} branch={branch} />.
              </li>
              <li>
                <b>Security recall is read on training applications.</b> The documented-defect targets are public, intentionally
                vulnerable applications; the checklist gain may not transfer; the review of this repository&rsquo;s own code
                confirmed none of its findings and missed a defect its triage found<Cite note={c7.comparison} branch={branch} />.
              </li>
              <li>
                <b>A developer preview.</b> The harness underneath is in developer preview and will change
                incompatibly<Cite note={c7.preview} branch={branch} />.
              </li>
            </ol>
          </Section>

          <Section index={8} notes={n8} branch={branch} lead={LEADS.roadmap}>
            <h3>Roadmap</h3>
            <ol className="bf-roadmap">
              <li>
                <b>Data handling before any client work.</b> Serve the departments from an Anthropic API organisation under a data
                processing agreement with zero data retention, keep the records in a private repository, and pin data-use terms on
                every session<Cite note={c8.terms} branch={branch} />.
              </li>
              <li>
                <b>Sign-off and isolation.</b> Have a person sign each release after the certificate, under a principal the engine
                does not configure<Cite note={c8.goals} branch={branch} />; run shift departments under the sandbox the bench already
                uses.
              </li>
              <li>
                <b>Unattended delivery, measured.</b> {scheduledChecks.length === 0 ? `${ciGreen ? 'Keep' : 'Make'} Branch CI green` : <>Clear the {listed(scheduledChecks)} {plural(scheduledChecks.length, 'check', 'checks')} that halted the scheduled cycles&rsquo; tickets and {ciGreen ? 'keep' : 'make'} Branch CI green</>}, then count what cycles ship without an operator, in the table of section 3<Cite note={c8.pilot} branch={branch} />.
              </li>
              <li>
                <b>Evidence that others can check.</b> Measure on public suites and on private tasks no model has seen, with more
                cells per arm, before promoting any harness change<Cite note={c8.goals} branch={branch} />.
              </li>
              <li>
                <b>More than one model vendor.</b> Run the same cells on more routes, so a result is not one
                vendor&rsquo;s<Cite note={c8.goals} branch={branch} />.
              </li>
              <li>
                <b>Full CI coverage.</b> Compose the Windows and primary lanes this fork lacks, so the vacant judge seats rule on
                real runs<Cite note={c8.vacancy} branch={branch} />.
              </li>
            </ol>
            <h3>Proposed engagement</h3>
            <ol className="bf-phases">
              <li>
                <span className="bf-phase__step">Step 1</span>
                <b>Data handling, terms and scope</b>
                <p>
                  An Anthropic API organisation for the engagement under a data processing agreement with zero data retention; a
                  private repository for the records; the data-use terms each session will pin; and the people who
                  sign<Cite note={c8.terms} branch={branch} />.
                </p>
              </li>
              <li>
                <span className="bf-phase__step">Step 2</span>
                <b>A code-safety review of a codebase the client selects</b>
                <p>
                  Six departments, each finding checked at the line it cites, the report with executive summaries in French and
                  English; recall read by planting defects in a copy<Cite note={c8.safety} branch={branch} />. On the reference
                  application one review took up to {text(f('safety.reviewSecondsMax'), minutes)}<Cite note={c8.duration} branch={branch} />.
                </p>
              </li>
              <li>
                <span className="bf-phase__step">Step 3</span>
                <b>Supervised shifts on an agreed queue</b>
                <p>
                  Tickets under the client&rsquo;s own acceptance commands, a person signing each release, measured as this
                  briefing measures: checks, reviews, CI verdicts, tokens and time per ticket<Cite note={c8.queue} branch={branch} />.
                </p>
              </li>
              <li>
                <span className="bf-phase__step">Step 4</span>
                <b>Decision</b>
                <p>Continue, widen or stop on the measured record, not on this document.</p>
              </li>
            </ol>
          </Section>

          <section className="bf-section bf-appendix" id="inputs" aria-labelledby="inputs-title">
            <header className="bf-section__head">
              <span className="bf-section__number">A</span>
              <h2 id="inputs-title">Inputs and verification</h2>
              <p className="bf-lead">Every figure above was computed by <code>pnpm run enterprise:briefing</code> from these inputs<Cite note={cA.inputs} branch={branch} />. For a directory, the digest covers the list of every file read under it with that file&rsquo;s own SHA-256.</p>
            </header>
            <h3>Inputs<Cite note={cA.inputs} branch={branch} /></h3>
            <div className="bf-table bf-table--inputs" role="table" aria-label="Inputs">
              <div className="bf-table__row bf-table__row--head" role="row"><span role="columnheader">Input</span><span role="columnheader">Files</span><span role="columnheader">Bytes</span><span role="columnheader">SHA-256</span></div>
              {data.inputs.map(input => (
                <div className="bf-table__row" role="row" key={input.path}>
                  <span role="cell" data-label="Input"><a href={pathUrl(input.path, branch)}><code>{input.path}</code></a></span>
                  <span role="cell" data-label="Files" className="bf-num">{count(input.files)}</span>
                  <span role="cell" data-label="Bytes" className="bf-num">{count(input.bytes)}</span>
                  <span role="cell" data-label="SHA-256"><code className="bf-hash">{input.sha256.slice(0, 16)}</code></span>
                </div>
              ))}
            </div>
            <h3>To check a figure</h3>
            <ol className="bf-points bf-points--numbered">
              <li>Open its source note: it names the paths read and the computation.</li>
              <li>
                Open the path on the branch; the Proving Ground and code-safety records carry their own manifests with each
                file&rsquo;s SHA-256.
              </li>
              <li>
                Rebuild with <code>pnpm run enterprise:briefing</code> on a checkout of the branch and
                compare <code>apps/command-deck/public/fixtures/briefing.json</code>.
              </li>
              <li>
                Read the claims register, <a href={pathUrl(CLAIMS, branch)}><code>briefing-claims.md</code></a>: every sentence of
                this page with the notes it cites<Cite note={cA.claims} branch={branch} />.
              </li>
            </ol>
            <SourceNotes notes={nA.list()} branch={branch} />
          </section>

          <footer className="bf-footer">
            <span>Daliesk · client briefing · committed records as of {moment(data.asOf)}</span>
            <span>Built from <code>briefing.json</code>, schema {data.schema}</span>
          </footer>
        </main>
      </div>
    </div>
  )
}
