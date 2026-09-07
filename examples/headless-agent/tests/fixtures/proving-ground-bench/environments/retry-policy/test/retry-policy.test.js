import test from 'node:test';
import assert from 'node:assert/strict';
import { PolicyError, classifyError, computeSchedule, normalizePolicy, planAttempts } from '../src/index.js';

/** Deterministic 32-bit PRNG so property loops replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random source that replays a fixed list and counts its own calls. */
function scripted(values) {
  const fn = () => {
    if (fn.calls >= values.length) throw new Error('scripted random exhausted');
    const value = values[fn.calls];
    fn.calls += 1;
    return value;
  };
  fn.calls = 0;
  return fn;
}

/** A random source returning a constant, counting its own calls. */
function constant(value) {
  const fn = () => {
    fn.calls += 1;
    return value;
  };
  fn.calls = 0;
  return fn;
}

test('normalizePolicy fills documented defaults and freezes the result', () => {
  const policy = normalizePolicy({ baseMs: 50, maxAttempts: 4 });
  assert.deepEqual(policy, { baseMs: 50, maxAttempts: 4, factor: 2, maxDelayMs: 30000, budgetMs: Infinity, jitter: 'full' });
  assert.equal(Object.isFrozen(policy), true);
  assert.deepEqual(Object.keys(policy).sort(), ['baseMs', 'budgetMs', 'factor', 'jitter', 'maxAttempts', 'maxDelayMs']);
});

test('normalizePolicy keeps explicit values including edge-legal ones', () => {
  const policy = normalizePolicy({ baseMs: 1, maxAttempts: 1, factor: 1, maxDelayMs: 1, budgetMs: 0, jitter: 'none' });
  assert.deepEqual(policy, { baseMs: 1, maxAttempts: 1, factor: 1, maxDelayMs: 1, budgetMs: 0, jitter: 'none' });
  assert.equal(normalizePolicy({ baseMs: 5, maxAttempts: 2, factor: 1.5 }).factor, 1.5);
  assert.equal(normalizePolicy({ baseMs: 5, maxAttempts: 2, budgetMs: Infinity }).budgetMs, Infinity);
});

test('normalizePolicy treats an explicit undefined as absent', () => {
  const policy = normalizePolicy({ baseMs: 5, maxAttempts: 2, factor: undefined, jitter: undefined });
  assert.equal(policy.factor, 2);
  assert.equal(policy.jitter, 'full');
  assert.throws(() => normalizePolicy({ baseMs: undefined, maxAttempts: 2 }), {
    name: 'PolicyError',
    code: 'MISSING_FIELD',
    message: 'missing required policy field: baseMs',
  });
});

test('normalizePolicy rejects malformed configuration with exact codes', () => {
  const cases = [
    [null, 'INVALID_POLICY', 'policy must be an object'],
    ['nope', 'INVALID_POLICY', 'policy must be an object'],
    [[], 'INVALID_POLICY', 'policy must be an object'],
    [{ baseMs: 1, maxAttempts: 1, retries: 3 }, 'UNKNOWN_FIELD', 'unknown policy field: retries'],
    [{ maxAttempts: 3 }, 'MISSING_FIELD', 'missing required policy field: baseMs'],
    [{ baseMs: 10 }, 'MISSING_FIELD', 'missing required policy field: maxAttempts'],
    [{ baseMs: 0, maxAttempts: 3 }, 'INVALID_FIELD', 'invalid policy field: baseMs'],
    [{ baseMs: 1.5, maxAttempts: 3 }, 'INVALID_FIELD', 'invalid policy field: baseMs'],
    [{ baseMs: '10', maxAttempts: 3 }, 'INVALID_FIELD', 'invalid policy field: baseMs'],
    [{ baseMs: 10, maxAttempts: 0 }, 'INVALID_FIELD', 'invalid policy field: maxAttempts'],
    [{ baseMs: 10, maxAttempts: 3, factor: 0.5 }, 'INVALID_FIELD', 'invalid policy field: factor'],
    [{ baseMs: 10, maxAttempts: 3, factor: Infinity }, 'INVALID_FIELD', 'invalid policy field: factor'],
    [{ baseMs: 10, maxAttempts: 3, maxDelayMs: 0 }, 'INVALID_FIELD', 'invalid policy field: maxDelayMs'],
    [{ baseMs: 10, maxAttempts: 3, budgetMs: -1 }, 'INVALID_FIELD', 'invalid policy field: budgetMs'],
    [{ baseMs: 10, maxAttempts: 3, budgetMs: 1.5 }, 'INVALID_FIELD', 'invalid policy field: budgetMs'],
    [{ baseMs: 10, maxAttempts: 3, jitter: 'half' }, 'INVALID_FIELD', 'invalid policy field: jitter'],
  ];
  for (const [input, code, message] of cases) {
    assert.throws(() => normalizePolicy(input), { name: 'PolicyError', code, message }, `case ${JSON.stringify(input)}`);
  }
  assert.equal(new PolicyError('X', 'y') instanceof Error, true);
});

