// We define the comparators in a global const so that they are only
// instantiated once, and so we can couple a label (string) for them that could
// be used in runtime to refer to them (e.g. "asc", "desc").
const COMPARATORS = {
    asc: (x, y) => x > y,
    desc: (x, y) => x < y,
};
/**
 * Allows functions that want to handle a variadic number of order rules a
 * a simplified API that hides most of the implementation details. The only
 * thing users of this function need to do is provide a function that would take
 * the data, and a compare function that can be used to determine the order
 * between the items of the array.
 * This functions takes care of the rest; it will parse rules, built the
 * comparer, and manage the purrying of the input arguments.
 */
export function purryOrderRules(func, inputArgs) {
    // We rely on casting blindly here, but we rely on casting blindly everywhere
    // else when we call purry so it's fine...
    const [dataOrRule, ...rules] = inputArgs;
    if (!isOrderRule(dataOrRule)) {
        // dataFirst!
        // @ts-expect-error [ts2556]: Typescript is failing to infer the type of rules
        // correctly here after the type refinement above, rules should be non-empty
        // when we get here.
        const compareFn = orderRuleComparer(...rules);
        return func(dataOrRule, compareFn);
    }
    // dataLast!
    // Important: initialize the comparer outside of the returned function so it
    // it's constructed and shared everywhere (it's stateless so should be safe
    // if used multiple times).
    const compareFn = orderRuleComparer(dataOrRule, ...rules);
    return (data) => func(data, compareFn);
}
/**
 * Some functions need an extra number argument, this helps facilitate that.
 */
export function purryOrderRulesWithArgument(func, [first, second, ...rest]) {
    // We need to pull the `n` argument out to make it work with purryOrderRules.
    let arg;
    let argRemoved;
    if (isOrderRule(second)) {
        // dataLast!
        arg = first;
        argRemoved = [second, ...rest];
    }
    else {
        // dataFirst!
        arg = second;
        argRemoved = [first, ...rest];
    }
    return purryOrderRules((...args) => func(...args, arg), argRemoved);
}
function orderRuleComparer(primaryRule, secondaryRule, ...otherRules) {
    const projector = typeof primaryRule === "function" ? primaryRule : primaryRule[0];
    const direction = typeof primaryRule === "function" ? "asc" : primaryRule[1];
    const comparator = COMPARATORS[direction];
    const nextComparer = secondaryRule === undefined
        ? undefined
        : orderRuleComparer(secondaryRule, ...otherRules);
    return (a, b) => {
        const projectedA = projector(a);
        const projectedB = projector(b);
        if (comparator(projectedA, projectedB)) {
            return 1;
        }
        if (comparator(projectedB, projectedA)) {
            return -1;
        }
        // The elements are equal base on the current comparator and projection. So
        // we need to check the elements using the next comparer, if one exists,
        // otherwise we consider them as true equal (returning 0).
        return nextComparer?.(a, b) ?? 0;
    };
}
function isOrderRule(x) {
    if (isProjection(x)) {
        return true;
    }
    if (typeof x !== "object" || !Array.isArray(x)) {
        return false;
    }
    const [maybeProjection, maybeDirection, ...rest] = x;
    return (isProjection(maybeProjection) &&
        typeof maybeDirection === "string" &&
        Object.hasOwn(COMPARATORS, maybeDirection) &&
        // Has to be a 2-tuple
        rest.length === 0);
}
const isProjection = (x) => typeof x === "function" && x.length === 1;
