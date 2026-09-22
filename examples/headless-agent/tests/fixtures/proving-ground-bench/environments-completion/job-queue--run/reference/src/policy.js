/** The policy file: the `limit` and `retry` lines a run may take from argv instead of the log. */

import { existsSync, readFileSync } from 'node:fs'
import { LogError, policyDirective, splitLines } from './parse.js'

/** One refusal of a policy file, carrying the file and the 1-based line. */
export class PolicyError extends Error {
  /**
   * @param {string} message - the message the specification words, without the `error: ` prefix.
   */
  constructor(message) {
    super(message)
    this.name = 'PolicyError'
  }
}

/**
 * Read one policy file.
 * @param {string} path - the policy file's workspace path, as the argument gave it.
 * @returns {{limit?: {starts: number, window: number}, retry?: {max: number, base: number}}} the policy it sets.
 * @throws {PolicyError} when the file is unreadable or a line is malformed.
 */
export function readPolicy(path) {
  if (!existsSync(path)) throw new PolicyError(`cannot read policy ${path}`)
  const policy = {}
  for (const [index, raw] of splitLines(readFileSync(path, 'utf8')).entries()) {
    const line = index + 1
    const text = raw.trim()
    if (text === '' || text.startsWith('#')) continue
    const words = text.split(/\s+/u)
    try {
      if (!policyDirective(line, words, policy)) throw new LogError(line, `unknown directive ${words[0]}`)
    } catch (error) {
      if (!(error instanceof LogError)) throw error
      throw new PolicyError(`${path}: line ${line}: ${error.message}`)
    }
  }
  return policy
}
