'use client'

import type { CSSProperties, ReactNode } from 'react'
import { SEVERITY_ORDER, type SafetyReview } from '@/deck/contract'
import { SEVERITY_COLOR } from '@/deck/palette'
import type { VerdictKind } from './moments.ts'
import styles from './moments.module.css'

/**
 * Split a word into letters that arrive one after another.
 * @param text - The verdict word.
 * @returns One span per character, each carrying its place in the stagger.
 */
function struck(text: string): ReactNode[] {
  return [...text].map((char, index) => (
    <span className={styles.char} key={index} style={{ '--i': index } as CSSProperties}>
      {char === ' ' ? ' ' : char}
    </span>
  ))
}

/**
 * Who the certificate did not cover, as the review itself names them.
 * @param review - The loaded review.
 * @returns The named findings, else the departments that issued no
 * certificate, else a statement that the verifier named neither.
 */
function withheldFrom(review: SafetyReview): string {
  if (review.certificate.unverified.length > 0) {
    return `unverified: ${review.certificate.unverified.join(', ')}`
  }
  const missing = review.departments.filter(entry => !entry.certified)
  if (missing.length > 0) return `no certificate from ${missing.map(entry => entry.name).join(', ')}`
  return 'the verifier named no finding and no department'
}

/**
 * The certificate landing over the city.
 *
 * Every number and name is read from the loaded review: the departments that
 * certified, the examiner the certificate names, its severity counts, and —
 * when it was withheld — what it names as unverified.
 * @param props - The verdict, the loaded review, and the motion preference.
 * @returns The overlay.
 */
export function VerdictCard({
  verdict,
  review,
  reduced,
}: {
  verdict: VerdictKind
  review: SafetyReview
  reduced: boolean
}): ReactNode {
  const certified = verdict === 'certified'
  const departments = review.departments
  const passed = departments.filter(entry => entry.certified).length

  return (
    <div
      className={`${styles.overlay} ${styles.verdict}`}
      data-reduced={reduced}
      style={{ color: certified ? 'var(--green)' : 'var(--amber)' }}
    >
      <div>
        <div className={styles.eyebrow}>Code safety review · {review.target.name}</div>
        <h2 className={styles.verdictTitle}>{struck(certified ? 'CERTIFIED' : 'NOT CERTIFIED')}</h2>

        <p className={styles.verdictLine} style={{ '--i': 0 } as CSSProperties}>
          {passed} of {departments.length} departments certified · {review.findings.length} findings
          <span className={styles.verdictWhere}>
            {certified ? `examined by ${review.certificate.verifier}` : withheldFrom(review)}
          </span>
        </p>

        <div className={styles.tally}>
          {SEVERITY_ORDER.map(level => (
            <div key={level}>
              <b style={{ color: SEVERITY_COLOR[level] }}>{review.certificate.counts[level]}</b>
              <span>{level}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
