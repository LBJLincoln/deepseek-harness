export function isEmpty(data) {
    if (data === "" ||
        // TODO [>2]: remove `undefined` support! (don't forget to update the jsdoc example too!)
        data === undefined) {
        return true;
    }
    if (Array.isArray(data)) {
        return data.length === 0;
    }
    return Object.keys(data).length === 0;
}