test('normalizePolicy reports an unknown field before a missing one', () => {
  assert.throws(() => normalizePolicy({ tries: 4 }), { code: 'UNKNOWN_FIELD', message: 'unknown policy field: tries' });
});

test('classifyError applies the documented precedence', () => {
  const cases = [
    [{ retryable: true, status: 404 }, 'retryable'],
    [{ retryable: false, status: 503 }, 'permanent'],
    [{ retryable: 'yes' }, 'permanent'],
    [{ status: 500 }, 'retryable'],
    [{ status: 502 }, 'retryable'],
    [{ status: 599 }, 'retryable'],
    [{ status: 501 }, 'permanent'],
    [{ status: 408 }, 'retryable'],
    [{ status: 429 }, 'retryable'],
    [{ status: 400 }, 'permanent'],
    [{ status: 499 }, 'permanent'],
    [{ status: 600 }, 'permanent'],
    [{ status: 503.5, code: 'ETIMEDOUT' }, 'retryable'],
    [{ status: Number.NaN, code: 'ENOENT' }, 'permanent'],
    [{ status: 404, code: 'ECONNRESET' }, 'permanent'],
    [{ code: 'ETIMEDOUT' }, 'retryable'],
    [{ code: 'econnreset' }, 'retryable'],
    [{ code: 'EAI_AGAIN' }, 'retryable'],
    [{ code: 'EPIPE' }, 'retryable'],
    [{ code: 'ENETUNREACH' }, 'retryable'],
    [{ code: 'ECONNREFUSED' }, 'retryable'],
    [{ code: 'ENOENT' }, 'permanent'],
    [{ code: 'ETIMEDOUT_EXTRA' }, 'permanent'],
    [{}, 'permanent'],
    [null, 'permanent'],
    [undefined, 'permanent'],
    ['ETIMEDOUT', 'permanent'],
    [42, 'permanent'],
  ];
  for (const [error, expected] of cases) {
    assert.equal(classifyError(error), expected, `case ${JSON.stringify(error)}`);
  }
  const wrapped = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  assert.equal(classifyError(wrapped), 'retryable');
});

test('computeSchedule grows geometrically and never calls random without jitter', () => {
  const random = constant(0.5);
  const schedule = computeSchedule({ baseMs: 100, maxAttempts: 5, jitter: 'none' }, random);
  assert.deepEqual(schedule.delays, [100, 200, 400, 800]);
  assert.equal(schedule.totalDelayMs, 1500);
  assert.equal(schedule.stopReason, 'attempts');
  assert.equal(random.calls, 0);
  assert.deepEqual(computeSchedule({ baseMs: 100, maxAttempts: 1, jitter: 'none' }, random).delays, []);
});

test('computeSchedule caps and floors each delay', () => {
  const random = constant(0);
  assert.deepEqual(
    computeSchedule({ baseMs: 100, maxAttempts: 5, maxDelayMs: 300, jitter: 'none' }, random).delays,
    [100, 200, 300, 300],
  );
  assert.deepEqual(
    computeSchedule({ baseMs: 100, maxAttempts: 5, factor: 1.5, jitter: 'none' }, random).delays,
    [100, 150, 225, 337],
  );
  assert.deepEqual(
    computeSchedule({ baseMs: 7, maxAttempts: 4, factor: 1, jitter: 'none' }, random).delays,
    [7, 7, 7],
  );
});

