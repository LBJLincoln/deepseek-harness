import test from 'node:test';
import assert from 'node:assert/strict';

import { CronError, matches, next, parse } from '../src/cron.js';

/** Deterministic 32-bit PRNG so the generated cases are identical on every run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (date) => date.toISOString();

test('a bare expression covers every value', () => {
  const schedule = parse('* * * * *');
  assert.equal(schedule.minute.length, 60);
  assert.equal(schedule.hour.length, 24);
  assert.deepStrictEqual(schedule.dayOfMonth, Array.from({ length: 31 }, (_, i) => i + 1));
  assert.deepStrictEqual(schedule.month, Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepStrictEqual(schedule.dayOfWeek, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(schedule.restrictedDayOfMonth, false);
  assert.equal(schedule.restrictedDayOfWeek, false);
});

test('lists, ranges and steps expand to sorted values', () => {
  const cases = [
    ['0 * * * *', 'minute', [0]],
    ['*/15 * * * *', 'minute', [0, 15, 30, 45]],
    ['2-20/5 * * * *', 'minute', [2, 7, 12, 17]],
    ['1-10/3 * * * *', 'minute', [1, 4, 7, 10]],
    ['5,3,1 * * * *', 'minute', [1, 3, 5]],
    ['1,1,2 * * * *', 'minute', [1, 2]],
    ['0,30 * * * *', 'minute', [0, 30]],
    ['55-59 * * * *', 'minute', [55, 56, 57, 58, 59]],
    ['0 9-17 * * *', 'hour', [9, 10, 11, 12, 13, 14, 15, 16, 17]],
    ['0 0/6 * * *', 'hour', [0, 6, 12, 18]],
    ['0 20/6 * * *', 'hour', [20]],
    ['0 0 1,15,31 * *', 'dayOfMonth', [1, 15, 31]],
    ['0 0 * 1,6-8 *', 'month', [1, 6, 7, 8]],
    ['0 0 * */3 *', 'month', [1, 4, 7, 10]],
  ];
  for (const [expression, field, expected] of cases) {
    assert.deepStrictEqual(parse(expression)[field], expected, expression);
  }
});

test('names are case-insensitive and Sunday has two numbers', () => {
  const cases = [
    ['0 0 * JAN,dec *', 'month', [1, 12]],
    ['0 0 * Feb-Apr *', 'month', [2, 3, 4]],
    ['0 0 * * MON-FRI', 'dayOfWeek', [1, 2, 3, 4, 5]],
    ['0 0 * * sun', 'dayOfWeek', [0]],
    ['0 0 * * SAT,SUN', 'dayOfWeek', [0, 6]],
    ['0 0 * * 7', 'dayOfWeek', [0]],
    ['0 0 * * 0,7', 'dayOfWeek', [0]],
    ['0 0 * * 5-7', 'dayOfWeek', [0, 5, 6]],
  ];
  for (const [expression, field, expected] of cases) {
    assert.deepStrictEqual(parse(expression)[field], expected, expression);
  }
});

test('only a bare asterisk leaves a day field unrestricted', () => {
  assert.equal(parse('0 0 13 * 5').restrictedDayOfMonth, true);
  assert.equal(parse('0 0 13 * 5').restrictedDayOfWeek, true);
  assert.equal(parse('0 0 * * 5').restrictedDayOfMonth, false);
  assert.equal(parse('0 0 13 * *').restrictedDayOfWeek, false);
  assert.equal(parse('0 0 */2 * *').restrictedDayOfMonth, true);
});

test('malformed expressions are rejected', () => {
  const cases = [
    ['* * * *', /expected 5 fields, got 4/],
    ['', /expected 5 fields, got 0/],
    ['* * * * * *', /expected 5 fields, got 6/],
    ['60 * * * *', /value 60 is out of range 0-59 in minute/],
    ['* 24 * * *', /value 24 is out of range 0-23 in hour/],
    ['0 0 0 * *', /value 0 is out of range 1-31 in dayOfMonth/],
    ['0 0 * 13 *', /value 13 is out of range 1-12 in month/],
    ['0 0 * * 8', /value 8 is out of range 0-7 in dayOfWeek/],
    ['0 0 * FOO *', /unknown name FOO in month/],
    ['0 0 * * FUN', /unknown name FUN in dayOfWeek/],
    ['*/0 * * * *', /invalid step 0 in minute/],
    ['5-1 * * * *', /range 5-1 is reversed in minute/],
    ['a * * * *', /invalid value a in minute/],
    ['0 0 * * MON-', /empty value in dayOfWeek/],
    ['1-2-3 * * * *', /invalid range 1-2-3 in minute/],
    ['1/2/3 * * * *', /invalid term 1\/2\/3 in minute/],
  ];
  for (const [expression, message] of cases) {
    assert.throws(() => parse(expression), message, expression);
  }
  assert.throws(() => parse(null), /expression must be a string/);
  assert.throws(() => parse(['*']), CronError);
});

test('matches ignores seconds and reads the date in UTC', () => {
  const at = new Date('2024-03-01T12:34:56.789Z');
  assert.equal(matches('* * * * *', at), true);
  assert.equal(matches('34 12 1 3 *', at), true);
  assert.equal(matches('35 12 1 3 *', at), false);
  assert.equal(matches('34 13 1 3 *', at), false);
  assert.equal(matches('34 12 * * FRI', at), true);
  assert.equal(matches('34 12 * * MON', at), false);
  assert.throws(() => matches('* * * * *', 'today'), /date must be a valid Date/);
  assert.throws(() => matches('* * * * *', new Date('nonsense')), /date must be a valid Date/);
});

