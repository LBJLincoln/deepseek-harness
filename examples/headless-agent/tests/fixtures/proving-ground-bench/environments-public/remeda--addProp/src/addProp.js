import { purry } from "./purry.js";
export function addProp(...args) {
    throw new Error('not implemented');
}
const addPropImplementation = (obj, prop, value) =>
// @ts-expect-error [ts2322] - Hard to type...
({ ...obj, [prop]: value });
