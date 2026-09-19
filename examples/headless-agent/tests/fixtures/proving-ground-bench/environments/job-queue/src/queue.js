/** The simulation: one worker and a rate limit on starts. */

import { createClock } from './clock.js'

/**
 * Run every submission to a verdict.
 * @param {Map<string, {id: string, duration: number, outcomes: string[]}>} jobs - the declared jobs.
 * @param {{id: string, at: number}[]} submissions - the submissions, in input order.
 * @param {{limit?: {starts: number, window: number}}} policy - the rate limit in force.
 * @returns {{attempts: {start: number, id: string, attempt: number, outcome: string, finish: number}[], end: number}} the attempts in the order they started and the clock at the end.
 */
export function run(jobs, submissions, policy) {
  const clock = createClock()
  const queued = submissions.map((submission, order) => ({ ...submission, order, readyAt: submission.at, attempt: 0 }))
  const attempts = []
  const starts = []
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
  }
  return { attempts, end: clock.now() }
}