test('computeSchedule stops on the first delay that would overrun the budget', () => {
  const base = { baseMs: 100, maxAttempts: 5, jitter: 'none' };
  const exact = computeSchedule({ ...base, budgetMs: 300 }, constant(0));
  assert.deepEqual(exact.delays, [100, 200]);
  assert.equal(exact.totalDelayMs, 300);
  assert.equal(exact.stopReason, 'budget');

  const short = computeSchedule({ ...base, budgetMs: 299 }, constant(0));
  assert.deepEqual(short.delays, [100]);
  assert.equal(short.stopReason, 'budget');

  const roomy = computeSchedule({ ...base, budgetMs: 1500 }, constant(0));
  assert.deepEqual(roomy.delays, [100, 200, 400, 800]);
  assert.equal(roomy.stopReason, 'attempts');
});

test('full jitter draws exactly one value per slot from the given source', () => {
  const random = scripted([0, 0.5, 0.25, 0.999]);
  const schedule = computeSchedule({ baseMs: 100, maxAttempts: 5 }, random);
  assert.deepEqual(schedule.delays, [0, 100, 100, 800]);
  assert.equal(random.calls, 4);
  assert.equal(schedule.totalDelayMs, 1000);
});

test('a slot rejected by the budget still consumes its draw', () => {
  const random = constant(0.9);
  const schedule = computeSchedule({ baseMs: 1000, maxAttempts: 5, budgetMs: 0 }, random);
  assert.deepEqual(schedule.delays, []);
  assert.equal(schedule.stopReason, 'budget');
  assert.equal(random.calls, 1);
});

test('computeSchedule rejects a missing random source and invalid policies', () => {
  assert.throws(() => computeSchedule({ baseMs: 1, maxAttempts: 2 }, null), {
    name: 'PolicyError',
    code: 'INVALID_RANDOM',
    message: 'random must be a function',
  });
  assert.throws(() => computeSchedule({ baseMs: -1, maxAttempts: 2 }, constant(0)), { code: 'INVALID_FIELD' });
});

test('planAttempts stops at the first success', () => {
  const random = constant(0);
  const result = planAttempts(
    { baseMs: 10, maxAttempts: 4, jitter: 'none' },
    [{ ok: false, error: { status: 503 } }, { ok: true, value: 'body' }],
    random,
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(result.attempts, 2);
  assert.equal(result.value, 'body');
  assert.deepEqual(result.waits, [10]);
  assert.equal(result.totalDelayMs, 10);
});

test('planAttempts gives up immediately on a permanent failure', () => {
  const random = constant(0);
  const result = planAttempts(
    { baseMs: 10, maxAttempts: 5, jitter: 'none' },
    [{ ok: false, error: { status: 400 } }, { ok: true, value: 'unused' }],
    random,
  );
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'permanent');
  assert.equal(result.attempts, 1);
  assert.deepEqual(result.waits, []);
  assert.deepEqual(result.error, { status: 400 });
  assert.equal(random.calls, 0);
});

test('planAttempts exhausts the attempt count and then the budget', () => {
  const retryable = { ok: false, error: { code: 'ETIMEDOUT' } };
  const byAttempts = planAttempts({ baseMs: 10, maxAttempts: 3, jitter: 'none' }, [retryable, retryable, retryable], constant(0));
  assert.equal(byAttempts.reason, 'attempts');
  assert.equal(byAttempts.attempts, 3);
  assert.deepEqual(byAttempts.waits, [10, 20]);

  const byBudget = planAttempts(
    { baseMs: 100, maxAttempts: 6, budgetMs: 250, jitter: 'none' },
    Array.from({ length: 6 }, () => retryable),
    constant(0),
  );
  assert.equal(byBudget.reason, 'budget');
  assert.deepEqual(byBudget.waits, [100]);
  assert.equal(byBudget.attempts, 2);
});

test('planAttempts validates its outcome list', () => {
  const policy = { baseMs: 1, maxAttempts: 9 };
  assert.throws(() => planAttempts(policy, [], constant(0)), {
    code: 'INVALID_OUTCOMES',
    message: 'outcomes must be a non-empty array',
  });
  assert.throws(() => planAttempts(policy, 'nope', constant(0)), { code: 'INVALID_OUTCOMES' });
  assert.throws(() => planAttempts(policy, [{ ok: true }, { value: 1 }], constant(0)), {
    code: 'INVALID_OUTCOMES',
    message: 'outcome 1 must have a boolean ok field',
  });
  assert.throws(() => planAttempts(policy, [{ ok: false, error: { status: 500 } }], constant(0)), {
    code: 'OUTCOMES_EXHAUSTED',
    message: 'outcome sequence exhausted',
  });
});

