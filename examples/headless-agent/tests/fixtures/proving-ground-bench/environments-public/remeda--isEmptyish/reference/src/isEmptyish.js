export function isEmptyish(data) {
    // eslint-disable-next-line eqeqeq -- Less code to ship...
    if (data === "" || data == undefined) {
        // These are the only literal values that are considered emptyish.
        return true;
    }
    if (typeof data !== "object") {
        // There are no non-object types that could be empty at this point...
        return false;
    }
    if ("length" in data && typeof data.length === "number") {
        // Arrays and array-likes.
        return data.length === 0;
    }
    if ("size" in data && typeof data.size === "number") {
        // Maps and Sets.
        return data.size === 0;
    }
    // eslint-disable-next-line guard-for-in, no-unreachable-loop -- Instead of taking Object.keys just to check its length, which will be inefficient if the object has a lot of keys, we have a backdoor into an iterator of the object's properties via the `for...in` loop.
    for (const _ in data) {
        return false;
    }
    // We can't do a similar optimization for symbol props, so we leave them for
    // the very last check when the object is practically empty. Assuming that
    // even if an object has a symbol prop, it probably doesn't have thousands of
    // them.
    return Object.getOwnPropertySymbols(data).length === 0;
}
