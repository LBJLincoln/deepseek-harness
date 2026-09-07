/**
 * Retry policy: configuration validation, error classification, backoff schedules
 * with full jitter, and a pure simulation of an attempt sequence.
 */

/** Error raised for invalid policy configuration and invalid simulation input. */
export class PolicyError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
  }
}

/**
 * Validate a policy and fill in defaults.
 *
 * @param {unknown} input Raw policy configuration.
 * @returns {Readonly<{baseMs: number, maxAttempts: number, factor: number, maxDelayMs: number, budgetMs: number, jitter: string}>} Frozen policy.
 */
export function normalizePolicy(input) {
  throw new Error('not implemented');
}

/**
 * Decide whether a failure is worth retrying.
 *
 * @param {unknown} error Failure value produced by an attempt.
 * @returns {'retryable'|'permanent'} Classification.
 */
export function classifyError(error) {
  throw new Error('not implemented');
}

/**
 * Build the full backoff schedule for a policy.
 *
 * @param {unknown} policyInput Raw or normalized policy.
 * @param {() => number} random Source of uniform values in [0, 1).
 * @returns {{delays: number[], totalDelayMs: number, stopReason: 'attempts'|'budget'}} Schedule.
 */
export function computeSchedule(policyInput, random) {
  throw new Error('not implemented');
}

/**
 * Simulate an attempt sequence against a fixed list of outcomes.
 *
 * @param {unknown} policyInput Raw or normalized policy.
 * @param {unknown} outcomes Outcome descriptors, one per attempt.
 * @param {() => number} random Source of uniform values in [0, 1).
 * @returns {object} Terminal result with the waits that were performed.
 */
export function planAttempts(policyInput, outcomes, random) {
  throw new Error('not implemented');
}
