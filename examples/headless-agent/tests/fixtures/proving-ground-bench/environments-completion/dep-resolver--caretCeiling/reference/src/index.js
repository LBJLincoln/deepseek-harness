/**
 * Public surface of the dependency resolver.
 */
export { ResolveError, compareVersions, maxSatisfying, parseRange, parseVersion, satisfies } from './semver.js';
export { ConflictError, resolve } from './resolve.js';
