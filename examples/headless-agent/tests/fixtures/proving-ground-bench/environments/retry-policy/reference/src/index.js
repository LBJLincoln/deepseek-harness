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

const KNOWN_FIELDS = ['baseMs', 'maxAttempts', 'factor', 'maxDelayMs', 'budgetMs', 'jitter'];
const DEFAULTS = { factor: 2, maxDelayMs: 30000, budgetMs: Infinity, jitter: 'full' };

const RETRYABLE_CODES = new Set(['etimedout', 'econnreset', 'econnrefused', 'eai_again', 'epipe', 'enetunreach']);

/**
 * Validate a policy and fill in defaults.
 *
 * @param {unknown} input Raw policy configuration.
 * @returns {Readonly<{baseMs: number, maxAttempts: number, factor: number, maxDelayMs: number, budgetMs: number, jitter: string}>} Frozen policy.
 */
export function normalizePolicy(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new PolicyError('INVALID_POLICY', 'policy must be an object');
  }
  for (const key of Object.keys(input)) {
    if (!KNOWN_FIELDS.includes(key)) {
      throw new PolicyError('UNKNOWN_FIELD', `unknown policy field: ${key}`);
    }
  }
  const policy = {};
  for (const name of ['baseMs', 'maxAttempts']) {
    const value = input[name];
    if (value === undefined) {
      throw new PolicyError('MISSING_FIELD', `missing required policy field: ${name}`);
    }
    if (!Number.isInteger(value) || value < 1) {
      throw new PolicyError('INVALID_FIELD', `invalid policy field: ${name}`);
    }
    policy[name] = value;
  }
  const factor = input.factor === undefined ? DEFAULTS.factor : input.factor;
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 1) {
    throw new PolicyError('INVALID_FIELD', 'invalid policy field: factor');
  }
  policy.factor = factor;

  const maxDelayMs = input.maxDelayMs === undefined ? DEFAULTS.maxDelayMs : input.maxDelayMs;
  if (!Number.isInteger(maxDelayMs) || maxDelayMs < 1) {
    throw new PolicyError('INVALID_FIELD', 'invalid policy field: maxDelayMs');
  }
  policy.maxDelayMs = maxDelayMs;

  const budgetMs = input.budgetMs === undefined ? DEFAULTS.budgetMs : input.budgetMs;
  if (budgetMs !== Infinity && (!Number.isInteger(budgetMs) || budgetMs < 0)) {
    throw new PolicyError('INVALID_FIELD', 'invalid policy field: budgetMs');
  }
  policy.budgetMs = budgetMs;

  const jitter = input.jitter === undefined ? DEFAULTS.jitter : input.jitter;
  if (jitter !== 'full' && jitter !== 'none') {
    throw new PolicyError('INVALID_FIELD', 'invalid policy field: jitter');
  }
  policy.jitter = jitter;

  return Object.freeze(policy);
}

/**
 * Decide whether a failure is worth retrying.
 *
 * @param {unknown} error Failure value produced by an attempt.
 * @returns {'retryable'|'permanent'} Classification.
 */
export function classifyError(error) {
  if (typeof error !== 'object' || error === null) return 'permanent';
  if (error.retryable === true) return 'retryable';
  if (error.retryable === false) return 'permanent';
  const status = error.status;
  if (typeof status === 'number' && Number.isInteger(status)) {
    if (status === 501) return 'permanent';
    if (status === 408 || status === 429) return 'retryable';
    if (status >= 500 && status <= 599) return 'retryable';
    return 'permanent';
  }
  const code = error.code;
  if (typeof code === 'string' && RETRYABLE_CODES.has(code.toLowerCase())) return 'retryable';
  return 'permanent';
}

/**
 * Uncapped-then-capped integer delay for a retry slot, before jitter.
 *
 * @param {{baseMs: number, factor: number, maxDelayMs: number}} policy Normalized policy.
 * @param {number} slot One-based retry slot.
 * @returns {number} Capped integer delay.
 */
function cappedDelay(policy, slot) {
  const raw = policy.baseMs * policy.factor ** (slot - 1);
  return Math.floor(Math.min(raw, policy.maxDelayMs));
}

/**
 * Draw the delay for one retry slot, consuming one value from `random` under full jitter.
 *
 * @param {object} policy Normalized policy.
 * @param {number} slot One-based retry slot.
 * @param {() => number} random Source of uniform values in [0, 1).
 * @returns {number} Delay in milliseconds.
 */
function drawDelay(policy, slot, random) {
  const capped = cappedDelay(policy, slot);
  if (policy.jitter === 'none') return capped;
  return Math.floor(random() * (capped + 1));
}

/**
 * Build the full backoff schedule for a policy.
 *
 * @param {unknown} policyInput Raw or normalized policy.
 * @param {() => number} random Source of uniform values in [0, 1).
 * @returns {{delays: number[], totalDelayMs: number, stopReason: 'attempts'|'budget'}} Schedule.
 */
export function computeSchedule(policyInput, random) {
  const policy = normalizePolicy(policyInput);
  if (typeof random !== 'function') {
    throw new PolicyError('INVALID_RANDOM', 'random must be a function');
  }
  const delays = [];
  let totalDelayMs = 0;
  let stopReason = 'attempts';
  for (let slot = 1; slot <= policy.maxAttempts - 1; slot += 1) {
    const delay = drawDelay(policy, slot, random);
    if (totalDelayMs + delay > policy.budgetMs) {
      stopReason = 'budget';
      break;
    }
    delays.push(delay);
    totalDelayMs += delay;
  }
  return { delays, totalDelayMs, stopReason };
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
  const policy = normalizePolicy(policyInput);
  if (typeof random !== 'function') {
    throw new PolicyError('INVALID_RANDOM', 'random must be a function');
  }
  if (!Array.isArray(outcomes) || outcomes.length === 0) {
    throw new PolicyError('INVALID_OUTCOMES', 'outcomes must be a non-empty array');
  }
  outcomes.forEach((outcome, index) => {
    if (typeof outcome !== 'object' || outcome === null || typeof outcome.ok !== 'boolean') {
      throw new PolicyError('INVALID_OUTCOMES', `outcome ${index} must have a boolean ok field`);
    }
  });

  const waits = [];
  let totalDelayMs = 0;
  for (let attempts = 1; ; attempts += 1) {
    const outcome = outcomes[attempts - 1];
    if (outcome === undefined) {
      throw new PolicyError('OUTCOMES_EXHAUSTED', 'outcome sequence exhausted');
    }
    if (outcome.ok) {
      return { status: 'succeeded', attempts, value: outcome.value, waits, totalDelayMs };
    }
    const fail = (reason) => ({ status: 'failed', reason, error: outcome.error, attempts, waits, totalDelayMs });
    if (classifyError(outcome.error) === 'permanent') return fail('permanent');
    if (attempts >= policy.maxAttempts) return fail('attempts');
    const delay = drawDelay(policy, attempts, random);
    if (totalDelayMs + delay > policy.budgetMs) return fail('budget');
    waits.push(delay);
    totalDelayMs += delay;
  }
}
