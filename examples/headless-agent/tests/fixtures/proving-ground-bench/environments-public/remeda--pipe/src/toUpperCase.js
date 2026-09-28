import { purry } from "./purry.js";
export function toUpperCase(...args) {
    return purry(toUpperCaseImplementation, args);
}
const toUpperCaseImplementation = (data) =>
// @ts-expect-error [ts2322] -- TypeScript can't infer this from the code...
data.toUpperCase();
