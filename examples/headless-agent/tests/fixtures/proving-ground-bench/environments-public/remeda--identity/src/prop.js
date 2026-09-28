export function prop(maybeData, ...args) {
    return typeof maybeData === "string" ||
        typeof maybeData === "number" ||
        typeof maybeData === "symbol"
        ? (data) => propImplementation(data, maybeData, ...args)
        : propImplementation(maybeData, ...args);
}
function propImplementation(data, ...keys) {
    let output = data;
    for (const key of keys) {
        if (output === undefined || output === null) {
            return undefined;
        }
        // @ts-expect-error [ts7053] -- This is fine, the types are really dynamic
        // here and TypeScript doesn't have a chance to infer them correctly.
        output = output[key];
    }
    return output;
}
