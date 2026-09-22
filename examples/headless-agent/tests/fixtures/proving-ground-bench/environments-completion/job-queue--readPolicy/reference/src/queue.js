/** The simulation: one worker, a rate limit on starts, and a retry policy with backoff. */

import { createClock } from './clock.js'

/**
 * Run every submission to a verdict.
 * @param {Map<string, {id: string, duration: number, outcomes: string[]}>} jobs - the declared jobs.
 * @param {{id: string, at: number}[]} submissions - the submissions, in input order.
 * @param {{limit?: {starts: number, window: number}, retry?: {max: number, base: number}}} policy - the rate limit and retry policy in force.
 * @returns {{attempts: {start: number, id: string, attempt: number, outcome: string, finish: number}[], dead: {id: string, attempts: number, at: number}[], end: number}} the attempts in the order they started, the dead letters in the order they were written off, and the clock at the end.
 */
export function run(jobs, submissions, policy) {
  const clock = createClock()
  const queued = submissions.map((submission, order) => ({ ...submission, order, readyAt: submission.at, attempt: 0 }))
  const attempts = []
  const dead = []
  const starts = []
  const maxAttempts = policy.retry === undefined ? 1 : policy.retry.max
  while (queued.length > 0) {
    let pick = 0
    for (const [index, entry] of queued.entries()) {
      const best = queued[pick]
      if (entry.readyAt < best.readyAt || (entry.readyAt === best.readyAt && entry.order < best.order)) pick = index
    }
    const entry = queued.splice(pick, 1)[0]
    clock.advanceTo(entry.readyAt)
    if (policy.limit !== undefined && starts.length >= policy.limit.starts) {
      const oldest = starts[starts.length - policy.limit.starts]
      if (clock.now() - oldest < policy.limit.window) clock.advanceTo(oldest + policy.limit.window)
    }
    const job = jobs.get(entry.id)
    const start = clock.now()
    starts.push(start)
    const attempt = entry.attempt + 1
    const outcome = job.outcomes[Math.min(attempt, job.outcomes.length) - 1]
    const finish = start + job.duration
    clock.advanceTo(finish)
    attempts.push({ start, id: entry.id, attempt, outcome, finish })
    if (outcome === 'fail' && policy.retry !== undefined) {
      if (attempt < maxAttempts) {
        queued.push({ ...entry, attempt, readyAt: finish + policy.retry.base * 2 ** (attempt - 1) })
      } else {
        dead.push({ id: entry.id, attempts: attempt, at: finish })
      }
    }
  }
  return { attempts, dead, end: clock.now() }
}
