import { purry } from "./purry.js";
export function sum(...args) {
    throw new Error('not implemented');
}
function sumImplementation(data) {
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- The rule differentiates 0 and 0n :(
    let out = typeof data[0] === "bigint" ? 0n : 0;
    for (const value of data) {
        // @ts-expect-error [ts2365] -- Typescript can't infer that all elements will be a number of the same type.
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        out += value;
    }
    return out;
}