test('an all-retryable run reproduces the schedule exactly', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = mulberry32(seed);
    const policy = {
      baseMs: 1 + (seed % 7) * 25,
      maxAttempts: 1 + (seed % 6),
      factor: 1 + (seed % 4) / 2,
      maxDelayMs: 50 + (seed % 5) * 120,
      budgetMs: seed % 3 === 0 ? 400 : Infinity,
    };
    const outcomes = Array.from({ length: policy.maxAttempts }, () => ({ ok: false, error: { code: 'EPIPE' } }));
    const plan = planAttempts(policy, outcomes, mulberry32(seed));
    const schedule = computeSchedule(policy, random);
    assert.deepEqual(plan.waits, schedule.delays, `seed ${seed}`);
    assert.equal(plan.totalDelayMs, schedule.totalDelayMs, `seed ${seed}`);
    assert.equal(plan.reason, schedule.stopReason, `seed ${seed}`);
  }
});

test('schedules respect their caps and budget for many seeded policies', () => {
  const pick = mulberry32(20260907);
  for (let round = 0; round < 200; round += 1) {
    const policy = {
      baseMs: 1 + Math.floor(pick() * 500),
      maxAttempts: 1 + Math.floor(pick() * 8),
      factor: 1 + pick() * 3,
      maxDelayMs: 1 + Math.floor(pick() * 4000),
      budgetMs: pick() < 0.5 ? Math.floor(pick() * 5000) : Infinity,
      jitter: pick() < 0.5 ? 'full' : 'none',
    };
    const schedule = computeSchedule(policy, mulberry32(round + 1));
    assert.ok(schedule.delays.length <= policy.maxAttempts - 1, 'never more waits than retries');
    assert.equal(
      schedule.totalDelayMs,
      schedule.delays.reduce((sum, delay) => sum + delay, 0),
      'total equals the sum of the waits',
    );
    assert.ok(schedule.totalDelayMs <= policy.budgetMs, 'total stays inside the budget');
    schedule.delays.forEach((delay, index) => {
      const ceiling = Math.floor(Math.min(policy.baseMs * policy.factor ** index, policy.maxDelayMs));
      assert.ok(Number.isInteger(delay) && delay >= 0 && delay <= ceiling, `slot ${index} within [0, ${ceiling}]`);
    });
    assert.ok(['attempts', 'budget'].includes(schedule.stopReason));
  }
});

test('mixed outcome sequences keep the result invariants', () => {
  const pick = mulberry32(4242);
  const errors = [{ status: 503 }, { status: 400 }, { code: 'ETIMEDOUT' }, { code: 'ENOENT' }, { retryable: true }];
  for (let round = 0; round < 150; round += 1) {
    const policy = {
      baseMs: 1 + Math.floor(pick() * 100),
      maxAttempts: 1 + Math.floor(pick() * 5),
      budgetMs: pick() < 0.4 ? Math.floor(pick() * 400) : Infinity,
    };
    const outcomes = Array.from({ length: 12 }, () =>
      pick() < 0.25 ? { ok: true, value: round } : { ok: false, error: errors[Math.floor(pick() * errors.length)] },
    );
    const result = planAttempts(policy, outcomes, mulberry32(round + 7));
    assert.ok(result.attempts >= 1 && result.attempts <= policy.maxAttempts, 'attempt count stays in range');
    assert.equal(result.waits.length, result.attempts - 1, 'one recorded wait per retry that was taken');
    assert.equal(result.totalDelayMs, result.waits.reduce((sum, wait) => sum + wait, 0), 'total equals the sum of waits');
    assert.ok(result.totalDelayMs <= policy.budgetMs, 'never over budget');
    if (result.status === 'succeeded') assert.equal(outcomes[result.attempts - 1].ok, true);
    else assert.ok(['permanent', 'attempts', 'budget'].includes(result.reason));
  }
});
