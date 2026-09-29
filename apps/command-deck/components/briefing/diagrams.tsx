import type { ReactNode } from 'react'
import type { DivisionRow } from './types.ts'

/**
 * How each division is engaged, as `data/enterprise/README.md` (functions,
 * the cycle) and `data/enterprise/tickets/README.md` (the divisions in the
 * queue) define it. A division absent here is shown without a tag.
 */
const ENGAGEMENT: Readonly<Record<string, readonly string[]>> = {
  'harness-core': ['Tickets'],
  'proving-ground': ['Bench runs'],
  'verification': ['Cycle function: gates'],
  'judging': ['Cycle function: CI verdicts'],
  'curation-data': ['Cycle function: scoreboard', 'Tickets'],
  'program-departments': ['Intake', 'Tickets'],
  'code-safety': ['Reviews on request'],
  'knowledge': ['Tickets'],
  'governance': ['Tickets'],
  'observatory': ['Cycle function: telemetry'],
}

/**
 * The organisation: the operator above the cycle, the cycle above the ten
 * divisions, each division with its purpose, its seats and how it is engaged.
 * The operator is the one person in it; every sign-off in the shift records is
 * written by the engine, so the chart does not present the operator as a
 * signatory.
 * @param props - the divisions in the roster's order.
 * @returns the chart.
 */
export function OrgChart({ divisions }: { divisions: readonly DivisionRow[] }): ReactNode {
  return (
    <figure className="bf-org" aria-label="Organisation chart">
      <div className="bf-org__apex">
        <div className="bf-org__node bf-org__node--human">
          <span className="bf-org__kind">Operator · a person</span>
          <b>Owns the queue policy, the schedule and the branch</b>
          <span>Starts shifts and cycles by hand; the scheduler starts the rest</span>
        </div>
        <i className="bf-org__stem" aria-hidden="true" />
        <div className="bf-org__node bf-org__node--cycle">
          <span className="bf-org__kind">The cycle · every two hours</span>
          <b>Intake → shift → functions → roster and deck</b>
          <span>Started by the scheduler at 13 minutes past every even UTC hour, or by the operator</span>
        </div>
        <i className="bf-org__stem" aria-hidden="true" />
      </div>
      <ol className="bf-org__divisions">
        {divisions.map(division => (
          <li className="bf-org__division" key={division.id}>
            <b>{division.name}</b>
            <span className="bf-org__purpose">{division.purpose}</span>
            <span className="bf-org__foot">
              <span>{division.defined} seats</span>
              <span className="bf-org__tags">{(ENGAGEMENT[division.id] ?? []).map(tag => <em key={tag}>{tag}</em>)}</span>
            </span>
          </li>
        ))}
      </ol>
    </figure>
  )
}

interface Step {
  title: string
  who: string
  what: string
  record: string
}

const STEPS: readonly Step[] = [
  { title: 'Intake', who: 'Program Departments coordinators', what: 'Propose tickets for their package groups when fewer than 8 are open; admission files only tickets whose checks fail on the branch tip.', record: 'data/enterprise/intake/<run>/' },
  { title: 'Queue', who: 'The ticket file', what: 'Names the seat, the paths the change may touch, the acceptance commands and the budget.', record: 'data/enterprise/tickets/T-nnnn.json' },
  { title: 'Shift', who: 'The seat’s department', what: 'Implements the ticket in its own worktree of a fresh clone of the branch.', record: 'Session log per department' },
  { title: 'Acceptance', who: 'The engine', what: 'Runs the ticket’s commands and its own checks: committed, inside scope, clean whitespace, documentation pairing.', record: 'Ledger line: checks' },
  { title: 'Blind review', who: 'An independent session', what: 'No parent and an empty directory, and no tools since the second shift; reads the diff, the commit messages and the check output, then approves or rejects.', record: 'Review session log; ledger: review' },
  { title: 'Assembly', who: 'The engine', what: 'Squashes each approved ticket into one commit on the base, checks the tree against the certified merge, and re-runs the acceptance.', record: 'Commit naming shift, ticket, seat, sessions' },
  { title: 'Push, then CI', who: 'The engine, then GitHub', what: 'One fast-forward push of the commits with the ledger lines; Branch CI then runs its static, coverage and snapshot lanes on the pushed tip, after the change is on the branch.', record: 'Shift record; GitHub Actions run' },
  { title: 'Functions', who: 'Verification, Judging, Observatory, Curation', what: 'Run the gates on the new tip, read the CI verdicts, fold telemetry and the scoreboard; the roster and this briefing are regenerated.', record: 'Ledger function lines' },
]

/**
 * The flow of one ticket from intake to the functions that follow a shift,
 * each step with its actor and the record it leaves.
 * @returns the diagram.
 */
export function FlowDiagram(): ReactNode {
  return (
    <figure className="bf-flow" aria-label="From intake to shipped commit">
      <ol className="bf-flow__steps">
        {STEPS.map((step, index) => (
          <li className="bf-flow__step" key={step.title}>
            <span className="bf-flow__index">{index + 1}</span>
            <b className="bf-flow__title">{step.title}</b>
            <span className="bf-flow__who">{step.who}</span>
            <span className="bf-flow__what">{step.what}</span>
            <span className="bf-flow__record"><code>{step.record.replaceAll('/', '/\u200b')}</code></span>
          </li>
        ))}
      </ol>
    </figure>
  )
}

/** One movement of data between the review machine and a party outside it. */
export interface Flow {
  /** What moves, and where it starts. */
  from: string
  /** Where it arrives. */
  to: string
  /** `out` leaves the review machine; `in` arrives on it. */
  direction: 'in' | 'out'
  /** The party outside the machine, which picks the destination's marker. */
  party: 'anthropic' | 'github'
  /** How it moves. */
  how: ReactNode
}

/**
 * Where the data of a shift goes: one row per movement between the review
 * machine and a party outside it, the machine on the left, the party on the
 * right and the arrow pointing the way the data moves.
 * @param props - the flows, in the order a shift causes them.
 * @returns the diagram.
 */
export function DataFlow({ flows }: { flows: readonly Flow[] }): ReactNode {
  return (
    <figure className="bf-dataflow" aria-label="Data flow">
      <div className="bf-dataflow__head" aria-hidden="true">
        <span>On the review machine</span>
        <span>How it moves</span>
        <span>Outside it</span>
      </div>
      <ol className="bf-dataflow__rows">
        {flows.map(flow => (
          <li className="bf-dataflow__row" key={`${flow.from} ${flow.to}`}>
            <span className="bf-dataflow__node">{flow.from}</span>
            <span className={`bf-dataflow__edge bf-dataflow__edge--${flow.direction}`}>
              <span className="bf-dataflow__how">{flow.how}</span>
              <i className="bf-dataflow__arrow" aria-hidden="true" />
            </span>
            <span className={`bf-dataflow__node bf-dataflow__node--${flow.party}`}>{flow.to}</span>
          </li>
        ))}
      </ol>
    </figure>
  )
}
