import { purry } from "./purry.js";
export function isDeepEqual(...args) {
    throw new Error('not implemented');
}
function isDeepEqualImplementation(data, other) {
    if (data === other) {
        return true;
    }
    if (Object.is(data, other)) {
        // We want to ignore the slight differences between `===` and `Object.is` as
        // both of them largely define equality from a semantic point-of-view.
        return true;
    }
    if (typeof data !== "object" || typeof other !== "object") {
        return false;
    }
    if (data === null || other === null) {
        return false;
    }
    if (!isComparablePrototype(data, other)) {
        // If the objects don't share a prototype it's unlikely that they are
        // semantically equal. It is technically possible to build 2 prototypes that
        // act the same but are not equal (at the reference level, checked via
        // `===`) and then create 2 objects that are equal although we would fail on
        // them. Because this is so unlikely, the optimization we gain here for the
        // rest of the function by assuming that `other` is of the same type as
        // `data` is more than worth it.
        return false;
    }
    if (Array.isArray(data)) {
        return isDeepEqualArrays(data, other);
    }
    if (data instanceof Map) {
        return isDeepEqualMaps(data, other);
    }
    if (data instanceof Set) {
        return isDeepEqualSets(data, other);
    }
    if (data instanceof Date) {
        return data.getTime() === other.getTime();
    }
    if (data instanceof RegExp) {
        return data.toString() === other.toString();
    }
    // At this point we only know that the 2 objects have a comparable prototype and are not
    // any of the previous types. They could be plain objects (Object.prototype),
    // they could be classes, they could be other built-ins, or they could be
    // something weird. We assume that comparing values by keys is enough to judge
    // their equality.
    if (Object.keys(data).length !== Object.keys(other).length) {
        return false;
    }
    for (const [key, value] of Object.entries(data)) {
        if (!Object.hasOwn(other, key)) {
            return false;
        }
        if (!isDeepEqualImplementation(value,
        // @ts-expect-error [ts7053] - We already checked that `other` has `key`
        other[key])) {
            return false;
        }
    }
    return true;
}
function isComparablePrototype(data, other) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- This is a low-level check, we can't avoid it being typed as `any`.
    const dataPrototype = Object.getPrototypeOf(data);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- This is a low-level check, we can't avoid it being typed as `any`.
    const otherPrototype = Object.getPrototypeOf(other);
    if (dataPrototype === otherPrototype) {
        return true;
    }
    if (dataPrototype === null) {
        return otherPrototype === Object.prototype;
    }
    return dataPrototype === Object.prototype && otherPrototype === null;
}
function isDeepEqualArrays(data, other) {
    if (data.length !== other.length) {
        return false;
    }
    for (const [index, item] of data.entries()) {
        if (!isDeepEqualImplementation(item, other[index])) {
            return false;
        }
    }
    return true;
}
function isDeepEqualMaps(data, other) {
    if (data.size !== other.size) {
        return false;
    }
    for (const [key, value] of data) {
        if (!other.has(key)) {
            return false;
        }
        if (!isDeepEqualImplementation(value, other.get(key))) {
            return false;
        }
    }
    return true;
}
function isDeepEqualSets(data, other) {
    if (data.size !== other.size) {
        return false;
    }
    // To ensure we only count each item once we need to "remember" which items of
    // the other set we've already matched against. We do this by creating a copy
    // of the other set and removing items from it as we find them in the data
    // set.
    const otherCopy = [...other];
    for (const dataItem of data) {
        const matchIndex = otherCopy.findIndex((otherItem) => isDeepEqualImplementation(dataItem, otherItem));
        if (matchIndex === -1) {
            return false;
        }
        otherCopy.splice(matchIndex, 1);
    }
    return true;
}
