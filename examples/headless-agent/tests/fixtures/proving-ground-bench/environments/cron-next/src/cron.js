/**
 * Five-field cron expressions: parsing to explicit value sets, testing one
 * instant, and finding the next occurrence.
 *
 * The fields, in order, and the values each admits:
 *
 * | field        | range | names             |
 * | ------------ | ----- | ----------------- |
 * | minute       | 0-59  |                   |
 * | hour         | 0-23  |                   |
 * | day of month | 1-31  |                   |
 * | month        | 1-12  | `JAN` to `DEC`    |
 * | day of week  | 0-7   | `SUN` to `SAT`    |
 *
 * Day of week accepts both 0 and 7 for Sunday. Every calculation is in UTC, and
 * the calendar arithmetic is done here rather than through local-time
 * conversions, so a schedule never shifts with the host's zone.
 */

/** Failure raised by every entry point in this module. */
export class CronError extends Error {
  /** @param {string} message reason */
  constructor(message) {
    super(message);
    this.name = 'CronError';
  }
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SEARCH_YEARS = 5;

const FIELDS = [
  { key: 'minute', min: 0, max: 59, names: null, offset: 0 },
  { key: 'hour', min: 0, max: 23, names: null, offset: 0 },
  { key: 'dayOfMonth', min: 1, max: 31, names: null, offset: 0 },
  { key: 'month', min: 1, max: 12, names: MONTH_NAMES, offset: 1 },
  { key: 'dayOfWeek', min: 0, max: 7, names: DAY_NAMES, offset: 0 },
];

/**
 * Whether a Gregorian year has a 29th of February.
 *
 * @param {number} year full year
 * @returns {boolean} true for a leap year
 */
function isLeapYear(year) {
  return year % 4 === 0;
}

/**
 * How many days a month has.
 *
 * @param {number} year full year
 * @param {number} month month number, 1 to 12
 * @returns {number} the day count
 */
function daysInMonth(year, month) {
  return month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
}

/**
 * The weekday of a date.
 *
 * @param {number} year full year
 * @param {number} month month number, 1 to 12
 * @param {number} day day of the month
 * @returns {number} 0 for Sunday through 6 for Saturday
 */
function weekday(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Read one value of a field, resolving names.
 *
 * @param {string} token value text
 * @param {object} field field description
 * @returns {number} the numeric value
 */
function value(token, field) {
  const text = token.trim();
  if (text === '') throw new CronError(`empty value in ${field.key}`);
  if (field.names !== null && /^[A-Za-z]+$/.test(text)) {
    const index = field.names.indexOf(text.toLowerCase());
    if (index === -1) throw new CronError(`unknown name ${text} in ${field.key}`);
    return index + field.offset;
  }
  if (!/^\d+$/.test(text)) throw new CronError(`invalid value ${text} in ${field.key}`);
  const number = Number(text);
  if (number < field.min || number > field.max) {
    throw new CronError(`value ${text} is out of range ${field.min}-${field.max} in ${field.key}`);
  }
  return number;
}

/**
 * Read the step of a field term.
 *
 * @param {string} token step text
 * @param {object} field field description
 * @returns {number} the step
 */
function step(token, field) {
  if (!/^\d+$/.test(token) || Number(token) === 0) throw new CronError(`invalid step ${token} in ${field.key}`);
  return Number(token);
}

/**
 * Expand one comma-separated term of a field.
 *
 * @param {string} term term text
 * @param {object} field field description
 * @returns {number[]} the values the term stands for
 */
function expandTerm(term, field) {
  const [range, stepText, ...rest] = term.split('/');
  if (rest.length > 0) throw new CronError(`invalid term ${term} in ${field.key}`);
  const stride = stepText === undefined ? 1 : step(stepText, field);

  let start;
  let end;
  if (range === '*') {
    start = field.min;
    end = field.max;
  } else if (range.includes('-')) {
    const [from, to, ...extra] = range.split('-');
    if (extra.length > 0) throw new CronError(`invalid range ${range} in ${field.key}`);
    start = value(from, field);
    end = value(to, field);
    if (start > end) throw new CronError(`range ${range} is reversed in ${field.key}`);
  } else {
    start = value(range, field);
    end = stepText === undefined ? start : field.max;
  }

  const values = [];
  for (let current = field.min; current <= end; current += stride) {
    if (current >= start) values.push(current);
  }
  return values;
}

/**
 * Expand one whole field.
 *
 * @param {string} text field text
 * @param {object} field field description
 * @returns {{ values: number[], restricted: boolean }} the sorted values and whether the field narrows anything
 */
function expandField(text, field) {
  if (text === '') throw new CronError(`empty ${field.key} field`);
  const values = new Set();
  for (const term of text.split(',')) {
    for (const found of expandTerm(term, field)) {
      values.add(found);
    }
  }
  return { values: [...values].sort((a, b) => a - b), restricted: text !== '*' };
}

/**
 * Parse a cron expression into explicit value sets.
 *
 * @param {string} expression five whitespace-separated fields
 * @returns {{ minute: number[], hour: number[], dayOfMonth: number[], month: number[], dayOfWeek: number[],
 *   restrictedDayOfMonth: boolean, restrictedDayOfWeek: boolean }} the parsed schedule
 */
export function parse(expression) {
  if (typeof expression !== 'string') throw new CronError('expression must be a string');
  const parts = expression.trim().split(/\s+/).filter((part) => part !== '');
  if (parts.length !== 5) throw new CronError(`expected 5 fields, got ${parts.length}`);

  const schedule = {};
  for (let i = 0; i < FIELDS.length; i += 1) {
    const field = FIELDS[i];
    const { values, restricted } = expandField(parts[i], field);
    schedule[field.key] = values;
    if (field.key === 'dayOfMonth') schedule.restrictedDayOfMonth = restricted;
    if (field.key === 'dayOfWeek') schedule.restrictedDayOfWeek = restricted;
  }
  return schedule;
}

/**
 * Whether a calendar day satisfies the two day fields.
 *
 * When both day fields are restricted a day matches if either one accepts it;
 * otherwise both must accept it, which the unrestricted field always does.
 *
 * @param {object} schedule parsed schedule
 * @param {number} year full year
 * @param {number} month month number, 1 to 12
 * @param {number} day day of the month
 * @returns {boolean} whether the day is scheduled
 */
function dayMatches(schedule, year, month, day) {
  const byMonthDay = schedule.dayOfMonth.includes(day);
  const byWeekday = schedule.dayOfWeek.includes(weekday(year, month, day));
  return byMonthDay && byWeekday;
}

/**
 * Check one instant against an expression.
 *
 * @param {string} expression cron expression
 * @param {Date} date instant to test, read in UTC with seconds ignored
 * @returns {boolean} whether the expression fires in that minute
 */
export function matches(expression, date) {
  const schedule = parse(expression);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new CronError('date must be a valid Date');
  return (
    schedule.minute.includes(date.getUTCMinutes()) &&
    schedule.hour.includes(date.getUTCHours()) &&
    schedule.month.includes(date.getUTCMonth() + 1) &&
    dayMatches(schedule, date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  );
}

/**
 * Step to the first minute of the following month.
 *
 * @param {{ year: number, month: number }} at current position
 * @returns {{ year: number, month: number }} the following month
 */
function nextMonth({ year, month }) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * Find the next occurrence at or after a calendar position.
 *
 * @param {object} schedule parsed schedule
 * @param {{ year: number, month: number, day: number, hour: number, minute: number }} at starting position
 * @param {number} limitYear last year the search may enter
 * @returns {object | null} the matching position, or null when the limit is reached
 */
function search(schedule, at, limitYear) {
  let { year, month, day, hour, minute } = at;
  for (;;) {
    if (year > limitYear) return null;

    if (!schedule.month.includes(month) || day > daysInMonth(year, month)) {
      ({ year, month } = nextMonth({ year, month }));
      day = 1;
      hour = 0;
      minute = 0;
      continue;
    }
    if (!dayMatches(schedule, year, month, day)) {
      day += 1;
      hour = 0;
      minute = 0;
      continue;
    }
    if (!schedule.hour.includes(hour)) {
      hour += 1;
      minute = 0;
      if (hour > 23) {
        hour = 0;
        day += 1;
      }
      continue;
    }
    if (!schedule.minute.includes(minute)) {
      minute += 1;
      if (minute > 59) {
        minute = 0;
        hour += 1;
        if (hour > 23) {
          hour = 0;
          day += 1;
        }
      }
      continue;
    }
    return { year, month, day, hour, minute };
  }
}

/**
 * Find the first occurrence strictly after an instant.
 *
 * @param {string} expression cron expression
 * @param {Date} from instant to start from, read in UTC
 * @returns {Date} the next matching minute, with zero seconds
 */
export function next(expression, from) {
  const schedule = parse(expression);
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) throw new CronError('from must be a valid Date');

  const start = new Date(Math.ceil(from.getTime() / 60000) * 60000);
  const found = search(
    schedule,
    {
      year: start.getUTCFullYear(),
      month: start.getUTCMonth() + 1,
      day: start.getUTCDate(),
      hour: start.getUTCHours(),
      minute: start.getUTCMinutes(),
    },
    start.getUTCFullYear() + SEARCH_YEARS,
  );
  if (found === null) throw new CronError(`no occurrence within ${SEARCH_YEARS} years`);
  return new Date(Date.UTC(found.year, found.month - 1, found.day, found.hour, found.minute));
}
