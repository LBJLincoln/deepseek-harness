export function prop(maybeData, ...args) {
    throw new Error('not implemented');
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
