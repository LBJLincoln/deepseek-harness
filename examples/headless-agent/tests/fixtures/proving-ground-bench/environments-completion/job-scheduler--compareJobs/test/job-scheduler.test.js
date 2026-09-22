import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualClock, Scheduler, SchedulerError } from '../src/index.js';

/** Deterministic 32-bit PRNG so generated schedules replay identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A scheduler on a fresh manual clock. */
function build(workers = 1, startMs = 0) {
  const clock = new ManualClock(startMs);
  return { clock, scheduler: new Scheduler({ clock, workers }) };
}

/** The event log without the submissions, as compact triples. */
function runLog(scheduler) {
  return scheduler.events
    .filter((event) => event.type !== 'submit')
    .map((event) => `${event.at}:${event.type}:${event.id}`);
}

test('the manual clock only moves forward', () => {
  const clock = new ManualClock(5);
  assert.equal(clock.now, 5);
  clock.advanceTo(5);
  clock.advanceTo(9);
  assert.equal(clock.now, 9);
  assert.throws(() => clock.advanceTo(8), {
    name: 'SchedulerError',
    code: 'CLOCK_REGRESSION',
    message: 'cannot move the clock from 9 to 8',
  });
  assert.throws(() => clock.advanceTo(9.5), { code: 'CLOCK_REGRESSION' });
  assert.throws(() => new ManualClock(-1), { code: 'BAD_CLOCK' });
  assert.equal(new SchedulerError('X', 'y') instanceof Error, true);
});

test('one job runs from submission to completion', () => {
  const { clock, scheduler } = build();
  const submitted = scheduler.submit({ id: 'a', durationMs: 5 });
  assert.equal(submitted.status, 'pending');
  assert.equal(submitted.durationMs, 5);
  assert.equal(scheduler.runUntilIdle(), 2);
  assert.equal(clock.now, 5);
  assert.equal(scheduler.status('a'), 'done');
  assert.deepEqual(runLog(scheduler), ['0:start:a', '5:complete:a']);
  assert.deepEqual(scheduler.job('a').startedAt, 0);
  assert.deepEqual(scheduler.job('a').finishedAt, 5);
  assert.deepEqual(scheduler.report(), { pending: 0, running: 0, done: 1, cancelled: 0, missed: 0, blocked: 0 });
  assert.deepEqual(scheduler.events[0], { at: 0, type: 'submit', id: 'a' });
});

test('higher priority runs first, whatever the deadlines say', () => {
  const { scheduler } = build();
  scheduler.submit({ id: 'urgent', priority: 0, deadlineMs: 50, durationMs: 1 });
  scheduler.submit({ id: 'important', priority: 9, deadlineMs: 900, durationMs: 1 });
  scheduler.runUntilIdle();
  assert.deepEqual(runLog(scheduler), ['0:start:important', '1:complete:important', '1:start:urgent', '2:complete:urgent']);
});

test('equal priorities break ties by deadline and then by id', () => {
  const { scheduler } = build();
  scheduler.submit({ id: 'later', deadlineMs: 100, durationMs: 1 });
  scheduler.submit({ id: 'sooner', deadlineMs: 10, durationMs: 1 });
  scheduler.submit({ id: 'never', durationMs: 1 });
  scheduler.runUntilIdle();
  assert.deepEqual(
    scheduler.events.filter((event) => event.type === 'start').map((event) => event.id),
    ['sooner', 'later', 'never'],
  );

  const plain = build();
  plain.scheduler.submit({ id: 'b', durationMs: 1 });
  plain.scheduler.submit({ id: 'a', durationMs: 1 });
  plain.scheduler.submit({ id: 'c', durationMs: 1 });
  plain.scheduler.runUntilIdle();
  assert.deepEqual(
    plain.scheduler.events.filter((event) => event.type === 'start').map((event) => event.id),
    ['a', 'b', 'c'],
  );
});

test('a job may start exactly on its deadline but not after', () => {
  const onTime = build();
  onTime.scheduler.submit({ id: 'hog', priority: 10, durationMs: 5 });
  onTime.scheduler.submit({ id: 'edge', deadlineMs: 5, durationMs: 1 });
  onTime.scheduler.runUntilIdle();
  assert.equal(onTime.scheduler.status('edge'), 'done');
  assert.deepEqual(runLog(onTime.scheduler), ['0:start:hog', '5:complete:hog', '5:start:edge', '6:complete:edge']);

  const late = build();
  late.scheduler.submit({ id: 'hog', priority: 10, durationMs: 5 });
  late.scheduler.submit({ id: 'edge', deadlineMs: 4, durationMs: 1 });
  late.scheduler.runUntilIdle();
  assert.equal(late.scheduler.status('edge'), 'missed');
  assert.deepEqual(runLog(late.scheduler), ['0:start:hog', '5:complete:hog', '5:miss:edge']);
});

