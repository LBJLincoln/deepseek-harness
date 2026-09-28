import { purry } from "./purry.js";
export function swapIndices(...args) {
    throw new Error('not implemented');
}
const swapIndicesImplementation = (data, index1, index2) => typeof data === "string"
    ? // eslint-disable-next-line @typescript-eslint/no-misused-spread -- TODO: I'm not sure what the right way to split the string here, there are multiple "correct" answers and each one is meaningfully different: https://github.com/sindresorhus/eslint-plugin-unicorn/issues/2521
        swapArray([...data], index1, index2).join("")
    : swapArray(data, index1, index2);
function swapArray(data, index1, index2) {
    const result = [...data];
    if (Number.isNaN(index1) || Number.isNaN(index2)) {
        return result;
    }
    const positiveIndexA = index1 < 0 ? data.length + index1 : index1;
    if (positiveIndexA < 0 || positiveIndexA >= data.length) {
        return result;
    }
    const positiveIndexB = index2 < 0 ? data.length + index2 : index2;
    if (positiveIndexB < 0 || positiveIndexB >= data.length) {
        return result;
    }
    result[positiveIndexA] = data[positiveIndexB];
    result[positiveIndexB] = data[positiveIndexA];
    return result;
}
