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
  throw new Error('not implemented')
}
