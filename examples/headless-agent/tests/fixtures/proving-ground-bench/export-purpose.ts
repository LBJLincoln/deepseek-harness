/**
 * The purpose a Proving Ground bench run exports its trajectories for, read
 * from the data-use terms the composition pins every cell session with. A run
 * whose agreement admits `training` exports for training; a run on the
 * operator's subscription route, whose agreement admits `evaluation` alone,
 * exports for evaluation. The curator then writes exactly the sessions whose
 * own pinned terms list that purpose.
 * @module
 */

import type { DataUsePurpose, DataUseTerms } from '@deepseek-ai/dsh-data-use'

/** The purposes a bench export serves, in the order the bench prefers them. */
const BENCH_EXPORT_PURPOSES: readonly DataUsePurpose[] = ['training', 'evaluation']

/**
 * Choose the purpose one bench run exports for.
 * @param terms - the composition's default terms, which every fresh cell session is pinned with.
 * @returns `training` when the terms admit it, otherwise `evaluation`.
 * @throws when the terms admit neither, because a curated export of such a run
 *   would withhold every cell; the drivers call this before the first cell runs.
 */
export function benchExportPurpose(terms: DataUseTerms): DataUsePurpose {
  const purpose = BENCH_EXPORT_PURPOSES.find(candidate => terms.purposes.includes(candidate))
  if (purpose === undefined) {
    throw new Error(
      `the composition pins agreement ${terms.agreementId} admitting ${terms.purposes.join(', ')}; a bench run exports for training or evaluation`,
    )
  }
  return purpose
}
