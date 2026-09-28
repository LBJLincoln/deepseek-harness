// Weight used to push `null`/`undefined` after other values when sorting, with `null` before `undefined`.
function nullishRank(value) {
    if (value === null) {
        return 1;
    }
    if (value === undefined) {
        return 2;
    }
    return 0;
}
function compareAscending(a, b) {
    const aRank = nullishRank(a);
    const bRank = nullishRank(b);
    // Compare by rank first: regular value (0) < null (1) < undefined (2).
    if (aRank < bRank) {
        return -1;
    }
    if (aRank > bRank) {
        return 1;
    }
    if (aRank !== 0) {
        return 0; // Both are the same kind of nullish.
    }
    // Both are regular values.
    if (a < b) {
        return -1;
    }
    if (a > b) {
        return 1;
    }
    return 0;
}
export function compareValues(a, b, order) {
    // Descending order is the ascending comparison with the operands swapped.
    return order === 'asc' ? compareAscending(a, b) : compareAscending(b, a);
}
