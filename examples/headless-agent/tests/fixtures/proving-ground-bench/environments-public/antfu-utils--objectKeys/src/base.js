export function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
export const toString = (v) => Object.prototype.toString.call(v);
export function getTypeName(v) {
    if (v === null)
        return 'null';
    const type = toString(v).slice(8, -1).toLowerCase();
    return (typeof v === 'object' || typeof v === 'function') ? type : typeof v;
}
export function noop() { }
