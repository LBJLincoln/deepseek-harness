import { words } from "./internal/words.js";
import { purry } from "./purry.js";
export function toSnakeCase(...args) {
    return purry(toSnakeCaseImplementation, args);
}
const toSnakeCaseImplementation = (data) =>
// @ts-expect-error [ts2322] -- To avoid importing our own utilities for this
// we are using the built-in `join` and `toLowerCase` functions which aren't
// typed as well. This is equivalent to `toLowerCase(join(words(data), "_"))`
// which TypeScript infers correctly as SnakeCase.
words(data).join("_").toLowerCase();
