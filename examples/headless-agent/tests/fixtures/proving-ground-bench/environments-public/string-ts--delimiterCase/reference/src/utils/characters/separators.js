const UNESCAPED_SEPARATORS = [
    '[',
    ']',
    '{',
    '}',
    '(',
    ')',
    '|',
    '/',
    '-',
    '\\',
];
const SEPARATORS = [...UNESCAPED_SEPARATORS, ' ', '_', '.'];
/** Escape characters with special significance in regular expressions */
function escapeChar(char) {
    return UNESCAPED_SEPARATORS.includes(char)
        ? `\\${char}`
        : char;
}
export const SEPARATOR_REGEX = new RegExp(`[${SEPARATORS.map(escapeChar).join('')}]`, 'g');
