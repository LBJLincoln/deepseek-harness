import { remove } from "./array.js";
/**
 * Create singleton promise function
 *
 * @category Promise
 */
export function createSingletonPromise(fn) {
    let _promise;
    function wrapper() {
        if (!_promise)
            _promise = fn();
        return _promise;
    }
    wrapper.reset = async () => {
        const _prev = _promise;
        _promise = undefined;
        if (_prev)
            await _prev;
    };
    return wrapper;
}
/**
 * Promised `setTimeout`
 *
 * @category Promise
 */
export function sleep(ms, callback) {
    return new Promise(resolve => setTimeout(async () => {
        await callback?.();
        resolve();
    }, ms));
}
/**
 * Create a promise lock
 *
 * @category Promise
 * @example
 * ```
 * const lock = createPromiseLock()
 *
 * lock.run(async () => {
 *   await doSomething()
 * })
 *
 * // in anther context:
 * await lock.wait() // it will wait all tasking finished
 * ```
 */
export function createPromiseLock() {
    const locks = [];
    return {
        async run(fn) {
            const p = fn();
            locks.push(p);
            try {
                return await p;
            }
            finally {
                remove(locks, p);
            }
        },
        async wait() {
            await Promise.allSettled(locks);
        },
        isWaiting() {
            return Boolean(locks.length);
        },
        clear() {
            locks.length = 0;
        },
    };
}
/**
 * Return a Promise with `resolve` and `reject` methods
 *
 * @category Promise
 * @example
 * ```
 * const promise = createControlledPromise()
 *
 * await promise
 *
 * // in anther context:
 * promise.resolve(data)
 * ```
 */
export function createControlledPromise() {
    let resolve, reject;
    const promise = new Promise((_resolve, _reject) => {
        resolve = _resolve;
        reject = _reject;
    });
    promise.resolve = resolve;
    promise.reject = reject;
    return promise;
}
