import epsilon from "./epsilon.js";
import gammaln from "./gammaln.js";
import maxDistributionCells from "./max_distribution_cells.js";
/**
 * The [Binomial Distribution](http://en.wikipedia.org/wiki/Binomial_distribution) is the discrete probability
 * distribution of the number of successes in a sequence of n independent yes/no experiments, each of which yields
 * success with probability `probability`. Such a success/failure experiment is also called a Bernoulli experiment or
 * Bernoulli trial; when trials = 1, the Binomial Distribution is a Bernoulli Distribution.
 *
 * Returns `undefined` when the distribution cannot be calculated: either
 * argument is outside its domain or is not a number, or when `trials` is large
 * enough that the table would run past a million cells.
 *
 * @param {number} trials number of trials to simulate
 * @param {number} probability
 * @returns {number[] | undefined} output
 */
function binomialDistribution(trials, probability) {
    throw new Error('not implemented');
}
export default binomialDistribution;
