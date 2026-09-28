import { purry } from "./purry.js";
export function partition(...args) {
    throw new Error('not implemented');
}
const partitionImplementation = (data, predicate) => {
    const ret = [[], []];
    for (const [index, item] of data.entries()) {
        if (predicate(item, index, data)) {
            ret[0].push(item);
        }
        else {
            ret[1].push(item);
        }
    }
    return ret;
};
