/**
 * Call every function in an array
 */
export function batchInvoke(functions) {
    functions.forEach(fn => fn && fn());
}
/**
 * Call the function, returning the result
 */
export function invoke(fn) {
    return fn();
}
/**
 * Pass the value through the callback, and return the value
 *
 * @example
 * ```
 * function createUser(name: string): User {
 *   return tap(new User, user => {
 *     user.name = name
 *   })
 * }
 * ```
 */
export function tap(value, callback) {
    callback(value);
    return value;
}