test('a dependency must finish before its dependant starts', () => {
  const { scheduler } = build(2);
  scheduler.submit({ id: 'first', durationMs: 3 });
  scheduler.submit({ id: 'second', deps: ['first'], durationMs: 2 });
  scheduler.runUntilIdle();
  assert.deepEqual(runLog(scheduler), ['0:start:first', '3:complete:first', '3:start:second', '5:complete:second']);
  assert.equal(scheduler.job('second').startedAt, 3);
});

test('a job waits for its release time even when a worker is free', () => {
  const { scheduler } = build(2);
  scheduler.submit({ id: 'now', durationMs: 5 });
  scheduler.submit({ id: 'later', runAtMs: 100, durationMs: 1 });
  scheduler.runUntilIdle();
  assert.deepEqual(runLog(scheduler), [
    '0:start:now',
    '5:complete:now',
    '100:start:later',
    '101:complete:later',
  ]);
});

test('two workers run two jobs at once', () => {
  const { clock, scheduler } = build(2);
  scheduler.submit({ id: 'a', durationMs: 3 });
  scheduler.submit({ id: 'b', durationMs: 4 });
  scheduler.submit({ id: 'c', durationMs: 1 });
  scheduler.runUntilIdle();
  assert.deepEqual(runLog(scheduler), [
    '0:start:a',
    '0:start:b',
    '3:complete:a',
    '3:start:c',
    '4:complete:b',
    '4:complete:c',
  ]);
  assert.equal(clock.now, 4);
  assert.deepEqual(scheduler.report().done, 3);
});

test('cancelling a job blocks everything downstream of it', () => {
  const { scheduler } = build();
  scheduler.submit({ id: 'root', durationMs: 1 });
  scheduler.submit({ id: 'child', deps: ['root'], durationMs: 1 });
  scheduler.submit({ id: 'grand', deps: ['child'], durationMs: 1 });
  scheduler.submit({ id: 'cousin', deps: ['grand'], durationMs: 1 });
  assert.equal(scheduler.cancel('root'), true);
  assert.deepEqual(scheduler.report(), {
    pending: 0,
    running: 0,
    done: 0,
    cancelled: 1,
    missed: 0,
    blocked: 3,
  });
  assert.deepEqual(runLog(scheduler), ['0:cancel:root', '0:block:child', '0:block:grand', '0:block:cousin']);
  assert.equal(scheduler.cancel('root'), false, 'cancelling twice changes nothing');
  assert.equal(scheduler.cancel('child'), false, 'a blocked job is not cancellable');
  assert.equal(scheduler.runUntilIdle(), 0, 'nothing is left to run');
});

test('a running job cannot be cancelled', () => {
  const { scheduler } = build();
  scheduler.submit({ id: 'a', durationMs: 4 });
  scheduler.submit({ id: 'b', deps: ['a'], durationMs: 1 });
  assert.equal(scheduler.tick(), true);
  assert.equal(scheduler.status('a'), 'running');
  assert.equal(scheduler.cancel('a'), false);
  assert.equal(scheduler.status('a'), 'running');
  assert.equal(scheduler.status('b'), 'pending');
  scheduler.runUntilIdle();
  assert.equal(scheduler.status('a'), 'done');
  assert.equal(scheduler.status('b'), 'done');
});

test('a missed job blocks everything downstream of it', () => {
  const { scheduler } = build();
  scheduler.submit({ id: 'hog', priority: 10, durationMs: 20 });
  scheduler.submit({ id: 'late', deadlineMs: 5, durationMs: 1 });
  scheduler.submit({ id: 'after', deps: ['late'], durationMs: 1 });
  scheduler.submit({ id: 'far', deps: ['after'], durationMs: 1 });
  scheduler.runUntilIdle();
  assert.deepEqual(scheduler.report(), {
    pending: 0,
    running: 0,
    done: 1,
    cancelled: 0,
    missed: 1,
    blocked: 2,
  });
  assert.deepEqual(runLog(scheduler), [
    '0:start:hog',
    '20:complete:hog',
    '20:miss:late',
    '20:block:after',
    '20:block:far',
  ]);
});

test('a job submitted after its dependency failed is born blocked', () => {
  const { scheduler } = build();
  scheduler.submit({ id: 'gone', durationMs: 1 });
  scheduler.cancel('gone');
  const late = scheduler.submit({ id: 'late', deps: ['gone'], durationMs: 1 });
  assert.equal(late.status, 'blocked');
  assert.equal(scheduler.status('late'), 'blocked');
  assert.deepEqual(runLog(scheduler), ['0:cancel:gone', '0:block:late']);
});

