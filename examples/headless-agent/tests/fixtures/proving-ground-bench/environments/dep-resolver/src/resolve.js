/**
 * Flat dependency resolution over an in-memory registry: one version per
 * package, chosen highest-first, with a conflict report naming the chain that
 * imposed each constraint.
 */
import { ResolveError } from './semver.js';

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
 * Resolve one version per package.
 *
 * @param {Record<string, Record<string, {deps?: Record<string, string>}>>} registry Available packages.
 * @param {Record<string, string>} rootDeps Ranges the root asks for.
 * @returns {{resolved: Record<string, string>, order: string[]}} Selection and the order it was made in.
 */
export function resolve(registry, rootDeps) {
  throw new Error('not implemented');
}
