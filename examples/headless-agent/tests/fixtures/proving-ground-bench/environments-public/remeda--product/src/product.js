import { purry } from "./purry.js";
export function product(...args) {
    throw new Error('not implemented');
}
function productImplementation(data) {
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- The rule differentiates 1 and 1n :(
    let out = typeof data[0] === "bigint" ? 1n : 1;
    for (const value of data) {
        // @ts-expect-error [ts2365] -- Typescript can't infer that all elements will be a number of the same type.
        out *= value;
    }
    return out;
}
