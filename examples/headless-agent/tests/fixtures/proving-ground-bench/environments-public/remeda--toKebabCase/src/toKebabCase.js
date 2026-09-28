import { words } from "./internal/words.js";
import { purry } from "./purry.js";
export function toKebabCase(...args) {
    throw new Error('not implemented');
}
const toKebabCaseImplementation = (data) =>
// @ts-expect-error [ts2322] -- To avoid importing our own utilities for this
// we are using the built-in `join` and `toLowerCase` functions which aren't
// typed as well. This is equivalent to `toLowerCase(join(words(data), "-"))`
// which TypeScript infers correctly as KebabCase.
words(data).join("-").toLowerCase();
