import { purry } from "./purry.js";
export function only(...args) {
    throw new Error('not implemented');
}
const onlyImplementation = (data) => data.length === 1 ? data[0] : undefined;
