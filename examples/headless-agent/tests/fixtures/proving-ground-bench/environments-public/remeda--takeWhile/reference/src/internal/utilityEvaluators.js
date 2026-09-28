const EMPTY_PIPE = { done: true, hasNext: false };
/**
 * A singleton value for skipping an item in a lazy evaluator.
 */
export const SKIP_ITEM = { done: false, hasNext: false };
/**
 * A helper evaluator when we want to return an empty result. It memoizes both
 * the result and the evaluator itself to reduce memory usage.
 */
export const lazyEmptyEvaluator = () => EMPTY_PIPE;
/**
 * A helper evaluator when we want to return a shallow clone of the input. It
 * memoizes both the evaluator itself to reduce memory usage.
 */
export const lazyIdentityEvaluator = (value) => ({
    hasNext: true,
    next: value,
    done: false,
});
