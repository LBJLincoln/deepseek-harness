/**
 * An in-memory job scheduler: priorities, deadlines, dependencies,
 * cancellation and a deterministic tick loop over an injectable clock.
 */

/** Error raised for invalid scheduler input. */
export class SchedulerError extends Error {
  /**
   * @param {string} code Stable machine-readable reason.
   * @param {string} message Human-readable detail.
   */
  constructor(code, message) {
    super(message);
    this.name = 'SchedulerError';
    this.code = code;
  }
}

/** A clock the caller drives by hand, so runs are reproducible. */
export class ManualClock {
  #now;

  /**
   * @param {number} [startMs] Initial time in milliseconds.
   */
  constructor(startMs = 0) {
    if (!Number.isInteger(startMs) || startMs < 0) {
      throw new SchedulerError('BAD_CLOCK', 'startMs must be a non-negative integer');
    }
    this.#now = startMs;
  }

  /** @returns {number} Current time in milliseconds. */
  get now() {
    return this.#now;
  }

  /**
   * Move the clock forward.
   *
   * @param {number} ms Target time, never earlier than the current time.
   * @returns {void}
   */
  advanceTo(ms) {
    if (!Number.isInteger(ms) || ms < this.#now) {
      throw new SchedulerError('CLOCK_REGRESSION', `cannot move the clock from ${this.#now} to ${ms}`);
    }
    this.#now = ms;
  }
}

const FAILED = new Set(['cancelled', 'missed', 'blocked']);

/**
 * Order the jobs that could start now: priority first, then the tightest
 * deadline, then the identifier.
 *
 * @param {object} left First job.
 * @param {object} right Second job.
 * @returns {number} Comparison result.
 */
