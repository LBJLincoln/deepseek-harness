'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import type { ProgramRecord } from '@/deck/contract'
import { clock, duration, stamp } from '@/deck/format'
import { useDeck } from '@/deck/store'

/** How many leading characters of a digest or revision the panel prints. */
const SHORT_HASH = 12

/** One moment of a program's sign-off chain, in the order the record logged it. */
interface ChainStep {
  at: string
  label: string
  /** Who the record says decided, for a signature. */
  who?: string
  /** The signed artefact's digest, for a signature. */
  digest?: string
  /** A signature that vouches for work the record certifies only later. */
  early: boolean
}

/**
 * A program's sign-off chain: every signature beside the moments it vouches
 * for — the program's start, the integration's certificate, and its end —
 * ordered by the times the record logged. A `release` recorded before the
 * integration was certified is marked, because the record then shows the
 * release vouching for work that did not yet exist.
 * @param program - The program record.
 * @returns The chain, earliest first.
 */
function chainOf(program: ProgramRecord): ChainStep[] {
  const certifiedAt = program.integration?.certifiedAt
  const steps: ChainStep[] = [{ at: program.startedAt, label: 'program started', early: false }]
  for (const signoff of program.signoffs) {
    if (signoff.at === undefined) continue
    const who = signoff.decidedBy === undefined
      ? 'no principal recorded'
      : `${signoff.decidedBy.displayName ?? signoff.decidedBy.id} (${signoff.decidedBy.kind})`
    steps.push({
      at: signoff.at,
      label: `${signoff.transition} signed`,
      who,
      ...signoff.artefactSha256 === undefined ? {} : { digest: signoff.artefactSha256.slice(0, SHORT_HASH) },
      early: signoff.transition === 'release' && certifiedAt !== undefined && Date.parse(signoff.at) < Date.parse(certifiedAt),
    })
  }
  if (certifiedAt !== undefined) steps.push({ at: certifiedAt, label: 'integration certified', early: false })
  if (program.endedAt !== undefined) steps.push({ at: program.endedAt, label: program.outcome ?? 'ended', early: false })
  return steps.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
}

/**
 * One department or integration row. The row opens its session in the Workflow
 * view when the deck lists the program's run, and names the session log's file
 * otherwise (its full path is the row's tooltip).
 * @param props - The program, the row's figures, and whether the deck lists the run.
 * @returns The table row.
 */
function SessionRow({
  program,
  name,
  status,
  sessionId,
  sessionPath,
  steps,
  toolCalls,
  certified,
  listed,
}: {
  program: ProgramRecord
  name: string
  status: string
  sessionId: string
  sessionPath: string | undefined
  steps: number
  toolCalls: number
  certified: boolean
  listed: boolean
}): ReactNode {
  const router = useRouter()
  const selectRun = useDeck(state => state.selectRun)
  const selectSession = useDeck(state => state.selectSession)
  const open = (): void => {
    selectRun(program.runId)
    selectSession(sessionId)
    router.push('/workflow')
  }
  const where = sessionPath ?? 'no session log recorded'
  return (
    <tr
      data-link={listed}
      title={listed ? `open ${sessionId} in the Workflow view` : where}
      onClick={listed ? open : undefined}
    >
      <td>
        <div>{name}</div>
        <div className="mono">{listed ? `${status} · open session` : `${status} · ${where.split('/').at(-1) ?? where}`}</div>
      </td>
      <td style={{ textAlign: 'right', width: 44 }}>{steps}</td>
      <td style={{ textAlign: 'right', width: 44 }}>{toolCalls}</td>
      <td style={{ width: 22 }}>
        <span className="status-tag" data-status={certified ? 'certified' : 'failed'} title={certified ? 'certified' : 'no certificate'} />
      </td>
    </tr>
  )
}

/**
 * One program run of the record.
 * @param props - The program, and whether the deck lists its run.
 * @returns The card.
 */
function ProgramCard({ program, listed }: { program: ProgramRecord; listed: boolean }): ReactNode {
  const released = program.outcome === 'released'
  const certified = program.departments.filter(department => department.certified).length
  return (
    <div className={`card record ${released ? 'card--verified' : ''}`}>
      <div className="card__head">
        <h4>{program.runId}</h4>
        <span className="status-tag" data-status={released ? 'certified' : program.outcome === undefined ? 'active' : 'failed'}>
          {program.outcome ?? 'running'}
        </span>
      </div>
      <p className="record__what">
        {program.kind === 'code-safety'
          ? `Code-safety review of ${program.target ?? 'an unrecorded target'}`
          : program.spec?.objective ?? 'Program run'}
      </p>
      <p className="record__meta">
        {stamp(program.startedAt)} · {program.endedAt === undefined ? 'running' : duration(program.startedAt, program.endedAt)}
        {' · '}{certified} of {program.departments.length} departments certified
      </p>

      <table className="table record__table">
        <thead>
          <tr>
            <th>Department</th>
            <th style={{ textAlign: 'right' }}>Steps</th>
            <th style={{ textAlign: 'right' }}>Tools</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {program.departments.map(department => (
            <SessionRow
              key={department.key}
              program={program}
              name={department.key}
              status={department.status}
              sessionId={department.sessionId}
              sessionPath={department.sessionPath}
              steps={department.steps}
              toolCalls={department.toolCalls}
              certified={department.certified}
              listed={listed}
            />
          ))}
          {program.integration === undefined ? null : (
            <SessionRow
              program={program}
              name="integration"
              status={program.integration.status}
              sessionId={program.integration.sessionId}
              sessionPath={program.integration.sessionPath}
              steps={program.integration.steps}
              toolCalls={program.integration.toolCalls}
              certified={program.integration.certified}
              listed={listed}
            />
          )}
        </tbody>
      </table>

      <div className="record__chain">
        <h5>Sign-off chain</h5>
        {chainOf(program).map(step => (
          <div className="record__step" data-early={step.early} key={`${step.at}-${step.label}`}>
            <time>{clock(step.at)}</time>
            <div>
              <div>{step.label}{step.who === undefined ? '' : ` by ${step.who}`}</div>
              {step.digest === undefined && !step.early ? null : (
                <div className="record__note">
                  {step.digest === undefined ? '' : `artefact ${step.digest}…`}
                  {step.early ? `${step.digest === undefined ? '' : ' · '}signed before the integration certified` : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="record__path" title={program.programId}>{program.path}</p>
    </div>
  )
}

/**
 * The Record tab: the organisation of record, one card per recorded program
 * run, newest first, read from `GET /programs` or its committed fixture.
 * @returns The tab body.
 */
export function RecordPanel(): ReactNode {
  const programs = useDeck(state => state.programs)
  const programsError = useDeck(state => state.programsError)
  const runs = useDeck(state => state.runs)

  if (programs === undefined) {
    return (
      <div className="panel__empty">
        {programsError === undefined ? 'Reading the record…' : `The feed serves no record of program runs (${programsError}).`}
      </div>
    )
  }
  if (programs.length === 0) return <div className="panel__empty">No program run is recorded yet.</div>

  const listed = new Set(runs.map(run => run.id))
  return (
    <>
      <p className="record__lead">
        Every program run the records hold: who did the work, what each department certified, what the integration concluded,
        and who signed each transition and when. Open a department to follow its session.
      </p>
      {programs.map(program => <ProgramCard key={program.path} program={program} listed={listed.has(program.runId)} />)}
    </>
  )
}
