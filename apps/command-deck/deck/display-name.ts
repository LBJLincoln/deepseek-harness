/**
 * The names a person reads for a run.
 *
 * A run's `id` and `name` are machine slugs: `2026-09-19-nodegoat-2` for a
 * recorded review, `NodeGoat-2026-09-19T20-49-35` for one started from the
 * deck, `2026-09-19-bench-h3-baseline-sonnet-t5` for a benchmark fleet. The
 * deck prints the slug only where an id is the fact asked for; a heading, a
 * title card and the run picker print the subject, what the run was, the day
 * and how long it took, as in `OWASP NodeGoat · security review · 19 Sep 2026
 * · 20 min`.
 */

import type { RunKind } from './contract.ts'

/** A run as the display name reads it; every field but the name is optional so a review read without its run still has a title. */
export interface NamedRun {
  name: string
  kind?: RunKind
  startedAt?: string
  endedAt?: string
}

/** The subjects the deck's records review, by the slug their runs are named with. */
const SUBJECTS: Record<string, string> = {
  nodegoat: 'OWASP NodeGoat',
  dvja: 'DVJA, the Damn Vulnerable Java Application',
  'csv-tools': 'CSV tools',
}

/** What each kind of run is, as a heading says it. */
const KIND_NAME: Record<RunKind, string> = {
  'code-safety': 'security review',
  program: 'program run',
  fleet: 'benchmark fleet',
  experiment: 'benchmark experiment',
}

/** Month names, so a date reads the same in every locale. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2026-09-19-<slug>`: a recorded run's id. */
const RECORDED = /^(\d{4}-\d{2}-\d{2})-(.+)$/

/** `<Target>-2026-09-19T20-49-35`: a review started from the deck, named after its target's directory. */
const STARTED = /^(.+)-(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}$/

/**
 * The subject a run slug names: a known target by its proper name, else the
 * slug's words, without the run's ordinal and without the words that only say
 * what kind of run it is.
 * @param slug - The slug after its date, such as `nodegoat-2` or `bench-h3-baseline-sonnet-t5`.
 * @returns The subject, such as `OWASP NodeGoat` or `H3 baseline sonnet t5`.
 */
function subjectOf(slug: string): string {
  const bare = slug.toLowerCase().replace(/-\d+$/, '').replace(/-program$/, '')
  const known = SUBJECTS[bare]
  if (known !== undefined) return known
  const words = bare.replace(/^bench-/, '').split('-').filter(word => word !== '')
  const text = words.join(' ')
  return text === '' ? slug : text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * A day as a heading prints it.
 * @param at - ISO-8601 text.
 * @returns `19 Sep 2026` in UTC, or `undefined` when it does not parse.
 */
function day(at: string): string | undefined {
  const date = new Date(at)
  if (Number.isNaN(date.getTime())) return undefined
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()] ?? ''} ${date.getUTCFullYear()}`
}

/**
 * How long a run took, rounded for a heading.
 * @param from - Its start.
 * @param to - Its end.
 * @returns `20 min`, `1 h 46 min`, `under a minute`, or `undefined` when either end does not parse.
 */
function span(from: string, to: string): string | undefined {
  const ms = new Date(to).getTime() - new Date(from).getTime()
  if (Number.isNaN(ms) || ms < 0) return undefined
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  return minutes % 60 === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/**
 * The subject of a run or of a review: what was reviewed or benchmarked.
 * @param name - The run's name or id, or a review's target name.
 * @returns The subject, such as `OWASP NodeGoat`.
 */
export function subjectName(name: string): string {
  const started = STARTED.exec(name)
  if (started !== null) return subjectOf(started[1] ?? name)
  const recorded = RECORDED.exec(name)
  return subjectOf(recorded?.[2] ?? name)
}

/**
 * The heading a person reads for a run: its subject, what kind of run it
 * was, the day it started and how long it took, each part left out when the
 * run does not record it.
 * @param run - The run, or a review's target name with what is known of its run.
 * @returns For example `OWASP NodeGoat · security review · 19 Sep 2026 · 20 min`.
 */
export function displayName(run: NamedRun): string {
  const started = STARTED.exec(run.name)
  const recorded = RECORDED.exec(run.name)
  const when = run.startedAt ?? started?.[2] ?? recorded?.[1]
  return [
    subjectName(run.name),
    run.kind === undefined ? undefined : KIND_NAME[run.kind],
    when === undefined ? undefined : day(when),
    run.startedAt === undefined || run.endedAt === undefined ? undefined : span(run.startedAt, run.endedAt),
  ].filter((part): part is string => part !== undefined).join(' · ')
}
