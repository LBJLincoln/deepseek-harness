'use client'

import type { ReactNode } from 'react'
import type { Finding, SafetyCertificate } from '@/deck/contract'
import { departmentOf } from '@/deck/departments'

/**
 * A finding's confidence as text.
 *
 * The contract types the field as a number, and the fixtures carry one, but a
 * live feed also reports it as a word the departments wrote — `confirmed`,
 * `likely` — so the card renders whichever arrives rather than calling a
 * number method on a string.
 * @param confidence - The confidence the feed reported.
 * @returns The text to show after the location.
 */
function confidenceText(confidence: number | string): string {
  return typeof confidence === 'number' ? confidence.toFixed(2) : confidence
}

/**
 * The selected finding, over the city, next to the marker it belongs to.
 * @param props - The finding and the certificate that did or did not verify it.
 * @returns The floating detail card.
 */
export function FindingCard({
  finding,
  certificate,
  onClose,
}: {
  finding: Finding
  certificate: SafetyCertificate | undefined
  onClose: () => void
}): ReactNode {
  const verified = certificate !== undefined && !certificate.unverified.includes(finding.id)

  return (
    <div className="finding-card">
      <div className="finding-card__head">
        <span className="sev" data-s={finding.severity}>{finding.severity}</span>
        <span className="finding-card__id">{finding.id}</span>
        <span className="chip">{finding.cwe}</span>
        <span className="chip">{departmentOf(finding)}</span>
        <span
          className="status-tag"
          data-status={verified ? 'certified' : 'failed'}
          title={verified ? 'Re-read by the verifier at this line' : 'Named on the certificate as unverified'}
        >
          {verified ? 'verified' : 'unverified'}
        </span>
        <button type="button" className="btn finding-card__close" onClick={onClose} aria-label="Close finding">
          esc
        </button>
      </div>

      <h3 className="finding-card__title">{finding.title}</h3>
      <div className="finding-card__where">
        {finding.file}:{finding.line} · {finding.owasp} · confidence {confidenceText(finding.confidence)}
      </div>

      <pre className="snippet" style={{ borderLeftColor: `var(--${finding.severity})` }}>{finding.snippet}</pre>

      <dl className="finding-card__facts">
        <div>
          <dt>Evidence</dt>
          <dd>{finding.evidence}</dd>
        </div>
        <div>
          <dt>Impact</dt>
          <dd>{finding.impact}</dd>
        </div>
        <div>
          <dt>Fix</dt>
          <dd>{finding.fix}</dd>
        </div>
      </dl>
    </div>
  )
}
