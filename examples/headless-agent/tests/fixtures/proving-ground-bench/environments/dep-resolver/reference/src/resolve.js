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
  checkRegistry(registry);
  checkDeps(rootDeps, 'root dependencies');

  const constraints = new Map();
  const firstVia = new Map();
  const chains = new Map();
  const selection = new Map();
  const pending = new Set();
  const order = [];

  const addConstraint = (name, range, via) => {
    if (!constraints.has(name)) {
      constraints.set(name, []);
      firstVia.set(name, via);
    }
    constraints.get(name).push({ range, via });
  };

  const versionsOf = (name) => Object.keys(registry[name] ?? {}).sort(compareVersions);

  for (const name of Object.keys(rootDeps).sort()) {
    addConstraint(name, rootDeps[name], '<root>');
    pending.add(name);
  }

  while (pending.size > 0) {
    const name = [...pending].sort()[0];
    pending.delete(name);
    if (registry[name] === undefined) throw new ResolveError('UNKNOWN_PACKAGE', `unknown package: ${name}`);
    const wanted = constraints.get(name);
    const available = versionsOf(name);
    const candidates = available.filter((version) => wanted.every((entry) => satisfies(version, entry.range)));
    if (candidates.length === 0) throw new ConflictError(name, [...wanted], available);
    const chosen = candidates[candidates.length - 1];
    selection.set(name, chosen);
    order.push(name);
    chains.set(name, `${firstVia.get(name)} > ${name}@${chosen}`);

    const deps = registry[name][chosen].deps ?? {};
    for (const dep of Object.keys(deps).sort()) {
      addConstraint(dep, deps[dep], chains.get(name));
      if (!selection.has(dep)) {
        pending.add(dep);
      } else if (!satisfies(selection.get(dep), deps[dep])) {
        throw new ConflictError(dep, [...constraints.get(dep)], versionsOf(dep));
      }
    }
  }

  const resolved = {};
  for (const name of [...selection.keys()].sort()) resolved[name] = selection.get(name);
  return { resolved, order };
}
