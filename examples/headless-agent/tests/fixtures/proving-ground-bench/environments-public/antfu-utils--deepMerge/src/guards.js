/**
 * Type guard to filter out null-ish values
 *
 * @category Guards
 * @example array.filter(notNullish)
 */
export function notNullish(v) {
    return v != null;
}
/**
 * Type guard to filter out null values
 *
 * @category Guards
 * @example array.filter(noNull)
 */
export function noNull(v) {
    return v !== null;
}
/**
 * Type guard to filter out null-ish values
 *
 * @category Guards
 * @example array.filter(notUndefined)
 */
export function notUndefined(v) {
    return v !== undefined;
}
/**
 * Type guard to filter out falsy values
 *
 * @category Guards
 * @example array.filter(isTruthy)
 */
export function isTruthy(v) {
    return Boolean(v);
}
