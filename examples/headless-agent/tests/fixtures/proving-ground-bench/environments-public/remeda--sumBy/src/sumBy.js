import { purry } from "./purry.js";
export function sumBy(...args) {
    throw new Error('not implemented');
}
const sumByImplementation = (array, callbackfn) => {
    const iter = array.entries();
    const firstEntry = iter.next();
    if ("done" in firstEntry && firstEntry.done) {
        return 0;
    }
    const { value } = firstEntry;
    let sum = callbackfn(value[1], 0, array);
    for (const [index, item] of iter) {
        const summand = callbackfn(item, index, array);
        // @ts-expect-error [ts2365] -- Typescript can't infer that all elements will be a number of the same type.
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        sum += summand;
    }
    return sum;
};
