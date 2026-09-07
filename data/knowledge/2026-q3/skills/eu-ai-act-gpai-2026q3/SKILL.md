---
name: eu-ai-act-gpai-2026q3
description: Use when preparing the documentation, training-data summary, provenance, and compute accounting a European general-purpose model provider owes under the EU AI Act, or when a client contract asks which duties bind in which jurisdiction — as analysed between June and September 2026, with sources. Engineering reading, not legal advice.
---

# EU AI Act obligations for general-purpose models, June to September 2026

For a model of about 120B parameters trained on the lab's own certified runs, the binding constraints are documentation, transparency, and the training-data summary, not the systemic-risk tier. The window supplied a jurisdiction map that says which provisions bind, a measured gap in published model documentation, and two vendors whose data disclosure is a usable template.

## What changed

- **Which provisions bind.** Mapping General-Purpose AI Governance in Twenty AI Middle-Power Jurisdictions (<https://arxiv.org/abs/2608.19278>, 2026-08-18; dataset on Zenodo, CC-BY-4.0): only 22 percent of mapped general-purpose AI provisions sit in binding law; ten of twenty jurisdictions hold no binding in-force provision; the EU and Brazil hold more than half of the 85 binding provisions; outside the EU no jurisdiction imposes a binding evaluation duty on a model developer; self-assessment is the majority evaluation model. The compute thresholds diverge: the EU presumes systemic risk above 1e25 floating-point operations, rebuttable, while Korea's decree sets 1e26 as one of three cumulative conditions.
- **How to operationalise it.** Operationalizing the EU AI Act in Agile Software Development (<https://arxiv.org/abs/2608.16526>, 2026-08-17) validates a 12-item guideline through 11 expert interviews.
- **What published documentation lacks.** A Large-Scale Measurement of AI Bill of Materials Completeness in Hugging Face Models (<https://arxiv.org/abs/2607.17242>, 2026-07-19) inspects about 97,500 artifacts: required structural fields are complete, while model-card, responsible-use, environmental, and limitation fields are weakly represented or missing.
- **Disclosure templates.** K2-Horizon-MoVA (<https://huggingface.co/IFM/K2-Horizon-MoVA-36B-A4B>, 2026-09-01) promises intermediate checkpoints, training data, and training code, with its pre-training corpus partly public as TxT360-v2 under CC-BY-4.0; NVIDIA's Nemotron 3 family publishes pre-training and post-training datasets, an end-to-end recipe, and RL environments. Both are working examples of a training-data summary.
- **Licence volatility as supply-chain risk.** GLM-5.2 (2026-06-16) is MIT; GLM-5.3 (2026-08-25, same base) is under a bespoke licence. A base model's licence must be pinned by version in the lineage record.
- **A European competitor for signed evidence.** hlido-eu's leaderboard (<https://huggingface.co/spaces/hlido-eu/leaderboard>, updated 2026-09-06) issues C2PA cryptographically signed, tamper-evident evidence that a test ran as described, with longitudinal re-tests and a public registry: signed agent certificates are already sold to the clients Daliesk addresses.

## What Daliesk adopts

1. The EU AI Act artifacts are generated outputs, not documents written afterwards: the composition manifest, the data-use terms pinned to every session, the sign-off records, and the training-run record with its cumulative compute produce the model card, the training-data summary, and the provenance statement.
2. The release is shaped like an AI bill of materials that fills the fields the measurement found missing: datasets and their licences, limitations, responsible use, environmental information.
3. A per-jurisdiction duty table, derived from the Zenodo provision dataset, is part of each client contract's technical annex.
4. Compute accounting sits on the training-run record as a fraction of the 1e25 presumption, so the systemic-risk question is answered by a number, not an argument.
5. Certificates and sign-off records are the counter to signed third-party evidence: the runner's certificate over a restored fixture, with its tree hash and check digests, is the lab's tamper-evident proof, and its export should be signable.

## Using the references

`references/items.md` lists every corpus item this theme selects, with date, evidence level, and URL. Cite the URL when a claim rests on an item; this skill is an engineering reading of the sources, not legal advice.
