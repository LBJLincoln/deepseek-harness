import { purry } from "./purry.js";
export function median(...args) {
    throw new Error('not implemented');
}
const numberComparator = (a, b) => a - b;
function medianImplementation(data) {
    if (data.length === 0) {
        return undefined;
    }
    // TODO [>2]: When node 18 reaches end-of-life bump target lib to ES2023+ and use `Array.prototype.toSorted` here.
    const sortedData = [...data].sort(numberComparator);
    // For odd length, return the middle element
    if (sortedData.length % 2 !== 0) {
        return sortedData[(sortedData.length - 1) / 2];
    }
    // For even length, return the mean of the two middle elements
    const middleIndex = sortedData.length / 2;
    return (sortedData[middleIndex] + sortedData[middleIndex - 1]) / 2;
}
