export function isNot(predicate) {
    return (data) => !predicate(data);
}
