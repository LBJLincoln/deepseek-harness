const s = 1000;
const m = s * 60;
const h = m * 60;
const d = h * 24;
const w = d * 7;
const y = d * 365.25;
const mo = y / 12;
export function ms(value, options) {
    throw new Error('not implemented');
}
/**
 * Parse the given string and return milliseconds.
 *
 * @param str - A string to parse to milliseconds
 * @returns The parsed value in milliseconds, or `NaN` if the string can't be
 * parsed
 */
export function parse(str) {
    if (typeof str !== 'string' || str.length === 0 || str.length > 100) {
        throw new Error(`Value provided to ms.parse() must be a string with length between 1 and 99. value=${JSON.stringify(str)}`);
    }
    const match = /^(?<value>-?\d*\.?\d+) *(?<unit>milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mo|years?|yrs?|y)?$/i.exec(str);
    if (!match?.groups) {
        return NaN;
    }
    // Named capture groups need to be manually typed today.
    // https://github.com/microsoft/TypeScript/issues/32098
    const { value, unit = 'ms' } = match.groups;
    const n = parseFloat(value);
    const matchUnit = unit.toLowerCase();
    /* istanbul ignore next - istanbul doesn't understand, but thankfully the TypeScript the exhaustiveness check in the default case keeps us type safe here */
    switch (matchUnit) {
        case 'years':
        case 'year':
        case 'yrs':
        case 'yr':
        case 'y':
            return n * y;
        case 'months':
        case 'month':
        case 'mo':
            return n * mo;
        case 'weeks':
        case 'week':
        case 'w':
            return n * w;
        case 'days':
        case 'day':
        case 'd':
            return n * d;
        case 'hours':
        case 'hour':
        case 'hrs':
        case 'hr':
        case 'h':
            return n * h;
        case 'minutes':
        case 'minute':
        case 'mins':
        case 'min':
        case 'm':
            return n * m;
        case 'seconds':
        case 'second':
        case 'secs':
        case 'sec':
        case 's':
            return n * s;
        case 'milliseconds':
        case 'millisecond':
        case 'msecs':
        case 'msec':
        case 'ms':
            return n;
        default:
            matchUnit;
            throw new Error(`Unknown unit "${matchUnit}" provided to ms.parse(). value=${JSON.stringify(str)}`);
    }
}
/**
 * Parse the given StringValue and return milliseconds.
 *
 * @param value - A typesafe StringValue to parse to milliseconds
 * @returns The parsed value in milliseconds, or `NaN` if the string can't be
 * parsed
 */
export function parseStrict(value) {
    return parse(value);
}
/**
 * Short format for `ms`.
 */
function fmtShort(ms) {
    const msAbs = Math.abs(ms);
    if (msAbs >= y) {
        return `${Math.round(ms / y)}y`;
    }
    if (msAbs >= mo) {
        return `${Math.round(ms / mo)}mo`;
    }
    if (msAbs >= w) {
        return `${Math.round(ms / w)}w`;
    }
    if (msAbs >= d) {
        return `${Math.round(ms / d)}d`;
    }
    if (msAbs >= h) {
        return `${Math.round(ms / h)}h`;
    }
    if (msAbs >= m) {
        return `${Math.round(ms / m)}m`;
    }
    if (msAbs >= s) {
        return `${Math.round(ms / s)}s`;
    }
    return `${ms}ms`;
}
/**
 * Long format for `ms`.
 */
function fmtLong(ms) {
    const msAbs = Math.abs(ms);
    if (msAbs >= y) {
        return plural(ms, msAbs, y, 'year');
    }
    if (msAbs >= mo) {
        return plural(ms, msAbs, mo, 'month');
    }
    if (msAbs >= w) {
        return plural(ms, msAbs, w, 'week');
    }
    if (msAbs >= d) {
        return plural(ms, msAbs, d, 'day');
    }
    if (msAbs >= h) {
        return plural(ms, msAbs, h, 'hour');
    }
    if (msAbs >= m) {
        return plural(ms, msAbs, m, 'minute');
    }
    if (msAbs >= s) {
        return plural(ms, msAbs, s, 'second');
    }
    return `${ms} ms`;
}
/**
 * Format the given integer as a string.
 *
 * @param ms - milliseconds
 * @param options - Options for the conversion
 * @returns The formatted string
 */
export function format(ms, options) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) {
        throw new Error('Value provided to ms.format() must be of type number.');
    }
    return options?.long ? fmtLong(ms) : fmtShort(ms);
}
/**
 * Pluralization helper.
 */
function plural(ms, msAbs, n, name) {
    const isPlural = msAbs >= n * 1.5;
    return `${Math.round(ms / n)} ${name}${isPlural ? 's' : ''}`;
}