test('submission is validated', () => {
  const { scheduler } = build();
  scheduler.submit({ id: 'ok', durationMs: 1 });
  const cases = [
    [null, 'BAD_JOB'],
    [{ id: '' }, 'BAD_JOB'],
    [{ id: 7 }, 'BAD_JOB'],
    [{ id: 'ok' }, 'DUPLICATE_JOB'],
    [{ id: 'x', priority: 1.5 }, 'BAD_JOB'],
    [{ id: 'x', runAtMs: -1 }, 'BAD_JOB'],
    [{ id: 'x', durationMs: 0 }, 'BAD_JOB'],
    [{ id: 'x', durationMs: 2.5 }, 'BAD_JOB'],
    [{ id: 'x', runAtMs: 10, deadlineMs: 9 }, 'BAD_JOB'],
    [{ id: 'x', deps: 'ok' }, 'BAD_JOB'],
    [{ id: 'x', deps: [7] }, 'BAD_JOB'],
    [{ id: 'x', deps: ['ghost'] }, 'UNKNOWN_DEPENDENCY'],
  ];
  for (const [spec, code] of cases) {
    assert.throws(() => scheduler.submit(spec), { name: 'SchedulerError', code }, `case ${JSON.stringify(spec)}`);
  }
  assert.throws(() => scheduler.status('ghost'), { code: 'UNKNOWN_JOB', message: 'unknown job: ghost' });
  assert.throws(() => scheduler.cancel('ghost'), { code: 'UNKNOWN_JOB' });
  assert.throws(() => new Scheduler({ clock: new ManualClock(), workers: 0 }), { code: 'BAD_OPTIONS' });
  assert.throws(() => new Scheduler({ clock: {} }), { code: 'BAD_CLOCK' });
  assert.throws(() => new Scheduler(null), { code: 'BAD_OPTIONS' });
  assert.equal(scheduler.jobs().length, 1);
});

test('the event log and job views are copies', () => {
  const { scheduler } = build();
  scheduler.submit({ id: 'a', durationMs: 1 });
  const events = scheduler.events;
  events.push({ at: 99, type: 'fake', id: 'a' });
  events[0].id = 'tampered';
  assert.equal(scheduler.events.length, 1);
  assert.equal(scheduler.events[0].id, 'a');
  const view = scheduler.job('a');
  view.status = 'done';
  view.deps.push('nope');
  assert.equal(scheduler.status('a'), 'pending');
  assert.deepEqual(scheduler.job('a').deps, []);
});

test('generated schedules keep every invariant', () => {
  const pick = mulberry32(31415);
  for (let round = 0; round < 60; round += 1) {
    const workers = 1 + Math.floor(pick() * 3);
    const { scheduler } = build(workers);
    const ids = [];
    const count = 3 + Math.floor(pick() * 8);
    for (let index = 0; index < count; index += 1) {
      const id = `j${index}`;
      const deps = ids.filter(() => pick() < 0.25);
      const runAtMs = pick() < 0.3 ? Math.floor(pick() * 20) : 0;
      scheduler.submit({
        id,
        priority: Math.floor(pick() * 4),
        runAtMs,
        deadlineMs: pick() < 0.35 ? runAtMs + Math.floor(pick() * 25) : Infinity,
        durationMs: 1 + Math.floor(pick() * 5),
        deps,
      });
      ids.push(id);
    }

    let ticks = 0;
    while (scheduler.tick()) {
      ticks += 1;
      assert.ok(ticks < 500, 'the run terminates');
      if (pick() < 0.15) {
        const pending = scheduler.jobs().filter((job) => job.status === 'pending');
        if (pending.length > 0) scheduler.cancel(pending[Math.floor(pick() * pending.length)].id);
      }
    }

    const jobs = scheduler.jobs();
    const byId = new Map(jobs.map((job) => [job.id, job]));
    const counts = scheduler.report();
    assert.equal(counts.pending + counts.running, 0, 'nothing is left unfinished');
    assert.equal(Object.values(counts).reduce((sum, value) => sum + value, 0), jobs.length, 'every job is counted');

    for (const job of jobs) {
      if (job.status === 'done') {
        assert.ok(job.startedAt >= job.runAtMs, `${job.id} waited for its release time`);
        assert.ok(job.startedAt <= job.deadlineMs, `${job.id} started by its deadline`);
        assert.equal(job.finishedAt, job.startedAt + job.durationMs, `${job.id} ran for its duration`);
        for (const dep of job.deps) {
          assert.equal(byId.get(dep).status, 'done', `${dep} finished before ${job.id}`);
          assert.ok(byId.get(dep).finishedAt <= job.startedAt, `${dep} finished no later than ${job.id} started`);
        }
      }
      if (job.status === 'blocked') {
        assert.ok(
          job.deps.some((dep) => ['cancelled', 'missed', 'blocked'].includes(byId.get(dep).status)),
          `${job.id} is blocked by a failed dependency`,
        );
      }
    }

    let inFlight = 0;
    let previousAt = -1;
    for (const event of scheduler.events) {
      assert.ok(event.at >= previousAt, 'the log never goes back in time');
      previousAt = event.at;
      if (event.type === 'start') inFlight += 1;
      if (event.type === 'complete') inFlight -= 1;
      assert.ok(inFlight <= workers, `never more than ${workers} jobs at once`);
    }
    assert.equal(inFlight, 0, 'every started job finished');
  }
});
