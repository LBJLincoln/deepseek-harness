import { purry } from "./purry.js";
export function capitalize(...args) {
    throw new Error('not implemented');
}
const capitalizeImplementation = (data) => `${data[0]?.toUpperCase() ?? ""}${data.slice(1)}`;
