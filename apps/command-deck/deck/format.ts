/** Display formatting shared by every panel. */

/**
 * Clock time of one timestamp, in the viewer's locale.
 * @param at - ISO-8601 text (a run's `startedAt`) or epoch milliseconds (an event's `ts`).
 * @returns `HH:MM:SS`, or `--:--:--` when the timestamp does not parse.
 */
export function clock(at: string | number): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return date.toLocaleTimeString('en-GB', { hour12: false })
}

/**
 * Date and clock time of one timestamp.
 * @param at - ISO-8601 text or epoch milliseconds.
 * @returns `YYYY-MM-DD HH:MM`, or `—` when the timestamp does not parse.
 */
export function stamp(at: string | number): string {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`
}

/**
 * Human-readable byte count.
 * @param bytes - Size in bytes.
 * @returns A short size such as `6.1 kB`.
 */
export function bytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Duration between two ISO timestamps.
 * @param from - Start timestamp.
 * @param to - End timestamp; the current time when omitted.
 * @returns A compact duration such as `34m 12s`.
 */
export function duration(from: string, to?: string): string {
  const start = new Date(from).getTime()
  const end = to === undefined ? Date.now() : new Date(to).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return '—'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}
