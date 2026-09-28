/**
 * A strongly-typed function to reverse a string.
 * @param str the string to reverse.
 * @returns the reversed string in both type level and runtime.
 * @example reverse('hello world') // 'dlrow olleh'
 */
function reverse(str) {
    return str.split('').reverse().join('');
}
export { reverse };
