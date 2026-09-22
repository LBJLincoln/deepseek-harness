# Data

English | [中文](README.zh.md)

What this repository keeps of its own operation, as files rather than claims.

- [transcripts/](transcripts/README.md): the process transcripts of the agent sessions that build this repository, raw and as a compact dataset.
- [proving-ground/](proving-ground/README.md): real Proving Ground runs, with their cell session logs, exports, and observatory pages; [proving-ground/dashboard.html](proving-ground/dashboard.html) is the one page folded from all of them, [proving-ground/improvement-log.md](proving-ground/improvement-log.md) is the ledger of every improvement iteration they tested, and [proving-ground/datasets/](proving-ground/README.md) holds the training-corpus folds.
- [knowledge/](knowledge/README.md): knowledge packs distilled from dated research sweeps, kept as a sourced corpus and served to agents as skills.
- [code-safety/](code-safety/README.md): real code-safety reviews of repositories this harness did not write, with the report each one released, the findings behind it, and the committed examiner's verdict.

All four are analysis records. The one exception is a fold whose manifest names `training` as its purpose under `proving-ground/datasets/`: it holds only sessions whose pinned terms admit training, which today means the free open-weight routes, and it is a rebuildable index of records rather than a corpus. Everything else under `data/` is evaluation-only by its terms: the RLVR corpus comes from the harness's own certified runs on routes whose terms allow it, gated by the [data-use terms](../packages/governance/data-use/README.md) and the [curator](../packages/governance/curator/README.md).
