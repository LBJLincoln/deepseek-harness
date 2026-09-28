export function sliceString(dataOrIndexStart, indexStartOrIndexEnd, indexEnd) {
    return typeof dataOrIndexStart === "string"
        ? dataOrIndexStart.slice(indexStartOrIndexEnd, indexEnd)
        : (data) => data.slice(dataOrIndexStart, indexStartOrIndexEnd);
}
