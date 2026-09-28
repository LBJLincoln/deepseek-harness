export function debounce(func, { waitMs, timing = "trailing", maxWaitMs, }) {
    if (maxWaitMs !== undefined && waitMs !== undefined && maxWaitMs < waitMs) {
        throw new Error(`debounce: maxWaitMs (${maxWaitMs.toString()}) cannot be less than waitMs (${waitMs.toString()})`);
    }
    // All these are part of the debouncer runtime state:
    // The timeout is the main object we use to tell if there's an active cool-
    // down period or not.
    let coolDownTimeoutId;
    // We use an additional timeout to track how long the last debounced call is
    // waiting.
    let maxWaitTimeoutId;
    // For 'trailing' invocations we need to keep the args around until we
    // actually invoke the function.
    let latestCallArgs;
    // To make any value of the debounced function we need to be able to return a
    // value. For any invocation except the first one when 'leading' is enabled we
    // will return this cached value.
    let result;
    const handleInvoke = () => {
        if (maxWaitTimeoutId !== undefined) {
            // We are invoking the function so the wait is over...
            const timeoutId = maxWaitTimeoutId;
            maxWaitTimeoutId = undefined;
            clearTimeout(timeoutId);
        }
        /* v8 ignore if -- This protects us against changes to the logic, there is no known flow we can simulate to reach this condition. It can only happen if a previous timeout isn't cleared (or faces a race condition clearing). @preserve */
        if (latestCallArgs === undefined) {
            // If you see this error pop up when using this function please report
            // it on the Remeda github page!
            throw new Error("REMEDA[debounce]: latestCallArgs was unexpectedly undefined.");
        }
        const args = latestCallArgs;
        // Make sure the args aren't accidentally used again, this is mainly
        // relevant for the check above where we'll fail a subsequent call to
        // 'trailingEdge'.
        latestCallArgs = undefined;
        // Invoke the function and store the results locally.
        // @ts-expect-error [ts2345, ts2322] -- TypeScript infers the generic sub-
        // types too eagerly, making itself blind to the fact that the types match
        // here.
        result = func(...args);
    };
    const handleCoolDownEnd = () => {
        if (coolDownTimeoutId === undefined) {
            // It's rare to get here, it should only happen when `flush` is called
            // when the cool-down window isn't active.
            return;
        }
        // Make sure there are no more timers running.
        const timeoutId = coolDownTimeoutId;
        coolDownTimeoutId = undefined;
        clearTimeout(timeoutId);
        // Then reset state so a new cool-down window can begin on the next call.
        if (latestCallArgs !== undefined) {
            // If we have a debounced call waiting to be invoked at the end of the
            // cool-down period we need to invoke it now.
            handleInvoke();
        }
    };
    const handleDebouncedCall = (args) => {
        // We save the latest call args so that (if and) when we invoke the function
        // in the future, we have args to invoke it with.
        latestCallArgs = args;
        if (maxWaitMs !== undefined && maxWaitTimeoutId === undefined) {
            // We only need to start the maxWait timeout once, on the first debounced
            // call that is now being delayed.
            maxWaitTimeoutId = setTimeout(handleInvoke, maxWaitMs);
        }
    };
    return {
        call: (...args) => {
            if (coolDownTimeoutId === undefined) {
                // This call is starting a new cool-down window!
                if (timing === "trailing") {
                    // Only when the timing is "trailing" is the first call "debounced".
                    handleDebouncedCall(args);
                }
                else {
                    // Otherwise for "leading" and "both" the first call is actually
                    // called directly and not via a timeout.
                    // @ts-expect-error [ts2345, ts2322] -- TypeScript infers the generic
                    // sub-types too eagerly, making itself blind to the fact that the
                    // types match here.
                    result = func(...args);
                }
            }
            else {
                // There's an inflight cool-down window.
                if (timing !== "leading") {
                    // When the timing is 'leading' all following calls are just ignored
                    // until the cool-down period ends. But for the other timings the call
                    // is "debounced".
                    handleDebouncedCall(args);
                }
                // The current timeout is no longer relevant because we need to wait the
                // full `waitMs` time from this call.
                const timeoutId = coolDownTimeoutId;
                coolDownTimeoutId = undefined;
                clearTimeout(timeoutId);
            }
            coolDownTimeoutId = setTimeout(handleCoolDownEnd,
            // If waitMs is not defined but maxWaitMs *is* it means the user is only
            // interested in the leaky-bucket nature of the debouncer which is
            // achieved by setting waitMs === maxWaitMs. If both are not defined we
            // default to 0 which would wait until the end of the execution frame.
            waitMs ?? maxWaitMs ?? 0);
            // Return the last computed result while we "debounce" further calls.
            return result;
        },
        cancel: () => {
            // Reset all "in-flight" state of the debouncer. Notice that we keep the
            // cached value!
            if (coolDownTimeoutId !== undefined) {
                const timeoutId = coolDownTimeoutId;
                coolDownTimeoutId = undefined;
                clearTimeout(timeoutId);
            }
            if (maxWaitTimeoutId !== undefined) {
                const timeoutId = maxWaitTimeoutId;
                maxWaitTimeoutId = undefined;
                clearTimeout(timeoutId);
            }
            latestCallArgs = undefined;
        },
        flush: () => {
            // Flush is just a manual way to trigger the end of the cool-down window.
            handleCoolDownEnd();
            return result;
        },
        get isPending() {
            return coolDownTimeoutId !== undefined;
        },
        get cachedValue() {
            return result;
        },
    };
}
