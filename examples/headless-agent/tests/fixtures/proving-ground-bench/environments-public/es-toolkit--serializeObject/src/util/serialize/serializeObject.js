import { compareValues } from "./compareValues.js";
import { serializeValue } from "./serialize.js";
import { serializePlainObject } from "./serializePlainObject.js";
import { serializeString } from "./serializeString.js";
import { isArrayBuffer } from "../../predicate/isArrayBuffer.js";
import { isDate } from "../../predicate/isDate.js";
import { isError } from "../../predicate/isError.js";
import { isMap } from "../../predicate/isMap.js";
import { isPlainObject } from "../../predicate/isPlainObject.js";
import { isRegExp } from "../../predicate/isRegExp.js";
import { isSet } from "../../predicate/isSet.js";
import { isTypedArray } from "../../predicate/isTypedArray.js";
/**
 * Serializes an object, handling circular references and repeated references.
 *
 * The first time an object is visited, it is registered as `#ref{n}` where `n`
 * is the visit order; if the object is reached again while it is still being
 * serialized, the back-reference is emitted instead. Once completed, the
 * serialized string is memoized so that repeated references serialize
 * in constant time.
 *
 * @param value - The object to serialize, or `null`.
 * @param refs - The circular reference context shared across one serialization.
 * @returns The serialized string.
 * @throws {TypeError} If the object cannot be serialized.
 */
export function serializeObject(value, refs) {
    throw new Error('not implemented');
}
function serializeObjectImpl(value, refs) {
    if (Array.isArray(value)) {
        return serializeArray(value, refs);
    }
    if (isPlainObject(value)) {
        return serializePlainObject(value, refs);
    }
    if (isDate(value)) {
        return Number.isNaN(value.getTime()) ? 'Date(null)' : `Date(${serializeString(value.toISOString())})`;
    }
    if (isRegExp(value)) {
        return `RegExp(${value.toString()})`;
    }
    if (isSet(value)) {
        const values = Array.from(value).sort((a, b) => compareValues(a, b, refs));
        return `Set${serializeArray(values, refs)}`;
    }
    if (isMap(value)) {
        return serializeEntries('Map', value.entries(), refs);
    }
    if (isTypedArray(value)) {
        const name = value[Symbol.toStringTag];
        if (name === 'BigInt64Array' || name === 'BigUint64Array') {
            return `${name}[${value.join('n,')}${value.length > 0 ? 'n' : ''}]`;
        }
        return `${name}[${value.join(',')}]`;
    }
    if (isArrayBuffer(value)) {
        return `ArrayBuffer[${new Uint8Array(value).join(',')}]`;
    }
    if (isError(value)) {
        return `Error(${value.name}: ${serializeString(value.message)})`;
    }
    const tag = Object.prototype.toString.call(value).slice(8, -1);
    if (tag === 'Object') {
        return serializeClassInstance(value, refs);
    }
    if (typeof value.entries === 'function') {
        return serializeEntries(tag, value.entries(), refs);
    }
    throw new TypeError(`Cannot serialize ${tag}`);
}
function serializeArray(array, refs) {
    let result = '[';
    for (let i = 0; i < array.length; i++) {
        if (i > 0) {
            result += ',';
        }
        result += serializeValue(array[i], refs);
    }
    return result + ']';
}
function serializeEntries(tag, entries, refs) {
    const sortedEntries = Array.from(entries).sort((a, b) => compareValues(a[0], b[0], refs));
    let result = `${tag}{`;
    for (let i = 0; i < sortedEntries.length; i++) {
        const [key, value] = sortedEntries[i];
        if (i > 0) {
            result += ',';
        }
        result += `${serializeValue(key, refs)}:${serializeValue(value, refs)}`;
    }
    return result + '}';
}
function serializeClassInstance(value, refs) {
    const constructor = value.constructor;
    const name = constructor === Object || constructor === undefined ? '' : constructor.name;
    if ('toJSON' in value && typeof value.toJSON === 'function') {
        const json = value.toJSON();
        if (json !== null && typeof json === 'object') {
            return name + serializeObject(json, refs);
        }
        return `${name}(${serializeValue(json, refs)})`;
    }
    return name + serializePlainObject(value, refs);
}
