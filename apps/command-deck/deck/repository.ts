/**
 * Links from the deck to the repository its records live in. The deck is a
 * static page, so a document it cites is linked on GitHub, on the branch the
 * records are committed to.
 */

/** The repository the records live in. */
export const REPOSITORY = 'https://github.com/LBJLincoln/deepseek-harness'

/** The development branch the deck's records and documents are committed to. */
const BRANCH = 'claude/coding-agent-harness-u9l4gt'

/** Where a reviewed codebase and its records go; every text about the code under review links it. */
export const DATA_HANDLING_URL = `${REPOSITORY}/blob/${BRANCH}/docs/client/data-handling.md`
