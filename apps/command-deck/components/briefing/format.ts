/**
 * Formatting for the briefing: every number, time and link the page prints
 * goes through here, so one figure reads the same way in every section and in
 * print. Times are UTC because every record states UTC.
 */

import { REPOSITORY } from '../../deck/repository.ts'
import type { Figure, TierRow } from './types.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * @param value - an integer.
 * @returns it with thousands separators: `1,047,317`.
 */
export function count(value: number): string {
  return value.toLocaleString('en-US')
}

/**
 * @param part - the part.
 * @param whole - the whole.
 * @returns the whole-number percentage, `72%`.
 */
export function percent(part: number, whole: number): string {
  return whole === 0 ? '—' : `${Math.round((part / whole) * 100)}%`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * @param iso - an ISO time.
 * @returns `28 Sep 2026`.
 */
export function day(iso: string): string {
  const date = new Date(iso)
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

/**
 * @param iso - an ISO time.
 * @returns `22:13 UTC`.
 */
export function clock(iso: string): string {
  const date = new Date(iso)
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
}

/**
 * @param iso - an ISO time.
 * @returns `28 Sep 2026, 22:13 UTC`.
 */
export function moment(iso: string): string {
  return `${day(iso)}, ${clock(iso)}`
}

/**
 * @param seconds - a duration.
 * @returns `462 s` below two minutes, else `34 min 36 s`.
 */
export function duration(seconds: number): string {
  if (seconds < 120) return `${Math.round(seconds)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

/**
 * @param seconds - a duration.
 * @returns it in minutes to one decimal, `34.6 min`.
 */
export function minutes(seconds: number): string {
  return `${(seconds / 60).toFixed(1)} min`
}

/**
 * @param value - a share difference.
 * @returns it signed to two decimals, `+0.19`, `−0.38`, `0.00`.
 */
export function signed(value: number): string {
  const text = Math.abs(value).toFixed(2)
  if (text === '0.00') return '0.00'
  return `${value < 0 ? '−' : '+'}${text}`
}

/**
 * @param lower - the interval's lower end.
 * @param upper - the interval's upper end.
 * @returns `[−0.56, −0.19]`.
 */
export function interval(lower: number, upper: number): string {
  const one = (value: number): string => {
    const text = Math.abs(value).toFixed(2)
    return text === '0.00' ? '0.00' : `${value < 0 ? '−' : ''}${text}`
  }
  return `[${one(lower)}, ${one(upper)}]`
}

/**
 * @param sha - a commit.
 * @returns its first nine characters.
 */
export function short(sha: string): string {
  return sha.slice(0, 9)
}

/**
 * @param sha - a commit.
 * @returns its page on GitHub.
 */
export function commitUrl(sha: string): string {
  return `${REPOSITORY}/commit/${sha}`
}

/**
 * The page of a repository path on the development branch: a file's blob, a directory's tree.
 * @param path - repository-relative path.
 * @param branch - the branch.
 * @returns the URL.
 */
export function pathUrl(path: string, branch: string): string {
  const kind = /\.[a-z0-9]+$/i.test(path.split('/').at(-1) ?? '') ? 'blob' : 'tree'
  return `${REPOSITORY}/${kind}/${branch}/${path}`
}

/**
 * A figure's value for display, or `unknown`.
 * @param figure - the figure.
 * @param show - formats a known value.
 * @returns the text.
 */
export function shown<T>(figure: Figure<T> | undefined, show: (value: T) => string): string {
  if (figure === undefined || 'unknown' in figure) return 'unknown'
  return show(figure.value)
}

/**
 * A number figure's value, or `undefined`.
 * @param figure - the figure.
 * @returns the number.
 */
export function numberOf(figure: Figure<number | string> | undefined): number | undefined {
  return figure !== undefined && typeof figure.value === 'number' ? figure.value : undefined
}

/**
 * @param row - a comparison tier.
 * @returns its measured wall time, else the time the comparison states, else `unknown time`.
 */
export function tierTime(row: TierRow | undefined): string {
  if (row?.wallSeconds === null || row?.wallSeconds === undefined) return row?.wall ?? 'unknown time'
  return duration(row.wallSeconds)
}

/**
 * @param row - a comparison tier.
 * @returns its measured cost in US dollars, else the cost the comparison states, else `unknown cost`.
 */
export function tierCost(row: TierRow | undefined): string {
  if (row?.costUsd === null || row?.costUsd === undefined) return row?.cost ?? 'unknown cost'
  return `$${row.costUsd.toFixed(2)}`
}

/**
 * @param items - phrases.
 * @returns them joined as `a, b and c`.
 */
export function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
