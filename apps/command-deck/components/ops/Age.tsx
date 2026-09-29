'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { formatAge } from '@/deck/ops'
import styles from './ops.module.css'

/**
 * The viewer's clock, ticking once a second, so ages count up between reads.
 * @returns Epoch milliseconds.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

/** What an age is drawn from. */
interface AgeProps {
  /** The ISO time the facts were current; `undefined` when a source they rest on was not read. */
  at: string | undefined
  /** The words the exact time follows in the title. */
  verb?: string
  /** Leave out the word `old`, where a tile's label leaves little room. */
  short?: boolean
}

/**
 * How old the facts behind a tile or a panel are, by the viewer's clock,
 * counting up between reads; the exact UTC time is its title.
 * @param props - The time, the title's verb and whether to leave out `old`.
 * @returns The age.
 */
export function Age({ at, verb = 'as of', short = false }: AgeProps): ReactNode {
  const now = useNow()
  if (at === undefined) return <span className={styles.age}>age unknown</span>
  const ms = Date.parse(at)
  return (
    <time className={styles.age} dateTime={at} title={`${verb} ${at.slice(0, 19).replace('T', ' ')} UTC`}>
      {formatAge(Number.isNaN(ms) ? Number.NaN : Math.max(0, now - ms))}{short ? '' : ' old'}
    </time>
  )
}
