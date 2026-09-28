import { toSingle } from "./internal/toSingle.js";
import { purry } from "./purry.js";
export function first(...args) {
    return purry(firstImplementation, args, toSingle(lazyImplementation));
}
const firstImplementation = ([item]) => item;
const lazyImplementation = () => firstLazy;
const firstLazy = (value) => ({ hasNext: true, next: value, done: true });
