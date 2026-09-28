export function mergeAll(objects) {
    let out = {};
    for (const item of objects) {
        out = { ...out, ...item };
    }
    return out;
}
