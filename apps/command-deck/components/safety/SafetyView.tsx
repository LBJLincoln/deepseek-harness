'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { SEVERITY_ORDER, type Severity } from '@/deck/contract'
import { departmentOf } from '@/deck/departments'
import { startSafety } from '@/deck/feed'
import { bytes, stamp } from '@/deck/format'
import { languageColor, SEVERITY_COLOR } from '@/deck/palette'
import { useDeck } from '@/deck/store'
import { ReplayNotice } from '@/components/shell/ReplayNotice'
import { FindingCard } from './FindingCard'

// three.js reaches for a WebGL context on mount, so the scene never renders on
// the server; the rest of the view is ordinary React and does.
const SafetyStage = dynamic(
  async () => (await import('./SafetyStage')).SafetyStage,
  { ssr: false, loading: () => <div className="loading">building the code city…</div> },
)

/** Which panel tab is open. */
type Tab = 'findings' | 'certificate' | 'report'

/** The models `pnpm run code-safety -- --model` accepts; the feed forwards the name unchanged. */
const REVIEW_MODELS = ['sonnet', 'opus'] as const
type ReviewModel = (typeof REVIEW_MODELS)[number]

/**
 * Offer one generated file to the viewer.
 * @param name - Download file name.
 * @param content - File contents.
 * @param type - MIME type.
 */
function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * The Code safety view: the city on the left, the review on the right.
 * @returns The view.
 */
