import { purry } from "./purry.js";
export function uncapitalize(...args) {
    throw new Error('not implemented');
}
const uncapitalizeImplementation = (data) => `${data[0]?.toLowerCase() ?? ""}${data.slice(1)}`;
