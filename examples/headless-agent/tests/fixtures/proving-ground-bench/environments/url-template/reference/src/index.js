/**
 * URI templates: parsing a template into literal and expression parts, and
 * expanding it with the per-operator prefix, separator, naming and
 * percent-encoding rules.
 */

export { UriTemplateError, parse } from './parse.js';
export { expand } from './expand.js';
