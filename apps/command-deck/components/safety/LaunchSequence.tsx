'use client'

import type { CSSProperties, ReactNode } from 'react'
import { DEPARTMENT_CHARTERS } from './charters.ts'
import styles from './moments.module.css'

/**
 * The opening of a review: the six departments ignite one after another, each
 * in its own colour, naming what it reads the target's code for.
 *
 * It is drawn only while {@link useSafetyMoments} says the review has just
 * started, and it fades itself out inside that time. Under
 * `prefers-reduced-motion` the same six lines are one static card.
 * @param props - The target's name and file count, and the motion preference.
 * @returns The overlay.
 */
export function LaunchSequence({
  name,
  files,
  reduced,
}: {
  name: string
  files: number
  reduced: boolean
}): ReactNode {
  return (
    <div className={`${styles.overlay} ${styles.launch}`} data-reduced={reduced}>
      <div className={styles.launchInner}>
        <div className={styles.launchHead}>
          <div>
            <div className={styles.eyebrow}>Code safety review · opening</div>
            <h2 className={styles.launchTitle}>{name}</h2>
          </div>
          <div className={styles.eyebrow}>{files} files · six departments in parallel</div>
        </div>

        {DEPARTMENT_CHARTERS.map((charter, index) => (
          <div
            key={charter.id}
            className={styles.row}
            style={{ '--i': index, color: charter.color } as CSSProperties}
          >
            <i className={styles.rowMark} />
            <span className={styles.rowName}>{charter.name}</span>
            <span className={styles.rowCharter}>{charter.charter}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
