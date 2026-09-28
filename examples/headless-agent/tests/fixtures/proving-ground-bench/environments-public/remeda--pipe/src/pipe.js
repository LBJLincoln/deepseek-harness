/* eslint-disable jsdoc/check-param-names --
 * We document pipe's function params as a single parameter entry in the docs.
 */
import { SKIP_ITEM } from "./internal/utilityEvaluators.js";
export function pipe(input, ...functions) {
    throw new Error('not implemented');
}
function extractLazySequence(
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- The items array is mutable for efficiency.
lazySteps, startIndex) {
    const lazySequence = [];
    for (let index = startIndex; index < lazySteps.length; index++) {
        const lazyStep = lazySteps[index];
        if (lazyStep === undefined) {
            break;
        }
        lazySequence.push(lazyStep);
        if (lazyStep.isSingle) {
            break;
        }
    }
    return lazySequence;
}
function processIterable(iterable,
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- The items array is mutable for efficiency.
lazySequence) {
    const accumulator = [];
    for (const value of iterable) {
        const shouldExitEarly = processItem(value, accumulator, lazySequence);
        if (shouldExitEarly) {
            break;
        }
    }
    return accumulator;
}
function processItem(item,
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- Intentionally mutable, we use the accumulator directly to accumulate the results.
accumulator,
// eslint-disable-next-line @typescript-eslint/prefer-readonly-parameter-types -- The items array is mutable for efficiency.
lazySequence) {
    if (lazySequence.length === 0) {
        accumulator.push(item);
        return false;
    }
    let currentItem = item;
    let lazyResult = SKIP_ITEM;
    let isDone = false;
    for (const [functionsIndex, { items, lazyEvaluator },] of lazySequence.entries()) {
        items.push(currentItem);
        lazyResult = lazyEvaluator(currentItem, items.length - 1, items);
        if (lazyResult.done) {
            isDone = true;
        }
        if (lazyResult.hasNext) {
            if (lazyResult.hasMany ?? false) {
                for (const subItem of lazyResult.next) {
                    const shouldExitEarly = processItem(subItem, accumulator, lazySequence.slice(functionsIndex + 1));
                    if (shouldExitEarly) {
                        return true;
                    }
                }
                return isDone;
            }
            currentItem = lazyResult.next;
        }
        else {
            break;
        }
    }
    if (lazyResult.hasNext) {
        accumulator.push(currentItem);
    }
    return isDone;
}
function isIterable(something) {
    // Check for null and undefined to avoid errors when accessing Symbol.iterator
    return (typeof something === "string" ||
        (typeof something === "object" &&
            something !== null &&
            // eslint-disable-next-line unicorn/no-computed-property-existence-check -- The prototype-chain check is intentional: iterables inherit `Symbol.iterator` from their prototype (e.g. `Array.prototype`), and `Object.hasOwn` would reject them all.
            Symbol.iterator in something));
}
