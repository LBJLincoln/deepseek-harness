export function split(dataOrSeparator, separatorOrLimit, limit) {
    return typeof separatorOrLimit === "number" || separatorOrLimit === undefined
        ? // dataLast
            (data) => data.split(dataOrSeparator, separatorOrLimit)
        : // dataFirst
            dataOrSeparator.split(separatorOrLimit, limit);
}
