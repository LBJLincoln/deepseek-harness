import { purryFromLazy } from "./internal/purryFromLazy.js";
export function mapWithFeedback(...args) {
    return purryFromLazy(lazyImplementation, args);
}
const lazyImplementation = (reducer, initialValue) => {
    let previousValue = initialValue;
    return (currentValue, index, data) => {
        previousValue = reducer(previousValue, currentValue, index, data);
        return { done: false, hasNext: true, next: previousValue };
    };
};
