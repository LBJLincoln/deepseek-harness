import { purry } from "./purry.js";
export function objOf(...args) {
    throw new Error('not implemented');
}
const objOfImplementation = (value, key) =>
// @ts-expect-error [ts2322] - I'm not sure how to get the type right here...
({ [key]: value });