test('a restricted day of month and day of week are combined with or', () => {
  assert.equal(matches('0 0 13 * 5', new Date('2024-08-13T00:00:00Z')), true);
  assert.equal(matches('0 0 13 * 5', new Date('2024-08-02T00:00:00Z')), true);
  assert.equal(matches('0 0 13 * 5', new Date('2024-08-14T00:00:00Z')), false);
  assert.equal(matches('0 0 13 * *', new Date('2024-08-02T00:00:00Z')), false);
  assert.equal(matches('0 0 * * 5', new Date('2024-08-13T00:00:00Z')), false);
  assert.equal(iso(next('0 0 13 * 5', new Date('2024-08-01T00:00:00Z'))), '2024-08-02T00:00:00.000Z');
});

test('next lands on the following occurrence, never on the start', () => {
  const cases = [
    ['* * * * *', '2024-03-01T00:00:00Z', '2024-03-01T00:01:00.000Z'],
    ['* * * * *', '2024-03-01T00:00:30Z', '2024-03-01T00:01:00.000Z'],
    ['* * * * *', '2024-03-01T23:59:00Z', '2024-03-02T00:00:00.000Z'],
    ['0 12 * * *', '2024-03-01T12:00:00Z', '2024-03-02T12:00:00.000Z'],
    ['0 12 * * *', '2024-03-01T11:59:59Z', '2024-03-01T12:00:00.000Z'],
    ['0 0 * * *', '2024-03-01T00:00:00.001Z', '2024-03-02T00:00:00.000Z'],
    ['*/15 * * * *', '2024-03-01T00:07:00Z', '2024-03-01T00:15:00.000Z'],
    ['*/15 * * * *', '2024-03-01T00:45:00Z', '2024-03-01T01:00:00.000Z'],
    ['30 4 * * 1', '2024-03-01T00:00:00Z', '2024-03-04T04:30:00.000Z'],
    ['0 0 * * 7', '2024-03-01T00:00:00Z', '2024-03-03T00:00:00.000Z'],
    ['0 0 1 * *', '2024-01-31T13:45:00Z', '2024-02-01T00:00:00.000Z'],
    ['0 0 31 * *', '2024-01-31T00:00:00Z', '2024-03-31T00:00:00.000Z'],
    ['0 0 1 1 *', '2024-06-15T00:00:00Z', '2025-01-01T00:00:00.000Z'],
    ['59 23 31 12 *', '2024-12-31T23:58:00Z', '2024-12-31T23:59:00.000Z'],
    ['0 0 29 2 *', '2024-03-01T00:00:00Z', '2028-02-29T00:00:00.000Z'],
    ['0 0 29 2 *', '2099-06-01T00:00:00Z', '2104-02-29T00:00:00.000Z'],
  ];
  for (const [expression, from, expected] of cases) {
    assert.equal(iso(next(expression, new Date(from))), expected, `${expression} from ${from}`);
  }
});

test('a schedule that never fires is reported', () => {
  assert.throws(() => next('0 0 30 2 *', new Date('2024-01-01T00:00:00Z')), /no occurrence within 5 years/);
  assert.throws(() => next('0 0 29 2 *', new Date('2097-01-01T00:00:00Z')), /no occurrence within 5 years/);
  assert.throws(() => next('* * * * *', 'now'), /from must be a valid Date/);
  assert.throws(() => next('* * * * *', new Date('nonsense')), CronError);
});

test('repeated calls walk the schedule in order', () => {
  let at = new Date('2024-02-27T00:00:00Z');
  const seen = [];
  for (let i = 0; i < 40; i += 1) {
    const found = next('0 0 * * *', at);
    assert.ok(found.getTime() > at.getTime(), `${iso(found)} must be after ${iso(at)}`);
    assert.equal(matches('0 0 * * *', found), true, `${iso(found)} must match`);
    seen.push(iso(found));
    at = found;
  }
  assert.equal(seen[0], '2024-02-28T00:00:00.000Z');
  assert.equal(seen[1], '2024-02-29T00:00:00.000Z');
  assert.equal(seen[2], '2024-03-01T00:00:00.000Z');
  assert.equal(seen.length, new Set(seen).size);
});

test('next agrees with a minute-by-minute scan', () => {
  const random = mulberry32(0x0c20f);
  const expressions = ['*/7 * * * *', '0 0 13 * 5', '15 3 * * 2,4', '0 0 1,15 * *', '5 6 29 * *', '30 2 * FEB-MAR *'];
  const horizon = 1500;

  for (const expression of expressions) {
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const from = new Date(Date.UTC(2024, Math.floor(random() * 12), 1 + Math.floor(random() * 28), Math.floor(random() * 24), Math.floor(random() * 60)));
      const found = next(expression, from);
      assert.ok(found.getTime() > from.getTime(), `${expression}: ${iso(found)} must be after ${iso(from)}`);

      const base = Math.floor(from.getTime() / 60000) * 60000;
      let scanned = null;
      for (let step = 1; step <= horizon; step += 1) {
        const candidate = new Date(base + step * 60000);
        if (matches(expression, candidate)) {
          scanned = candidate;
          break;
        }
      }
      if (scanned !== null) assert.equal(iso(found), iso(scanned), `${expression} from ${iso(from)}`);
      else assert.ok(found.getTime() > base + horizon * 60000, `${expression} from ${iso(from)} found too early`);
    }
  }
});
