/**
 * Flat dependency resolution over an in-memory registry: one version per
 * package, chosen highest-first, with a conflict report naming the chain that
 * imposed each constraint.
 */
import { ResolveError, compareVersions, parseRange, parseVersion, satisfies } from './semver.js';

/** Raised when no version of a package satisfies everything asked of it. */
export class ConflictError extends ResolveError {
  /**
   * @param {string} packageName Package that could not be satisfied.
   * @param {Array<{range: string, via: string}>} constraints Every constraint on it, in the order they arrived.
   * @param {string[]} available Versions the registry offers, ascending.
   */
  constructor(packageName, constraints, available) {
    const detail = constraints.map((entry) => `${entry.range} (from ${entry.via})`).join(', ');
    super('CONFLICT', `cannot satisfy ${packageName}: ${detail}`);
    this.name = 'ConflictError';
    this.packageName = packageName;
    this.constraints = constraints;
    this.available = available;
  }
}

/**
 * Reject a dependency map that is not name-to-range.
 *
 * @param {unknown} deps Candidate dependency map.
 * @param {string} owner Description used in the failure message.
 * @returns {Record<string, string>} The validated map.
 */
function checkDeps(deps, owner) {
  if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) {
    throw new ResolveError('BAD_DEPENDENCIES', `${owner} must be an object`);
  }
  for (const range of Object.values(deps)) parseRange(range);
  return deps;
}

/**
 * Reject a registry that is not name-to-version-to-metadata.
 *
 * @param {unknown} registry Candidate registry.
 * @returns {Record<string, Record<string, {deps?: Record<string, string>}>>} The validated registry.
 */
function checkRegistry(registry) {
  if (typeof registry !== 'object' || registry === null || Array.isArray(registry)) {
    throw new ResolveError('BAD_REGISTRY', 'registry must be an object');
  }
  for (const [name, versions] of Object.entries(registry)) {
    if (typeof versions !== 'object' || versions === null || Array.isArray(versions)) {
      throw new ResolveError('BAD_REGISTRY', `registry entry must be an object: ${name}`);
    }
    for (const [version, meta] of Object.entries(versions)) {
      parseVersion(version);
      if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
        throw new ResolveError('BAD_REGISTRY', `metadata must be an object: ${name}@${version}`);
      }
      checkDeps(meta.deps ?? {}, `dependencies of ${name}@${version}`);
    }
  }
  return registry;
}

/**
 * Resolve one version per package.
 *
 * @param {Record<string, Record<string, {deps?: Record<string, string>}>>} registry Available packages.
 * @param {Record<string, string>} rootDeps Ranges the root asks for.
 * @returns {{resolved: Record<string, string>, order: string[]}} Selection and the order it was made in.
 */
export function resolve(registry, rootDeps) {
  throw new Error('not implemented')
}
