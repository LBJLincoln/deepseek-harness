import epsilon from "./epsilon.js";
import gammaln from "./gammaln.js";
import maxDistributionCells from "./max_distribution_cells.js";
/**
 * The [Poisson Distribution](http://en.wikipedia.org/wiki/Poisson_distribution)
 * is a discrete probability distribution that expresses the probability
 * of a given number of events occurring in a fixed interval of time
 * and/or space if these events occur with a known average rate and
 * independently of the time since the last event.
 *
 * The Poisson Distribution is characterized by the strictly positive
 * mean arrival or occurrence rate, `λ`.
 *
 * Returns `undefined` when the distribution cannot be calculated: when `lambda`
 * is not a strictly positive number, or when it is large enough that the table
 * would run past a million cells.
 *
 * @param {number} lambda location poisson distribution
 * @returns {number[] | undefined} values of poisson distribution at that point
 */
function poissonDistribution(lambda) {
    throw new Error('not implemented');
}
export default poissonDistribution;