function compareJobs(left, right) {
  if (left.priority !== right.priority) return right.priority - left.priority;
  if (left.deadlineMs !== right.deadlineMs) return left.deadlineMs < right.deadlineMs ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** A scheduler that runs jobs on a fixed number of workers. */
export class Scheduler {
  #clock;

  #workers;

  #jobs = new Map();

  #events = [];

  /**
   * @param {{clock: {now: number, advanceTo: (ms: number) => void}, workers?: number}} options Clock and worker count.
   */
  constructor(options) {
    if (typeof options !== 'object' || options === null) {
      throw new SchedulerError('BAD_OPTIONS', 'options must be an object');
    }
    const { clock, workers = 1 } = options;
    if (typeof clock !== 'object' || clock === null || typeof clock.advanceTo !== 'function') {
      throw new SchedulerError('BAD_CLOCK', 'clock must expose now and advanceTo');
    }
    if (!Number.isInteger(workers) || workers < 1) {
      throw new SchedulerError('BAD_OPTIONS', 'workers must be a positive integer');
    }
    this.#clock = clock;
    this.#workers = workers;
  }

  /**
   * Append one entry to the event log.
   *
   * @param {string} type Event type.
   * @param {string} id Job the event concerns.
   * @returns {void}
   */
  #log(type, id) {
    this.#events.push({ at: this.#clock.now, type, id });
  }

  /**
   * Read-only description of a job.
   *
   * @param {object} job Internal job record.
   * @returns {object} Plain copy.
   */
  #view(job) {
    return {
      id: job.id,
      status: job.status,
      priority: job.priority,
      runAtMs: job.runAtMs,
      deadlineMs: job.deadlineMs,
      durationMs: job.durationMs,
      deps: [...job.deps],
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }

  /**
   * Look up a job or fail.
   *
   * @param {string} id Job id.
   * @returns {object} Internal job record.
   */
  #require(id) {
    const job = this.#jobs.get(id);
    if (job === undefined) throw new SchedulerError('UNKNOWN_JOB', `unknown job: ${id}`);
    return job;
  }

  /**
   * Submit a job.
   *
   * @param {{id: string, priority?: number, runAtMs?: number, deadlineMs?: number, durationMs?: number, deps?: string[]}} spec Job description.
   * @returns {object} The submitted job.
   */
  submit(spec) {
    if (typeof spec !== 'object' || spec === null) throw new SchedulerError('BAD_JOB', 'job must be an object');
    const { id, priority = 0, runAtMs = 0, deadlineMs = Infinity, durationMs = 1, deps = [] } = spec;
    if (typeof id !== 'string' || id === '') {
      throw new SchedulerError('BAD_JOB', 'job id must be a non-empty string');
    }
    if (this.#jobs.has(id)) throw new SchedulerError('DUPLICATE_JOB', `job already submitted: ${id}`);
    if (!Number.isInteger(priority)) throw new SchedulerError('BAD_JOB', 'priority must be an integer');
    if (!Number.isInteger(runAtMs) || runAtMs < 0) {
      throw new SchedulerError('BAD_JOB', 'runAtMs must be a non-negative integer');
    }
    if (!Number.isInteger(durationMs) || durationMs < 1) {
      throw new SchedulerError('BAD_JOB', 'durationMs must be a positive integer');
    }
    if (deadlineMs !== Infinity && (!Number.isInteger(deadlineMs) || deadlineMs < runAtMs)) {
      throw new SchedulerError('BAD_JOB', 'deadlineMs must be an integer at or after runAtMs');
    }
    if (!Array.isArray(deps) || deps.some((dep) => typeof dep !== 'string')) {
      throw new SchedulerError('BAD_JOB', 'deps must be an array of job ids');
    }
    for (const dep of deps) {
      if (!this.#jobs.has(dep)) throw new SchedulerError('UNKNOWN_DEPENDENCY', `unknown dependency: ${dep}`);
    }

    const job = {
      id,
      status: 'pending',
      priority,
      runAtMs,
      deadlineMs,
      durationMs,
      deps: [...deps],
      startedAt: null,
      finishedAt: null,
      finishMs: null,
    };
    this.#jobs.set(id, job);
    this.#log('submit', id);
    if (deps.some((dep) => FAILED.has(this.#jobs.get(dep).status))) {
      job.status = 'blocked';
      this.#log('block', id);
    }
    return this.#view(job);
  }

  /**
   * Report whether every dependency of a job has finished.
   *
   * @param {object} job Internal job record.
   * @returns {boolean} True when the job may run.
   */
  #dependenciesSatisfied(job) {
    return job.deps.every((dep) => this.#jobs.get(dep).status === 'done');
  }

  /**
   * Report whether a job could start at a moment.
   *
   * @param {object} job Internal job record.
   * @param {number} now Current time.
   * @returns {boolean} True when the job is startable now.
   */
  #isReady(job, now) {
    return job.status === 'pending' && job.runAtMs <= now && this.#dependenciesSatisfied(job);
  }

  /**
   * Mark everything that waited on a failed job as blocked, transitively.
   *
   * @param {string} failedId Job that will never finish.
   * @returns {void}
   */
  #blockDependents(failedId) {
    const queue = [failedId];
    while (queue.length > 0) {
      const failed = queue.shift();
      for (const job of this.#jobs.values()) {
        if (job.status !== 'pending' || !job.deps.includes(failed)) continue;
        job.status = 'blocked';
        this.#log('block', job.id);
        queue.push(job.id);
      }
    }
  }

  /**
   * Cancel a job that has not started.
   *
   * @param {string} id Job to cancel.
   * @returns {boolean} True when the job was cancelled by this call.
   */
  cancel(id) {
    const job = this.#require(id);
    if (job.status !== 'pending') return false;
    job.status = 'cancelled';
    this.#log('cancel', id);
    this.#blockDependents(id);
    return true;
  }

  /**
   * Finish every running job whose time is up.
   *
   * @returns {boolean} True when anything finished.
   */
  #completeDue() {
    const now = this.#clock.now;
    let changed = false;
    for (const job of this.#jobs.values()) {
      if (job.status !== 'running' || job.finishMs > now) continue;
      job.status = 'done';
      job.finishedAt = now;
      this.#log('complete', job.id);
      changed = true;
    }
    return changed;
  }

  /**
   * Start as many ready jobs as there are free workers, missing any whose
   * deadline has already passed.
   *
   * @returns {boolean} True when anything started or was missed.
   */
  #startEligible() {
    let changed = false;
    for (;;) {
      const now = this.#clock.now;
      const busy = [...this.#jobs.values()].filter((job) => job.status === 'running').length;
      if (busy >= this.#workers) break;
      const ready = [...this.#jobs.values()].filter((job) => this.#isReady(job, now));
      if (ready.length === 0) break;
      ready.sort(compareJobs);
      const job = ready[0];
      if (now > job.deadlineMs) {
        job.status = 'missed';
        this.#log('miss', job.id);
        this.#blockDependents(job.id);
        changed = true;
        continue;
      }
      job.status = 'running';
      job.startedAt = now;
      job.finishMs = now + job.durationMs;
      this.#log('start', job.id);
      changed = true;
    }
    return changed;
  }

  /**
   * The next moment at which anything can happen.
   *
   * @returns {number|null} Time in milliseconds, or null when the run is over.
   */
  #nextEventTime() {
    const now = this.#clock.now;
    let best = null;
    const consider = (time) => {
      best = best === null || time < best ? time : best;
    };
    let busy = 0;
    for (const job of this.#jobs.values()) {
      if (job.status !== 'running') continue;
      busy += 1;
      consider(job.finishMs);
    }
    if (busy < this.#workers) {
      for (const job of this.#jobs.values()) {
        if (job.status !== 'pending' || !this.#dependenciesSatisfied(job)) continue;
        consider(Math.max(job.runAtMs, now));
      }
    }
    return best;
  }

  /**
   * Advance to the next moment and process it.
   *
   * @returns {boolean} True when the run has more to do.
   */
  tick() {
    const next = this.#nextEventTime();
    if (next === null) return false;
    if (next > this.#clock.now) this.#clock.advanceTo(next);
    this.#completeDue();
    this.#startEligible();
    return true;
  }

  /**
   * Tick until nothing is left to do.
   *
   * @param {number} [maxTicks] Safety limit.
   * @returns {number} Number of ticks taken.
   */
  runUntilIdle(maxTicks = 10000) {
    if (!Number.isInteger(maxTicks) || maxTicks < 1) {
      throw new SchedulerError('BAD_OPTIONS', 'maxTicks must be a positive integer');
    }
    let ticks = 0;
    while (this.tick()) {
      ticks += 1;
      if (ticks > maxTicks) throw new SchedulerError('TICK_LIMIT', `the run exceeded ${maxTicks} ticks`);
    }
    return ticks;
  }

  /**
   * Status of one job.
   *
   * @param {string} id Job id.
   * @returns {string} Current status.
   */
  status(id) {
    return this.#require(id).status;
  }

  /**
   * One job's description.
   *
   * @param {string} id Job id.
   * @returns {object} Plain copy of the job.
   */
  job(id) {
    return this.#view(this.#require(id));
  }

  /** @returns {object[]} Every job in submission order. */
  jobs() {
    return [...this.#jobs.values()].map((job) => this.#view(job));
  }

  /** @returns {Array<{at: number, type: string, id: string}>} Copy of the event log. */
  get events() {
    return this.#events.map((event) => ({ ...event }));
  }

  /** @returns {Record<string, number>} Count of jobs by status. */
  report() {
    const counts = { pending: 0, running: 0, done: 0, cancelled: 0, missed: 0, blocked: 0 };
    for (const job of this.#jobs.values()) counts[job.status] += 1;
    return counts;
  }
}
