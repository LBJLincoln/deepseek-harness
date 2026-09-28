export function isIncludedIn(dataOrContainer, container) {
    if (container === undefined) {
        // === dataLast ===
        // We don't use purry here because we can optimize the dataLast case by
        // memoizing a set and accessing it in O(1) time instead of scanning the
        // array **each time** (O(n)) each time.
        const asSet = new Set(dataOrContainer);
        return (data) => asSet.has(data);
    }
    // === dataFirst ===
    return container.includes(dataOrContainer);
}