export function SafetyView(): ReactNode {
  const safety = useDeck(state => state.safety)
  const safetyRunId = useDeck(state => state.safetyRunId)
  const source = useDeck(state => state.source)
  const selectedFindingId = useDeck(state => state.selectedFindingId)
  const selectFinding = useDeck(state => state.selectFinding)
  const selectRun = useDeck(state => state.selectRun)
  const addRun = useDeck(state => state.addRun)

  const [tab, setTab] = useState<Tab>('findings')
  const [severity, setSeverity] = useState<Severity | 'all'>('all')
  const [department, setDepartment] = useState('all')
  const [cwe, setCwe] = useState('all')
  const [target, setTarget] = useState('')
  const [model, setModel] = useState<ReviewModel>('sonnet')
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | undefined>(undefined)

  // The form opens on the loaded review's own target, which is a path the
  // feed's machine is known to hold; a viewer replaces it to review another.
  const loadedTarget = safety?.target.path
  useEffect(() => {
    if (loadedTarget !== undefined) setTarget(current => (current === '' ? loadedTarget : current))
  }, [loadedTarget])

  const findings = safety?.findings ?? []

  const filtered = useMemo(() => findings.filter(finding => (
    (severity === 'all' || finding.severity === severity)
    && (department === 'all' || departmentOf(finding) === department)
    && (cwe === 'all' || finding.cwe === cwe)
  )), [findings, severity, department, cwe])

  const cwes = useMemo(
    () => [...new Set(findings.map(finding => finding.cwe))].sort((left, right) => left.localeCompare(right)),
    [findings],
  )

  const selected = findings.find(finding => finding.id === selectedFindingId)

  const onStart = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (source === undefined) return
    setStarting(true)
    setStartError(undefined)
    try {
      const id = await startSafety(source.base, target, model)
      // The feed lists the run once its directory exists; until then the deck
      // carries it itself so the views can follow it from the first event.
      addRun({
        id,
        kind: 'code-safety',
        name: target.split('/').filter(Boolean).pop() ?? target,
        startedAt: new Date().toISOString(),
        status: 'running',
        path: target,
      })
      selectRun(id)
      setTab('findings')
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error))
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="view view--split">
      <div className="stage">
        {safety === undefined
          ? <div className="loading">reading the review…</div>
          : (
            <SafetyStage
              target={safety.target}
              findings={findings}
              selectedFindingId={selectedFindingId}
              onSelectFinding={selectFinding}
            />
          )}

        <div className="stage__overlay">
          <div className="stage__title">
            <h1>{safety?.target.name ?? 'Code safety'}</h1>
            <p>
              Directories are districts, files are blocks scaled by size and coloured by language.
              Every marker is a finding standing on the line of code that carries it.
            </p>
            <div className="legend" style={{ marginTop: 11 }}>
              {SEVERITY_ORDER.map(level => (
                <span key={level}>
                  <i style={{ background: SEVERITY_COLOR[level], borderRadius: '50%' }} />
                  {level} {findings.filter(finding => finding.severity === level).length}
                </span>
              ))}
            </div>
          </div>
          <span className="hint">drag to orbit · click a marker or a block</span>
        </div>

        {selected === undefined ? null : (
          <FindingCard
            finding={selected}
            certificate={safety?.certificate}
            onClose={() => selectFinding(undefined)}
          />
        )}
      </div>

      <aside className="panel">
        <div className="panel__head">
          <div className="panel__eyebrow">Code safety review</div>
          <h2 className="panel__title">{safety?.target.name ?? '—'}</h2>
          <p className="panel__sub">
            {safety === undefined
              ? '—'
              : `${safety.target.files.length} files · ${Object.keys(safety.target.languages).length} languages · ${findings.length} findings`}
          </p>
        </div>

        <div className="tabs">
          <button type="button" data-active={tab === 'findings'} onClick={() => setTab('findings')}>Findings</button>
          <button type="button" data-active={tab === 'certificate'} onClick={() => setTab('certificate')}>Certificate</button>
          <button type="button" data-active={tab === 'report'} onClick={() => setTab('report')}>Report</button>
        </div>

        <div className="panel__body">
          <ReplayNotice />

          {tab === 'findings' ? (
            <>
              <div className="filters">
                <div>
                  <label className="label" htmlFor="filter-severity">Severity</label>
                  <select
                    id="filter-severity"
                    className="input"
                    value={severity}
                    onChange={event => setSeverity(event.target.value as Severity | 'all')}
                  >
                    <option value="all">all</option>
                    {SEVERITY_ORDER.map(level => <option key={level} value={level}>{level}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="filter-department">Department</label>
                  <select
                    id="filter-department"
                    className="input"
                    value={department}
                    onChange={event => setDepartment(event.target.value)}
                  >
                    <option value="all">all</option>
                    {(safety?.departments ?? []).map(entry => (
                      <option key={entry.id} value={entry.id}>{entry.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="filter-cwe">CWE</label>
                  <select id="filter-cwe" className="input" value={cwe} onChange={event => setCwe(event.target.value)}>
                    <option value="all">all</option>
                    {cwes.map(entry => <option key={entry} value={entry}>{entry}</option>)}
                  </select>
                </div>
              </div>

              <table className="table" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>Sev</th>
                    <th>Finding</th>
                    <th style={{ width: 72 }}>CWE</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(finding => (
                    <tr
                      key={finding.id}
                      data-selected={finding.id === selectedFindingId}
                      onClick={() => selectFinding(finding.id)}
                    >
                      <td><span className="sev" data-s={finding.severity} /></td>
                      <td>
                        <div>{finding.title}</div>
                        <div className="mono">{finding.file}:{finding.line}</div>
                      </td>
                      <td className="mono">{finding.cwe}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filtered.length === 0
                ? (
                  <div className="panel__empty">
                    {findings.length === 0 && safety?.departments.some(entry => entry.status === 'pending') === true
                      ? 'The review is running. Findings appear here once the departments release them; the certificate follows the integration.'
                      : 'No finding matches these filters.'}
                  </div>
                )
                : null}
            </>
          ) : null}

          {tab === 'certificate' && safety !== undefined ? (
            <>
              <div className={`card ${safety.certificate.verified ? 'card--verified' : ''}`}>
                <div className="card__head">
                  <h4>{safety.certificate.verified ? 'Certificate issued' : 'Certificate withheld'}</h4>
                  <span className="status-tag" data-status={safety.certificate.verified ? 'certified' : 'failed'}>
                    {safety.certificate.verified ? 'verified' : 'unverified'}
                  </span>
                </div>
                <dl style={{ margin: '8px 0 0' }}>
                  <div className="field">
                    <dt>Verifier</dt>
                    <dd className="mono">{safety.certificate.verifier}</dd>
                  </div>
                  <div className="field">
                    <dt>Checked</dt>
                    <dd className="mono">{stamp(safety.certificate.checkedAt)}</dd>
                  </div>
                </dl>
                <div className="tally">
                  {SEVERITY_ORDER.map(level => (
                    <div key={level}>
                      <b style={{ color: SEVERITY_COLOR[level] }}>{safety.certificate.counts[level]}</b>
                      <span>{level}</span>
                    </div>
                  ))}
                </div>
                {safety.certificate.unverified.length === 0 ? null : (
                  <p style={{ margin: '11px 0 0', fontSize: 11, color: 'var(--amber)' }}>
                    Named unverified: {safety.certificate.unverified.join(', ')}
                  </p>
                )}
              </div>

              <div className="section">
                <h3>Departments</h3>
                <table className="table">
                  <tbody>
                    {safety.departments.map(entry => (
                      <tr key={entry.id} onClick={() => { setDepartment(entry.id); setTab('findings') }}>
                        <td>
                          <div>{entry.name}</div>
                          <div className="mono">{entry.status}</div>
                        </td>
                        <td style={{ textAlign: 'right', width: 52 }}>{entry.findings}</td>
                        <td style={{ width: 22 }}>
                          <span className="status-tag" data-status={entry.certified ? 'certified' : 'failed'} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="section">
                <h3>Languages</h3>
                <div className="legend">
                  {Object.entries(safety.target.languages).map(([language, count]) => (
                    <span key={language}>
                      <i style={{ background: languageColor(language) }} />
                      {language} {count}
                    </span>
                  ))}
                </div>
                <p style={{ margin: '9px 0 0', fontSize: 11, color: 'var(--ink-3)' }}>
                  {safety.target.path} · {bytes(safety.target.files.reduce((total, file) => total + file.bytes, 0))} read
                </p>
              </div>

              <div className="section">
                <h3>Download</h3>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => download(
                      `${safetyRunId ?? 'review'}-findings.json`,
                      `${JSON.stringify(findings, null, 2)}\n`,
                      'application/json',
                    )}
                  >
                    findings.json
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => download(`${safetyRunId ?? 'review'}-report.md`, safety.report.markdown, 'text/markdown')}
                  >
                    report.md
                  </button>
                </div>
              </div>

              <form className="section" onSubmit={(event) => { void onStart(event) }}>
                <h3>Start a review</h3>
                <label className="label" htmlFor="review-target">Target path</label>
                <input
                  id="review-target"
                  className="input"
                  value={target}
                  onChange={event => setTarget(event.target.value)}
                  placeholder="absolute path of a repository on the feed's machine"
                />
                <label className="label" htmlFor="review-model" style={{ marginTop: 9 }}>Model</label>
                <select
                  id="review-model"
                  className="input"
                  value={model}
                  onChange={event => setModel(event.target.value === 'opus' ? 'opus' : 'sonnet')}
                >
                  {REVIEW_MODELS.map(name => <option key={name} value={name}>{name}</option>)}
                </select>
                <button
                  type="submit"
                  className="btn"
                  data-variant="primary"
                  style={{ marginTop: 11 }}
                  disabled={starting || target.trim() === ''}
                >
                  {starting ? 'starting…' : 'Start review'}
                </button>
                {startError === undefined ? null : (
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--red)' }}>{startError}</p>
                )}
                {source?.mode === 'replay' ? (
                  <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--ink-3)' }}>
                    In replay mode this reopens the recorded review instead of starting a new one.
                  </p>
                ) : null}
              </form>
            </>
          ) : null}

          {tab === 'report' && safety !== undefined ? (
            <div className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{safety.report.markdown}</ReactMarkdown>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  )
}
