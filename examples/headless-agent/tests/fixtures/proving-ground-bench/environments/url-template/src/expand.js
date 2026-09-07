/** URI template expansion following the operator table. */

import { UriTemplateError, parse } from './parse.js';

/**
 * Expand a template against a set of variables.
 *
 * @param {string} template template text
 * @param {Record<string, unknown>} variables values bound by name, read as own properties
 * @returns {string} the expanded URI
 */
export function expand(template, variables) {
  throw new Error('not implemented');
}
