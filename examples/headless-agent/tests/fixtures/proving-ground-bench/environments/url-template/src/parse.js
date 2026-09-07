/** URI template parsing into literal and expression parts. */

/** Failure raised while parsing or expanding a template. */
export class UriTemplateError extends Error {
  /**
   * @param {string} message reason
   * @param {number} [index] 0-based index of the `{` that opens the offending expression
   */
  constructor(message, index) {
    super(message);
    this.name = 'UriTemplateError';
    this.index = index;
  }
}

/**
 * Split a template into literal and expression parts.
 *
 * @param {string} template template text
 * @returns {({ type: 'literal', value: string } | { type: 'expression', operator: string, variables: object[] })[]}
 *   the parts in order, with adjacent literal text merged
 */
export function parse(template) {
  if (typeof template !== 'string') throw new UriTemplateError('template must be a string');
  if (template === '') return [];
  if (!template.includes('{') && !template.includes('}')) return [{ type: 'literal', value: template }];
  throw new Error('not implemented');
}
