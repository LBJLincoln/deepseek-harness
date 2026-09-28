import { decodeQueryKey, decodeQueryValue, encodeQueryKey, encodeQueryValue, } from "./encoding.js";
// const EmptyObject = /* @__PURE__ */ (() => {
//   const C = function () {};
//   C.prototype = Object.create(null);
//   return C;
// })() as unknown as { new (): any };
/**
 * Parses and decodes a query string into an object.
 *
 * The input can be a query string with or without the leading `?`.
 *
 * @example
 *
 * ```js
 * parseQuery("?foo=bar&baz=qux");
 * // { foo: "bar", baz: "qux" }
 *
 * parseQuery("tags=javascript&tags=web&tags=dev");
 * // { tags: ["javascript", "web", "dev"] }
 * ```
 *
 * @note
 * The `__proto__` and `constructor` keys are ignored to prevent prototype pollution.
 *
 * @group Query_utils
 */
export function parseQuery(parametersString = "") {
    // TODO: Use new EmptyObject() instead of Object.create(null) for better performance in next major version
    // https://github.com/unjs/ufo/pull/290
    const object = Object.create(null);
    if (parametersString[0] === "?") {
        parametersString = parametersString.slice(1);
    }
    for (const parameter of parametersString.split("&")) {
        const s = parameter.match(/([^=]+)=?(.*)/) || [];
        if (s.length < 2) {
            continue;
        }
        const key = decodeQueryKey(s[1]);
        if (key === "__proto__" || key === "constructor") {
            continue;
        }
        const value = decodeQueryValue(s[2] || "");
        if (object[key] === undefined) {
            object[key] = value;
        }
        else if (Array.isArray(object[key])) {
            object[key].push(value);
        }
        else {
            object[key] = [object[key], value];
        }
    }
    return object;
}
/**
 * Encodes a pair of key and value into a url query string value.
 *
 * If the value is an array, it will be encoded as multiple key-value pairs with the same key.
 *
 * @example
 *
 * ```js
 * encodeQueryItem('message', 'Hello World')
 * // 'message=Hello+World'
 *
 * encodeQueryItem('tags', ['javascript', 'web', 'dev'])
 * // 'tags=javascript&tags=web&tags=dev'
 * ```
 *
 * @group Query_utils
 */
export function encodeQueryItem(key, value) {
    if (typeof value === "number" || typeof value === "boolean") {
        value = String(value);
    }
    if (!value) {
        return encodeQueryKey(key);
    }
    if (Array.isArray(value)) {
        return value
            .map((_value) => `${encodeQueryKey(key)}=${encodeQueryValue(_value)}`)
            .join("&");
    }
    return `${encodeQueryKey(key)}=${encodeQueryValue(value)}`;
}
/**
 * Stringfies and encodes a query object into a query string.
 *
 * @example
 *
 * ```js
 * stringifyQuery({ foo: 'bar', baz: 'qux' })
 * // 'foo=bar&baz=qux'
 *
 * stringifyQuery({ foo: 'bar', baz: undefined })
 * // 'foo=bar'
 * ```
 *
 * @group Query_utils
 */
export function stringifyQuery(query) {
    return Object.keys(query)
        .filter((k) => query[k] !== undefined)
        .map((k) => encodeQueryItem(k, query[k]))
        .filter(Boolean)
        .join("&");
}
