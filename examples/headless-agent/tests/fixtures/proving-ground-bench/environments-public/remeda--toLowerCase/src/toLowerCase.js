import { purry } from "./purry.js";
export function toLowerCase(...args) {
    throw new Error('not implemented');
}
const toLowerCaseImplementation = (data) =>
// @ts-expect-error [ts2322] -- TypeScript can't infer this from the code...
data.toLowerCase();
