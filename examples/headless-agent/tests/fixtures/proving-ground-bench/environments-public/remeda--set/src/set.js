import { purry } from "./purry.js";
export function set(...args) {
    throw new Error('not implemented');
}
const setImplementation = (obj, prop, value) =>
// @ts-expect-error [ts2322] - Hard to type
({ ...obj, [prop]: value });
